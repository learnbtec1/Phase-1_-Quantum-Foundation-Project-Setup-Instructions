/**
 * Client-side TTS: speaks text via /api/tts-proxy, dispatches avatar:speak for lip-sync.
 * Supports avatar:interrupt to stop playback when user types or speaks.
 * Phase 2: schedules avatar:viseme events from real word-boundary timing (edge-tts).
 */
import toast from 'react-hot-toast';
import type { WordTiming } from '@/ai/lipsync/timing';
import { azureVisemeToWeights } from '@/ai/lipsync/azureViseme';

export type { WordTiming };

export interface SpeakOptions {
  emotion?:  string;   // Phase 4: maps to edge-tts prosody via backend
  rate?:     number;   // Hybrid Persona Kernel: direct speed override (1.0 = normal)
  pitch?:    string;   // Phase 4: explicit Hz offset e.g. "+5Hz" (overrides emotion default)
  /** Override Jordanian Arabic voice: "male" (ar-JO-TaimNeural) | "female" (ar-JO-SanaNeural) */
  arVoice?:  'male' | 'female';
  onStart?: () => void;
  onEnd?:   () => void;
}

/** Detect Arabic unicode block (U+0600–U+06FF) */
const _ARABIC_RE = /[\u0600-\u06FF]/;

// ══════════════════════════════════════════════════════════════════════════════
// تعريفات اللهجة الأردنية — Jordanian Arabic Dialect Profile
// ══════════════════════════════════════════════════════════════════════════════
//
//  الصوت الذكوري  : ar-JO-TaimNeural  →  شخصية د. حمزة  (TTS_ARABIC_VOICE)
//  الصوت الأنثوي  : ar-JO-SanaNeural  →  شخصية فورينا   (TTS_ARABIC_VOICE_FEMALE)
//
//  المشاعر الستة الأساسية للمدرّس مع سرعتها المناسبة للعربية الأردنية:
//    neutral     →  هادئ رزين         ×0.93  (أهدأ قليلاً للوضوح)
//    friendly    →  ودود دافئ         ×0.97  (طبيعي ومرحّب)
//    thinking    →  متأمّل متمهّل      ×0.82  (توقف واضح)
//    encouraging →  تشجيعي حماسي     ×1.07  (حيوي ورافع للمعنويات)
//    strict      →  حازم رسمي         ×0.88  (سلطة هادئة)
//    celebrate   →  احتفالي فرحاني    ×1.14  (فرح أردني تعبيري)
// ══════════════════════════════════════════════════════════════════════════════

/** Kokoro speed multiplier per tutor emotion — Arabic Jordanian dialect tuned */
const EMOTION_SPEED: Record<string, number> = {
  // ── المشاعر الستة الأساسية للمدرّس ──────────────────────────────────────
  neutral:     0.93,   // هادئ رزين
  friendly:    0.97,   // ودود دافئ
  thinking:    0.82,   // متأمّل متمهّل
  encouraging: 1.07,   // تشجيعي حماسي
  strict:      0.88,   // حازم رسمي
  celebrate:   1.14,   // احتفالي فرحاني
  // ── مشاعر موسّعة (توافق استجابات LLM الأخرى) ───────────────────────────
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

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
/** Monotonically-increasing session ID — guards against concurrent speakWithTTS calls. */
let _ttsSessionId = 0;
/** Pending viseme setTimeout IDs — cleared on interrupt. */
const _visemeTimers: ReturnType<typeof setTimeout>[] = [];

/** Wrap raw 16-bit mono PCM bytes (Kokoro output) in a valid WAV container. */
function pcmBytesToWavBlob(pcmBytes: Uint8Array, sampleRate: number): Blob {
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign    = numChannels * (bitsPerSample / 8);
  const dataSize      = pcmBytes.length;
  const bufferSize    = 44 + dataSize;
  const buffer        = new ArrayBuffer(bufferSize);
  const view          = new DataView(buffer);
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
    window.dispatchEvent(new CustomEvent('avatar:viseme', {
      detail: { id: 0, weights: { aa: 0, ih: 0, ou: 0 } }
    }));
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
      // لا تُلغِ إلا لو كان blob: URL أنشأناه نحن
      if (currentUrl.startsWith('blob:')) URL.revokeObjectURL(currentUrl);
    } catch { /* ignore */ }
    currentUrl = null;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('avatar:speak:end'));
  }
}

/**
 * Speak text using TTS API (via /api/tts-proxy). Returns true on success, false to use Web Speech fallback.
 * - Prefers server-provided audioUrl (no blob lifecycle issues).
 * - Falls back to audioBase64 -> Blob URL (revoked only after ended/error).
 * - Cancels Web‑Speech before playing to avoid echo.
 * - Retries audio.play() once if AudioContext/device balks.
 */
