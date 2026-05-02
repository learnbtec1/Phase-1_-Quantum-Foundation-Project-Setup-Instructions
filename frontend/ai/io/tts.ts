/**
 * Client-side TTS: **`/api/tts-with-timing`** → Microsoft Edge neural voices (`edge-tts` on backend). No ElevenLabs.
 * Supports avatar:interrupt to stop playback when user types or speaks.
 */
import type { WordTiming } from '@/ai/lipsync/timing';
import { COGNI_PERSONA } from '@/config/personality';
import {
  getAccessToken,
  getPublicDevOpaqueToken,
  isEmergencyAuthFreeze,
} from '@/lib/auth';
import { resetSpeechIntentHints, setSpeechIntentHintsFromText } from '@/lib/avatar/speechIntentHints';
import { prepareAssistantSpeechText } from '@/lib/avatar/prepareAssistantSpeechText';
import { setUtterancePoseIntentOverride } from '@/lib/ai/cognitiveOrchestrator';
import { resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';
import { waitAudioReady } from '@/lib/audio/waitAudioReady';
import { stretchVisemeCuesToDuration, visemeEventsToCues } from '@/lib/audio/visemeCueFromApi';
import { inferEmotionFromText } from '@/ai/voice/emotionFromText';
import { getPauseMicroHeadMul } from '@/ai/voice/emotionalCoupling';
import { getSpeechEmotionSnapshot, setSpeechEmotionBridge } from '@/ai/voice/speechEmotionBridge';
import { useBrainStore } from '@/store/useBrainStore';
import {
  getBehavioralSignature,
  getPersonalityProfile,
} from '@/ai/avatar/personalityProfile';
import { bindAudioUtterance, clearAudioTimeline } from '@/lib/avatar/audioTimeline';
import { installCogniAvatarRuntimeValidation } from '@/lib/debug/avatarAudioRuntimeValidation';
import { installCogniAvatarFailsafe } from '@/lib/debug/cogniAvatarFailsafe';
import {
  cogniMetricsMarkTtsFailure,
  cogniMetricsMarkTtsPlayStarted,
  cogniMetricsMarkTtsRequestStart,
  installCogniMetricsWindow,
  startCogniMetricsWindowRefresh,
} from '@/lib/observability/cogniMetrics';
import { installCogniAutoRecovery } from '@/lib/observability/cogniAutoRecovery';
import { installCogniAvatarStateDiag } from '@/lib/debug/cogniAvatarStateDiag';
import { updateConsciousFromTts } from '@/lib/avatar/consciousStateManager';
import { automaticGestureInjectorsDisabled } from '@/lib/avatar/automaticGestureInjectors';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';
import {
  cogniDuplexAbortTtsSession,
  cogniDuplexMarkOutboundPlaybackStarted,
  cogniDuplexMarkSpeakingEnded,
  cogniDuplexStampOutboundPlaybackEnded,
  cogniDuplexTryBeginHttpTtsSession,
  cogniDuplexTryInit,
  COGNI_duplex_NATURAL_END_TAIL_MS,
  COGNI_duplex_RESUME_AFTER_FAIL_MS,
} from '@/lib/audio/cogniDuplexGate';

export type { WordTiming };

function isLevel6UnifiedBehavior(): boolean {
  return (
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_LEVEL6_UNIFIED_BEHAVIOR === 'true' ||
      process.env.NEXT_PUBLIC_LEVEL6_UNIFIED_BEHAVIOR === '1')
  );
}

/** Level6 `avatar:behavior:speech` + canonical `avatar:speak:end` (single dispatch per end). */
export function dispatchAvatarSpeakEndForTtsPlayback(): void {
  if (typeof window === 'undefined') return;
  if (isLevel6UnifiedBehavior()) {
    window.dispatchEvent(
      new CustomEvent('avatar:behavior:speech', { detail: { phase: 'agent_end' } }),
    );
  }
  window.dispatchEvent(new CustomEvent('avatar:speak:end', { detail: {} }));
}

/** Bridge path: set the authoritative `<audio>` for `audioTimeline` / LipSyncManager. */
export { setPlaybackAudio as setActiveAudioElement } from '@/lib/avatar/audioTimeline';

/** Last `<audio>` owned by this module (`speakWithTTS` only). */
export function getClientTtsAudioElement(): HTMLAudioElement | null {
  return currentAudio;
}

export interface SpeakOptions {
  emotion?:  string;   // Hint for metadata (Edge ignores most SSML-style controls)
  /** 0–1; merged with emotionFromText when omitted */
  emotionIntensity?: number;
  rate?:     number;   // Hybrid Persona Kernel: direct speed override (1.0 = normal)
  pitch?:    string;   // Phase 4: explicit Hz offset e.g. "+5Hz" (overrides emotion default)
  /** @deprecated Ignored — Edge neural voice is locked on the backend. */
  arVoice?:  'male' | 'female';
  onStart?: () => void;
  onEnd?:   () => void;
}

/**
 * `true` when build explicitly targets ElevenLabs (not default in Edge-primary stack).
 */
export function isElevenLabsTtsProvider(): boolean {
  if (typeof process === 'undefined') return false;
  const raw = (process.env.NEXT_PUBLIC_TTS_PROVIDER ?? '').trim().toLowerCase();
  return raw === 'elevenlabs';
}

/** Default UX path: Edge BFF `/api/tts-with-timing`. */
export function isEdgePrimaryTts(): boolean {
  const raw = (process.env.NEXT_PUBLIC_TTS_PROVIDER ?? 'edge').trim().toLowerCase();
  return raw === '' || raw === 'edge' || raw === 'auto';
}

// Emotion speed mapping (كما هو)
/** Emotion → default TTS speed; exported for AgentDirector + Cogni persona blending */
export const EMOTION_SPEED: Record<string, number> = {
  neutral:     0.93,
  friendly:    0.97,
  thinking:    0.82,
  encouraging: 1.07,
  strict:      0.88,
  celebrate:   1.14,
  celebrating: 1.14,
  excited:     1.10,
  happy:       1.04,
  proud:       1.02,
  surprised:   1.05,
  curious:     0.99,
  attentive:   0.95,
  empathetic:  0.85,
  concerned:   0.85,
  sad:         0.80,
  anxious:     0.91,
};

/** Blend emotion default speed with a persona multiplier (e.g. Cogni calm = 0.95). */
export function resolveSpeakRate(emotion: string | undefined, personaRateMultiplier: number): number {
  const e = emotion ?? 'neutral';
  const base = EMOTION_SPEED[e] ?? EMOTION_SPEED.neutral;
  return Math.min(1.18, Math.max(0.78, base * personaRateMultiplier));
}

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

// ─── PAD voice override (from AgentDirector avatar:voice events) ─────────────
/** Current voice hint from avatar:voice; applied in next speakWithTTS call. */
let _padVoiceRate:  number | null = null;
let _padVoicePitch: string | null = null;

/** Called once in app init to listen for avatar:voice directives. */
export function initAvatarVoiceListener(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('avatar:voice', (e: Event) => {
    const d = (e as CustomEvent<{ rate?: number; pitch?: number | string }>).detail;
    if (typeof d?.rate === 'number' && Number.isFinite(d.rate)) {
      _padVoiceRate = Math.max(0.75, Math.min(1.25, d.rate));
    }
    if (d?.pitch !== undefined) {
      const p = d.pitch;
      if (typeof p === 'string') _padVoicePitch = p;
      else if (typeof p === 'number' && Number.isFinite(p)) {
        // convert numeric PAD pitch (±scale) → Hz offset string
        const hz = Math.round((p - 1) * 20);
        _padVoicePitch = hz >= 0 ? `+${hz}Hz` : `${hz}Hz`;
      }
    }
  });
}

