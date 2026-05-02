/**
 * Lightweight text → emotion + intensity (Arabic + English heuristics).
 * No network; safe for real-time — used to enrich TTS when intent is missing.
 */
'use client';

export type InferredEmotion = {
  emotion: string;
  intensity: number;
};

const SERIOUS_AR = /مهم\s*جدا|جد(ا|ي)\s*مهم|خطير|حرج|يجب|لازم|انتبه|احذر/i;
const EXCITED_AR = /[!؟]{2,}|يا\s*سلام|رائع|ممتاز|حلو|عظيم|wow|great/i;
const CALM_AR = /حسنا|حسنًا|طيب|تمام|لا\s*بأس|بكل\s*هدوء|…|\.\.\./i;
const THINK_AR = /دعني\s*أفكر|فكر|تأمل|أظن|ربما|ممكن|hm+|hmm/i;
const SAD_AR = /حزين|آسف|للأسف|يؤسف|difficult|sorry/i;

/**
 * Infer display emotion + 0–1 intensity from raw dialogue.
 */
export function inferEmotionFromText(text: string): InferredEmotion {
  const t = (text || '').trim();
  if (!t) return { emotion: 'neutral', intensity: 0.45 };

  if (SERIOUS_AR.test(t) || /\b(critical|urgent|must|important)\b/i.test(t)) {
    return { emotion: 'serious', intensity: Math.min(1, 0.55 + Math.min(0.35, t.length / 400)) };
  }
  if (EXCITED_AR.test(t) || /\b(yes!|amazing|awesome)\b/i.test(t)) {
    return { emotion: 'excited', intensity: Math.min(1, 0.62 + Math.min(0.3, t.length / 350)) };
  }
  if (SAD_AR.test(t)) {
    return { emotion: 'concerned', intensity: 0.58 };
  }
  if (THINK_AR.test(t) || /\b(let me think|perhaps|maybe)\b/i.test(t)) {
    return { emotion: 'thinking', intensity: 0.55 };
  }
  if (CALM_AR.test(t) || /^(ok|okay|alright)\b/i.test(t)) {
    return { emotion: 'calm', intensity: 0.42 };
  }

  const q = (t.match(/[!؟]/g) || []).length;
  if (q >= 2) return { emotion: 'friendly', intensity: 0.55 };

  return { emotion: 'neutral', intensity: 0.5 };
}
