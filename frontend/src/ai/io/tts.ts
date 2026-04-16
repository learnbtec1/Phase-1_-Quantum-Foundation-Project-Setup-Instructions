/**
 * Client-side TTS: speaks via BFF — `/api/tts-with-timing` (Edge) or `/api/tts-elevenlabs` when
 * `NEXT_PUBLIC_TTS_PROVIDER=elevenlabs` (ElevenLabs Multilingual v2, mp3_44100_128 on server).
 * Supports avatar:interrupt to stop playback when user types or speaks.
 */
import type { WordTiming } from '@/ai/lipsync/timing';
import { COGNI_PERSONA } from '@/config/personality';
import { getAccessToken } from '@/lib/auth';
import { resetSpeechIntentHints, setSpeechIntentHintsFromText } from '@/lib/avatar/speechIntentHints';
import { resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';
import { waitAudioReady } from '@/lib/audio/waitAudioReady';
import { visemeEventsToCues } from '@/lib/audio/visemeCueFromApi';
import { inferEmotionFromText } from '@/ai/voice/emotionFromText';
import { getPauseMicroHeadMul } from '@/ai/voice/emotionalCoupling';
import { getSpeechEmotionSnapshot, setSpeechEmotionBridge } from '@/ai/voice/speechEmotionBridge';
import { useBrainStore } from '@/store/useBrainStore';
import {
  getBehavioralSignature,
  getPersonalityProfile,
} from '@/ai/avatar/personalityProfile';
import { bindAudioUtterance, clearAudioTimeline } from '@/lib/avatar/audioTimeline';
import { updateConsciousFromTts, getTotalPreSpeechDelayMs } from '@/lib/avatar/consciousStateManager';
import { automaticGestureInjectorsDisabled } from '@/lib/avatar/automaticGestureInjectors';

export type { WordTiming };

/** Bridge path: set the authoritative `<audio>` for `audioTimeline` / LipSyncManager. */
export { setPlaybackAudio as setActiveAudioElement } from '@/lib/avatar/audioTimeline';

/** Last `<audio>` owned by this module (`speakWithTTS` only). */
export function getClientTtsAudioElement(): HTMLAudioElement | null {
  return currentAudio;
}

export interface SpeakOptions {
  emotion?:  string;   // Passed to backend /tts-with-timing (Edge TTS ignores some SSML-only hints)
  /** 0–1; merged with emotionFromText when omitted */
  emotionIntensity?: number;
  rate?:     number;   // Hybrid Persona Kernel: direct speed override (1.0 = normal)
  pitch?:    string;   // Phase 4: explicit Hz offset e.g. "+5Hz" (overrides emotion default)
  /** Override Jordanian Arabic voice: "male" (ar-JO-OmarNeural) | "female" (ar-JO-MaysoonNeural) */
  arVoice?:  'male' | 'female';
  onStart?: () => void;
  onEnd?:   () => void;
}

/** Detect Arabic unicode block (U+0600–U+06FF) */
const _ARABIC_RE = /[\u0600-\u06FF]/;

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
/** True while client `/api/tts-with-timing` audio is actively playing (after successful play()). */
let _clientTtsPlaying = false;

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
 * Fade out client `/api/tts-with-timing` audio then release (barge-in).
 * Does not hard-cut unless fadeMs is 0.
 */
export function fadeOutStopTTS(
  fadeMs = 120,
  opts?: { skipSpeakEnd?: boolean; skipNeutralViseme?: boolean },
): void {
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
    if (!opts?.skipSpeakEnd) {
      resetSpeechIntentHints();
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
    resetSpeechIntentHints();
    setSpeechEmotionBridge(null);
    window.dispatchEvent(new CustomEvent('avatar:speak:end'));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('cogni:avatar:interrupt', () => {
    fadeOutStopTTS(130);
  });
}

/**
 * Speak text using TTS API (`/api/tts-with-timing`).
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
  const guestTtsOk =
    process.env.NEXT_PUBLIC_COGNI_WS_ALLOW_ANONYMOUS === 'true' ||
    process.env.NEXT_PUBLIC_COGNI_WS_GUEST_OK === 'true';
  if (!bearer && !guestTtsOk) {
    // getAccessToken() already logged `[Auth] ❌ Token missing or invalid` — no fetch (avoids 401 spam).
    console.error('[speakWithTTS] ❌ Short-circuit: no valid JWT — skipping /api/tts-with-timing');
    return null;
  }
  const ttsLog =
    typeof process !== 'undefined' &&
    (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_TTS === 'true');
  if (ttsLog) {
    // eslint-disable-next-line no-console
    console.log('[speakWithTTS] 🔊 TTS CALLED', { chars: text.length });
  }
  const mySid = ++_ttsSessionId;
  stopTTS();

  try {
    // FIX: voice stability — blend emotion speed with Cogni persona rate/pitch consistently
    const inferred = inferEmotionFromText(text);
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

    const ttsBody = JSON.stringify({
      text,
      provider: 'edge',
      speed: blendedSpeed,
      emotion: resolvedEmotion,
      emotion_intensity: resolvedIntensity,
      ...(resolvedPitch ? { pitch: resolvedPitch } : {}),
      ar_voice: options?.arVoice ?? (_ARABIC_RE.test(text) ? 'male' : undefined),
    });

    const useElevenLabs =
      typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_TTS_PROVIDER === 'elevenlabs';

    const doTtsFetch = () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (bearer) {
        headers.Authorization = `Bearer ${bearer}`;
        // eslint-disable-next-line no-console
        console.log('[Network] 🔑 Attaching JWT to TTS Request');
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          '[Network] TTS without Authorization (guest) — requires COGNI_BFF_DEV_BYPASS_AUTH on Next + COGNI_DEV_BYPASS_AUTH on backend',
        );
      }
      if (useElevenLabs) {
        return fetch('/api/tts-elevenlabs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text }),
        });
      }
      return fetch('/api/tts-with-timing', {
        method: 'POST',
        headers,
        body: ttsBody,
      });
    };

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    let res = await doTtsFetch();

    const isTtsHourlyQuota = (status: number, body: string) =>
      status === 429 ||
      /tts_hourly_limit|"TTS hourly limit|hourly limit exceeded|tts_rate_limit/i.test(body);

    if (!res.ok) {
      let errBody = await res.text().catch(() => '');

      if (res.status === 401) {
        console.error('[TTS] ❌ Unauthorized (401)');
        return null;
      }

      if (isTtsHourlyQuota(res.status, errBody)) {
        console.warn(
          '[speakWithTTS] TTS hourly quota exceeded. Set TTS_CALL_LIMIT_PER_HOUR in backend .env (e.g. 200) or wait ~1 hour.',
          errBody.slice(0, 120),
        );
        return null;
      }

      if ([503, 502, 408].includes(res.status)) {
        const azureRateLimited =
          res.status === 503 &&
          (/azure_rate_limited|"Azure TTS rate limited"|rate limit|Rate limited|429/i.test(errBody) ||
            /Azure Speech rate limited/i.test(errBody));
        const retryableNet =
          /AbortError|timeout|unreachable|Backend unreachable|TTS timeout/i.test(errBody) ||
          res.status === 408;

        if (azureRateLimited) {
          // V31 — at most one retry; avoid hammering /api/tts-with-timing with identical text
          for (let attempt = 0; attempt < 2 && !res.ok; attempt++) {
            const backoff = 2000 + attempt * 2500;
            await sleep(backoff);
            res = await doTtsFetch();
            if (res.status === 401) {
              console.error('[TTS] ❌ Unauthorized (401)');
              return null;
            }
            if (res.ok) break;
            errBody = await res.text().catch(() => errBody);
            if (isTtsHourlyQuota(res.status, errBody)) {
              console.warn('[speakWithTTS] TTS hourly quota during retry.', errBody.slice(0, 120));
              return null;
            }
          }
        } else if (retryableNet) {
          await sleep(600);
          res = await doTtsFetch();
          if (res.status === 401) {
            console.error('[TTS] ❌ Unauthorized (401)');
            return null;
          }
        } else {
          if (res.status === 503 || res.status === 502) {
            console.error(
              `[speakWithTTS] TTS unavailable (${res.status}) — no client fallback.`,
              errBody.slice(0, 220),
            );
            return null;
          }
          console.warn(
            `[speakWithTTS] /api/tts-with-timing HTTP ${res.status}:`,
            errBody.slice(0, 400),
          );
          return null;
        }
      } else {
        console.warn(
          `[speakWithTTS] /api/tts-with-timing HTTP ${res.status}:`,
          errBody.slice(0, 400),
        );
        return null;
      }
    }

    if (!res.ok) {
      const errTail = await res.text().catch(() => '');
      if (res.status === 401) {
        console.error('[TTS] ❌ Unauthorized (401)');
        return null;
      }
      if (isTtsHourlyQuota(res.status, errTail)) {
        console.warn('[speakWithTTS] TTS hourly quota after retry.', errTail.slice(0, 120));
        return null;
      }
      if (res.status === 503 || res.status === 502) {
        console.error(
          `[speakWithTTS] TTS unavailable (${res.status}) after retry — no client fallback.`,
          errTail.slice(0, 220),
        );
        return null;
      }
      console.warn(
        `[speakWithTTS] /api/tts-with-timing HTTP ${res.status} after retry:`,
        errTail.slice(0, 400),
      );
      return null;
    }

    const data = await res.json().catch(() => null);
    const prov = typeof data?.provider === 'string' ? data.provider.toLowerCase().trim() : '';
    if (prov && prov !== 'azure' && prov !== 'edge' && prov !== 'auto' && prov !== 'elevenlabs') {
      console.error('[speakWithTTS] TTS provider not supported — got:', data?.provider);
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
      return null;
    }
    const audioBase64 = data?.audio_base64;
    const wordTimings = (data?.word_timings ?? []) as WordTiming[];
    const sampleRate = data?.sample_rate ?? 24000;

    if (!audioBase64) {
      console.error(
        '[speakWithTTS] Backend returned no audio — cannot play.',
        JSON.stringify(data)?.slice(0, 300),
      );
      return null;
    }

    const playbackEl = getTtsPlaybackAudioElement();
    if (!playbackEl) {
      console.error(
        '[TTS] ABORT: no playback element — AvatarAgentClient must mount and call setTtsPlaybackAudioElement',
      );
      return null;
    }

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

    detachPlaybackElementListeners();
    try {
      playbackEl.pause();
      playbackEl.currentTime = 0;
    } catch {
      /* */
    }
    playbackEl.crossOrigin = 'anonymous';
    playbackEl.preload = 'auto';
    playbackEl.volume = 0.94;
    playbackEl.src = audioSrc;
    const audio = playbackEl;
    currentAudio = audio;

    const visemeCues = visemeEventsToCues(visRaw);

    const cleanup = (): void => {
      _clientTtsPlaying = false;
      while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
      if (mySid === _ttsSessionId) {
        audio.removeEventListener('ended', cleanup);
        audio.removeEventListener('error', cleanup);
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
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        options?.onEnd?.();
      }
    };

    _onPlaybackEnded = cleanup;
    _onPlaybackError = cleanup;
    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);

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

    const dispatchPlaybackAfterAudibleStart = (): void => {
      speakUiDispatched = true;
      useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      setSpeechEmotionBridge({
        emotion: resolvedEmotion,
        intensity: resolvedIntensity,
      });
      window.dispatchEvent(
        new CustomEvent('avatar:speak', {
          detail: { text, timings: wordTimings, sampleRate, audio },
        }),
      );
      setSpeechIntentHintsFromText(text);
      window.dispatchEvent(
        new CustomEvent('avatar:speak:start', {
          detail: { emotion: resolvedEmotion, intensity: resolvedIntensity },
        }),
      );
      options?.onStart?.();
      scheduleNods();
    };

    /** First play(); on non-autoplay errors, resume AudioContext and try once more. NotAllowed → rethrow for muted fallback. */
    const playWithResumeRetry = async (): Promise<boolean> => {
      // eslint-disable-next-line no-console
      console.log('[TTS] 🔊 PLAY');
      try {
        await audio.play();
        return true;
      } catch (first) {
        if ((first as Error).name === 'NotAllowedError') throw first;
        try {
          await resumeSharedAudioContext();
          await audio.play();
          return true;
        } catch (e) {
          console.error('[TTS] ❌ audio.play failed:', e);
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
      const playedOk = await playWithResumeRetry();
      if (!playedOk) {
        cleanup();
        return null;
      }
      await waitAudioReady(audio);
      _clientTtsPlaying = true;
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
      return audio;
    } catch (playErr: unknown) {
      try {
        useBrainStore.getState().setPreSpeechCognitiveWindow(false);
      } catch {
        /* */
      }
      const err = playErr as Error;
      if (err.name === 'NotAllowedError') {
        console.warn('[speakWithTTS] 🔇 Autoplay blocked — starting muted. User must unmute.');
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
        console.log('[TTS] 🔊 PLAY');
        await audio.play();
        await waitAudioReady(audio);
        _clientTtsPlaying = true;
        // eslint-disable-next-line no-console
        console.log('[TTS] ✅ SUCCESS');
        console.log('[speakWithTTS] 🔊 Muted playback started — UI should show Unmute button');
        dispatchPlaybackAfterAudibleStart();
        window.dispatchEvent(
          new CustomEvent('cogni:autoplay-blocked', {
            detail: { audio, text },
          }),
        );
        if (ttsLog) {
          // eslint-disable-next-line no-console
          console.log('[speakWithTTS] ✅ audio.play() resolved (muted — autoplay policy)', {
            duration: Number.isFinite(audio.duration) ? audio.duration : null,
          });
        }
        return audio;
      }
      console.error('[speakWithTTS] Audio play failed:', err);
      cleanup();
      return null;
    }
  } catch (err) {
    // Catch errors from fetch, JSON, or blob creation
    console.warn('[speakWithTTS] TTS pipeline exception:', err);
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
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      options?.onEnd?.();
    }
    return null;
  }
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
    ttsClientBodyProvider:     'edge',
    checklist: [
      'JWT required for speakWithTTS (Authorization on /api/tts-with-timing).',
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