/** Consume pending PAD overrides (called once per speakWithTTS invocation). */
export function consumePadVoiceHint(): { rate?: number; pitch?: string } {
  const out: { rate?: number; pitch?: string } = {};
  if (_padVoiceRate  !== null) { out.rate  = _padVoiceRate;  _padVoiceRate  = null; }
  if (_padVoicePitch !== null) { out.pitch = _padVoicePitch; _padVoicePitch = null; }
  return out;
}

/** Monotonically-increasing session ID — guards against concurrent speakWithTTS calls. */
let _ttsSessionId = 0;
/** Pending viseme setTimeout IDs — cleared on interrupt. */
const _visemeTimers: ReturnType<typeof setTimeout>[] = [];
/** Sentence-end nod timers from `scheduleNods` — must not outlive interrupt (race + leak). */
const _nodTimers: ReturnType<typeof setTimeout>[] = [];
let _ttsFailsafeTimer: number | null = null;

function clearTtsPlaybackFailsafeTimer(): void {
  if (_ttsFailsafeTimer === null || typeof window === 'undefined') return;
  window.clearTimeout(_ttsFailsafeTimer);
  _ttsFailsafeTimer = null;
}

/** True while client BFF TTS audio is actively playing (after successful play()). */
let _clientTtsPlaying = false;

/** True while WS `speech_data` playback is active (same flag as HTTP TTS). */
export function isClientTtsPlaying(): boolean {
  return _clientTtsPlaying;
}

/** Stop module-scoped TTS and viseme timers; clears playing flag. Call from useAgentAgent for unified pipeline. */
export function stopTTSGlobally(): void {
  _clientTtsPlaying = false;
  stopTTS();
}

