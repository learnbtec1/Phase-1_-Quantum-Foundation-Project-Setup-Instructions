/**
 * Client-side TTS: speaks text via /api/tts-with-timing, dispatches avatar:speak for lip-sync.
 * Supports avatar:interrupt to stop playback when user types or speaks.
 * Phase 2: schedules avatar:viseme events from Azure viseme + word-boundary timing.
 */
import type { WordTiming } from '@/ai/lipsync/timing';
import { COGNI_PERSONA } from '@/config/personality';
import { authHeaders } from '@/lib/auth';
import { resetSpeechIntentHints, setSpeechIntentHintsFromText } from '@/lib/avatar/speechIntentHints';
import { resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';
import { waitAudioReady } from '@/lib/audio/waitAudioReady';
import { visemeEventsToCues } from '@/lib/audio/visemeCueFromApi';
import { inferEmotionFromText } from '@/ai/voice/emotionFromText';
import { getPauseMicroHeadMul } from '@/ai/voice/emotionalCoupling';
import { getSpeechEmotionSnapshot, setSpeechEmotionBridge } from '@/ai/voice/speechEmotionBridge';

export type { WordTiming };

export interface SpeakOptions {
  emotion?:  string;   // Phase 4: maps to Azure SSML prosody via backend
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

/** Optional: browser Azure Speech SDK path (`useTTSWithVisemes`) — stopped with global TTS interrupt. */
let _stopAzureClientTTS: (() => void) | null = null;

export function registerAzureClientTTSStop(fn: (() => void) | null): void {
  _stopAzureClientTTS = fn;
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
  while (_visemeTimers.length) clearTimeout(_visemeTimers.pop()!);
  while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
  try {
    _stopAzureClientTTS?.();
  } catch {
    /* */
  }
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
      } catch { /* ignore */ }
    }
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
      } catch { /* ignore */ }
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
  try {
    _stopAzureClientTTS?.();
  } catch {
    /* */
  }
  // Cancel pending viseme events
  while (_visemeTimers.length) clearTimeout(_visemeTimers.pop()!);
  while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('avatar:viseme', { detail: { id: 0, weights: { aa: 0, ih: 0, ou: 0 } } }));
    window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch { /* ignore */ }
    currentAudio = null;
  }
  if (currentUrl) {
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
 * Speak text using TTS API (`/api/tts-with-timing`). Returns false if upstream failed (caller may use AgentDirector timing-only fallback).
 */
export async function speakWithTTS(
  text: string,
  options?: SpeakOptions
): Promise<boolean> {
  if (typeof window === 'undefined' || !text?.trim()) return false;
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
      provider: 'azure',
      speed: blendedSpeed,
      emotion: resolvedEmotion,
      emotion_intensity: resolvedIntensity,
      ...(resolvedPitch ? { pitch: resolvedPitch } : {}),
      ar_voice: options?.arVoice ?? (_ARABIC_RE.test(text) ? 'male' : undefined),
    });

    const doTtsFetch = () =>
      fetch('/api/tts-with-timing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: ttsBody,
      });

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    let res = await doTtsFetch();

    const isTtsHourlyQuota = (status: number, body: string) =>
      status === 429 ||
      /tts_hourly_limit|"TTS hourly limit|hourly limit exceeded|tts_rate_limit/i.test(body);

    if (!res.ok) {
      let errBody = await res.text().catch(() => '');

      if (isTtsHourlyQuota(res.status, errBody)) {
        console.warn(
          '[speakWithTTS] TTS hourly quota exceeded. Set TTS_CALL_LIMIT_PER_HOUR in backend .env (e.g. 200) or wait ~1 hour.',
          errBody.slice(0, 120),
        );
        return false;
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
            if (res.ok) break;
            errBody = await res.text().catch(() => errBody);
            if (isTtsHourlyQuota(res.status, errBody)) {
              console.warn('[speakWithTTS] TTS hourly quota during retry.', errBody.slice(0, 120));
              return false;
            }
          }
        } else if (retryableNet) {
          await sleep(600);
          res = await doTtsFetch();
        } else {
          if (res.status === 503 || res.status === 502) {
            console.error(
              `[speakWithTTS] Azure TTS unavailable (${res.status}) — no fallback (Azure-only policy).`,
              errBody.slice(0, 220),
            );
            return false;
          }
          console.warn(
            `[speakWithTTS] /api/tts-with-timing HTTP ${res.status}:`,
            errBody.slice(0, 400),
          );
          return false;
        }
      } else {
        console.warn(
          `[speakWithTTS] /api/tts-with-timing HTTP ${res.status}:`,
          errBody.slice(0, 400),
        );
        return false;
      }
    }

    if (!res.ok) {
      const errTail = await res.text().catch(() => '');
      if (isTtsHourlyQuota(res.status, errTail)) {
        console.warn('[speakWithTTS] TTS hourly quota after retry.', errTail.slice(0, 120));
        return false;
      }
      if (res.status === 503 || res.status === 502) {
        console.error(
          `[speakWithTTS] Azure TTS unavailable (${res.status}) after retry — no fallback.`,
          errTail.slice(0, 220),
        );
        return false;
      }
      console.warn(
        `[speakWithTTS] /api/tts-with-timing HTTP ${res.status} after retry:`,
        errTail.slice(0, 400),
      );
      return false;
    }

    const data = await res.json().catch(() => null);
    const prov = typeof data?.provider === 'string' ? data.provider.toLowerCase() : '';
    if (prov && prov !== 'azure') {
      console.error('[speakWithTTS] TTS provider must be azure — got:', data?.provider);
      return false;
    }
    const visRaw = data?.viseme_events;
    if (!Array.isArray(visRaw) || visRaw.length === 0) {
      console.error(
        '[speakWithTTS] Missing or empty viseme_events — lip sync cannot run (Azure integrity).',
        JSON.stringify(data)?.slice(0, 240),
      );
      return false;
    }
    const audioBase64 = data?.audio_base64;
    const wordTimings = (data?.word_timings ?? []) as WordTiming[];
    const sampleRate = data?.sample_rate ?? 24000;

    if (!audioBase64) {
      console.error(
        '[speakWithTTS] Backend returned no audio — Azure-only: cannot play.',
        JSON.stringify(data)?.slice(0, 300),
      );
      return false;
    }

    const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const fmt = (data?.format ?? 'wav') as string;
    const blob = fmt === 'pcm'
      ? pcmBytesToWavBlob(binary, sampleRate)
      : new Blob([binary], { type: fmt === 'wav' ? 'audio/wav' : 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    currentUrl = url;
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    /** Slight headroom to reduce perceived clipping on neural voices */
    audio.volume = 0.94;
    audio.src = url;
    currentAudio = audio;

    const visemeCues = visemeEventsToCues(data?.viseme_events);

    // Cleanup function to be called after playback ends or on fatal error
    const cleanup = () => {
      _clientTtsPlaying = false;
      while (_nodTimers.length) clearTimeout(_nodTimers.pop()!);
      URL.revokeObjectURL(url);
      if (mySid === _ttsSessionId) {
        currentAudio = null;
        currentUrl   = null;
      }
      resetSpeechIntentHints();
      setSpeechEmotionBridge(null);
      window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      options?.onEnd?.();
    };

    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);

    const scheduleNods = () => {
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

    const dispatchPlaybackStarted = (): void => {
      window.dispatchEvent(
        new CustomEvent('cogni:pre_speech', {
          detail: { emotion: resolvedEmotion, intensity: resolvedIntensity },
        }),
      );
      setSpeechEmotionBridge({
        emotion: resolvedEmotion,
        intensity: resolvedIntensity,
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

    try {
      await resumeSharedAudioContext();
      await audio.play();
      await waitAudioReady(audio);
      _clientTtsPlaying = true;
      dispatchPlaybackStarted();
      return true;
    } catch (playErr: unknown) {
      const err = playErr as Error;
      if (err.name === 'NotAllowedError') {
        console.warn('[speakWithTTS] 🔇 Autoplay blocked — starting muted. User must unmute.');
        audio.muted = true;
        await resumeSharedAudioContext();
        await audio.play();
        await waitAudioReady(audio);
        _clientTtsPlaying = true;
        console.log('[speakWithTTS] 🔊 Muted playback started — UI should show Unmute button');
        dispatchPlaybackStarted();
        window.dispatchEvent(
          new CustomEvent('cogni:autoplay-blocked', {
            detail: { audio, text },
          }),
        );
        return true;
      }
      console.error('[speakWithTTS] Audio play failed:', err);
      cleanup();
      return false;
    }
  } catch (err) {
    // Catch errors from fetch, JSON, or blob creation
    console.warn('[speakWithTTS] TTS pipeline exception:', err);
    if (mySid === _ttsSessionId) {
      if (currentUrl) {
        try { URL.revokeObjectURL(currentUrl); } catch { /* ignore */ }
      }
      currentAudio = null;
      currentUrl   = null;
    }
    // Dispatch end event in case anything was already sent (though unlikely)
    resetSpeechIntentHints();
    setSpeechEmotionBridge(null);
    window.dispatchEvent(new CustomEvent('avatar:speak:end'));
    options?.onEnd?.();
    return false;
  }
}