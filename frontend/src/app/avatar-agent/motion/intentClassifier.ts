'use client';
/**
 * Intent Classifier (rule-based, Arabic + English)
 * Pure keyword-based mapper from raw utterance text to a motion intent label.
 * Used by VRMSkeletonManager as a fallback / augmentation for LLM-provided intent.
 */

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
};

const EXPLAIN_AR = /(اشرح|يشرح|بشرح|شرح|يعني|لأن|بمعنى|بالتالي|أي أن|مثلاً|مثلا|باختصار)/u;
const EXPLAIN_EN = /\b(explain|clarify|means|therefore|because|in other words|for example|e\.g\.|in summary|let me)\b/i;

const QUESTION_AR = /(هل|ماذا|لماذا|كيف|متى|أين|من هو|من هي|أي|أيّ|ألا|أليس|\?|؟)/u;
const QUESTION_EN = /\b(what|why|how|when|where|who|which|is it|are you|do you|can you|could you)\b|\?/i;

const CONFIRM_AR = /(نعم|أجل|أكيد|صحيح|صح|تمام|موافق|طبعًا|طبعا|بالضبط|بالتأكيد)/u;
const CONFIRM_EN = /\b(yes|yeah|yep|correct|right|sure|absolutely|exactly|ok|okay)\b/i;

const THINK_AR = /(انتظر|افكر|أفكر|لحظة|لحظه|دعني أفكر|هممم|آه|مممم)/u;
const THINK_EN = /\b(hmm|uhh|let me think|thinking|wait|one moment|i'm not sure|maybe|perhaps)\b/i;

const GREET_AR = /(أهلا|أهلاً|مرحبا|مرحباً|السلام عليكم|صباح|مساء|كيفك|كيف حالك)/u;
const GREET_EN = /\b(hi|hello|hey|good morning|good evening|welcome|how are you)\b/i;

const AGREE_AR = /(موافق|معك حق|أتفق|أوافق|صح كلامك)/u;
const AGREE_EN = /\b(i agree|agreed|i'm with you|you're right|that's right|true)\b/i;

const DISAGREE_AR = /(لا أتفق|أعارض|غير صحيح|مش صح|هذا خطأ|خطأ)/u;
const DISAGREE_EN = /\b(i disagree|i don't agree|wrong|not true|that's wrong|incorrect)\b/i;

const EMPHASIZE_AR = /(مهم جدًا|الأهم|انتبه|ركز|يجب|لازم|ضروري)/u;
const EMPHASIZE_EN = /\b(important|crucial|must|have to|pay attention|focus|key point)\b/i;

/**
 * Classify a raw text utterance into a motion intent.
 * Checks rules in priority order so multi-match text still returns the most
 * salient intent (e.g. a question with "نعم" still maps to questioning).
 */
export function detectIntent(text: string): DetectedIntent {
  if (!text) return 'neutral';
  const t = text.trim();
  if (t.length === 0) return 'neutral';

  if (QUESTION_AR.test(t) || QUESTION_EN.test(t))   return 'questioning';
  if (EMPHASIZE_AR.test(t) || EMPHASIZE_EN.test(t)) return 'emphasizing';
  if (DISAGREE_AR.test(t) || DISAGREE_EN.test(t))   return 'disagreeing';
  if (AGREE_AR.test(t) || AGREE_EN.test(t))         return 'agreeing';
  if (CONFIRM_AR.test(t) || CONFIRM_EN.test(t))     return 'confirming';
  if (THINK_AR.test(t) || THINK_EN.test(t))         return 'thinking';
  if (EXPLAIN_AR.test(t) || EXPLAIN_EN.test(t))     return 'explaining';
  if (GREET_AR.test(t) || GREET_EN.test(t))         return 'greeting';

  return 'neutral';
}

/** Rich form — same rules but also returns confidence + reason for logs. */
export function detectIntentDetailed(text: string): IntentResult {
  const t = (text ?? '').trim();
  if (t.length === 0) return { intent: 'neutral', confidence: 0, reason: 'empty-input' };

  if (QUESTION_AR.test(t))   return { intent: 'questioning',  confidence: 0.9, reason: 'ar-question-marker' };
  if (QUESTION_EN.test(t))   return { intent: 'questioning',  confidence: 0.85, reason: 'en-question-word' };
  if (EMPHASIZE_AR.test(t))  return { intent: 'emphasizing',  confidence: 0.8, reason: 'ar-emphasis' };
  if (EMPHASIZE_EN.test(t))  return { intent: 'emphasizing',  confidence: 0.8, reason: 'en-emphasis' };
  if (DISAGREE_AR.test(t))   return { intent: 'disagreeing',  confidence: 0.85, reason: 'ar-disagree' };
  if (DISAGREE_EN.test(t))   return { intent: 'disagreeing',  confidence: 0.85, reason: 'en-disagree' };
  if (AGREE_AR.test(t))      return { intent: 'agreeing',     confidence: 0.8, reason: 'ar-agree' };
  if (AGREE_EN.test(t))      return { intent: 'agreeing',     confidence: 0.8, reason: 'en-agree' };
  if (CONFIRM_AR.test(t))    return { intent: 'confirming',   confidence: 0.75, reason: 'ar-confirm' };
  if (CONFIRM_EN.test(t))    return { intent: 'confirming',   confidence: 0.75, reason: 'en-confirm' };
  if (THINK_AR.test(t))      return { intent: 'thinking',     confidence: 0.7, reason: 'ar-hesitation' };
  if (THINK_EN.test(t))      return { intent: 'thinking',     confidence: 0.7, reason: 'en-hesitation' };
  if (EXPLAIN_AR.test(t))    return { intent: 'explaining',   confidence: 0.65, reason: 'ar-explain' };
  if (EXPLAIN_EN.test(t))    return { intent: 'explaining',   confidence: 0.65, reason: 'en-explain' };
  if (GREET_AR.test(t))      return { intent: 'greeting',     confidence: 0.6, reason: 'ar-greet' };
  if (GREET_EN.test(t))      return { intent: 'greeting',     confidence: 0.6, reason: 'en-greet' };

  return { intent: 'neutral', confidence: 0.3, reason: 'no-rule-match' };
}

console.log('[FILE_CREATED] intentClassifier.ts loaded');