/** Wrap raw 16-bit mono PCM bytes (Kokoro output) in a valid WAV container. */
function pcmBytesToWavBlob(pcmBytes: Uint8Array, sampleRate: number): Blob {
  const numChannels  = 1;
  const bitsPerSample = 16;
  const byteRate  = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize   = pcmBytes.length;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view   = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Large-safe base64 for `data:audio/...;base64,...` URLs (PCM→WAV path). */
function uint8ToBase64(u8: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < u8.length; i += chunk) {
    const sub = u8.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

/** Single app-wide `<audio>` — set once from AvatarAgentClient (`setTtsPlaybackAudioElement`). */
let _registeredPlaybackAudio: HTMLAudioElement | null = null;
let _onPlaybackEnded: (() => void) | null = null;
let _onPlaybackError: (() => void) | null = null;

export function setTtsPlaybackAudioElement(el: HTMLAudioElement | null): void {
  _registeredPlaybackAudio = el;
}

export function getTtsPlaybackAudioElement(): HTMLAudioElement | null {
  return _registeredPlaybackAudio;
}

/** Retries (~200 ms) while `<audio>` is still settling — paired with {@link isAudioStable}. */
export const COGNI_VAD_AUDIO_STABILITY_RETRY_MAX = 24;
const COGNI_VAD_AUDIO_STABILITY_RETRY_MS = 200;

/** @internal exported for gates that align with retry delay */
export const COGNI_VAD_AUDIO_STABILITY_RETRY_DELAY_MS = COGNI_VAD_AUDIO_STABILITY_RETRY_MS;

function ttsPlaybackElementHasRenderableSrc(audio: HTMLAudioElement): boolean {
  try {
    const rawAttr = audio.getAttribute('src');
    if (rawAttr !== null && String(rawAttr).trim() !== '') return true;
  } catch {
    /* */
  }
  const prop = String(audio.src ?? '').trim();
  if (!prop) return false;
  if (
    typeof window !== 'undefined' &&
    window.location?.href &&
    prop === window.location.href
  ) {
    return false;
  }
  return true;
}

/** Prefer in-DOM `#tts-audio`; falls back to the registered singleton. */
export function getTtsPlaybackElementForVadGate(): HTMLAudioElement | null {
  if (typeof document !== 'undefined') {
    const dom = document.querySelector('#tts-audio');
    if (dom instanceof HTMLAudioElement) return dom;
  }
  return getTtsPlaybackAudioElement();
}

/**
 * Whether the outbound TTS `<audio>` is safe for opening the microphone:
 * idle (no URI), or `ended` + `paused`.
 * Allows `currentTime === 0` at `ended` when `duration > 0` (engine quirk).
 */
export function isAudioStable(audio: HTMLAudioElement | null | undefined): boolean {
  if (!audio) return true;
  if (!ttsPlaybackElementHasRenderableSrc(audio)) return true;

  const paused = audio.paused === true;
  const ended = audio.ended === true;
  if (!paused || !ended) return false;

  const ct =
    typeof audio.currentTime === 'number' && Number.isFinite(audio.currentTime)
      ? audio.currentTime
      : 0;
  const dur =
    typeof audio.duration === 'number' && Number.isFinite(audio.duration) ? audio.duration : 0;

  const userShapeOk = paused && ended && ct > 0;
  const endedZeroTimeOk = paused && ended && dur > 0 && ct <= 0.001;
  return Boolean(userShapeOk || endedZeroTimeOk);
}

/** Same as {@link isAudioStable} plus “no in-flight marked client TTS”. */
export function isOutboundTtsAudioStableForMic(audio: HTMLAudioElement | null | undefined): boolean {
  if (isClientTtsPlaying()) return false;
  return isAudioStable(audio);
}


/** If Avatar mount is late/race-y, bind `#tts-audio` or synthetic `Audio` — never omit playback in dev recovery. */
function ensureTtsPlaybackAudioElement(): HTMLAudioElement {
  const existing = getTtsPlaybackAudioElement();
  if (existing) return existing;
  if (typeof document !== 'undefined') {
    const dom = document.getElementById('tts-audio');
    if (dom instanceof HTMLAudioElement) {
      dom.preload = 'auto';
      dom.crossOrigin = 'anonymous';
      dom.volume = 0.94;
      setTtsPlaybackAudioElement(dom);
      return dom;
    }
  }
  const synth = new Audio();
  synth.preload = 'auto';
  synth.crossOrigin = 'anonymous';
  synth.volume = 0.94;
  setTtsPlaybackAudioElement(synth);
  // eslint-disable-next-line no-console
  console.warn('[TTS] ensureTtsPlaybackAudioElement: fallback synthetic Audio (#tts-audio missing)');
  return synth;
}

/** TTS output level — must stay >0; never couple “recovery” to `muted` (self-healing policy). */
const TTS_PLAYBACK_VOLUME = 1;

/** Production: full-scale output — never duck TTS element volume unintentionally. */
export function normalizeTtsOutputLevel(el: HTMLAudioElement): void {
  try {
    el.preload = 'auto';
    el.muted = false;
    el.volume = TTS_PLAYBACK_VOLUME;
  } catch {
    /* */
  }
}

/**
 * Single choke-point for HTMLMediaElement playback: un-mute, full volume, play + one resume retry.
 * Never sets `audio.muted = true`.
 */
export async function safePlayAudio(audio: HTMLAudioElement): Promise<boolean> {
  try {
    if (audio.ended) {
      // eslint-disable-next-line no-console
      console.warn('[AUDIO] skip play — element already ended');
      return false;
    }
    audio.muted = false;
    audio.volume = TTS_PLAYBACK_VOLUME;
    await audio.play();
    // eslint-disable-next-line no-console
    console.log('PLAY SUCCESS');
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('PLAY FAILED → attempting recovery', err);
    try {
      await resumeSharedAudioContext();
      audio.muted = false;
      audio.volume = TTS_PLAYBACK_VOLUME;
      if (audio.ended) {
        return false;
      }
      await audio.play();
      // eslint-disable-next-line no-console
      console.log('PLAY RECOVERED');
      return true;
    } catch (err2) {
      // eslint-disable-next-line no-console
      console.error('PLAY HARD FAIL', err2);
      try {
        if (typeof window !== 'undefined') {
          cogniMetricsMarkTtsFailure('safePlayAudio_hard_fail');
          (window as Window & { __cogniAudioFailure?: Record<string, unknown> }).__cogniAudioFailure = {
            reason: 'play_failed',
            error: err2 instanceof Error ? err2.message : String(err2),
          };
          window.dispatchEvent(
            new CustomEvent('cogni:audio:failure', {
              detail: { reason: 'play_failed', error: String(err2) },
            }),
          );
        }
      } catch {
        /* */
      }
      logTtsHardFail('safePlayAudio_hard_fail', err2);
      return false;
    }
  }
}

/** If decode never advances (~silent / stuck decode), rewind and replay once. */
function scheduleSilentPlaybackProbe(audio: HTMLAudioElement, sessionId: number): void {
  setTimeout(() => {
    if (sessionId !== _ttsSessionId) return;
    if (currentAudio !== audio) return;
    if (audio.ended) {
      const verbose =
        typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_TTS === 'true';
      if (verbose) {
        // eslint-disable-next-line no-console -- dev-only: explains early return of silent probe
        console.log('[TTS silent probe] skip — audio ended (normal idle)', { silentPlaybackProbe: true });
      }
      return;
    }
    try {
      if (!audio.muted && audio.volume > 0 && audio.currentTime < 0.05) {
        // eslint-disable-next-line no-console
        console.warn('⚠️ Silent playback detected → forcing restart');
        audio.currentTime = 0;
        audio.muted = false;
        audio.volume = TTS_PLAYBACK_VOLUME;
        if (audio.ended) {
          return;
        }
        void safePlayAudio(audio);
      }
    } catch {
      /* */
    }
  }, 300);
}

function cogniAudioWatchdogImpl(): void {
  const a = document.querySelector('#tts-audio') as HTMLAudioElement | null;
  if (!a) return;
  try {
    /** Idle: element at rest — avoid console spam every 2s (not a render-loop deadlock). */
    if (!_clientTtsPlaying && (a.ended || (!ttsPlaybackElementHasRenderableSrc(a) && a.paused))) {
      return;
    }

    /**
     * Orphan: half-duplex / `isTalkingRef` still locked but MediaElement finished
     * (dropped `ended` or race). One reconcile via `stopTTS` (bumps session, clears duplex, `avatar:speak:end`).
     */
    if (_clientTtsPlaying && a.ended) {
      cogniDuplexStampOutboundPlaybackEnded(Date.now());
      const verbose =
        typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_TTS === 'true';
      if (verbose) {
        // eslint-disable-next-line no-console -- dev-only
        console.warn('[TTS watchdog] reconcile — ended while _clientTtsPlaying (stopTTS)');
      }
      stopTTS();
      return;
    }

    if (a.muted || a.volume === 0) {
      // eslint-disable-next-line no-console
      console.warn('🔧 Fixing muted audio');
      a.muted = false;
      a.volume = TTS_PLAYBACK_VOLUME;
    }
    if (_clientTtsPlaying && a.paused && !!a.src && ttsPlaybackElementHasRenderableSrc(a)) {
      // eslint-disable-next-line no-console
      console.log('[AUDIO STATE]', {
        paused: a.paused,
        ended: a.ended,
        currentTime: a.currentTime,
      });
      if (a.ended) {
        cogniDuplexStampOutboundPlaybackEnded(Date.now());
        stopTTS();
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('🔧 Restarting paused audio');
      void safePlayAudio(a);
    }
  } catch {
    /* */
  }
}

function cogniAudioDebugImpl(): Record<string, unknown> {
  const a = document.querySelector('#tts-audio') as HTMLAudioElement | null;
  return {
    exists: Boolean(a),
    muted: a?.muted ?? null,
    volume: a?.volume ?? null,
    paused: a?.paused ?? null,
    currentTime:
      a && !Number.isNaN(a.currentTime) ? a.currentTime : null,
    ended: a?.ended ?? null,
    srcExists: Boolean(a?.src?.length),
  };
}

let _cogniAudioWatchdogInterval: number | null = null;

function installCogniSelfHealingAudioHooks(): void {
  if (typeof window === 'undefined') return;
  if (_cogniAudioWatchdogInterval !== null) return;
  const w = window as Window & {
    __cogniAudioWatchdog?: () => void;
    __cogniAudioDebug?: () => Record<string, unknown>;
  };
  w.__cogniAudioWatchdog = cogniAudioWatchdogImpl;
  w.__cogniAudioDebug = cogniAudioDebugImpl;
  _cogniAudioWatchdogInterval = window.setInterval(cogniAudioWatchdogImpl, 2000);
}

function detachPlaybackElementListeners(): void {
  const el = currentAudio;
  if (el && _onPlaybackEnded && _onPlaybackError) {
    try {
      el.removeEventListener('ended', _onPlaybackEnded);
      el.removeEventListener('error', _onPlaybackError);
    } catch {
      /* */
    }
  }
  _onPlaybackEnded = null;
  _onPlaybackError = null;
}

/**
 * Fade out client BFF TTS audio then release (barge-in).
 * Does not hard-cut unless fadeMs is 0.
 * Duplex unlock + `avatar:speak:end` run **after** the audible tail (fade done or pause), never at fade start.
 */
export function fadeOutStopTTS(
  fadeMs = 120,
  opts?: { skipSpeakEnd?: boolean; skipNeutralViseme?: boolean },
): void {
  _ttsSessionId += 1;
  _clientTtsPlaying = false;
  clearTtsPlaybackFailsafeTimer();
  clearAudioTimeline('fadeOutStopTTS:start');
  while (_visemeTimers.length) clearTimeout(_visemeTimers.pop()!);
  while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
  if (typeof window !== 'undefined' && !opts?.skipNeutralViseme) {
    window.dispatchEvent(
      new CustomEvent('avatar:viseme', { detail: { id: 0, weights: { aa: 0, ih: 0, ou: 0 } } }),
    );
    window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
  }

  const releaseSpeakFloorAfterAudibleInterrupt = (): void => {
    if (typeof window === 'undefined') return;
    setSpeechEmotionBridge(null);
    if (!opts?.skipSpeakEnd) {
      resetSpeechIntentHints();
      cogniDuplexMarkSpeakingEnded();
      dispatchAvatarSpeakEndForTtsPlayback();
    }
  };

  detachPlaybackElementListeners();

  const a = currentAudio;
  const finish = (): void => {
    if (currentAudio === a) currentAudio = null;
    if (currentUrl) {
      try {
        URL.revokeObjectURL(currentUrl);
      } catch { /* ignore */ }
      currentUrl = null;
    }
  };

  if (!a || fadeMs <= 0.001) {
    if (a) {
      try {
        a.pause();
        a.currentTime = 0;
        if (!currentUrl) {
          a.removeAttribute('src');
        }
      } catch { /* ignore */ }
    }
    releaseSpeakFloorAfterAudibleInterrupt();
    clearAudioTimeline('fadeOutStopTTS');
    finish();
    return;
  }

  const v0 = typeof a.volume === 'number' && Number.isFinite(a.volume) ? a.volume : 1;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const step = (): void => {
    if (currentAudio !== a) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    const u = Math.min(1, t / fadeMs);
    try {
      a.volume = Math.max(0, v0 * (1 - u));
    } catch { /* ignore */ }
    if (u < 1) {
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(step);
      else window.setTimeout(step, 16);
    } else {
      try {
        a.pause();
        a.currentTime = 0;
        if (!currentUrl) {
          a.removeAttribute('src');
        }
      } catch { /* ignore */ }
      releaseSpeakFloorAfterAudibleInterrupt();
      clearAudioTimeline('fadeOutStopTTS-done');
      finish();
    }
  };
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(step);
  else window.setTimeout(step, 16);
}

/**
 * Stop current TTS playback. Called when user interrupts (types or speaks).
 * `skipSpeakEnd`: when chaining a new `speakWithTTS` session onto the same
 * element — avoids a spurious `avatar:speak:end` that would prematurely resume half-duplex VAD.
 */
export function stopTTS(opts?: { skipSpeakEnd?: boolean }): void {
  _ttsSessionId += 1;
  _clientTtsPlaying = false;
  clearTtsPlaybackFailsafeTimer();
  // Cancel pending viseme events
  while (_visemeTimers.length) clearTimeout(_visemeTimers.pop()!);
  while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('avatar:viseme', { detail: { id: 0, weights: { aa: 0, ih: 0, ou: 0 } } }));
    window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
  }
  clearAudioTimeline('stopTTS');
  detachPlaybackElementListeners();
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      if (currentUrl) {
        try {
          URL.revokeObjectURL(currentUrl);
        } catch { /* ignore */ }
        currentUrl = null;
      } else {
        try {
          currentAudio.removeAttribute('src');
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    currentAudio = null;
  } else if (currentUrl) {
    try {
      URL.revokeObjectURL(currentUrl);
    } catch { /* ignore */ }
    currentUrl = null;
  }
  if (typeof window !== 'undefined') {
    resetSpeechIntentHints();
    setSpeechEmotionBridge(null);
    if (!opts?.skipSpeakEnd) {
      cogniDuplexMarkSpeakingEnded();
      dispatchAvatarSpeakEndForTtsPlayback();
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('cogni:avatar:interrupt', () => {
    fadeOutStopTTS(130);
  });
}

/** BFF TTS round-trip (cold start / model load on backend can exceed default browser patience). */
const TTS_BFF_FETCH_TIMEOUT_MS = 15_000;

function ttsBffFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), TTS_BFF_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ac.signal }).finally(() => clearTimeout(tid));
}

