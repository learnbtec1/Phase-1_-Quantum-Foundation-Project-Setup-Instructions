/**
 * Client-side TTS: speaks text via /api/tts-with-timing, dispatches avatar:speak for lip-sync.
 * Supports avatar:interrupt to stop playback when user types or speaks.
 */
import type { WordTiming } from '@/ai/lipsync/timing';

export type { WordTiming };

export interface SpeakOptions {
  emotion?:  string;   // Phase 8: maps to TTS speed for prosody
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
        speed: EMOTION_SPEED[options?.emotion ?? ''] ?? 0.97,
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

    await audio.play();
    return true;
  } catch {
    currentAudio = null;
    currentUrl = null;
    return false;
  }
}