export async function speakWithTTS(
  text: string,
  options?: SpeakOptions
): Promise<boolean> {
  if (typeof window === 'undefined' || !text?.trim()) return false;

  // Guard future concurrent speaks
  const mySid = ++_ttsSessionId;
  stopTTS();

  // Helper: retry play() once on failure
  const safePlay = async (a: HTMLAudioElement) => {
    try { await a.play(); return true; }
    catch {
      // Small grace then retry once
      await new Promise(r => setTimeout(r, 400));
      try { await a.play(); return true; } catch { return false; }
    }
  };

  try {
    // Compose payload for proxy; keep your emotion/rate mapping
    const payload: any = {
      text,
      speed:   options?.rate ?? EMOTION_SPEED[options?.emotion ?? ''] ?? 0.97,
      emotion: options?.emotion ?? 'neutral',
      ...(options?.pitch ? { pitch: options.pitch } : {}),
      // Auto-select Jordanian Arabic voice for Arabic script unless overridden
      ar_voice: options?.arVoice ?? (_ARABIC_RE.test(text) ? 'male' : undefined),
      format: 'wav',
      timing_mode: 'native'
    };

    const res = await fetch('/api/tts-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    if (!j?.ok || !j?.tts) return false;

    // Extract meta
    const fmt        = (j.tts.format ?? 'wav') as string;
    const timingMode = (j.tts.timing_mode ?? 'native') as string;
    const sampleRate = j.tts.sampleRate ?? 24000;

    // Prefer audioUrl if present
    let url: string | null = j.tts.audioUrl || null;
    let createdObjectUrl = false;

    // If only base64 present, build Blob URL
    if (!url && j.tts.audioBase64) {
      const b64 = j.tts.audioBase64 as string;
      const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob =
        fmt === 'pcm'
          ? pcmBytesToWavBlob(binary, sampleRate)
          : fmt === 'wav'
            ? new Blob([binary], { type: 'audio/wav' })
            : new Blob([binary], { type: 'audio/mpeg' });
      url = URL.createObjectURL(blob);
      createdObjectUrl = true;
    }

    if (!url) return false;

    // Warn when format/timing is suboptimal (informational only)
    if (fmt !== 'wav' || timingMode === 'approx') {
      toast('TTS: دقة تقريبية للتوقيتات — كل شيء يعمل 👍', {
        icon: '⚠️',
        duration: 3500,
        style: { direction: 'rtl', fontFamily: 'Cairo, sans-serif', fontSize: '13px' },
      });
    }

    // Cancel any Web‑Speech before WAV to prevent echo
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}

    // Allocate and bind audio
    const audio = new Audio(url);
    currentAudio = audio;
    currentUrl   = url;

    // Visemes and word timings
    const visemeEvents = (j.tts.viseme_events ?? []) as { offset_ms: number; viseme_id: number }[];
    const wordTimings  = (j.tts.word_timings  ?? []) as WordTiming[];

    // Start callbacks & lip‑sync events
    options?.onStart?.();
    window.dispatchEvent(new CustomEvent('avatar:speak', {
      detail: { text, timings: wordTimings, sampleRate, audio },
    }));
    window.dispatchEvent(new CustomEvent('avatar:speak:start'));

    // Schedule visemes (Azure mapping)
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

    // Sentence-boundary nods (timing or heuristic)
    if (wordTimings.length > 0) {
      const sentenceEnd = /[.!?\u061f\u060c]+$/;
      wordTimings.forEach((wt) => {
        if (sentenceEnd.test((wt.word ?? '')) && wt.end_time > 0) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('avatar:nod', {
              detail: {
                intensity: 0.16 + Math.random() * 0.18,
                duration:  (360 + Math.random() * 160) / 1000
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
            detail: {
              intensity: 0.14 + Math.random() * 0.16,
              duration:  (340 + Math.random() * 130) / 1000
            },
          }));
        }, delay);
      });
    }

    // Cleanup that respects whether we created the blob URL
    const cleanup = () => {
      try {
        if (createdObjectUrl && url) URL.revokeObjectURL(url);
      } catch { /* ignore */ }
      if (mySid === _ttsSessionId) {
        currentAudio = null;
        currentUrl   = null;
      }
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      options?.onEnd?.();
    };

    audio.addEventListener('ended', cleanup, { once: true });
    audio.addEventListener('error', cleanup,  { once: true });

    // Finally, play with one retry on failure
    const ok = await (async () => {
      try { await audio.play(); return true; }
      catch {
        await new Promise(r => setTimeout(r, 400));
        try { await audio.play(); return true; } catch { return false; }
      }
    })();

    if (!ok) {
      cleanup();
      return false;
    }

    (window as any).__SERVER_TTS_ACTIVE__ = true;
    return true;

  } catch {
    // Always close the mouth & cleanup on failure
    try { window.dispatchEvent(new CustomEvent('avatar:speak:end')); } catch {}
    options?.onEnd?.();
    if (mySid === _ttsSessionId) {
      try { if (currentUrl?.startsWith('blob:')) URL.revokeObjectURL(currentUrl); } catch { /* ignore */ }
      currentAudio = null;
      currentUrl   = null;
    }
    return false;
  }
}