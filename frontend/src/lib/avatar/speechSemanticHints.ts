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
 */
export function deriveSpeechSemanticHints(text: string | undefined): SpeechSemanticHints {
  if (text === undefined || !String(text).trim()) {
    return { emphasis: 0, question: 0, uncertainty: 0, explanation: 0 };
  }
  const raw = String(text).replace(/\s+/g, ' ').trim();
  const lower = raw.toLowerCase();

  let emphasis = 0;
  const bangs = (raw.match(/!/g) ?? []).length;
  if (bangs > 0) emphasis += Math.min(0.45, bangs * 0.12);
  if (
    /\b(very|important|extremely|critical|essential|notice|note that|definitely)\b/i.test(lower)
  ) {
    emphasis += 0.28;
  }
  if (/(مهم|مهمّ|لاحظ|لاحظوا|جداً|جدا|ضروري|أساسي|لا بد)/u.test(raw)) {
    emphasis += 0.3;
  }

  let question = 0;
  if (/[؟?]/.test(raw)) question += 0.48;
  if (
    /^(what|why|how|when|where|who|which|is |are |do |does |did |can |could )\b/i.test(lower)
  ) {
    question += 0.32;
  }
  if (/(^|\s)(هل|كيف|ليش|لماذا|لم|ما |متى|أين|من |ماذا|أليس)/u.test(raw)) {
    question += 0.34;
  }

  let uncertainty = 0;
  if (/\b(maybe|perhaps|i think|i guess|probably|might|not sure)\b/i.test(lower)) {
    uncertainty += 0.42;
  }
  if (/(يمكن|ربما|أظن|قد\s|في الغالب|\.\.\.|⋯)/u.test(raw)) {
    uncertainty += 0.38;
  }

  let explanation = 0;
  if (/\b(because|therefore|means?|thus |hence |in other words|so)\b/i.test(lower)) {
    explanation += 0.36;
  }
  if (/(لأن|يعني|وبالتالي|بالتالي|لذلك|أي أن|بمعنى)/u.test(raw)) {
    explanation += 0.36;
  }

  return {
    emphasis: clamp01(emphasis),
    question: clamp01(question),
    uncertainty: clamp01(uncertainty),
    explanation: clamp01(explanation),
  };
}

/** Smoothed snapshot written into EmbodimentState — avoids instant jumps when text / heuristics change. */
let smoothedSemanticHints: SpeechSemanticHints = {
  emphasis: 0,
  question: 0,
  uncertainty: 0,
  explanation: 0,
};

/**
 * Exponential-style step toward derived targets (~`delta * 3` blend per frame).
 */
export function stepSmoothedSemanticHints(target: SpeechSemanticHints, delta: number): SpeechSemanticHints {
  const k = Math.min(1, Math.max(0, delta * 3));
  smoothedSemanticHints = {
    emphasis: smoothedSemanticHints.emphasis + (target.emphasis - smoothedSemanticHints.emphasis) * k,
    question: smoothedSemanticHints.question + (target.question - smoothedSemanticHints.question) * k,
    uncertainty:
      smoothedSemanticHints.uncertainty + (target.uncertainty - smoothedSemanticHints.uncertainty) * k,
    explanation:
      smoothedSemanticHints.explanation + (target.explanation - smoothedSemanticHints.explanation) * k,
  };
  return { ...smoothedSemanticHints };
}
