/**
 * Lightweight speech → 0..1 semantic channels for embodiment (no ML).
 * Utterance text is mirrored from {@link setSpeechIntentHintsFromText} for per-frame derivation.
 */
import type { SpeechSemanticHints } from '@/lib/avatar/embodimentState';

let utteranceTextForSemantics: string | undefined;

export function setEmbodimentUtteranceTextForSemantics(text: string | undefined): void {
  if (text === undefined || typeof text !== 'string') {
    utteranceTextForSemantics = undefined;
    return;
  }
  const t = text.trim();
  utteranceTextForSemantics = t.length ? t : undefined;
}

export function getEmbodimentUtteranceTextForSemantics(): string | undefined {
  return utteranceTextForSemantics;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Heuristic semantic scores from assistant / TTS line (Arabic + English cues).
 *
 * All channels are 0..1. The expression mapper consumes:
 *   emphasis (>0.6)  → emphasizing (nod + tilt)
 *   question (>0.5)  → thinking    (tilt)         ← head-tilt-on-question
 *   explanation(>.5) → explaining  (slow nod + turn)
 *   thinkingCue(>.5) → thinking    (tilt + pause)
 *   attention (>.5)  → listening   (turn)         ← attention cue
 */
export function deriveSpeechSemanticHints(text: string | undefined): SpeechSemanticHints {
  if (text === undefined || !String(text).trim()) {
    return {
      emphasis: 0, question: 0, uncertainty: 0, explanation: 0,
      attention: 0, thinkingCue: 0,
    };
  }
  const raw = String(text).replace(/\s+/g, ' ').trim();
  const lower = raw.toLowerCase();

  // ── Emphasis ───────────────────────────────────────────────────────────────
  let emphasis = 0;
  const bangs = (raw.match(/!/g) ?? []).length;
  if (bangs > 0) emphasis += Math.min(0.45, bangs * 0.12);
  if (
    /\b(very|important|extremely|critical|essential|definitely|absolutely|must|never|always)\b/i.test(lower)
  ) {
    emphasis += 0.28;
  }
  if (/(مهم|مهمّ|جداً|جدا|ضروري|أساسي|لا بد|لازم|بالتأكيد|قطعاً|أبداً|دائماً)/u.test(raw)) {
    emphasis += 0.3;
  }
  // ALL-CAPS words (≥5 chars) → strong emphasis cue
  if (/[A-Z]{5,}/.test(raw)) emphasis += 0.12;

  // ── Question ───────────────────────────────────────────────────────────────
  // A lone `?` / `؟` is intentionally below the 0.5 expression threshold —
  // explanatory speech with a rhetorical question mark should NOT lock the
  // avatar into `thinking`. Real interrogatives still cross threshold via
  // word-level cues (`what`, `why`, `هل`, `كيف`, …).
  let question = 0;
  if (/[؟?]/.test(raw)) question += 0.34;
  if (
    /^(what|why|how|when|where|who|which|is |are |do |does |did |can |could |would |should )\b/i.test(lower)
  ) {
    question += 0.32;
  }
  if (/(^|\s)(هل|كيف|ليش|لماذا|لم |ما |متى|أين|من |ماذا|أليس|أ)\b/u.test(raw)) {
    question += 0.34;
  }

  // ── Uncertainty ────────────────────────────────────────────────────────────
  let uncertainty = 0;
  if (/\b(maybe|perhaps|i think|i guess|probably|might|not sure|kind of|sort of)\b/i.test(lower)) {
    uncertainty += 0.42;
  }
  if (/(يمكن|ربما|أظن|قد\s|في الغالب|\.\.\.|⋯|لست متأكد)/u.test(raw)) {
    uncertainty += 0.38;
  }

  // ── Explanation (causal / structural / enumerative) ───────────────────────
  let explanation = 0;
  if (/\b(because|therefore|means?|thus |hence |in other words|so |first(ly)?|second(ly)?|third(ly)?|next |then )\b/i.test(lower)) {
    explanation += 0.36;
  }
  if (/(لأن|يعني|وبالتالي|بالتالي|لذلك|أي أن|بمعنى|أولاً|ثانياً|ثالثاً|بعد ذلك)/u.test(raw)) {
    explanation += 0.36;
  }
  // Long sentences with multiple clauses bias toward explanation.
  const commaCount = (raw.match(/[,،]/g) ?? []).length;
  if (commaCount >= 2 && raw.length > 60) explanation += 0.18;

  // ── Attention (imperatives + look-here cues) ───────────────────────────────
  let attention = 0;
  if (/\b(look|notice|see |observe|pay attention|watch |check |listen)\b/i.test(lower)) {
    attention += 0.42;
  }
  if (/(انتبه|انتبهوا|لاحظ|لاحظوا|انظر|انظروا|راقب|تابع|اسمع|اسمعوا)/u.test(raw)) {
    attention += 0.45;
  }

  // ── Thinking cue (explicit hesitation / "let me think") ───────────────────
  let thinkingCue = 0;
  if (/\b(let me think|hang on|one moment|hmm+|let's see|um+\b)\b/i.test(lower)) {
    thinkingCue += 0.55;
  }
  if (/(دعني أفكر|لحظة|^مم+[\s،]|تأمل معي|خليني أفكر)/u.test(raw)) {
    thinkingCue += 0.52;
  }
  // Trailing ellipsis often signals reflection.
  if (/(\.\.\.|⋯)\s*$/.test(raw)) thinkingCue += 0.18;

  return {
    emphasis:    clamp01(emphasis),
    question:    clamp01(question),
    uncertainty: clamp01(uncertainty),
    explanation: clamp01(explanation),
    attention:   clamp01(attention),
    thinkingCue: clamp01(thinkingCue),
  };
}

/** Smoothed snapshot written into EmbodimentState — avoids instant jumps when text / heuristics change. */
let smoothedSemanticHints: SpeechSemanticHints = {
  emphasis: 0,
  question: 0,
  uncertainty: 0,
  explanation: 0,
  attention: 0,
  thinkingCue: 0,
};

/**
 * Exponential-style step toward derived targets (~`delta * 3` blend per frame).
 */
export function stepSmoothedSemanticHints(target: SpeechSemanticHints, delta: number): SpeechSemanticHints {
  const k = Math.min(1, Math.max(0, delta * 3));
  const lerp = (a: number, b: number) => a + (b - a) * k;
  smoothedSemanticHints = {
    emphasis:    lerp(smoothedSemanticHints.emphasis,    target.emphasis),
    question:    lerp(smoothedSemanticHints.question,    target.question),
    uncertainty: lerp(smoothedSemanticHints.uncertainty, target.uncertainty),
    explanation: lerp(smoothedSemanticHints.explanation, target.explanation),
    attention:   lerp(smoothedSemanticHints.attention   ?? 0, target.attention   ?? 0),
    thinkingCue: lerp(smoothedSemanticHints.thinkingCue ?? 0, target.thinkingCue ?? 0),
  };
  return { ...smoothedSemanticHints };
}
