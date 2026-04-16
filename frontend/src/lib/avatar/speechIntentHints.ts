/**
 * Meaning-driven hints for final-pose motor (intentMotorLayer).
 * Set from utterance text at TTS / speak start; cleared on speak end. No events consumed here.
 */
import {
  setEmbodimentUtteranceTextForSemantics,
} from '@/lib/avatar/speechSemanticHints';

export type SpeechIntentHints = {
  /** 0–1 — stress / importance (exclamations, strong adverbs, Arabic intensifiers). */
  emphasis: number;
  question: boolean;
  /** Expository / causal / enumerative language. */
  explanation: boolean;
  /** 0–1 — hedging, ellipsis, “maybe” tone. */
  uncertainty: number;
  /** “Think with me” / imagine / consider — invites reflection. */
  inviteReflection: boolean;
};

const DEFAULT_HINTS: SpeechIntentHints = {
  emphasis: 0.34,
  question: false,
  explanation: false,
  uncertainty: 0.1,
  inviteReflection: false,
};

let current: SpeechIntentHints = { ...DEFAULT_HINTS };

/** Pure classifier — tests, tooling, or preview without mutating `current`. */
export function computeSpeechIntentHintsFromText(raw: string): SpeechIntentHints {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t.length) return { ...DEFAULT_HINTS };

  const lower = t.toLowerCase();

  const question =
    /[؟?]\s*$/.test(t)
    || /^(what|why|how|when|where|who|which|is |are |do |does |did |can |could |would |should )\b/i.test(lower)
    || /^(هل|ما|لماذا|كيف|متى|أين|من|ماذا|أليس|أ)\b/u.test(t);

  let uncertainty = 0.1;
  if (/\b(maybe|perhaps|not sure|i think|i guess|probably|kind of|sort of|might)\b/i.test(lower)) {
    uncertainty += 0.38;
  }
  if (/(ربما|قد\s|أظن|يمكن|في الغالب|لست متأكدا|لست متأكدة|\.\.\.|⋯|،،)/u.test(t)) {
    uncertainty += 0.32;
  }
  uncertainty = Math.min(1, uncertainty);

  const explanation =
    /\b(because|therefore|means?|in other words|that is|firstly|secondly|thirdly|so |thus |hence )\b/i.test(lower)
    || /(لأن|أي أن|بمعنى|يعني أن|بالتالي|أولا|ثانيا|ثالثا|لذلك|وبالتالي)/u.test(t);

  const inviteReflection =
    /\b(imagine|consider|think about|picture this|ask yourself|reflect)\b/i.test(lower)
    || /(تخيل|فكر معي|لاحظ أن|تأمل|جرب أن تفكر|ما رأيك)/u.test(t);

  let emphasis = 0.32;
  const bangs = (t.match(/!/g) ?? []).length;
  if (bangs > 0) emphasis += Math.min(0.34, bangs * 0.09);
  if (
    /\b(very|extremely|absolutely|critical|important|essential|must|never|always|definitely)\b/i.test(lower)
  ) {
    emphasis += 0.22;
  }
  if (/(مهم جدا|بالغ الأهمية|جداً|تماما|ضروري|أساسي|لا بد|حرج)/u.test(t)) {
    emphasis += 0.24;
  }
  if (/[A-Z]{5,}/.test(t)) emphasis += 0.05;
  emphasis = Math.min(1, emphasis);

  return { emphasis, question, explanation, uncertainty, inviteReflection };
}

export function setSpeechIntentHintsFromText(raw: string): void {
  current = computeSpeechIntentHintsFromText(raw);
  setEmbodimentUtteranceTextForSemantics(raw);
}

export function resetSpeechIntentHints(): void {
  current = { ...DEFAULT_HINTS };
  setEmbodimentUtteranceTextForSemantics(undefined);
}

export function getSpeechIntentHints(): Readonly<SpeechIntentHints> {
  return current;
}
