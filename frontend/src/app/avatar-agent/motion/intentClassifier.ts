'use client';
/**
 * Intent Classifier — rule-based Arabic + English recovery for embodiment.
 * Arabic text is normalized first ({@link normalizeForIntentClassification}) so
 * dialect spelling and hamza/alef variants still match.
 */

import {
  normalizeForIntentClassification,
  canonicalizeLlmIntentLabel,
  type CanonicalIntentLabel,
} from './arabicIntentNormalize';
import { DM } from '@/lib/diagnostics/diagnosticsMetrics';
import { diagInc } from '@/lib/diagnostics/diagnosticsStore';
import { diagTimelineTouchIntent } from '@/lib/diagnostics/diagnosticsTimelineProbe';

export type DetectedIntent =
  | 'explaining'
  | 'questioning'
  | 'confirming'
  | 'thinking'
  | 'greeting'
  | 'agreeing'
  | 'disagreeing'
  | 'emphasizing'
  | 'neutral';

export type IntentResult = {
  intent: DetectedIntent;
  /** 0..1 rough rule confidence. */
  confidence: number;
  /** Which rule fired (for debugging). */
  reason: string;
  /** Post-normalization surface (for DevTools). */
  normalizedText: string;
};

/** Fallback intent when TTS is active but transcript text is not mirrored yet — avoids neutral starvation in semantics bridge. */
export function detectIntentForSemanticsFallback(opts: {
  brainThinking: boolean;
  avatarPose: string | null;
  llmIntent?: string | null;
}): IntentResult {
  const poseThink =
    typeof opts.avatarPose === 'string' && /think/i.test(opts.avatarPose);
  if (opts.brainThinking || poseThink) {
    const out: IntentResult = {
      intent: 'thinking',
      confidence: 0.44,
      reason: 'semantic-fallback:tts-no-text',
      normalizedText: '',
    };
    diagTimelineTouchIntent(out.intent, opts.llmIntent ?? null, out.reason);
    return out;
  }
  const out: IntentResult = {
    intent: 'explaining',
    confidence: 0.43,
    reason: 'semantic-fallback:tts-no-text',
    normalizedText: '',
  };
  diagTimelineTouchIntent(out.intent, opts.llmIntent ?? null, out.reason);
  return out;
}