let _lastTtsFailEmbodimentAt = 0;
const TTS_FAIL_EMBODIMENT_COOLDOWN_MS = 850;

/**
 * Digital Human: when TTS fails, show **Thinking** motion + **confused** face instead of freezing.
 * Throttled to avoid gesture spam on rapid retries.
 */
export function emitTtsFailureEmbodiment(_reason?: string): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - _lastTtsFailEmbodimentAt < TTS_FAIL_EMBODIMENT_COOLDOWN_MS) return;
  _lastTtsFailEmbodimentAt = now;
  window.dispatchEvent(
    new CustomEvent('avatar:emotion', { detail: { emotion: 'confused', strength: 0.64 } }),
  );
  if (!isVrmaPlaybackGloballyDisabled()) {
    window.dispatchEvent(
      new CustomEvent('avatar:vrma:play', {
        detail: { name: 'Thinking', durationMs: 2700, intensity: 0.58 },
      }),
    );
  }
  window.dispatchEvent(
    new CustomEvent('avatar:gaze', { detail: { yaw: -0.045, pitch: 0.07, durationMs: 1500 } }),
  );
  window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: 'slow' } }));
}

/** True if BFF error body has no salvageable `audio_base64` (Phase 22 — avoid confused face on flaky 503 with payload). */
function bffErrorBodyLooksAudioEmpty(body: string): boolean {
  const t = (body || '').trim();
  if (!t) return true;
  try {
    const j = JSON.parse(t) as { audio_base64?: unknown };
    const b64 = j.audio_base64;
    if (typeof b64 === 'string' && b64.replace(/\s/g, '').length >= 64) {
      return false;
    }
  } catch {
    /* proxy/HTML/text */
  }
  return true;
}

/**
 * Emit failure avatar when upstream BFF error looks like missing audio payload.
 */
function maybeEmitTtsFailureAfterBff(reason: string, errBody: string): void {
  if (bffErrorBodyLooksAudioEmpty(errBody)) {
    emitTtsFailureEmbodiment(reason);
  }
}

/** Dev checklist: merges `window.__cogniLastTtsResponse` (success + HARD FAIL telemetry). */
function mergeCogniLastTtsResponse(patch: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    const w = window as Window & { __cogniLastTtsResponse?: Record<string, unknown> };
    const prev = w.__cogniLastTtsResponse ?? {};
    w.__cogniLastTtsResponse = { ...prev, ...patch };
  } catch {
    /* */
  }
}

function logTtsHardFail(reason: string, detail?: unknown): void {
  const d =
    detail === undefined ? '' : typeof detail === 'string' ? detail : String(detail);
  // eslint-disable-next-line no-console
  console.error('TTS HARD FAIL', reason, d);
  mergeCogniLastTtsResponse({
    audio_url: null,
    duration: null,
    visemeCount: 0,
    provider_used: null,
    failure_reason: reason,
    failure_detail: d || undefined,
    ts: Date.now(),
  });
}

/**
 * Client-side TTS: **Edge neural** via `/api/tts-with-timing` → FastAPI `edge-tts`.
 * Returns the playing `HTMLAudioElement` on success, or `null` if fetch/play failed.
 */
