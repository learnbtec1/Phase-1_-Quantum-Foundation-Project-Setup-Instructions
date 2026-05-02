'use client';

/**
 * Autonomous recovery: resumes AudioContext, replays timeline audio, rebinds viseme timeline,
 * re-dispatches lip-sync events, requests WS reconnect, then Web Speech escalation.
 * Watcher (800ms) + sequential retries (200→500→1000 ms) capped at three steps per anomaly.
 */

import { readLipSyncProbeFromWindow } from '@/app/avatar-agent/motion/motionPipelineDebug';
import type { AudioTimelineSource } from '@/lib/avatar/audioTimeline';
import {
  bindAudioUtterance,
  getActiveAudioElement,
  getTimelineSource,
  getUtteranceGeneration,
  getVisemeCues,
} from '@/lib/avatar/audioTimeline';
import {
  peekSharedAudioContext,
  resumeSharedAudioContext,
} from '@/lib/audio/avatarAudioContext';
import {
  cogniMetricsBumpRecoveryTrigger,
  cogniMetricsRecordRecoveryCycleEnd,
  cogniMetricsRecordRecoveryCycleStart,
  cogniMetricsRecordRecoveryEscalation,
  cogniMetricsRecordRecoveryStep,
  cogniMetricsSnapshot,
} from '@/lib/observability/cogniMetrics';
import { getStableWebSpeechVoice } from '@/ai/io/webSpeechVoice';
import { useBrainStore } from '@/store/useBrainStore';

const MAX_SEQUENTIAL_RETRIES = 3;
const WATCH_INTERVAL_MS_DEFAULT = 800;
const HEALTH_RECHECK_MS = 420;
const RECOVERY_COOLDOWN_MS = 1800;

const STEP_DELAYS_MS = [200, 500, 1000] as const;

let intervalId: ReturnType<typeof setInterval> | null = null;
let installed = false;
/** Sentinel so first anomaly is not swallowed by cooldown */
let lastRecoveryWallMs = Number.NEGATIVE_INFINITY;
let lastUtteranceGenSeen = -1;
let escalatedThisUtterance = false;
let recovering = false;
/** True after we have observed wsConnectedHint === true at least once. */
let wsWasConnectedEver = false;

let stallSamples = 0;
let lastPlayheadSeen: number | null = null;
let weakPbStreak = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLastSpeakTextForRecovery(): string {
  if (typeof window === 'undefined') return '';
  const w = window as Window & { __cogniLastSpeakTextForRecovery?: string };
  const t = typeof w.__cogniLastSpeakTextForRecovery === 'string'
    ? w.__cogniLastSpeakTextForRecovery
    : '';
  return t.trim().slice(0, 2800);
}

/**
 * WS reconnect during recovery stays enabled for the agent channel.
 * WS `speech_data` binary TTS playback is permanently off — recovery does not imply MP3 playback.
 */
function wsRecoveryRelevant(): boolean {
  return true;
}

function syncUtterance(): void {
  const g = getUtteranceGeneration();
  if (g !== lastUtteranceGenSeen) {
    lastUtteranceGenSeen = g;
    escalatedThisUtterance = false;
    recovering = false;
    stallSamples = 0;
    lastPlayheadSeen = null;
    weakPbStreak = 0;
  }
}

function rebindTimelineFromCurrent(reason: string): boolean {
  const audio = getActiveAudioElement();
  const cues = getVisemeCues();
  const src = getTimelineSource() as AudioTimelineSource | null;
  if (!audio || cues.length === 0 || !src) return false;
  try {
    bindAudioUtterance({
      audio,
      cues: cues.map((c) => ({ t: c.t, id: c.id })),
      source: src,
    });
    window.dispatchEvent(
      new CustomEvent('avatar:audio:element', { detail: { audio } }),
    );
    window.dispatchEvent(
      new CustomEvent('avatar:visemes:timeline', {
        detail: { cues },
      }),
    );
    cogniMetricsRecordRecoveryStep(`rebind_timeline:${reason}`);
    return true;
  } catch {
    cogniMetricsRecordRecoveryStep(`rebind_timeline_failed:${reason}`);
    return false;
  }
}

async function replayAudio(reason: string): Promise<void> {
  const el = getActiveAudioElement();
  if (!el || el.ended) return;
  try {
    const p = el.play();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      await (p as Promise<void>).catch(() => {});
    }
    cogniMetricsRecordRecoveryStep(`audio_replay:${reason}`);
  } catch {
    cogniMetricsRecordRecoveryStep(`audio_replay_failed:${reason}`);
  }
}

