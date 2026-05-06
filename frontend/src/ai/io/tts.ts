/**
 * Client-side TTS: speaks via BFF — `/api/tts-with-timing` (Edge) **or** `/api/tts-elevenlabs`
 * when `NEXT_PUBLIC_TTS_PROVIDER` is `elevenlabs` (build-time in Next.js; rebuild after changing `.env`).
 * Supports avatar:interrupt to stop playback when user types or speaks.
 */
import type { WordTiming } from '@/ai/lipsync/timing';
import { COGNI_PERSONA } from '@/config/personality';
import { getAccessToken, isCogniGuestBrowserMode } from '@/lib/auth';
import { getCogniPersonaPerformanceScales } from '@/lib/avatar/cogniPersonaStance';
import { resetSpeechIntentHints, setSpeechIntentHintsFromText } from '@/lib/avatar/speechIntentHints';
import { resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';
import { waitAudioReady } from '@/lib/audio/waitAudioReady';
import { stretchVisemeCuesToDurationIfFallback, visemeEventsToCues } from '@/lib/audio/visemeCueFromApi';
import { inferEmotionFromText } from '@/ai/voice/emotionFromText';
import { getPauseMicroHeadMul } from '@/ai/voice/emotionalCoupling';
import { getSpeechEmotionSnapshot, setSpeechEmotionBridge } from '@/ai/voice/speechEmotionBridge';
import { useBrainStore } from '@/store/useBrainStore';
import {
  getBehavioralSignature,
  getPersonalityProfile,
} from '@/ai/avatar/personalityProfile';
import { bindAudioUtterance, clearAudioTimeline, beginWebSpeechLipTimeline, appendWebSpeechVisemeCue, getPlaybackTimeSec } from '@/lib/avatar/audioTimeline';
import {
  azureVisemeIdFromSpeechBoundaryChar,
  resolveSpeechBoundaryChar,
} from '@/ai/io/webSpeechPseudoViseme';
import {
  ensureWebSpeechVoicesChangeHook,
  getStableWebSpeechVoice,
} from '@/ai/io/webSpeechVoice';
import { updateConsciousFromTts, getTotalPreSpeechDelayMs } from '@/lib/avatar/consciousStateManager';
import { automaticGestureInjectorsDisabled } from '@/lib/avatar/automaticGestureInjectors';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';
import { motionTraceLog } from '@/lib/avatar/avatarMotionTrace';
import { getSmoothedUnifiedEnergy } from '@/lib/avatar/unifiedEnergyModel';
import { isDebugTts, logDebug, logError, logWarn } from '@/lib/logging/runtimeLog';

/** Bridge path: set the authoritative `<audio>` for `audioTimeline` / LipSyncManager. */
export { setPlaybackAudio as setActiveAudioElement } from '@/lib/avatar/audioTimeline';

/** Last `<audio>` owned by this module (`speakWithTTS` only). */
export function getClientTtsAudioElement(): HTMLAudioElement | null {
  return currentAudio;
}

export interface SpeakOptions {
  emotion?:  string;   // Passed to the TTS BFF (Edge ignores some SSML-only hints; ElevenLabs uses emotion hints server-side)
  /** 0–1; merged with emotionFromText when omitted */
  emotionIntensity?: number;
  rate?:     number;   // Hybrid Persona Kernel: direct speed override (1.0 = normal)
  pitch?:    string;   // Phase 4: explicit Hz offset e.g. "+5Hz" (overrides emotion default)
  /** Override Jordanian Arabic voice: "male" (ar-JO-OmarNeural) | "female" (ar-JO-MaysoonNeural) */
  arVoice?:  'male' | 'female';
  onStart?: () => void;
  onEnd?:   () => void;
  /**
   * When true, always POST to `/api/tts-with-timing` with `provider: edge` (ignores NEXT_PUBLIC_TTS_PROVIDER=elevenlabs).
   * Prefer false when NEXT_PUBLIC_TTS_PROVIDER=elevenlabs so WS `tts_unavailable` still uses ElevenLabs.
   * Reserve `true` for edge-only stacks (avoid a broken ElevenLabs BFF after server TTS failed).
   */
  forceEdgeBff?: boolean;
}

/** Detect Arabic unicode block (U+0600–U+06FF) */
const _ARABIC_RE = /[\u0600-\u06FF]/;

/**
 * When true, `speakWithTTS` uses only `/api/tts-elevenlabs` (never `/api/tts-with-timing`).
 * `NEXT_PUBLIC_*` is inlined at build time.
 */
export function isElevenLabsTtsProvider(): boolean {
  if (typeof process === 'undefined') return false;
  const raw = process.env.NEXT_PUBLIC_TTS_PROVIDER;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'elevenlabs';
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

/** Revoke prior blob: URL from HTTP TTS (avoid leaks; must run before assigning a new src). */
function revokeCurrentTtsObjectUrl(): void {
  if (!currentUrl) return;
  try {
    URL.revokeObjectURL(currentUrl);
  } catch {
    /* ignore */
  }
  currentUrl = null;
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
 */
export function fadeOutStopTTS(
  fadeMs = 120,
  opts?: { skipSpeakEnd?: boolean; skipNeutralViseme?: boolean },
): void {
  const shouldDispatchSpeakEnd =
    !opts?.skipSpeakEnd && (_clientTtsPlaying || currentAudio != null);
  _ttsSessionId += 1;
  _clientTtsPlaying = false;
  clearAudioTimeline('fadeOutStopTTS:start');
  while (_visemeTimers.length) clearTimeout(_visemeTimers.pop()!);
  while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
  if (typeof window !== 'undefined' && !opts?.skipNeutralViseme) {
    window.dispatchEvent(
      new CustomEvent('avatar:viseme', { detail: { id: 0, weights: { aa: 0, ih: 0, ou: 0 } } }),
    );
    window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
  }
  if (typeof window !== 'undefined') {
    setSpeechEmotionBridge(null);
    if (shouldDispatchSpeakEnd) {
      resetSpeechIntentHints();
      // eslint-disable-next-line no-console
      logDebug('TTS','[TTS] end');
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
    }
  }

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
      clearAudioTimeline('fadeOutStopTTS-done');
      finish();
    }
  };
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(step);
  else window.setTimeout(step, 16);
}

/**
 * Stop current TTS playback. Called when user interrupts (types or speaks).
 */
export function stopTTS(): void {
  /** Only pair `speak:end` when there was active / bound playback — avoids stray ends before REST TTS starts. */
  const shouldDispatchSpeakEnd = _clientTtsPlaying || currentAudio != null;
  _ttsSessionId += 1;
  _clientTtsPlaying = false;
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
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* */
    }
    resetSpeechIntentHints();
    setSpeechEmotionBridge(null);
    if (shouldDispatchSpeakEnd) {
      // eslint-disable-next-line no-console
      logDebug('TTS','[TTS] end');
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
    }
  }
}