export async function speakWithTTS(
  text: string,
  options?: SpeakOptions
): Promise<HTMLAudioElement | null> {
  if (typeof window === 'undefined' || !text?.trim()) return null;
  /** True only after `avatar:speak` / `avatar:speak:start` were emitted following successful `safePlayAudio`. */
  let speakUiDispatched = false;
  let bearer = getAccessToken();
  /** Docker builds often omit NEXT_PUBLIC_COGNI_* — freeze still allows guest BFF→backend pairing. */
  if (!bearer && isEmergencyAuthFreeze()) {
    bearer = getPublicDevOpaqueToken();
  }
  const guestTtsOk =
    isEmergencyAuthFreeze() ||
    process.env.NEXT_PUBLIC_COGNI_WS_ALLOW_ANONYMOUS === 'true' ||
    process.env.NEXT_PUBLIC_COGNI_WS_GUEST_OK === 'true';
  if (!isEmergencyAuthFreeze() && !bearer && !guestTtsOk) {
    // getAccessToken() already logged `[Auth] ❌ Token missing or invalid` — no fetch (avoids 401 spam).
    console.error('[speakWithTTS] ❌ Short-circuit: no valid JWT — skipping TTS BFF');
    logTtsHardFail('auth_gate_no_jwt');
    return null;
  }

  const speechPrep = prepareAssistantSpeechText(text.trim());
  if (!speechPrep.ttsText.trim()) {
    logTtsHardFail('empty_tts_after_markup_strip');
    return null;
  }
  const ttsLine = speechPrep.ttsText;

  const ttsLog =
    typeof process !== 'undefined' &&
    (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_TTS === 'true');
  if (ttsLog) {
    // eslint-disable-next-line no-console
    console.log('[speakWithTTS] 🔊 TTS CALLED', { chars: ttsLine.length });
  }
  cogniDuplexTryInit();
  const duplexHeldRef = { current: false };
  const beginDup = cogniDuplexTryBeginHttpTtsSession(ttsLine);
  if (!beginDup.ok) {
    return null;
  }
  duplexHeldRef.current = true;
  const abortDuplexHeldPreCleanup = (): void => {
    if (!duplexHeldRef.current) return;
    duplexHeldRef.current = false;
    cogniDuplexAbortTtsSession('speakWithTTS_pipeline');
  };

  /** Must match `_ttsSessionId` after invalidating prior playback — `stopTTS` increments the id itself. */
  stopTTS({ skipSpeakEnd: true });
  const mySid = _ttsSessionId;
  cogniMetricsMarkTtsRequestStart();

  try {
    // FIX: voice stability — blend emotion speed with Cogni persona rate/pitch consistently
    const inferred = inferEmotionFromText(ttsLine);
    const resolvedEmotion = options?.emotion ?? inferred.emotion;
    const resolvedIntensity = options?.emotionIntensity ?? inferred.intensity;
    const personaRate = COGNI_PERSONA.voiceParameters.rate;
    // Consume any PAD-driven voice hint emitted by AgentDirector via avatar:voice
    const padHint     = consumePadVoiceHint();
    const blendedSpeed =
      options?.rate ?? padHint.rate ?? resolveSpeakRate(resolvedEmotion, personaRate);
    const defaultPitchFromPersona =
      COGNI_PERSONA.voiceParameters.pitchScale > 1.005
        ? `+${Math.round((COGNI_PERSONA.voiceParameters.pitchScale - 1) * 45)}Hz`
        : undefined;
    const resolvedPitch =
      options?.pitch ?? padHint.pitch ?? defaultPitchFromPersona;

    const ttsBffPath = '/api/tts-with-timing';

    // eslint-disable-next-line no-console
    console.log('TTS START', { path: ttsBffPath, provider: 'edge', chars: ttsLine.length });
    if (ttsLog) {
      // eslint-disable-next-line no-console
      console.log('[TTS] TTS START', { chars: ttsLine.length, path: ttsBffPath });
    }

    const sharedTtsPayload: Record<string, unknown> = {
      text: ttsLine,
      speed: blendedSpeed,
      emotion: resolvedEmotion,
      emotion_intensity: resolvedIntensity,
      ...(resolvedPitch ? { pitch: resolvedPitch } : {}),
    };

    const edgeTtsRequestBody = JSON.stringify({
      ...sharedTtsPayload,
      provider: 'edge',
    });

    const ttsHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (bearer) {
      ttsHeaders.Authorization = `Bearer ${bearer}`;
      // eslint-disable-next-line no-console
      console.log('[Network] 🔑 Attaching JWT to TTS Request');
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        '[Network] TTS without Authorization (guest) — requires COGNI_BFF_DEV_BYPASS_AUTH on Next + COGNI_DEV_BYPASS_AUTH on backend',
      );
    }

    const doTtsFetch = (): Promise<Response> =>
      ttsBffFetch(ttsBffPath, {
        method: 'POST',
        headers: ttsHeaders,
        body: edgeTtsRequestBody,
      });

    const isTtsHourlyQuota = (status: number, body: string) =>
      status === 429 ||
      /tts_hourly_limit|"TTS hourly limit|hourly limit exceeded|tts_rate_limit/i.test(body);

    const res = await doTtsFetch();

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error('[TTS]', 'BFF HTTP error', res.status, errBody.slice(0, 480));

      if (res.status === 401) {
        console.error('[TTS] ❌ Unauthorized (401)');
        logTtsHardFail('http_401', res.status);
        abortDuplexHeldPreCleanup();
        return null;
      }

      if (isTtsHourlyQuota(res.status, errBody)) {
        console.warn(
          '[speakWithTTS] TTS hourly quota exceeded. Set TTS_CALL_LIMIT_PER_HOUR in backend .env (e.g. 200) or wait ~1 hour.',
          errBody.slice(0, 120),
        );
        logTtsHardFail('tts_hourly_quota', errBody.slice(0, 200));
        abortDuplexHeldPreCleanup();
        return null;
      }

      maybeEmitTtsFailureAfterBff(`http_${res.status}`, errBody);
      logTtsHardFail(`http_${res.status}`, errBody.slice(0, 400));
      abortDuplexHeldPreCleanup();
      return null;
    }

    const data = await res.json().catch(() => null);
    const provRaw = typeof data?.provider === 'string' ? String(data.provider).trim() : '';
    const prov = provRaw.toLowerCase();
    const provider_used = provRaw || 'edge';

    if (prov && prov !== 'edge' && prov !== 'azure' && prov !== 'auto') {
      // eslint-disable-next-line no-console
      console.error('[TTS] unexpected provider in JSON:', data?.provider);
      emitTtsFailureEmbodiment('wrong_tts_provider');
      logTtsHardFail('wrong_tts_provider', String(data?.provider ?? ''));
      abortDuplexHeldPreCleanup();
      return null;
    }
    const visRaw =
      data?.viseme_events ??
      (data as { visemes?: unknown } | null)?.visemes;
    if (!Array.isArray(visRaw) || visRaw.length === 0) {
      console.error(
        '[speakWithTTS] Missing or empty viseme_events / visemes — lip sync cannot run.',
        JSON.stringify(data)?.slice(0, 240),
      );
      const b64Vis = data?.audio_base64;
      const hasAudioDespiteVisemes =
        typeof b64Vis === 'string' && b64Vis.replace(/\s/g, '').length >= 64;
      if (!hasAudioDespiteVisemes) {
        emitTtsFailureEmbodiment('empty_visemes');
      }
      logTtsHardFail('empty_visemes', JSON.stringify(data)?.slice(0, 280));
      abortDuplexHeldPreCleanup();
      return null;
    }
    const audioBase64 = data?.audio_base64;
    const wordTimings = (data?.word_timings ?? []) as WordTiming[];
    const sampleRate = data?.sample_rate ?? 44100;

    if (!audioBase64) {
      console.error(
        '[speakWithTTS] Backend returned no audio — cannot play.',
        JSON.stringify(data)?.slice(0, 300),
      );
      emitTtsFailureEmbodiment('no_audio_payload');
      logTtsHardFail('no_audio_payload');
      abortDuplexHeldPreCleanup();
      return null;
    }

    const playbackEl = ensureTtsPlaybackAudioElement();

    const b64Clean = String(audioBase64).replace(/\s/g, '');
    const binary = Uint8Array.from(atob(b64Clean), (c) => c.charCodeAt(0));
    const fmt = (data?.format ?? 'wav') as string;
    let audioSrc: string;
    if (fmt === 'pcm') {
      const wavBlob = pcmBytesToWavBlob(binary, sampleRate);
      const ab = await wavBlob.arrayBuffer();
      audioSrc = `data:audio/wav;base64,${uint8ToBase64(new Uint8Array(ab))}`;
      currentUrl = null;
    } else {
      const mime = fmt === 'wav' ? 'audio/wav' : 'audio/mpeg';
      audioSrc = `data:${mime};base64,${b64Clean}`;
      currentUrl = null;
    }

    const resp = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const serverUrlRaw =
      typeof resp?.audio_url === 'string' ? String(resp.audio_url).trim() : '';
    const playbackUrl = serverUrlRaw.length >= 24 ? serverUrlRaw : audioSrc;
    if (!playbackUrl?.trim()) {
      // eslint-disable-next-line no-console
      console.error('[TTS HARD FAIL] no audio_url from edge');
      try {
        window.dispatchEvent(
          new CustomEvent('cogni:audio:failure', {
            detail: { reason: 'no_audio_url' },
          }),
        );
      } catch {
        /* */
      }
      logTtsHardFail('no_audio_url');
      abortDuplexHeldPreCleanup();
      return null;
    }

    detachPlaybackElementListeners();
    try {
      playbackEl.pause();
      playbackEl.currentTime = 0;
    } catch {
      /* */
    }
    playbackEl.crossOrigin = 'anonymous';
    playbackEl.src = playbackUrl;
    normalizeTtsOutputLevel(playbackEl);
    const audio = playbackEl;
    currentAudio = audio;

    const visemeCues = visemeEventsToCues(visRaw);
    mergeCogniLastTtsResponse({
      audio_url: playbackUrl,
      duration: null,
      visemeCount: visemeCues.length,
      provider_used,
      failure_reason: null,
      failure_detail: null,
      ts: Date.now(),
    });

    const timingMode =
      typeof (data as { timing_mode?: string } | null)?.timing_mode === 'string'
        ? (data as { timing_mode: string }).timing_mode
        : '';
    // eslint-disable-next-line no-console
    console.log('[TTS] Viseme timeline length:', visemeCues.length);
    if (timingMode === 'phoneme_ar') {
      // eslint-disable-next-line no-console
      console.log(
        `[TTS-SYNC] High-precision phoneme map generated with ${visemeCues.length} cues.`,
      );
    }

    const rebindVisemesIfDurationDrift = (): void => {
      if (visemeCues.length === 0) return;
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur < 0.15) return;
      const stretched = stretchVisemeCuesToDuration(visemeCues, dur);
      if (stretched === visemeCues) return;
      bindAudioUtterance({
        audio,
        cues: stretched.map((c) => ({ t: c.t, id: c.id })),
        source: 'http_tts',
      });
      window.dispatchEvent(
        new CustomEvent('avatar:visemes:timeline', { detail: { cues: stretched } }),
      );
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('[TTS-SYNC] viseme timeline stretched to audio.duration=', Number(dur.toFixed(3)), 's');
      }
    };

    const onDurationChange = (): void => {
      if (mySid !== _ttsSessionId || currentAudio !== audio) return;
      rebindVisemesIfDurationDrift();
    };

    const playbackCompletionConsumedRef = { current: false };

    const finalizeSpeakWithTtsSession = (): void => {
      clearTtsPlaybackFailsafeTimer();
      if (
        playbackCompletionConsumedRef.current ||
        mySid !== _ttsSessionId ||
        currentAudio !== audio
      ) {
        return;
      }
      playbackCompletionConsumedRef.current = true;

      if (duplexHeldRef.current) {
        duplexHeldRef.current = false;
        cogniDuplexMarkSpeakingEnded();
        if (!speakUiDispatched && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('cogni:duplex:tts_aborted', {
              detail: {
                delayMs: COGNI_duplex_RESUME_AFTER_FAIL_MS,
                reason: 'speak_with_tts_cleanup_before_ui',
              },
            }),
          );
        }
      }
      _clientTtsPlaying = false;
      while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
      if (mySid === _ttsSessionId) {
        audio.removeEventListener('ended', onPlaybackEndedBound);
        audio.removeEventListener('error', onPlaybackErrorBound);
        audio.removeEventListener('durationchange', onDurationChange);
        _onPlaybackEnded = null;
        _onPlaybackError = null;
        try {
          audio.pause();
          audio.currentTime = 0;
          audio.removeAttribute('src');
        } catch {
          /* */
        }
        currentAudio = null;
        currentUrl = null;
      }
      try {
        useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      } catch {
        /* */
      }
      resetSpeechIntentHints();
      setSpeechEmotionBridge(null);
      clearAudioTimeline('speakWithTTS:cleanup');
      window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
      if (speakUiDispatched) {
        dispatchAvatarSpeakEndForTtsPlayback();
        options?.onEnd?.();
      }
    };

    const onPlaybackEndedBound = (): void => {
      clearTtsPlaybackFailsafeTimer();
      if (playbackCompletionConsumedRef.current || mySid !== _ttsSessionId || currentAudio !== audio)
        return;
      cogniDuplexStampOutboundPlaybackEnded();
      _clientTtsPlaying = false;
      window.setTimeout(() => finalizeSpeakWithTtsSession(), COGNI_duplex_NATURAL_END_TAIL_MS);
    };

    const onPlaybackErrorBound = (): void => finalizeSpeakWithTtsSession();

    _onPlaybackEnded = onPlaybackEndedBound;
    _onPlaybackError = onPlaybackErrorBound;
    audio.addEventListener('ended', onPlaybackEndedBound);
    audio.addEventListener('error', onPlaybackErrorBound);
    audio.addEventListener('durationchange', onDurationChange);

    const scheduleSpeechPausesBlink = (): void => {
      if (wordTimings.length < 2) return;
      for (let i = 1; i < wordTimings.length && _nodTimers.length < 24; i++) {
        const prev = wordTimings[i - 1]!;
        const cur = wordTimings[i]!;
        const gap = cur.start_time - prev.end_time;
        if (!Number.isFinite(gap) || gap < 360) continue;
        const triggerAt = prev.end_time + Math.min(Math.max(gap * 0.45, 80), gap - 40);
        _nodTimers.push(
          setTimeout(() => {
            if (mySid !== _ttsSessionId) return;
            window.dispatchEvent(
              new CustomEvent('avatar:blink', { detail: { style: 'normal' as const } }),
            );
          }, triggerAt),
        );
      }
    };

    const scheduleNods = () => {
      if (automaticGestureInjectorsDisabled()) return;
      if (wordTimings.length > 0) {
        const sentenceEnd = /[.!?\u061f\u060c]+$/;
        wordTimings.forEach((wt) => {
          if (sentenceEnd.test(wt.word ?? '') && wt.end_time > 0) {
            _nodTimers.push(
              setTimeout(() => {
                if (mySid !== _ttsSessionId) return;
                const headMul = getPauseMicroHeadMul(getSpeechEmotionSnapshot());
                window.dispatchEvent(new CustomEvent('avatar:nod', {
                  detail: {
                    intensity: (0.16 + Math.random() * 0.18) * headMul,
                    duration: (360 + Math.random() * 160) / 1000,
                  },
                }));
              }, wt.end_time + 120),
            );
          }
        });
      } else if (ttsLine.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3).length > 1) {
        const sentences = ttsLine.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3);
        const totalMs   = Math.max(1500, ttsLine.length * 190);
        let cumLen = 0;
        sentences.slice(0, -1).forEach((s) => {
          cumLen += s.length + 1;
          const delay = Math.max(300, (cumLen / ttsLine.length) * totalMs) + 80;
          _nodTimers.push(
            setTimeout(() => {
              if (mySid !== _ttsSessionId) return;
              const headMul = getPauseMicroHeadMul(getSpeechEmotionSnapshot());
              window.dispatchEvent(new CustomEvent('avatar:nod', {
                detail: {
                  intensity: (0.14 + Math.random() * 0.16) * headMul,
                  duration: (340 + Math.random() * 130) / 1000,
                },
              }));
            }, delay),
          );
        });
      }
    };

    const dispatchPreSpeechLead = (): void => {
      window.dispatchEvent(
        new CustomEvent('cogni:pre_speech', {
          detail: { emotion: resolvedEmotion, intensity: resolvedIntensity },
        }),
      );
      useBrainStore.getState().pulseIntentAnticipation();
      useBrainStore.getState().setPreSpeechCognitiveWindow(true);
      useBrainStore.getState().setInteractionIntent('thinking');
    };

    /** Intent + timeline bound before element plays — lips follow audio.currentTime only after play(). */
    const bindTimelineBeforePlay = (): void => {
      bindAudioUtterance({
        audio,
        cues: visemeCues.map((c) => ({ t: c.t, id: c.id })),
        source: 'http_tts',
      });
      window.dispatchEvent(
        new CustomEvent('avatar:audio:element', { detail: { audio } }),
      );
      if (visemeCues.length > 0) {
        window.dispatchEvent(
          new CustomEvent('avatar:visemes:timeline', { detail: { cues: visemeCues } }),
        );
      } else {
        window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
      }
    };

    let speakStartFired = false;
    /** Fire as soon as `play()` resolves so LipSyncManager sees isTalking before buffer wait. */
    const fireSpeakStartForLipSync = (): void => {
      if (speakStartFired) return;
      speakStartFired = true;
      useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      setSpeechEmotionBridge({
        emotion: resolvedEmotion,
        intensity: resolvedIntensity,
      });
      window.dispatchEvent(
        new CustomEvent('avatar:speak:start', {
          detail: { emotion: resolvedEmotion, intensity: resolvedIntensity },
        }),
      );
    };

    const dispatchPlaybackAfterAudibleStart = (): void => {
      speakUiDispatched = true;
      cogniMetricsMarkTtsPlayStarted({
        visemeCount: visemeCues.length,
        audioDurationSec: Number.isFinite(audio.duration) ? audio.duration : null,
      });
      try {
        if (typeof window !== 'undefined') {
          (window as Window & { __cogniLastSpeakTextForRecovery?: string }).__cogniLastSpeakTextForRecovery =
            ttsLine.slice(0, 2800);
        }
      } catch {
        /* */
      }
      fireSpeakStartForLipSync();
      window.dispatchEvent(
        new CustomEvent('avatar:speak', {
          detail: { text: ttsLine, timings: wordTimings, sampleRate, audio },
        }),
      );
      // eslint-disable-next-line no-console
      console.log('avatar');
      setUtterancePoseIntentOverride(speechPrep.utterancePoseIntent);
      setSpeechIntentHintsFromText(ttsLine);
      if (speechPrep.colonGestureCues.length > 0) {
        for (const cue of speechPrep.colonGestureCues) {
          const d = cue;
          queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent('avatar:performance', { detail: d }));
          });
        }
      }
      options?.onStart?.();
      scheduleNods();
      scheduleSpeechPausesBlink();
    };

    /** Playback via self-healing wrapper — never arms `muted` for policy; recovery is resume + replay. */
    const playWithResumeRetry = async (): Promise<boolean> => {
      // eslint-disable-next-line no-console
      console.log('[TTS] 🔊 PLAY');
      const ok = await safePlayAudio(audio);
      if (ok) scheduleSilentPlaybackProbe(audio, mySid);
      return ok;
    };

    try {
      await resumeSharedAudioContext();
      const urgencyU =
        useBrainStore.getState().behaviorContractPayload?.urgency ?? 0.55;
      updateConsciousFromTts(urgencyU, visemeCues.length);
      dispatchPreSpeechLead();
      bindTimelineBeforePlay();
      const playedOk = await playWithResumeRetry();
      if (!playedOk) {
        // eslint-disable-next-line no-console
        console.error('PLAY FAILED');
        finalizeSpeakWithTtsSession();
        cogniMetricsMarkTtsFailure('speakWithTTS_audio_play_failed');
        emitTtsFailureEmbodiment('audio_play_failed');
        return null;
      }
      fireSpeakStartForLipSync();
      await waitAudioReady(audio);
      normalizeTtsOutputLevel(audio);
      rebindVisemesIfDurationDrift();
      mergeCogniLastTtsResponse({
        duration: Number.isFinite(audio.duration) ? audio.duration : null,
      });
      cogniDuplexMarkOutboundPlaybackStarted();
      _clientTtsPlaying = true;
      // eslint-disable-next-line no-console
      console.log('[TTS EDGE OK]', { visemeCount: visemeCues.length });
      // eslint-disable-next-line no-console
      console.log('[TTS] ✅ SUCCESS');
      if (ttsLog) {
        // eslint-disable-next-line no-console
        console.log('[speakWithTTS] ✅ audio.play() resolved', {
          duration: Number.isFinite(audio.duration) ? audio.duration : null,
          muted: audio.muted,
        });
      }
      dispatchPlaybackAfterAudibleStart();

      /** If `HTMLMediaElement` `ended` never fires (browser quirks), unblock duplex + avatar:speak:end. */
      clearTtsPlaybackFailsafeTimer();
      const failsafeDeadlineMs = (() => {
        let sec =
          typeof audio.duration === 'number' && Number.isFinite(audio.duration) && audio.duration > 0.08
            ? audio.duration
            : NaN;
        if (!Number.isFinite(sec)) {
          let maxEndMs = 0;
          for (const w of wordTimings) {
            const et = w.end_time;
            if (typeof et === 'number' && Number.isFinite(et)) maxEndMs = Math.max(maxEndMs, et);
          }
          if (maxEndMs > 320) sec = maxEndMs / 1000;
        }
        if (!Number.isFinite(sec)) sec = Math.max(4.8, Math.min(120, ttsLine.length * 0.075));
        const cap = Math.min(300_000, sec * 1000 + 6200);
        return Math.max(14_500, cap);
      })();

      _ttsFailsafeTimer = window.setTimeout(() => {
        _ttsFailsafeTimer = null;
        if (playbackCompletionConsumedRef.current) return;
        if (mySid !== _ttsSessionId || currentAudio !== audio) return;
        const dur =
          typeof audio.duration === 'number' && Number.isFinite(audio.duration) ? audio.duration : NaN;
        const ct =
          typeof audio.currentTime === 'number' && Number.isFinite(audio.currentTime)
            ? audio.currentTime
            : 0;
        const logicallyEnded =
          Boolean(audio.ended) || (dur > 0.08 && ct >= dur - 0.22);
        if (logicallyEnded) {
          try {
            onPlaybackEndedBound();
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[TTS FAILSAFE] playback-end reconciliation failed', e);
          }
          return;
        }
        // eslint-disable-next-line no-console
        console.warn(
          '[TTS FAILSAFE] deadline without natural tail — unlocking duplex/stop',
          {
            paused: audio.paused,
            ended: audio.ended,
            currentTime: ct,
            duration: dur,
          },
        );
        stopTTS();
      }, failsafeDeadlineMs);

      return audio;
    } catch (playErr: unknown) {
      try {
        useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      } catch {
        /* */
      }
      console.error('[speakWithTTS] Audio play pipeline error:', playErr);
      logTtsHardFail('audio_play_error', playErr);
      try {
        window.dispatchEvent(
          new CustomEvent('cogni:audio:failure', {
            detail: {
              reason: 'play_pipeline_exception',
              error: playErr instanceof Error ? playErr.message : String(playErr),
            },
          }),
        );
      } catch {
        /* */
      }
      finalizeSpeakWithTtsSession();
      emitTtsFailureEmbodiment('audio_play_error');
      return null;
    }
  } catch (err) {
    abortDuplexHeldPreCleanup();
    cogniMetricsMarkTtsFailure(
      `[speakWithTTS_exception] ${err instanceof Error ? err.message : String(err)}`,
    );
    // Catch errors from fetch, JSON, or blob creation
    console.warn('[speakWithTTS] TTS pipeline exception:', err);
    logTtsHardFail(
      'pipeline_exception',
      err instanceof Error ? err.message : String(err),
    );
    emitTtsFailureEmbodiment('pipeline_exception');
    if (mySid === _ttsSessionId) {
      detachPlaybackElementListeners();
      if (currentUrl) {
        try { URL.revokeObjectURL(currentUrl); } catch { /* ignore */ }
        currentUrl = null;
      } else if (currentAudio) {
        try {
          currentAudio.removeAttribute('src');
        } catch { /* ignore */ }
      }
      currentAudio = null;
    }
    resetSpeechIntentHints();
    setSpeechEmotionBridge(null);
    if (speakUiDispatched) {
      dispatchAvatarSpeakEndForTtsPlayback();
      options?.onEnd?.();
    }
    return null;
  }
}

