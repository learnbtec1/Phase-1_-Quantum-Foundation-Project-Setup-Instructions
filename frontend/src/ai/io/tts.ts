/**
 * Client-side TTS: speaks text via /api/tts-with-timing, dispatches avatar:speak for lip-sync.
 * Supports avatar:interrupt to stop playback when user types or speaks.
 */
import type { WordTiming } from '@/ai/lipsync/timing';

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

/**
 * Stop current TTS playback. Called when user interrupts (types or speaks).
 */
export function stopTTS(): void {
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
    const blob = new Blob([binary], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    currentUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;

    const cleanup = () => {
      if (currentAudio === audio) {
        currentAudio = null;
        currentUrl = null;
      }
      URL.revokeObjectURL(url);
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
                duration:  360  + Math.random() * 160,
              },
            }));
          }, wt.end_time * 1000 + 120);   // end_time is seconds; add 120ms grace
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
            detail: { intensity: 0.14 + Math.random() * 0.16, duration: 340 + Math.random() * 130 },
          }));
        }, delay);
      });
    }

    await audio.play();
    return true;
  } catch {
    currentAudio = null;
    currentUrl = null;
    return false;
  }
}