function redispatchSpeakStart(reason: string): void {
  try {
    const st = useBrainStore.getState();
    const emotion = String(st.emotionLabel ?? 'neutral');
    const arousal = st.pad?.arousal ?? 0;
    const intensity = Math.min(
      1,
      Math.max(0.28, 0.35 + Math.abs(arousal) * 0.55),
    );
    window.dispatchEvent(
      new CustomEvent('avatar:speak:start', {
        detail: { emotion, intensity },
      }),
    );
    cogniMetricsRecordRecoveryStep(`redispatch_speak_start:${reason}`);
  } catch {
    cogniMetricsRecordRecoveryStep(`redispatch_speak_start_failed:${reason}`);
  }
}

function requestWsReconnect(reason: string): void {
  if (!wsRecoveryRelevant()) return;
  const fn = (
    typeof window !== 'undefined'
      ? (window as Window & { __cogniRequestWsReconnect?: () => void })
          .__cogniRequestWsReconnect
      : undefined
  );
  try {
    fn?.();
    cogniMetricsRecordRecoveryStep(`ws_reconnect_requested:${reason}`);
  } catch {
    cogniMetricsRecordRecoveryStep(`ws_reconnect_request_failed:${reason}`);
  }
}

function fallbackWebSpeech(text: string, reason: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const u = text.trim().slice(0, 2800);
  if (!u) return;
  try {
    window.speechSynthesis.cancel();
    const ut = new SpeechSynthesisUtterance(u);
    const v = getStableWebSpeechVoice(window.speechSynthesis);
    if (v) ut.voice = v;
    ut.lang = document.documentElement?.lang?.startsWith('ar') ? 'ar-JO' : 'ar-JO';
    window.speechSynthesis.speak(ut);
    cogniMetricsRecordRecoveryStep(`web_speech_fallback:${reason}`);
  } catch {
    cogniMetricsRecordRecoveryStep(`web_speech_fallback_failed:${reason}`);
  }
}

function isHealthyEnough(): boolean {
  const probe = readLipSyncProbeFromWindow();
  const snap = cogniMetricsSnapshot();

  try {
    const ctx = peekSharedAudioContext();
    if (ctx && ctx.state !== 'running') return false;
  } catch {
    /* */
  }

  const audio = getActiveAudioElement();
  const talking = !!(probe?.talking && probe.phase === 'active');

  if (talking && probe && probe.visemeCount > 0) {
    if (!probe.playbackDominant && audio && !audio.paused && !audio.ended) {
      return false;
    }
  }

  if (!talking) return true;

  if (
    probe
    && probe.visemeCount >= 4
    && snap.morphSamplesLastWindow > 16
    && snap.morphActivityRateEwma < 0.002
  ) {
    return false;
  }

  return true;
}

function detectFault(): string | null {
  syncUtterance();
  const snap = cogniMetricsSnapshot();
  const probe = readLipSyncProbeFromWindow();
  const audio = getActiveAudioElement();

  if (snap.wsConnectedHint) wsWasConnectedEver = true;

  try {
    const ctx = peekSharedAudioContext();
    const ctxState = ctx?.state ?? snap.audioContextState;
    const needsAudio =
      !!(probe?.talking && probe.phase === 'active')
      || !!(audio && !audio.paused && !audio.ended);
    if (needsAudio && ctxState && ctxState !== 'running') {
      return `audio_context_${ctxState}`;
    }
  } catch {
    /* */
  }

  if (
    wsRecoveryRelevant()
    && wsWasConnectedEver
    && !snap.wsConnectedHint
    && !!(probe?.talking || (audio && !audio.paused && !audio.ended))
  ) {
    return 'ws_disconnected';
  }

  if (
    probe?.talking
    && probe.phase === 'active'
    && probe.visemeCount >= 3
    && snap.morphActivityRateEwma < 1e-7
    && snap.morphSamplesLastWindow > 28
  ) {
    return 'morph_activity_stalled';
  }

  const ct = probe?.audioCurrentTime ?? (audio ? audio.currentTime : null);
  if (
    probe?.talking
    && probe.phase === 'active'
    && probe.audioPaused === false
    && ct != null
    && Number.isFinite(ct)
  ) {
    if (lastPlayheadSeen !== null && Math.abs(ct - lastPlayheadSeen) < 8e-4) {
      stallSamples += 1;
    } else {
      stallSamples = 0;
    }
    lastPlayheadSeen = ct;
    if (stallSamples >= 3) {
      return 'audio_playhead_stalled';
    }
  } else {
    stallSamples = 0;
    lastPlayheadSeen = ct;
  }

  if (
    audio
    && !audio.paused
    && !audio.ended
    && probe
    && probe.talking
    && probe.visemeCount > 0
    && probe.playbackDominant === false
    && probe.audioReady
  ) {
    weakPbStreak += 1;
    if (weakPbStreak >= 4) return 'playback_not_dominant';
  } else {
    weakPbStreak = 0;
  }

  return null;
}

