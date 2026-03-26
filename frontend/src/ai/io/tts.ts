/**
 * Client-side TTS: speaks text via /api/tts-with-timing, dispatches avatar:speak for lip-sync.
 * Supports avatar:interrupt to stop playback when user types or speaks.
 * Phase 2: schedules avatar:viseme events from real word-boundary timing (edge-tts).
 */
import type { WordTiming } from '@/ai/lipsync/timing';
import { azureVisemeToWeights } from '@/ai/lipsync/azureViseme';
import { COGNI_PERSONA } from '@/config/personality';
import { estimateSpeechDurationMs } from '@/utils/TimingUtils';

export type { WordTiming };

export interface SpeakOptions {
  emotion?:  string;   // Phase 4: maps to edge-tts prosody via backend
  rate?:     number;   // Hybrid Persona Kernel: direct speed override (1.0 = normal)
  pitch?:    string;   // Phase 4: explicit Hz offset e.g. "+5Hz" (overrides emotion default)
  /** Override Jordanian Arabic voice: "male" (ar-JO-OmarNeural) | "female" (ar-JO-MaysoonNeural) */
  arVoice?:  'male' | 'female';
  onStart?: () => void;
  onEnd?:   () => void;
}

/** Detect Arabic unicode block (U+0600–U+06FF) */
const _ARABIC_RE = /[\u0600-\u06FF]/;

const _SECONDARY_TTS_PROVIDERS = new Set(['edge-tts', 'gtts']);

function _notifySecondaryTtsEngine(source: 'http' | 'response'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cogni:tts-secondary-voice', {
      detail: { message: 'Using secondary voice engine...', source },
    }),
  );
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
/** Monotonically-increasing session ID — guards against concurrent speakWithTTS calls. */
let _ttsSessionId = 0;
/** Pending viseme setTimeout IDs — cleared on interrupt. */
const _visemeTimers: ReturnType<typeof setTimeout>[] = [];
/** True while client `/api/tts-with-timing` audio is actively playing (after successful play()). */
let _clientTtsPlaying = false;

/** Approximate word timings + viseme schedule when the TTS API returns 503 (no audio). */
function runLocalTtsLipSyncSimulation(
  text: string,
  options: SpeakOptions | undefined,
  mySid: number,
): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  const msPerWord = 200;
  const wordTimings: WordTiming[] = words.map((word, i) => ({
    word,
    start_time: i * msPerWord,
    end_time: (i + 1) * msPerWord,
  }));

  const durationMs = estimateSpeechDurationMs(trimmed, options?.rate ?? 1);

  window.dispatchEvent(
    new CustomEvent('avatar:speak', {
      detail: { text: trimmed, timings: wordTimings, sampleRate: 24000, audio: null },
    }),
  );
  options?.onStart?.();

  if (words.length > 0) {
    window.dispatchEvent(new CustomEvent('avatar:viseme:start'));
    words.forEach((word, i) => {
      const t = i * msPerWord;
      const firstAr = [...word].find((ch) => /[\u0600-\u06FF]/.test(ch));
      const vid = firstAr ? 2 : 1;
      _visemeTimers.push(
        setTimeout(() => {
          if (mySid !== _ttsSessionId) return;
          window.dispatchEvent(
            new CustomEvent('avatar:viseme', {
              detail: { id: vid, weights: azureVisemeToWeights(vid) },
            }),
          );
        }, Math.max(0, t)),
      );
    });
  }

  const sentenceEnd = /[.!?\u061f\u060c]+$/;
  wordTimings.forEach((wt) => {
    if (sentenceEnd.test(wt.word ?? '') && wt.end_time > 0) {
      _visemeTimers.push(
        setTimeout(() => {
          if (mySid !== _ttsSessionId) return;
          window.dispatchEvent(
            new CustomEvent('avatar:nod', {
              detail: {
                intensity: 0.16 + Math.random() * 0.18,
                duration: (360 + Math.random() * 160) / 1000,
              },
            }),
          );
        }, wt.end_time + 120),
      );
    }
  });

  _visemeTimers.push(
    setTimeout(() => {
      if (mySid !== _ttsSessionId) return;
      window.dispatchEvent(
        new CustomEvent('avatar:viseme', { detail: { id: 0, weights: { aa: 0, ih: 0, ou: 0 } } }),
      );
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      options?.onEnd?.();
    }, durationMs),
  );

  return true;
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

/**
 * Stop current TTS playback. Called when user interrupts (types or speaks).
 */