export interface PlayWsAgentTtsOptions {
  /** Base64 MP3 from WebSocket `speech_data` */
  audioBase64: string;
  /** Raw viseme cue array (offset_ms / viseme_id or Azure-style) */
  visemeRaw: unknown;
  emotion?: string;
  emotionIntensity?: number;
  /** Jitter buffer before `play()` (ms) — default 0 (minimum latency WebSocket audio). */
  bufferedStartMs?: number;
  /** Fallback line for autonomous recovery Web Speech escalation */
  recoveryTextFallback?: string;
}

/**
 * Stub: WS `speech_data` MP3 is never played (`speakWithTTS` is the single HTTP audio path → Edge `/api/tts-with-timing`).
 * Kept exported so tooling / dynamic imports resolve; callers must assume `null`.
 */
export async function playWsAgentTtsAudio(
  options: PlayWsAgentTtsOptions,
): Promise<HTMLAudioElement | null> {
  const raw = (options.audioBase64 ?? '').replace(/\s/g, '').length;
  logTtsHardFail('ws_agent_audio_blocked', raw > 32 ? `${raw} base64 chars ignored` : 'empty payload');
  // eslint-disable-next-line no-console -- invariant for ops / debugging
  console.warn('[TTS] WS speech_data playback disabled — use `/api/tts-with-timing`.', {
    base64Chars: raw,
    hint: 'AgentDirector → speakWithTTS → `/api/tts-with-timing` (Edge neural)',
  });
  return null;
}