async function runSequentialRecovery(reason: string): Promise<boolean> {
  cogniMetricsRecordRecoveryCycleStart(reason);

  for (let i = 0; i < MAX_SEQUENTIAL_RETRIES; i += 1) {
    const stepDelay =
      STEP_DELAYS_MS[Math.min(i, STEP_DELAYS_MS.length - 1)]!;
    await delay(stepDelay);

    cogniMetricsRecordRecoveryStep(`attempt_${i + 1}_resume_audio_context`);
    try {
      await resumeSharedAudioContext();
      const c = peekSharedAudioContext();
      if (c?.state === 'suspended') await c.resume?.();
    } catch {
      /* */
    }

    await replayAudio(reason);
    await delay(110);
    rebindTimelineFromCurrent(reason);
    redispatchSpeakStart(reason);
    requestWsReconnect(reason);
    await delay(HEALTH_RECHECK_MS);

    if (isHealthyEnough()) {
      cogniMetricsRecordRecoveryCycleEnd(true, reason);
      // eslint-disable-next-line no-console
      console.warn('[cogni:auto-recovery] recovered', {
        attempt: i + 1,
        reason,
      });
      return true;
    }
  }

  cogniMetricsRecordRecoveryCycleEnd(false, reason);
  return false;
}

function escalateAll(reason: string): void {
  if (escalatedThisUtterance) return;
  escalatedThisUtterance = true;
  // eslint-disable-next-line no-console -- critical path
  console.error('[cogni:auto-recovery] CRITICAL_AUDIO_RECOVERY_FAILED', { reason });

  cogniMetricsRecordRecoveryEscalation(reason);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('cogni:audio:recovery:critical', {
        detail: {
          message: 'Audio system recovered failure',
          reason,
        },
      }),
    );
  }

  const txt = getLastSpeakTextForRecovery();
  fallbackWebSpeech(txt, reason);
}

function tickWatcher(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible') return;

  syncUtterance();
  if (escalatedThisUtterance || recovering) return;

  const reason = detectFault();
  if (!reason) return;

  const wall =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (wall - lastRecoveryWallMs < RECOVERY_COOLDOWN_MS) {
    return;
  }
  lastRecoveryWallMs = wall;
  recovering = true;
  cogniMetricsBumpRecoveryTrigger();

  void runSequentialRecovery(reason)
    .then((ok) => {
      recovering = false;
      if (!ok) escalateAll(reason);
    })
    .catch(() => {
      recovering = false;
      escalateAll(reason);
    });
}

/** Optional: burst QA hook (also wired via window.__cogniNotifyBurstStrict after install). */
export function cogniAutoRecoveryNotifyBurstStrictRate(rate: number | null): void {
  if (rate == null || rate >= 0.6) return;
  // eslint-disable-next-line no-console
  console.warn('[cogni:auto-recovery] burst_strict_rate_low', {
    burstStrictPassRate: rate,
  });
}

export function installCogniAutoRecovery(intervalMs = WATCH_INTERVAL_MS_DEFAULT): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;

  (
    window as Window & {
      __cogniNotifyBurstStrict?: (rate: number | null) => void;
    }
  ).__cogniNotifyBurstStrict = cogniAutoRecoveryNotifyBurstStrictRate;

  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(tickWatcher, intervalMs);

  syncUtterance();
}

export function __resetCogniAutoRecoveryTestsOnly(): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  installed = false;
  recovering = false;
  escalatedThisUtterance = false;
  if (typeof window !== 'undefined') {
    delete (window as Window & { __cogniNotifyBurstStrict?: unknown })
      .__cogniNotifyBurstStrict;
    (window as Window & { __cogniRecoveryTriggersSession?: number }).__cogniRecoveryTriggersSession =
      0;
  }
}