export function stopTTS(): void {
  _clientTtsPlaying = false;
  // Cancel pending viseme events
  while (_visemeTimers.length) clearTimeout(_visemeTimers.pop()!);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('avatar:viseme', { detail: { id: 0, weights: { aa: 0, ih: 0, ou: 0 } } }));
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
    window.dispatchEvent(new CustomEvent('avatar:speak:end'));
  }
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
    const personaRate = COGNI_PERSONA.voiceParameters.rate;
    const emotionKey = options?.emotion ?? 'neutral';
    const blendedSpeed =
      options?.rate ?? resolveSpeakRate(emotionKey, personaRate);
    const defaultPitchFromPersona =
      COGNI_PERSONA.voiceParameters.pitchScale > 1.005
        ? `+${Math.round((COGNI_PERSONA.voiceParameters.pitchScale - 1) * 45)}Hz`
        : undefined;

    const ttsBody = JSON.stringify({
      text,
      speed: blendedSpeed,
      emotion: emotionKey,
      ...(options?.pitch
        ? { pitch: options.pitch }
        : defaultPitchFromPersona
          ? { pitch: defaultPitchFromPersona }
          : {}),
      ar_voice: options?.arVoice ?? (_ARABIC_RE.test(text) ? 'male' : undefined),
    });

    const doTtsFetch = () =>
      fetch('/api/tts-with-timing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            console.warn(
              `[speakWithTTS] TTS unavailable (${res.status}) — local lip-sync only (no audio).`,
              errBody.slice(0, 220),
            );
            return runLocalTtsLipSyncSimulation(text, options, mySid);
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
        console.warn(
          `[speakWithTTS] TTS unavailable (${res.status}) after retry — local lip-sync only.`,
          errTail.slice(0, 220),
        );
        return runLocalTtsLipSyncSimulation(text, options, mySid);
      }
      console.warn(
        `[speakWithTTS] /api/tts-with-timing HTTP ${res.status} after retry:`,
        errTail.slice(0, 400),
      );
      return false;
    }

    const data = await res.json().catch(() => null);
    const audioBase64 = data?.audio_base64;
    const wordTimings = (data?.word_timings ?? []) as WordTiming[];
    const sampleRate = data?.sample_rate ?? 24000;

    if (!audioBase64) {
      console.warn(
        '[speakWithTTS] Backend returned no audio — local lip-sync only.',
        JSON.stringify(data)?.slice(0, 300),
      );
      return runLocalTtsLipSyncSimulation(text, options, mySid);
    }

    const _prov = typeof data?.provider === 'string' ? data.provider.toLowerCase() : '';
    if (_prov && _SECONDARY_TTS_PROVIDERS.has(_prov)) {
      _notifySecondaryTtsEngine('response');
    }

    const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const fmt = (data?.format ?? 'mp3') as string;
    const blob = fmt === 'pcm'
      ? pcmBytesToWavBlob(binary, sampleRate)
      : new Blob([binary], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    currentUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;

    // Cleanup function to be called after playback ends or on fatal error
    const cleanup = () => {
      _clientTtsPlaying = false;
      URL.revokeObjectURL(url);
      if (mySid === _ttsSessionId) {
        currentAudio = null;
        currentUrl   = null;
      }
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      options?.onEnd?.();
    };

    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);

    options?.onStart?.();

    // We will NOT dispatch avatar:speak:start until we confirm playback has actually started.
    // Instead, we store the events to be dispatched after successful play.

    // ── Phase 2: Real viseme scheduling from edge-tts word-boundary events ──
    const visemeEvents = (data?.viseme_events ?? []) as Array<{ offset_ms: number; viseme_id: number }>;
    const scheduleVisemes = () => {
      if (visemeEvents.length > 0) {
        window.dispatchEvent(new CustomEvent('avatar:viseme:start'));
        visemeEvents.forEach((ve) => {
          _visemeTimers.push(
            setTimeout(() => {
              if (mySid !== _ttsSessionId) return;
              window.dispatchEvent(new CustomEvent('avatar:viseme', {
                detail: { id: ve.viseme_id, weights: azureVisemeToWeights(ve.viseme_id) },
              }));
            }, Math.max(0, ve.offset_ms))
          );
        });
      }
    };

    const scheduleNods = () => {
      if (wordTimings.length > 0) {
        const sentenceEnd = /[.!?\u061f\u060c]+$/;
        wordTimings.forEach((wt) => {
          if (sentenceEnd.test(wt.word ?? '') && wt.end_time > 0) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('avatar:nod', {
                detail: {
                  intensity: 0.16 + Math.random() * 0.18,
                  duration: (360 + Math.random() * 160) / 1000,
                },
              }));
            }, wt.end_time + 120);
          }
        });
      } else if (text.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3).length > 1) {
        const sentences = text.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3);
        const totalMs   = Math.max(1500, text.length * 190);
        let cumLen = 0;
        sentences.slice(0, -1).forEach((s) => {
          cumLen += s.length + 1;
          const delay = Math.max(300, (cumLen / text.length) * totalMs) + 80;
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('avatar:nod', {
              detail: { intensity: 0.14 + Math.random() * 0.16, duration: (340 + Math.random() * 130) / 1000 },
            }));
          }, delay);
        });
      }
    };

    // Handle autoplay policy
    try {
      // Try normal playback
      await audio.play();
      _clientTtsPlaying = true;
      // Success! Now we can dispatch start events.
      window.dispatchEvent(new CustomEvent('avatar:speak', {
        detail: { text, timings: wordTimings, sampleRate, audio },
      }));
      window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      scheduleVisemes();
      scheduleNods();
      return true;
    } catch (playErr: unknown) {
      const err = playErr as Error;
      if (err.name === 'NotAllowedError') {
        console.warn('[speakWithTTS] 🔇 Autoplay blocked — starting muted. User must unmute.');
        // Restart with muted audio to establish playback context
        audio.muted = true;
        await audio.play(); // إذا فشلت هذه أيضاً، نتركها ترمي الخطأ
        _clientTtsPlaying = true;
        console.log('[speakWithTTS] 🔊 Muted playback started — UI should show Unmute button');

        // Dispatch events even though muted – the audio is technically playing
        window.dispatchEvent(new CustomEvent('avatar:speak', {
          detail: { text, timings: wordTimings, sampleRate, audio },
        }));
        window.dispatchEvent(new CustomEvent('avatar:speak:start'));
        scheduleVisemes();
        scheduleNods();

        // Signal UI to show unmute button
        window.dispatchEvent(new CustomEvent('cogni:autoplay-blocked', {
          detail: { audio, text },
        }));
        return true;
      } else {
        // Some other play error (network, decode, etc.)
        console.error('[speakWithTTS] Audio play failed:', err);
        cleanup(); // clean up the blob and events
        return false;
      }
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
    window.dispatchEvent(new CustomEvent('avatar:speak:end'));
    options?.onEnd?.();
    return false;
  }
}