/**
 * Runtime snapshot for debugging silent TTS / missing gestures (browser console):
 * `window.__cogniAudioDiagnostics?.()` or `await import('@/ai/io/tts').then(m => m.getCogniAudioDiagnostics())`
 */
export function getCogniAudioDiagnostics(): Record<string, unknown> {
  const l6 =
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_LEVEL6_UNIFIED_BEHAVIOR === 'true' ||
      process.env.NEXT_PUBLIC_LEVEL6_UNIFIED_BEHAVIOR === '1');
  const w = typeof window !== 'undefined' ? (window as Window & { __AUDIO_UNLOCKED__?: boolean }) : null;
  return {
    hasJwt:                    Boolean(getAccessToken()),
    cogni_access_token_raw:    typeof window !== 'undefined' ? Boolean(localStorage.getItem('cogni_access_token')) : false,
    audioElementExists:        typeof document !== 'undefined' ? !!document.querySelector('audio') : false,
    userInteracted:            Boolean(w?.__AUDIO_UNLOCKED__),
    playbackAudioRegistered: !!getTtsPlaybackAudioElement(),
    clientTtsPlaying:          _clientTtsPlaying,
    ttsPlaybackFailsafeArmed: _ttsFailsafeTimer !== null,
    automaticGestureInjectorsDisabled: automaticGestureInjectorsDisabled(),
    level6UnifiedBehavior:   l6,
    ttsClientBffRoute: '/api/tts-with-timing',
    ttsProviderEnv: process.env.NEXT_PUBLIC_TTS_PROVIDER ?? null,
    checklist: [
      'JWT required for speakWithTTS (Authorization on the TTS BFF route unless dev guest bypass).',
      'AvatarAgentClient must mount to register <audio> via setTtsPlaybackAudioElement.',
      'WS speech_data MP3 is never played in-browser — synthesis is backend Edge neural only.',
      'If gestures feel “gone”: check NEXT_PUBLIC_DISABLE_AUTOMATIC_GESTURE_INJECTORS and LEVEL6_UNIFIED_BEHAVIOR in .env.local.',
      'If `[WATCHDOG BLOCKED]` spammed console: upgrade — idle audio no longer logs every 2s; enable NEXT_PUBLIC_DEBUG_TTS for reconcile breadcrumbs.',
      'Duplex stall: window.__cogniAudioDiagnostics() + (DEBUG_AVATAR) window.__cogniAvatarDiag?.().',
    ],
  };
}