/**
 * Begin a new TTS utterance: stop prior playback only when something is actually playing
 * (avoids stray `speak:end` + extra session bumps); always clears viseme/nod timers.
 */
function prepareNewTtsUtterance(): void {
  if (_clientTtsPlaying || currentAudio != null) {
    stopTTS();
  } else {
    while (_visemeTimers.length) clearTimeout(_visemeTimers.pop()!);
    while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
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
  return fetch(input, {
    ...init,
    credentials: init?.credentials ?? 'include',
    signal: ac.signal,
  }).finally(() => clearTimeout(tid));
}

let _lastTtsFailEmbodimentAt = 0;
const TTS_FAIL_EMBODIMENT_COOLDOWN_MS = 850;

/**
 * Phase 1 — Fail-safe avatar motion when TTS is broken.
 *
 * Sets `window.__ttsFailed = true` so the motion pipeline (VRMSkeletonManager)
 * can synthesise a fallback speaking state + pseudo-speech energy and keep
 * gesturing.  Cleared by `markTtsResumed()` on the next successful play.
 *
 * Throttled `[TTS_FALLBACK_TRIGGERED]` log to avoid console spam on retry storms.
 */
let _lastFallbackLogAt = 0;
function markTtsFailed(reason?: string): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__ttsFailed = true;
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // Stamp/refresh the failure time so the motion-side fallback window resets
  // on every new failure (3 s decay starts now).
  w.__ttsFailedAt = nowMs;
  if (nowMs - _lastFallbackLogAt > 1000) {
    _lastFallbackLogAt = nowMs;
    console.warn('[TTS_FALLBACK_TRIGGERED]', reason ?? '');
  }
}

/** Phase 6 — clear fallback once real TTS playback is confirmed. */
function markTtsResumed(): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__ttsFailed) w.__ttsFailed = false;
  w.__ttsFailedAt = 0;
}

/**
 * Digital Human: when TTS fails, show **Thinking** motion + **confused** face instead of freezing.
 * Throttled to avoid gesture spam on rapid retries.
 */