// ─── English (unchanged baseline, applied on trimmed raw for Latin cues) ─────
const QUESTION_EN = /\b(what|why|how|when|where|who|which|is it|are you|do you|can you|could you)\b|\?/i;
const CONFIRM_EN = /\b(yes|yeah|yep|correct|right|sure|absolutely|exactly|ok|okay)\b/i;
const THINK_EN = /\b(hmm|uhh|let me think|thinking|wait|one moment|i'm not sure|maybe|perhaps)\b/i;
const GREET_EN = /\b(hi|hello|hey|good morning|good evening|welcome|how are you)\b/i;
const AGREE_EN = /\b(i agree|agreed|i'm with you|you're right|that's right|true)\b/i;
const DISAGREE_EN = /\b(i disagree|i don't agree|wrong|not true|that's wrong|incorrect)\b/i;
const EMPHASIZE_EN = /\b(important|crucial|must|have to|pay attention|focus|key point)\b/i;
const EXPLAIN_EN = /\b(explain|clarify|means|therefore|because|in other words|for example|e\.g\.|in summary|let me)\b/i;

// ─── Arabic: priority order is enforced in detectIntentDetailed, not regex union ─

/** GREETING — must run before generic كيف questioning */
const GREET_AR = new RegExp(
  [
    'السلام عليكم',
    'مرحبا',
    'مرحبه',
    'اهلا',
    'اهلا وسهلا',
    'هلا',
    'يا هلا',
    'صباح الخير',
    'مساء الخير',
    'كيفك',
    'كيف حالك',
    'كيف الحال',
    'حياك',
    'حياكم',
  ].join('|'),
  'u',
);

/** THINKING — before explaining so "خليني أفكر" does not become explain */
const THINK_AR = new RegExp(
  [
    'خليني افكر',
    'خلينا نفكر',
    'همم+',
    'ممكن يكون',
    'ممكن ان',
    'ممكن إن',
    'احتمال',
    'دقيقه',
    'دقيقة',
    'لحظه',
    'لحظة',
    'انتظر',
  ].join('|'),
  'u',
);

/** EMPHASIS — strong phrases first (shared انتبه/ركز handled here only when boosted) */
const EMPHASIS_STRONG_AR = new RegExp(
  ['مهم جدا', 'مهمه جدا', 'اكيد', 'طبعا', 'طبعه', 'ممتاز', 'ضروري', 'لازم', 'يجب'].join('|'),
  'u',
);

/** EXPLAINING — Jordanian / MSA teaching cues */
const EXPLAIN_AR = new RegExp(
  [
    'خليني اشرح',
    'خلينا نشرح',
    'ركز معي',
    'انتبه',
    'الفكره',
    'الفكرة',
    'يعني',
    'ببساطه',
    'ببساطة',
    'خلينا نشوف',
    'لاحظ',
    'بالتالي',
    'بمعنى',
    'مثلا',
    'باختصار',
    'اشرح',
    'يشرح',
    'بشرح',
    'شرح',
    'لان',
    'لأن',
    'اي ان',
    'أي أن',
  ].join('|'),
  'u',
);

/** EMPHASIS — single-token (after explain-specific phrases) */
const EMPHASIS_WEAK_AR = /(^|\s)(انتبه|ركز)(?!\s*معي)(\s|$)/u;

/** QUESTIONING — dialect شو؛ avoid swallowing greeting كيفك via GREET_AR first */
const QUESTION_AR = new RegExp(
  [
    'شو رايك',
    'شو رأيك',
    'فهمت',
    'عندك سؤال',
    'صح\\s*\\?',
    'واضح\\s*\\?',
    'صح؟',
    'واضح؟',
    'ليش',
    '\\?',
    '؟',
    'هل ',
    'ماذا',
    'لماذا',
    'متى ',
    'اين ',
    'أين ',
    'من هو',
    'من هي',
    '(^|\\s)كيف(\\s|$)',
  ].join('|'),
  'u',
);

const CONFIRM_AR = /(نعم|اجل|أجل|اكيد|صحيح|صح|تمام|موافق|طبعا|بالضبط|بالتاكيد)/u;
const AGREE_AR = /(موافق|معك حق|اتفق|أتفق|اوافق|أوافق|صح كلامك)/u;
const DISAGREE_AR = /(لا اتفق|لا أتفق|اعارض|أعارض|غير صحيح|مش صح|هذا خطأ|خطأ)/u;

function containsGreetingCue(t: string): boolean {
  return GREET_AR.test(t);
}

/** If generic كيف match, treat as questioning only when not a greeting phrase */
function matchesQuestioningArabic(t: string): boolean {
  if (!QUESTION_AR.test(t)) return false;
  if (/(^|\s)كيف(\s|$)/u.test(t) && containsGreetingCue(t)) return false;
  return true;
}

function matchEnglish(textRaw: string): IntentResult | null {
  const t = textRaw.trim();
  if (QUESTION_EN.test(t)) return { intent: 'questioning', confidence: 0.85, reason: 'en-question-word', normalizedText: t };
  if (EMPHASIZE_EN.test(t)) return { intent: 'emphasizing', confidence: 0.8, reason: 'en-emphasis', normalizedText: t };
  if (DISAGREE_EN.test(t)) return { intent: 'disagreeing', confidence: 0.85, reason: 'en-disagree', normalizedText: t };
  if (AGREE_EN.test(t)) return { intent: 'agreeing', confidence: 0.8, reason: 'en-agree', normalizedText: t };
  if (CONFIRM_EN.test(t)) return { intent: 'confirming', confidence: 0.75, reason: 'en-confirm', normalizedText: t };
  if (THINK_EN.test(t)) return { intent: 'thinking', confidence: 0.7, reason: 'en-hesitation', normalizedText: t };
  if (EXPLAIN_EN.test(t)) return { intent: 'explaining', confidence: 0.65, reason: 'en-explain', normalizedText: t };
  if (GREET_EN.test(t)) return { intent: 'greeting', confidence: 0.65, reason: 'en-greet', normalizedText: t };
  return null;
}

function matchArabicOrdered(norm: string): IntentResult | null {
  if (GREET_AR.test(norm)) {
    return { intent: 'greeting', confidence: 0.92, reason: 'ar-greet', normalizedText: norm };
  }
  if (THINK_AR.test(norm)) {
    return { intent: 'thinking', confidence: 0.78, reason: 'ar-hesitation', normalizedText: norm };
  }
  if (EMPHASIS_STRONG_AR.test(norm)) {
    return { intent: 'emphasizing', confidence: 0.82, reason: 'ar-emphasis-strong', normalizedText: norm };
  }
  if (EXPLAIN_AR.test(norm)) {
    return { intent: 'explaining', confidence: 0.74, reason: 'ar-explain', normalizedText: norm };
  }
  if (EMPHASIS_WEAK_AR.test(norm)) {
    return { intent: 'emphasizing', confidence: 0.72, reason: 'ar-emphasis-weak', normalizedText: norm };
  }
  if (matchesQuestioningArabic(norm)) {
    return { intent: 'questioning', confidence: 0.88, reason: 'ar-question-marker', normalizedText: norm };
  }
  if (DISAGREE_AR.test(norm)) {
    return { intent: 'disagreeing', confidence: 0.85, reason: 'ar-disagree', normalizedText: norm };
  }
  if (AGREE_AR.test(norm)) {
    return { intent: 'agreeing', confidence: 0.8, reason: 'ar-agree', normalizedText: norm };
  }
  if (CONFIRM_AR.test(norm)) {
    return { intent: 'confirming', confidence: 0.75, reason: 'ar-confirm', normalizedText: norm };
  }
  return null;
}

/**
 * Merge LLM canonical label when rules miss (Arabic models often omit punctuation cues).
 */
export function mergeRuleIntentWithLlmCanon(
  rule: IntentResult,
  llmRaw: string | null | undefined,
): IntentResult {
  if (rule.reason === 'empty-input') return rule;
  if (rule.intent !== 'neutral') return rule;
  const canon = canonicalizeLlmIntentLabel(llmRaw);
  if (!canon) return rule;

  const map: Record<CanonicalIntentLabel, DetectedIntent | ''> = {
    '': 'neutral',
    greeting: 'greeting',
    explaining: 'explaining',
    questioning: 'questioning',
    thinking: 'thinking',
    emphasizing: 'emphasizing',
    listening: 'neutral',
    confirming: 'confirming',
    disagreeing: 'disagreeing',
    agreeing: 'agreeing',
  };
  const intent = map[canon];
  if (!intent || intent === 'neutral') return rule;
  return {
    intent,
    confidence: 0.56,
    reason: `llm-fallback:${canon}`,
    normalizedText: rule.normalizedText,
  };
}

/**
 * Classify a raw text utterance into a motion intent.
 */
export function detectIntent(text: string): DetectedIntent {
  return detectIntentDetailed(text).intent;
}

/** Rich form — normalization + Arabic-first priority + English fallback + optional LLM merge hook at call site */
export function detectIntentDetailed(text: string, llmIntent?: string | null): IntentResult {
  const raw = (text ?? '').trim();
  const normalizedText = normalizeForIntentClassification(raw);

  if (raw.length === 0 && normalizedText.length === 0) {
    diagInc(DM.INTENT_EMPTY_INPUT);
    const r = { intent: 'neutral' as const, confidence: 0, reason: 'empty-input', normalizedText: '' };
    diagTimelineTouchIntent(r.intent, llmIntent, r.reason);
    return r;
  }

  const ar = matchArabicOrdered(normalizedText);
  if (ar) {
    const out = mergeRuleIntentWithLlmCanon(ar, llmIntent);
    diagTimelineTouchIntent(out.intent, llmIntent, out.reason);
    return out;
  }

  const en = matchEnglish(normalizedText) ?? matchEnglish(raw);
  if (en) {
    const merged = { ...en, normalizedText };
    const out = mergeRuleIntentWithLlmCanon(merged, llmIntent);
    diagTimelineTouchIntent(out.intent, llmIntent, out.reason);
    return out;
  }

  const fallback: IntentResult = {
    intent: 'neutral',
    confidence: 0,
    reason: 'no-rule-match',
    normalizedText,
  };
  if (normalizedText.length > 6) diagInc(DM.INTENT_NO_RULE_MATCH);
  const out = mergeRuleIntentWithLlmCanon(fallback, llmIntent);
  diagTimelineTouchIntent(out.intent, llmIntent, out.reason);
  return out;
}

export { canonicalizeLlmIntentLabel, normalizeForIntentClassification };