/** Console: `await window.__cogniSpeakWithTTS('اختبار الصوت')` — recovery validation */
if (typeof window !== 'undefined') {
  cogniDuplexTryInit();
  const w = window as Window & {
    __cogniSpeakWithTTS?: typeof speakWithTTS;
    __cogniAudioDiagnostics?: typeof getCogniAudioDiagnostics;
    __cogniDebugAudio?: () => Record<string, unknown>;
    __cogniAudioWatchdog?: () => void;
    __cogniAudioDebug?: () => Record<string, unknown>;
    __cogniAudioFailure?: Record<string, unknown>;
    /** Last successful HTTP/WS TTS bind — probe `audio_url`, `visemeCount`. */
    __cogniLastTtsResponse?: Record<string, unknown> | null;
  };
  w.__cogniSpeakWithTTS = speakWithTTS;
  installCogniSelfHealingAudioHooks();
  installCogniAvatarRuntimeValidation();
  installCogniAvatarStateDiag();
  installCogniMetricsWindow();
  startCogniMetricsWindowRefresh();
  installCogniAvatarFailsafe();
  installCogniAutoRecovery();
  w.__cogniAudioDiagnostics = getCogniAudioDiagnostics;
  w.__cogniDebugAudio = () => ({
    hasJWT: !!localStorage.getItem('cogni_access_token'),
    audioElementExists: !!document.querySelector('audio'),
    userInteracted: Boolean((window as Window & { __AUDIO_UNLOCKED__?: boolean }).__AUDIO_UNLOCKED__),
  });
}