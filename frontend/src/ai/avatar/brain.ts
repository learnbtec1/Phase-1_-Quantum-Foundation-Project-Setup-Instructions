/**
 * Dialog policy: infers response plan from text and context.
 * Backend returns { reply }; we derive gestures, emotion, gaze from content.
 */
export interface ResponsePlan {
  text: string;
  language: 'ar' | 'en';
  tone: 'neutral' | 'friendly' | 'encouraging' | 'strict';
  emotion: 'neutral' | 'thinking' | 'friendly' | 'encouraging' | 'strictEvaluation' | 'celebration';
  gestures: Array<{ type: 'emphasis' | 'point' | 'openHand' | 'beat'; at: number; hand: 'L' | 'R' | 'both'; strength: number }>;
  head: { nodAtPhrases: boolean; microYaw: boolean; microPitch: boolean };
  posture: { lean: 'listen' | 'neutral' | 'emphasize' };
}

const ENCOURAGING_PATTERNS = /ممتاز|رائع|أحسنت|جيد جداً|جيد|ممتازة|مشروع|تطوير|تحسين|بالتأكيد|صحيح|great|excellent|well done|good job/i;
const CELEBRATION_PATTERNS = /تهانينا|مبروك|نجحت|تميز|ممتاز جداً|أحسنت جداً|متفوق|congratulations|congrats|bravo|celebrate/i;
const STRICT_PATTERNS = /انتبه|تأكد|خطأ|يجب|التحقق|لاحظ|مهم|important|attention|note|warning|critical/i;
const THINKING_PATTERNS = /دعني|سأفكر|لنتحقق|نراجع|حسناً|حسنًا|لنرى|ربما|يمكن|let me|let us|consider|perhaps|maybe/i;
const FRIENDLY_PATTERNS = /مرحباً|أهلاً|شكراً|من فضلك|تسعدني|بكل سرور|على الرحب|hello|hi|welcome|greetings|thank you|thanks/i;
const QUESTION_PATTERNS = /\?|؟|هل|لماذا|كيف|ماذا|أين|متى/i;

export function inferResponsePlan(reply: string): ResponsePlan {
  const text = reply?.trim() ?? '';
  const isArabic = /[\u0600-\u06FF]/.test(text);
  const language = isArabic ? 'ar' : 'en';

  let emotion: ResponsePlan['emotion'] = 'neutral';
  if (CELEBRATION_PATTERNS.test(text)) emotion = 'celebration';
  else if (ENCOURAGING_PATTERNS.test(text)) emotion = 'encouraging';
  else if (STRICT_PATTERNS.test(text)) emotion = 'strictEvaluation';
  else if (THINKING_PATTERNS.test(text)) emotion = 'thinking';
  else if (FRIENDLY_PATTERNS.test(text)) emotion = 'friendly';
  else if (QUESTION_PATTERNS.test(text)) emotion = 'thinking';

  const phraseCount = (text.match(/[.!?؟。،]/g) || []).length || 1;
  const gestures: ResponsePlan['gestures'] = [];

  // Map emotion to primary gesture type
  const emotionToGesture: Record<string, ResponsePlan['gestures'][0]['type']> = {
    celebration: 'openHand',
    encouraging: 'openHand',
    strictEvaluation: 'point',
    friendly: 'beat',
    thinking: 'beat',
    neutral: 'beat',
  };
  const primaryType = emotionToGesture[emotion] ?? 'beat';
  const primaryHand: 'L' | 'R' | 'both' =
    emotion === 'celebration' ? 'both'
    : emotion === 'friendly' ? 'both'
    : 'R';

  for (let i = 0; i < Math.min(phraseCount, 4); i++) {
    gestures.push({
      type: i === 0 ? primaryType : i % 2 === 0 ? 'beat' : 'openHand',
      at: (i / phraseCount) * 100,
      hand: i === 0 ? primaryHand : 'R',
      strength: 0.5 + (emotion === 'encouraging' || emotion === 'celebration' ? 0.3 : 0),
    });
  }

  return {
    text,
    language,
    tone: emotion === 'friendly' || emotion === 'encouraging' ? 'friendly' : emotion === 'strictEvaluation' ? 'strict' : 'neutral',
    emotion,
    gestures,
    head: { nodAtPhrases: true, microYaw: true, microPitch: true },
    posture: { lean: emotion === 'thinking' ? 'listen' : emotion === 'encouraging' ? 'emphasize' : 'neutral' },
  };
}