export function emitTtsFailureEmbodiment(_reason?: string): void {
  if (typeof window === 'undefined') return;
  markTtsFailed(_reason);
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
 * Microsoft's Edge online TTS often rejects the WebSocket handshake (HTTP 403) from cloud/VPS/datacenter IPs.
 */
function isEdgeTtsHandshakeBlocked(body: string): boolean {
  const b = body ?? '';
  const low = b.toLowerCase();
  return (
    /\[edge_forbidden\]|edge_forbidden/i.test(b) ||
    /microsoft edge tts rejected the websocket handshake/i.test(b) ||
    (/403/.test(b) && /edge.?tts|websocket handshake/i.test(low))
  );
}

/** Edge primary failed in a way that won't self-heal with an immediate Edge retry — try ElevenLabs BFF once. */
function shouldTryElevenlabsRescueAfterEdgeFailure(body: string): boolean {
  if (isEdgeTtsHandshakeBlocked(body)) return true;
  const low = (body ?? '').toLowerCase();
  return (
    /\[edge_error\]|edge tts failed|edge tts temporarily unavailable/i.test(body) ||
    /circuit\s+open|tts-reset-circuit|edge_fallback_failed/i.test(low)
  );
}

const EDGE_TTS_DATACENTER_BLOCKED_HINT =
  'Edge TTS is blocked from this network. Add ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID to frontend .env (Next BFF calls ElevenLabs directly), or set backend TTS_PROVIDER=elevenlabs with those keys and NEXT_PUBLIC_TTS_PROVIDER=elevenlabs, then rebuild.';

function stripTtsStageDirections(raw: string): string {
  return raw
    .replace(/\[EMOTION:\s*[^\]]+\]/gi, '')
    .replace(/\*+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function webSpeechTtsFallbackEnabled(): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  const raw =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_DISABLE_WEB_SPEECH_TTS_FALLBACK
      : '';
  return String(raw ?? '').toLowerCase() !== 'true';
}

/** After BFF retries, 502/503/504 means no server audio — optional browser synthesis (Edge block, EL 402, transient upstream). */
function shouldOfferWebSpeechTtsFallback(status: number): boolean {
  if (!webSpeechTtsFallbackEnabled()) return false;
  return status === 502 || status === 503 || status === 504;
}

/**
 * Last-resort TTS: Web Speech API in the browser (quality varies; no server MP3 / viseme sync).
 * Returns a placeholder `HTMLAudioElement` when successful so callers treat the turn as non-failure.
 */
async function speakWithWebSpeechClientFallback(
  fullText: string,
  ctx: {
    mySid: number;
    blendedSpeed: number;
    resolvedEmotion: string;
    resolvedIntensity: number;
    options?: SpeakOptions;
    ttsLog: boolean;
  },
): Promise<HTMLAudioElement | null> {
  const clean = stripTtsStageDirections(fullText);
  if (!clean) return null;

  ensureWebSpeechVoicesChangeHook();
  if (window.speechSynthesis.getVoices().length === 0) {
    await new Promise<void>((resolve) => {
      const w = window.speechSynthesis;
      const done = (): void => resolve();
      try {
        w.addEventListener('voiceschanged', done, { once: true });
      } catch {
        done();
        return;
      }
      window.setTimeout(done, 650);
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      _clientTtsPlaying = false;
      try {
        useBrainStore.getState().setTalking(false);
      } catch {
        /* */
      }
      clearAudioTimeline('webSpeechTtsFallback');
      resetSpeechIntentHints();
      setSpeechEmotionBridge(null);
      window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
      if (ok && ctx.mySid === _ttsSessionId) {
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        ctx.options?.onEnd?.();
      }
      const el = getTtsPlaybackAudioElement();
      if (ok) resolve(el ?? document.createElement('audio'));
      else resolve(null);
    };

    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    if (voices.length === 0) {
      settle(false);
      return;
    }

    const voice = getStableWebSpeechVoice(synth, { langHint: 'ar-JO', preferMale: true });
    const u = new SpeechSynthesisUtterance(clean);
    if (voice) u.voice = voice;
    u.lang = (voice?.lang || 'ar-JO').trim() || 'ar-JO';
    u.rate = Math.max(0.55, Math.min(1.35, ctx.blendedSpeed));
    u.volume = 0.95;

    u.onstart = () => {
      if (ctx.mySid !== _ttsSessionId) {
        try {
          synth.cancel();
        } catch {
          /* */
        }
        return;
      }
      setSpeechIntentHintsFromText(clean);
      window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
      beginWebSpeechLipTimeline();
      _clientTtsPlaying = true;
      try {
        useBrainStore.getState().setTalking(true);
      } catch {
        /* */
      }
      setSpeechEmotionBridge({
        emotion: ctx.resolvedEmotion,
        intensity: ctx.resolvedIntensity,
      });
      void resumeSharedAudioContext();
      motionTraceLog('tts.ts: dispatch avatar:speak:start (Web Speech)', {
        emotion: ctx.resolvedEmotion,
        intensity: ctx.resolvedIntensity,
      });
      window.dispatchEvent(
        new CustomEvent('avatar:speak:start', {
          detail: { emotion: ctx.resolvedEmotion, intensity: ctx.resolvedIntensity },
        }),
      );
      ctx.options?.onStart?.();
      window.dispatchEvent(
        new CustomEvent('avatar:speak', {
          detail: { text: clean, timings: [] as WordTiming[], sampleRate: 24000, audio: null },
        }),
      );
      if (ctx.ttsLog) {
        // eslint-disable-next-line no-console
        logDebug('TTS','[speakWithTTS] Web Speech API fallback (browser TTS + pseudo lip-sync via onboundary)');
      }
    };

    u.onboundary = (event: SpeechSynthesisEvent) => {
      if (ctx.mySid !== _ttsSessionId) return;
      const evName = event.name;
      if (evName && evName !== 'word' && evName !== 'sentence') return;
      const ch = resolveSpeechBoundaryChar(clean, event.charIndex);
      const vid = azureVisemeIdFromSpeechBoundaryChar(ch, u.lang);
      appendWebSpeechVisemeCue(getPlaybackTimeSec(), vid);
    };

    u.onend = () => {
      if (ctx.mySid !== _ttsSessionId) settle(false);
      else settle(true);
    };
    u.onerror = () => settle(false);

    try {
      synth.speak(u);
    } catch {
      settle(false);
    }
  });
}

/**
 * ElevenLabs quota / plan / “library voice” restrictions, or wrapped `edge_fallback_failed` with 402 — retrying the BFF won't help.
 */
function isPermanentTtsProviderFailure(body: string, httpStatus?: number): boolean {
  if (httpStatus === 402) return true;
  const b = body || '';
  const low = b.toLowerCase();
  const edgeFail = /\[edge_fallback_failed\]|edge_fallback_failed/i.test(low);
  const elevenRef = /elevenlabs|402|library voices|subscription|free users/i.test(low);
  return (
    /\belevenlabs http 402\b|http\s*402|"status"\s*:\s*402|payment required\b/i.test(b) ||
    /free users cannot\b|library voices\b|upgrade your subscription\b|insufficient credits\b/i.test(low) ||
    (edgeFail && elevenRef)
  );
}

const TTS_PROVIDER_BLOCKED_HINT =
  'TTS: ElevenLabs rejected this request (plan/voice). Use an Instant or API-allowed voice ID, upgrade the account, unset NEXT_PUBLIC_TTS_PROVIDER=elevenlabs to use Edge/Azure, or fix backend keys/voice.';

/**
 * When the ElevenLabs BFF returns an error, only show failure embodiment if the response is not a non-empty audio payload.
 * After Edge fallback (`usedElToEdgeFallback`), always use normal emit (error shape is not EL-specific).
 */
function maybeEmitTtsFailureAfterBff(
  reason: string,
  errBody: string,
  usedElToEdgeFallback: boolean,
  forceEdgeBff: boolean | undefined,
): void {
  const elPrimary =
    isElevenLabsTtsProvider() && !forceEdgeBff && !usedElToEdgeFallback;
  if (!elPrimary || bffErrorBodyLooksAudioEmpty(errBody)) {
    emitTtsFailureEmbodiment(reason);
  }
}

/**
 * Speak text using the TTS BFF (`/api/tts-elevenlabs` when `NEXT_PUBLIC_TTS_PROVIDER=elevenlabs`, else `/api/tts-with-timing`).
 * Returns the playing `HTMLAudioElement` on success, or `null` if fetch/play failed (no simulation fallback).
 */
export async function speakWithTTS(
  text: string,
  options?: SpeakOptions
): Promise<HTMLAudioElement | null> {
  if (typeof window === 'undefined' || !text?.trim()) return null;
  /** True only after `avatar:speak` / `avatar:speak:start` were emitted (audible or muted autoplay path). */
  let speakUiDispatched = false;
  const bearer = getAccessToken();
  const guestTtsOk = isCogniGuestBrowserMode();
  if (!bearer && !guestTtsOk) {
    logWarn('TTS', '[speakWithTTS] No valid JWT — skipping TTS BFF (log in or set guest WS flags).');
    return null;
  }
  if (isDebugTts()) {
    logDebug('TTS', '[speakWithTTS] 🔊 TTS CALLED', { chars: text.length });
  }
  prepareNewTtsUtterance();
  const mySid = ++_ttsSessionId;
  const ttsLog = isDebugTts();
  logDebug('TTS', '[TTS] start', { session: mySid });

  try {
    // FIX: voice stability — blend emotion speed with Cogni persona rate/pitch consistently
    const inferred = inferEmotionFromText(text);
    const resolvedEmotion = options?.emotion ?? inferred.emotion;
    const resolvedIntensity = options?.emotionIntensity ?? inferred.intensity;
    const personaRate = COGNI_PERSONA.voiceParameters.rate;
    // Consume any PAD-driven voice hint emitted by AgentDirector via avatar:voice
    const padHint     = consumePadVoiceHint();
    let blendedSpeed =
      options?.rate ?? padHint.rate ?? resolveSpeakRate(resolvedEmotion, personaRate);
    if (options?.rate == null && padHint.rate == null) {
      blendedSpeed = Math.min(
        1.18,
        Math.max(0.78, blendedSpeed * getCogniPersonaPerformanceScales().voiceRateMul),
      );
    }
    const defaultPitchFromPersona =
      COGNI_PERSONA.voiceParameters.pitchScale > 1.005
        ? `+${Math.round((COGNI_PERSONA.voiceParameters.pitchScale - 1) * 45)}Hz`
        : undefined;
    const resolvedPitch =
      options?.pitch ?? padHint.pitch ?? defaultPitchFromPersona;

    const useElevenLabs = isElevenLabsTtsProvider() && !options?.forceEdgeBff;
    const ttsBffPath = useElevenLabs ? '/api/tts-elevenlabs' : '/api/tts-with-timing';

    const nextPublicTtsProvider = (
      typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_TTS_PROVIDER ?? '') : ''
    )
      .trim()
      .toLowerCase();

    const isLocalTtsProvider =
      nextPublicTtsProvider === 'local' || nextPublicTtsProvider === 'local_piper';
    /** Backend accepts `local` (chain alias) and `local_piper` (router id). */
    const localProviderRequest =
      nextPublicTtsProvider === 'local_piper' ? 'local_piper' : 'local';

    const sharedTtsPayload: Record<string, unknown> = {
      text,
      speed: blendedSpeed,
      emotion: resolvedEmotion,
      emotion_intensity: resolvedIntensity,
      ar_voice: options?.arVoice ?? (_ARABIC_RE.test(text) ? 'male' : undefined),
    };
    if (!isLocalTtsProvider && resolvedPitch) {
      sharedTtsPayload.pitch = resolvedPitch;
    }

    const edgeTtsBody = JSON.stringify({
      ...sharedTtsPayload,
      provider: 'edge',
    });
    const localTtsBody = JSON.stringify({
      ...sharedTtsPayload,
      provider: localProviderRequest,
    });
    const elevenLabsTtsBody = JSON.stringify(sharedTtsPayload);

    const ttsHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (bearer) {
      ttsHeaders.Authorization = `Bearer ${bearer}`;
      logDebug('TTS', '[Network] 🔑 Attaching JWT to TTS Request');
    } else {
      logWarn(
        'TTS',
        '[Network] TTS without Authorization (guest) — requires COGNI_BFF_DEV_BYPASS_AUTH on Next + COGNI_DEV_BYPASS_AUTH on backend',
      );
    }

    const doTtsFetch = () => {
      if (useElevenLabs) {
        logDebug('TTS', '[speakWithTTS] BFF route:', ttsBffPath, '(NEXT_PUBLIC_TTS_PROVIDER=elevenlabs)');
        return ttsBffFetch(ttsBffPath, {
          method: 'POST',
          headers: ttsHeaders,
          body: elevenLabsTtsBody,
        });
      }
      if (isLocalTtsProvider) {
        logDebug(
          'TTS',
          '[speakWithTTS] BFF body provider=%s (Piper / local_tts)',
          localProviderRequest,
        );
        return ttsBffFetch(ttsBffPath, {
          method: 'POST',
          headers: ttsHeaders,
          body: localTtsBody,
        });
      }
      return ttsBffFetch(ttsBffPath, {
        method: 'POST',
        headers: ttsHeaders,
        body: edgeTtsBody,
      });
    };

    /** After EL→Edge fallback, retries must not call EL again (same broken path). */
    const edgeBffFetch = () =>
      ttsBffFetch('/api/tts-with-timing', {
        method: 'POST',
        headers: ttsHeaders,
        body: edgeTtsBody,
      });

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    let res = await doTtsFetch();
    let usedElToEdgeFallback = false;
    let usedEdgeToElevenlabsRescue = false;

    // ElevenLabs BFF down / 402 plan-voice / gateway errors → one-shot Edge BFF when possible.
    // HTTP 402 from ElevenLabs is local to that provider; Edge TTS often still works on home networks even when EL rejects the key/voice.
    if (
      !res.ok &&
      isElevenLabsTtsProvider() &&
      !options?.forceEdgeBff &&
      ([502, 503, 504].includes(res.status) || res.status === 402)
    ) {
      const errPeek = await res.clone().text().catch(() => '');
      const tryEdgeOnce =
        res.status === 402 ||
        !isPermanentTtsProviderFailure(errPeek, res.status);

      if (tryEdgeOnce) {
        logWarn('TTS',
          `[speakWithTTS] ElevenLabs BFF HTTP ${res.status} — falling back once to Edge /api/tts-with-timing`,
          errPeek.slice(0, 200),
        );
        await res.text().catch(() => '');
        res = await edgeBffFetch();
        usedElToEdgeFallback = true;
      } else {
        logWarn('TTS',
          '[speakWithTTS] ElevenLabs error is not recoverable via Edge fallback —',
          TTS_PROVIDER_BLOCKED_HINT,
          errPeek.slice(0, 220),
        );
      }
    }

    /** Edge blocked / circuit open / server-wrapped edge_error (common on VPS) → one-shot ElevenLabs BFF if keys exist. */
    if (
      !res.ok &&
      !useElevenLabs &&
      !options?.forceEdgeBff &&
      (res.status === 502 || res.status === 503)
    ) {
      const peek = await res.clone().text().catch(() => '');
      if (
        shouldTryElevenlabsRescueAfterEdgeFailure(peek)
        && !isPermanentTtsProviderFailure(peek, res.status)
      ) {
        logWarn('TTS',
          '[speakWithTTS] Edge TTS failed (handshake/block/circuit) — trying /api/tts-elevenlabs once.',
        );
        await res.text().catch(() => '');
        res = await ttsBffFetch('/api/tts-elevenlabs', {
          method: 'POST',
          headers: ttsHeaders,
          body: elevenLabsTtsBody,
        });
        usedEdgeToElevenlabsRescue = true;
      }
    }

    const isTtsHourlyQuota = (status: number, body: string) =>
      status === 429 ||
      /tts_hourly_limit|"TTS hourly limit|hourly limit exceeded|tts_rate_limit/i.test(body);

    if (!res.ok) {
      let errBody = await res.text().catch(() => '');

      if (res.status === 401) {
        logError('TTS', '[TTS] ❌ Unauthorized (401)');
        return null;
      }

      if (isTtsHourlyQuota(res.status, errBody)) {
        logWarn('TTS',
          '[speakWithTTS] TTS hourly quota exceeded. Set TTS_CALL_LIMIT_PER_HOUR in backend .env (e.g. 200) or wait ~1 hour.',
          errBody.slice(0, 120),
        );
        markTtsFailed(`quota_${res.status}`);
        return null;
      }

      if (isPermanentTtsProviderFailure(errBody, res.status)) {
        logWarn('TTS','[speakWithTTS]', TTS_PROVIDER_BLOCKED_HINT, errBody.slice(0, 320));
        maybeEmitTtsFailureAfterBff(
          'tts_provider_blocked',
          errBody,
          usedElToEdgeFallback,
          options?.forceEdgeBff,
        );
        return null;
      }

      /** Edge→EL rescue already ran; second transient EL/Edge round-trip is almost never useful. */
      if (usedEdgeToElevenlabsRescue) {
        logWarn('TTS',
          '[speakWithTTS] Edge TTS blocked on the server; ElevenLabs BFF did not return audio.',
          errBody.slice(0, 240),
        );
        logWarn('TTS','[speakWithTTS]', EDGE_TTS_DATACENTER_BLOCKED_HINT);
        maybeEmitTtsFailureAfterBff(
          'edge_blocked_el_failed',
          errBody,
          usedElToEdgeFallback,
          options?.forceEdgeBff,
        );
        return null;
      }

      if ([503, 502, 504, 408].includes(res.status)) {
        const azureRateLimited =
          res.status === 503 &&
          (/azure_rate_limited|"Azure TTS rate limited"|rate limit|Rate limited|429/i.test(errBody) ||
            /Azure Speech rate limited/i.test(errBody));
        const retryableNet =
          /AbortError|timeout|unreachable|Backend unreachable|TTS timeout|internal server error|upstream error|\[tts_internal\]/i.test(
            errBody,
          ) ||
          res.status === 408;
        /** One backoff retry — never re-hit plain Edge after we already know Edge handshake is forbidden. */
        const transientUpstream502503 =
          (res.status === 502 || res.status === 503 || res.status === 504) &&
          !isEdgeTtsHandshakeBlocked(errBody) &&
          !/not installed|misconfiguration|missing:|env not set|integrity|empty audio|hourly limit|circuit open/i.test(
            errBody,
          );

        const redoTtsAfterBackoff = async (ms: number): Promise<boolean> => {
          await sleep(ms);
          if (usedElToEdgeFallback) {
            res = await edgeBffFetch();
          } else if (usedEdgeToElevenlabsRescue) {
            res = await ttsBffFetch('/api/tts-elevenlabs', {
              method: 'POST',
              headers: ttsHeaders,
              body: elevenLabsTtsBody,
            });
          } else {
            res = await doTtsFetch();
          }
          if (res.status === 401) {
            logError('TTS', '[TTS] ❌ Unauthorized (401)');
            return false;
          }
          return true;
        };

        if (azureRateLimited) {
          // V31 — at most one retry; avoid hammering the TTS BFF with identical text
          for (let attempt = 0; attempt < 2 && !res.ok; attempt++) {
            const backoff = 2000 + attempt * 2500;
            await sleep(backoff);
            if (usedElToEdgeFallback) {
              res = await edgeBffFetch();
            } else if (usedEdgeToElevenlabsRescue) {
              res = await ttsBffFetch('/api/tts-elevenlabs', {
                method: 'POST',
                headers: ttsHeaders,
                body: elevenLabsTtsBody,
              });
            } else {
              res = await doTtsFetch();
            }
            if (res.status === 401) {
              logError('TTS', '[TTS] ❌ Unauthorized (401)');
              return null;
            }
            if (res.ok) break;
            errBody = await res.text().catch(() => errBody);
            if (isTtsHourlyQuota(res.status, errBody)) {
              logWarn('TTS','[speakWithTTS] TTS hourly quota during retry.', errBody.slice(0, 120));
              return null;
            }
          }
        } else if (retryableNet || transientUpstream502503) {
          if (transientUpstream502503 && !retryableNet) {
            logWarn('TTS',
              '[speakWithTTS] Transient TTS upstream',
              res.status,
              '— retrying once after backoff',
              errBody.slice(0, 120),
            );
          }
          const authOk = await redoTtsAfterBackoff(retryableNet ? 600 : 1000);
          if (!authOk) return null;
        } else {
          if (res.status === 503 || res.status === 502 || res.status === 504) {
            if (shouldOfferWebSpeechTtsFallback(res.status)) {
              const wsEl = await speakWithWebSpeechClientFallback(text, {
                mySid,
                blendedSpeed,
                resolvedEmotion,
                resolvedIntensity,
                options,
                ttsLog,
              });
              if (wsEl) return wsEl;
            }
            logWarn('TTS',
              `[speakWithTTS] TTS unavailable (${res.status}) — server TTS failed; Web Speech fallback ${
                webSpeechTtsFallbackEnabled() ? 'failed or unsupported' : 'disabled (NEXT_PUBLIC_DISABLE_WEB_SPEECH_TTS_FALLBACK)'
              }.`,
              errBody.slice(0, 220),
              isEdgeTtsHandshakeBlocked(errBody) ? `→ ${EDGE_TTS_DATACENTER_BLOCKED_HINT}` : '',
            );
            maybeEmitTtsFailureAfterBff(
              `upstream_${res.status}`,
              errBody,
              usedElToEdgeFallback,
              options?.forceEdgeBff,
            );
            return null;
          }
          logWarn('TTS',
            `[speakWithTTS] ${ttsBffPath} HTTP ${res.status}:`,
            errBody.slice(0, 400),
          );
          maybeEmitTtsFailureAfterBff(
            `http_${res.status}`,
            errBody,
            usedElToEdgeFallback,
            options?.forceEdgeBff,
          );
          return null;
        }
      } else {
        logWarn('TTS',
          `[speakWithTTS] ${ttsBffPath} HTTP ${res.status}:`,
          errBody.slice(0, 400),
        );
        maybeEmitTtsFailureAfterBff(
          `http_${res.status}`,
          errBody,
          usedElToEdgeFallback,
          options?.forceEdgeBff,
        );
        return null;
      }
    }

    if (!res.ok) {
      const errTail = await res.text().catch(() => '');
      if (res.status === 401) {
        logError('TTS', '[TTS] ❌ Unauthorized (401)');
        return null;
      }
      if (isTtsHourlyQuota(res.status, errTail)) {
        logWarn('TTS','[speakWithTTS] TTS hourly quota after retry.', errTail.slice(0, 120));
        markTtsFailed(`quota_${res.status}_retry`);
        return null;
      }
      if (isPermanentTtsProviderFailure(errTail, res.status)) {
        logWarn('TTS','[speakWithTTS]', TTS_PROVIDER_BLOCKED_HINT, errTail.slice(0, 320));
        maybeEmitTtsFailureAfterBff(
          'tts_provider_blocked_after_retry',
          errTail,
          usedElToEdgeFallback,
          options?.forceEdgeBff,
        );
        return null;
      }
      if (res.status === 503 || res.status === 502 || res.status === 504) {
        if (shouldOfferWebSpeechTtsFallback(res.status)) {
          const wsEl = await speakWithWebSpeechClientFallback(text, {
            mySid,
            blendedSpeed,
            resolvedEmotion,
            resolvedIntensity,
            options,
            ttsLog,
          });
          if (wsEl) return wsEl;
        }
        logWarn('TTS',
          `[speakWithTTS] TTS unavailable (${res.status}) after retry — server TTS failed; Web Speech fallback ${
            webSpeechTtsFallbackEnabled() ? 'failed or unsupported' : 'disabled (NEXT_PUBLIC_DISABLE_WEB_SPEECH_TTS_FALLBACK)'
          }.`,
          errTail.slice(0, 220),
          isEdgeTtsHandshakeBlocked(errTail) ? `→ ${EDGE_TTS_DATACENTER_BLOCKED_HINT}` : '',
        );
        maybeEmitTtsFailureAfterBff(
          `upstream_${res.status}`,
          errTail,
          usedElToEdgeFallback,
          options?.forceEdgeBff,
        );
        return null;
      }
      logWarn('TTS',
        `[speakWithTTS] ${ttsBffPath} HTTP ${res.status} after retry:`,
        errTail.slice(0, 400),
      );
      maybeEmitTtsFailureAfterBff(
        `http_${res.status}_retry`,
        errTail,
        usedElToEdgeFallback,
        options?.forceEdgeBff,
      );
      return null;
    }

    const data = await res.json().catch(() => null);
    const prov = typeof data?.provider === 'string' ? data.provider.toLowerCase().trim() : '';
    if (
      prov &&
      prov !== 'azure' &&
      prov !== 'edge' &&
      prov !== 'auto' &&
      prov !== 'elevenlabs' &&
      prov !== 'local' &&
      prov !== 'local_piper'
    ) {
      logError('TTS', '[speakWithTTS] TTS provider not supported — got:', data?.provider);
      emitTtsFailureEmbodiment('unsupported_provider');
      return null;
    }
    const audioBase64 = data?.audio_base64;
    const rawVis =
      data?.viseme_events ?? (data as { visemes?: unknown } | null)?.visemes;
    let visRaw: unknown[] = Array.isArray(rawVis) ? rawVis : [];
    if (
      visRaw.length === 0 &&
      typeof audioBase64 === 'string' &&
      audioBase64.replace(/\s/g, '').length >= 64
    ) {
      logWarn(
        'TTS',
        '[speakWithTTS] Empty viseme_events — continuing with audio only (minimal lip-sync)',
      );
    } else if (visRaw.length === 0) {
      logError(
        'TTS',
        '[speakWithTTS] Missing or empty viseme_events / visemes — lip sync cannot run.',
        JSON.stringify(data)?.slice(0, 240),
      );
      const b64Vis = data?.audio_base64;
      const hasAudioDespiteVisemes =
        typeof b64Vis === 'string' && b64Vis.replace(/\s/g, '').length >= 64;
      if (
        !isElevenLabsTtsProvider() ||
        options?.forceEdgeBff ||
        !hasAudioDespiteVisemes
      ) {
        emitTtsFailureEmbodiment('empty_visemes');
      }
      return null;
    }
    const wordTimings = (data?.word_timings ?? []) as WordTiming[];
    const sampleRate = data?.sample_rate ?? 24000;

    if (!audioBase64) {
      logError(
        'TTS',
        '[speakWithTTS] Backend returned no audio — cannot play.',
        JSON.stringify(data)?.slice(0, 300),
      );
      markTtsFailed('no_audio_payload');
      emitTtsFailureEmbodiment('no_audio_payload');
      return null;
    }

    const playbackEl = getTtsPlaybackAudioElement();
    if (!playbackEl) {
      logError(
        'TTS',
        '[TTS] ABORT: no playback element — AvatarAgentClient must mount and call setTtsPlaybackAudioElement',
      );
      emitTtsFailureEmbodiment('no_playback_element');
      return null;
    }

    const b64Clean = String(audioBase64).replace(/\s/g, '');
    const binary = Uint8Array.from(atob(b64Clean), (c) => c.charCodeAt(0));
    const fmtRaw = (data?.format ?? 'mp3') as string;
    const fmt = fmtRaw.toLowerCase();

    detachPlaybackElementListeners();
    revokeCurrentTtsObjectUrl();
    try {
      playbackEl.pause();
      playbackEl.currentTime = 0;
    } catch {
      /* */
    }

    let flowBlob: Blob;
    if (fmt === 'pcm') {
      flowBlob = pcmBytesToWavBlob(binary, sampleRate);
    } else if (fmt === 'wav') {
      flowBlob = new Blob([binary], { type: 'audio/wav' });
    } else {
      flowBlob = new Blob([binary], { type: 'audio/mp3' });
    }
    const playUrl = URL.createObjectURL(flowBlob);
    currentUrl = playUrl;

    // eslint-disable-next-line no-console -- pipeline audit (one line per utterance)
    console.log('[TTS FLOW]', {
      hasBase64: b64Clean.length > 0,
      blobSize: flowBlob.size,
      format: fmt,
      url: `${playUrl.slice(0, 72)}…`,
      provider: prov || '(none)',
    });

    playbackEl.crossOrigin = 'anonymous';
    playbackEl.preload = 'auto';
    playbackEl.volume = 0.94;
    playbackEl.src = playUrl;
    const audio = playbackEl;
    currentAudio = audio;

    const visemeCues = visemeEventsToCues(visRaw);
    const timingMode =
      typeof (data as { timing_mode?: string } | null)?.timing_mode === 'string'
        ? (data as { timing_mode: string }).timing_mode
        : '';
    // eslint-disable-next-line no-console
    logDebug('TTS','[TTS] Viseme timeline length:', visemeCues.length);
    if (timingMode === 'phoneme_ar') {
      // eslint-disable-next-line no-console
      logDebug('TTS',
        `[TTS-SYNC] High-precision phoneme map generated with ${visemeCues.length} cues.`,
      );
    }

    const rebindVisemesIfDurationDrift = (): void => {
      if (visemeCues.length === 0) return;
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur < 0.15) return;
      const stretched = stretchVisemeCuesToDurationIfFallback(visemeCues, dur);
      if (stretched === visemeCues) return;
      bindAudioUtterance({
        audio,
        cues: stretched.map((c) => ({ t: c.t, id: c.id })),
        source: 'http_tts',
      });
      window.dispatchEvent(
        new CustomEvent('avatar:visemes:timeline', {
          detail: { cues: stretched, source: 'http_tts' as const },
        }),
      );
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        logDebug('TTS','[TTS-SYNC] viseme timeline stretched to audio.duration=', Number(dur.toFixed(3)), 's');
      }
    };

    const onDurationChange = (): void => {
      if (mySid !== _ttsSessionId || currentAudio !== audio) return;
      rebindVisemesIfDurationDrift();
    };

    const cleanup = (): void => {
      _clientTtsPlaying = false;
      while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
      if (mySid === _ttsSessionId) {
        audio.removeEventListener('ended', cleanup);
        audio.removeEventListener('error', cleanup);
        audio.removeEventListener('durationchange', onDurationChange);
        _onPlaybackEnded = null;
        _onPlaybackError = null;
        try {
          audio.pause();
          audio.currentTime = 0;
          revokeCurrentTtsObjectUrl();
          audio.removeAttribute('src');
        } catch {
          /* */
        }
        currentAudio = null;
      }
      try {
        useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      } catch {
        /* */
      }
      try {
        useBrainStore.getState().setTalking(false);
      } catch {
        /* */
      }
      resetSpeechIntentHints();
      setSpeechEmotionBridge(null);
      clearAudioTimeline('speakWithTTS:cleanup');
      window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
      if (speakUiDispatched) {
        // eslint-disable-next-line no-console
        logDebug('TTS','[TTS] end');
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        options?.onEnd?.();
      }
    };

    _onPlaybackEnded = cleanup;
    _onPlaybackError = cleanup;
    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);
    audio.addEventListener('durationchange', onDurationChange);

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
      } else if (text.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3).length > 1) {
        const sentences = text.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3);
        const totalMs   = Math.max(1500, text.length * 190);
        let cumLen = 0;
        sentences.slice(0, -1).forEach((s) => {
          cumLen += s.length + 1;
          const delay = Math.max(300, (cumLen / text.length) * totalMs) + 80;
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

    const preSpeechLeadMsDeterministic = (): number => {
      const pauseBias = getBehavioralSignature(getPersonalityProfile()).pauseBeforeSpeakBiasMs;
      return 152 + (text.length % 97) + pauseBias;
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

    /** Intent + timeline bound before element plays — lip playhead tracks shared AudioContext (see audioTimeline). */
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
          new CustomEvent('avatar:visemes:timeline', {
            detail: { cues: visemeCues, source: 'http_tts' as const },
          }),
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
      speakUiDispatched = true;
      useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      try {
        useBrainStore.getState().setTalking(true);
      } catch {
        /* */
      }
      setSpeechEmotionBridge({
        emotion: resolvedEmotion,
        intensity: resolvedIntensity,
      });
      // eslint-disable-next-line no-console
      logDebug('TTS','[TTS] speak:start');
      motionTraceLog('tts.ts: dispatch avatar:speak:start (HTTP TTS after play)', {
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
      fireSpeakStartForLipSync();
      window.dispatchEvent(
        new CustomEvent('avatar:speak', {
          detail: { text, timings: wordTimings, sampleRate, audio },
        }),
      );
      options?.onStart?.();
      scheduleNods();
    };

    /** First play(); resume AudioContext retry; NotAllowed → outer catch for muted UX. */
    const playWithResumeRetry = async (): Promise<boolean> => {
      logDebug('TTS','[TTS] play');
      // Anticipation pulse: fires before audio starts so the motion system can
      // ramp up gains slightly before the first syllable, producing natural
      // pre-speech head movement rather than a cold start.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('avatar:speak:anticipation'));
      }
      // Belt-and-suspenders: re-dispatch `avatar:audio:element` immediately before
      // play() so AvatarCanvas can wire the analyser even if the earlier dispatch
      // (in bindTimelineBeforePlay) fired before AudioContext was fully running.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('avatar:audio:element', { detail: { audio } }),
        );
      }
      try {
        audio.muted = false;
        await audio.play();
        return true;
      } catch (first) {
        logError('TTS', '[AUDIO PLAY ERROR]', first);
        if ((first as Error).name === 'NotAllowedError') throw first;
        try {
          await resumeSharedAudioContext();
          await audio.play();
          return true;
        } catch (second) {
          logError('TTS', '[AUDIO PLAY ERROR]', second);
          return false;
        }
      }
    };

    try {
      await resumeSharedAudioContext();
      const urgencyU =
        useBrainStore.getState().behaviorContractPayload?.urgency ?? 0.55;
      updateConsciousFromTts(urgencyU, visemeCues.length);
      dispatchPreSpeechLead();
      bindTimelineBeforePlay();
      await new Promise<void>((resolve) =>
        setTimeout(resolve, getTotalPreSpeechDelayMs(preSpeechLeadMsDeterministic())),
      );
      let playedOk = await playWithResumeRetry();
      if (!playedOk) {
        logWarn('TTS', '[speakWithTTS] Retrying playback with muted=true');
        try {
          audio.muted = true;
          await resumeSharedAudioContext();
          await audio.play();
          playedOk = true;
        } catch (me) {
          logError('TTS', '[AUDIO PLAY ERROR]', me);
        }
      }
      if (!playedOk) {
        cleanup();
        markTtsFailed('audio_play_failed');
        emitTtsFailureEmbodiment('audio_play_failed');
        return null;
      }
      setSpeechIntentHintsFromText(text);
      fireSpeakStartForLipSync();
      await waitAudioReady(audio);
      rebindVisemesIfDurationDrift();
      _clientTtsPlaying = true;
      markTtsResumed();
      // eslint-disable-next-line no-console
      logDebug('TTS','[TTS] ✅ SUCCESS');
      // eslint-disable-next-line no-console -- pipeline audit (renamed from [TTS ENERGY] to avoid collision with unifiedEnergyModel log)
      console.log('[TTS:onPlay]', { computedEnergy: getSmoothedUnifiedEnergy() });
      if (ttsLog) {
        // eslint-disable-next-line no-console
        logDebug('TTS','[speakWithTTS] ✅ audio.play() resolved', {
          duration: Number.isFinite(audio.duration) ? audio.duration : null,
          muted: audio.muted,
        });
      }
      dispatchPlaybackAfterAudibleStart();
      if (audio.muted) {
        window.dispatchEvent(
          new CustomEvent('cogni:autoplay-blocked', {
            detail: { audio, text },
          }),
        );
      }
      return audio;
    } catch (playErr: unknown) {
      try {
        useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      } catch {
        /* */
      }
      const err = playErr as Error;
      if (err.name === 'NotAllowedError') {
        logWarn('TTS','[speakWithTTS] 🔇 Autoplay blocked — starting muted. User must unmute.');
        audio.muted = true;
        await resumeSharedAudioContext();
        const urgencyU =
          useBrainStore.getState().behaviorContractPayload?.urgency ?? 0.55;
        updateConsciousFromTts(urgencyU, visemeCues.length);
        dispatchPreSpeechLead();
        bindTimelineBeforePlay();
        await new Promise<void>((resolve) =>
          setTimeout(resolve, getTotalPreSpeechDelayMs(preSpeechLeadMsDeterministic())),
        );
        // eslint-disable-next-line no-console
        logDebug('TTS','[TTS] play');
        try {
          await audio.play();
        } catch (mutePlayErr) {
          logError('TTS', '[AUDIO PLAY ERROR]', mutePlayErr);
          cleanup();
          emitTtsFailureEmbodiment('audio_play_error');
          return null;
        }
        setSpeechIntentHintsFromText(text);
        fireSpeakStartForLipSync();
        await waitAudioReady(audio);
        rebindVisemesIfDurationDrift();
        _clientTtsPlaying = true;
        markTtsResumed();
        // eslint-disable-next-line no-console
        logDebug('TTS','[TTS] ✅ SUCCESS');
        // eslint-disable-next-line no-console -- pipeline audit (renamed from [TTS ENERGY] to avoid collision)
        console.log('[TTS:onPlay]', { computedEnergy: getSmoothedUnifiedEnergy(), muted: true });
        logDebug('TTS','[speakWithTTS] 🔊 Muted playback started — UI should show Unmute button');
        dispatchPlaybackAfterAudibleStart();
        window.dispatchEvent(
          new CustomEvent('cogni:autoplay-blocked', {
            detail: { audio, text },
          }),
        );
        if (ttsLog) {
          // eslint-disable-next-line no-console
          logDebug('TTS','[speakWithTTS] ✅ audio.play() resolved (muted — autoplay policy)', {
            duration: Number.isFinite(audio.duration) ? audio.duration : null,
          });
        }
        return audio;
      }
      logError('TTS', '[AUDIO PLAY ERROR]', err);
      cleanup();
      emitTtsFailureEmbodiment('audio_play_error');
      return null;
    }
  } catch (err) {
    // Catch errors from fetch, JSON, or blob creation
    logWarn('TTS','[speakWithTTS] TTS pipeline exception:', err);
    markTtsFailed('pipeline_exception');
    emitTtsFailureEmbodiment('pipeline_exception');
    if (mySid === _ttsSessionId) {
      detachPlaybackElementListeners();
      revokeCurrentTtsObjectUrl();
      if (currentAudio) {
        try {
          currentAudio.removeAttribute('src');
        } catch { /* ignore */ }
      }
      currentAudio = null;
    }
    resetSpeechIntentHints();
    setSpeechEmotionBridge(null);
    if (speakUiDispatched) {
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
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
  /** Jitter buffer before `play()` (ms) — default 50 */
  bufferedStartMs?: number;
}

/**
 * WebSocket `speech_data` playback — **disabled**. Use `speakWithTTS` (HTTP BFF) only.
 */
export async function playWsAgentTtsAudio(
  options: PlayWsAgentTtsOptions,
): Promise<HTMLAudioElement | null> {
  if (typeof window === 'undefined') return null;
  void options;
  logDebug(
    'TTS',
    '[TTS-WS] playWsAgentTtsAudio disabled — use HTTP /api/tts-with-timing (speakWithTTS) only',
  );
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
    automaticGestureInjectorsDisabled: automaticGestureInjectorsDisabled(),
    level6UnifiedBehavior:   l6,
    ttsClientBffRoute: isElevenLabsTtsProvider() ? '/api/tts-elevenlabs' : '/api/tts-with-timing',
    ttsProviderEnv: process.env.NEXT_PUBLIC_TTS_PROVIDER ?? null,
    checklist: [
      'JWT required for speakWithTTS (Authorization on the TTS BFF route).',
      'AvatarAgentClient must mount to register <audio> via setTtsPlaybackAudioElement.',
      'If gestures feel “gone”: check NEXT_PUBLIC_DISABLE_AUTOMATIC_GESTURE_INJECTORS and LEVEL6_UNIFIED_BEHAVIOR in .env.local.',
    ],
  };
}

/** Console: `await window.__cogniSpeakWithTTS('اختبار الصوت')` — recovery validation */
if (typeof window !== 'undefined') {
  const w = window as Window & {
    __cogniSpeakWithTTS?: typeof speakWithTTS;
    __cogniAudioDiagnostics?: typeof getCogniAudioDiagnostics;
    __cogniDebugAudio?: () => Record<string, unknown>;
  };
  w.__cogniSpeakWithTTS = speakWithTTS;
  w.__cogniAudioDiagnostics = getCogniAudioDiagnostics;
  w.__cogniDebugAudio = () => ({
    hasJWT: !!localStorage.getItem('cogni_access_token'),
    audioElementExists: !!document.querySelector('audio'),
    userInteracted: Boolean((window as Window & { __AUDIO_UNLOCKED__?: boolean }).__AUDIO_UNLOCKED__),
  });
}