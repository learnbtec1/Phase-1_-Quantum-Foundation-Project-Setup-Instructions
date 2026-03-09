/**
 * Client-side TTS: speaks text via /api/tts-with-timing, dispatches avatar:speak for lip-sync.
 * Supports avatar:interrupt to stop playback when user types or speaks.
 * Phase 2: schedules avatar:viseme events from real word-boundary timing (edge-tts).
 */
import type { WordTiming } from '@/ai/lipsync/timing';
import { azureVisemeToWeights } from '@/ai/lipsync/azureViseme';

export type { WordTiming };

export interface SpeakOptions {
  emotion?:  string;   // Phase 8: maps to TTS speed for prosody
  rate?:     number;   // Hybrid Persona Kernel: direct speed override (1.0 = normal)
  onStart?: () => void;
  onEnd?:   () => void;
}

// Phase 8: Emotion → speech-rate mapping (Kokoro `speed` param)
const EMOTION_SPEED: Record<string, number> = {
  celebration: 1.10,
  excited:     1.10,
  happy:       1.05,
  encouraging: 1.02,
  friendly:    0.98,
  neutral:     0.97,
  thinking:    0.90,
  sad:         0.88,
  empathy:     0.92,
};

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
/** Monotonically-increasing session ID — guards against concurrent speakWithTTS calls. */
let _ttsSessionId = 0;
/** Pending viseme setTimeout IDs — cleared on interrupt. */
const _visemeTimers: ReturnType<typeof setTimeout>[] = [];

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
 * Speak text using TTS API. Returns true if successful, false to use Web Speech fallback.
 */
export async function speakWithTTS(
  text: string,
  options?: SpeakOptions
): Promise<boolean> {
  if (typeof window === 'undefined' || !text?.trim()) return false;
  const mySid = ++_ttsSessionId;
  stopTTS();

  try {
    const res = await fetch('/api/tts-with-timing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        speed: options?.rate ?? EMOTION_SPEED[options?.emotion ?? ''] ?? 0.97,
      }),
    });

    if (!res.ok) return false;

    const data = await res.json().catch(() => null);
    const audioBase64 = data?.audio_base64;
    const wordTimings = (data?.word_timings ?? []) as WordTiming[];
    const sampleRate = data?.sample_rate ?? 24000;

    if (!audioBase64) return false;

    const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    // Backend returns format:"pcm" for Kokoro (raw int16) or format:"mp3" for edge-tts/gTTS.
    const fmt = (data?.format ?? 'mp3') as string;
    const blob = fmt === 'pcm'
      ? pcmBytesToWavBlob(binary, sampleRate)
      : new Blob([binary], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    currentUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;

    const cleanup = () => {
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

    window.dispatchEvent(
      new CustomEvent('avatar:speak', {
        detail: { text, timings: wordTimings, sampleRate, audio },
      })
    );
    window.dispatchEvent(new CustomEvent('avatar:speak:start'));
    // ── Phase 2: Real viseme scheduling from edge-tts word-boundary events ──
    // viseme_events: [{ offset_ms, viseme_id }] — fired at correct audio position
    type VisemeEvent = { offset_ms: number; viseme_id: number };
    const visemeEvents = (data?.viseme_events ?? []) as VisemeEvent[];
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
    // ── Phase 10: Sentence-boundary head nods ──────────────────────────────
    // When we have actual word timings, schedule a nod 120ms after each sentence-
    // ending word — more accurate than director’s character-count estimates.
    if (wordTimings.length > 0) {
      const sentenceEnd = /[.!?\u061f\u060c]+$/;
      wordTimings.forEach((wt) => {
        if (sentenceEnd.test(wt.word ?? '') && wt.end_time > 0) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('avatar:nod', {
              detail: {
                intensity: 0.16 + Math.random() * 0.18,
                // AvatarCanvas onNod expects seconds and multiplies ×1000 internally
                duration: (360 + Math.random() * 160) / 1000,
              },
            }));
          }, wt.end_time + 120);   // end_time is already in ms from Kokoro; add 120ms grace
        }
      });
    }
    // Fallback: character-count-based nods when word timings are absent
    else if (text.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3).length > 1) {
      const sentences = text.split(/[.!?\u061f]+/).filter(s => s.trim().length > 3);
      const totalMs   = Math.max(1500, text.length * 190);
      let cumLen = 0;
      sentences.slice(0, -1).forEach((s) => {
        cumLen += s.length + 1;
        const delay = Math.max(300, (cumLen / text.length) * totalMs) + 80;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('avatar:nod', {
            // AvatarCanvas onNod expects seconds and multiplies ×1000 internally
            detail: { intensity: 0.14 + Math.random() * 0.16, duration: (340 + Math.random() * 130) / 1000 },
          }));
        }, delay);
      });
    }

    if (mySid !== _ttsSessionId) {
      // Preempted by a subsequent speakWithTTS call — abort without playing.
      URL.revokeObjectURL(url);
      return false;
    }

    await audio.play();
    return true;
  } catch {
    if (mySid === _ttsSessionId) {
      currentAudio = null;
      currentUrl   = null;
    }
    return false;
  }
}
