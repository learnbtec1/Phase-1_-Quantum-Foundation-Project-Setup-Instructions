/**
 * Dialog policy: infers response plan from text and context.
 * Backend returns { reply }; we derive gestures, emotion, gaze from content.
 */

/**
 * EMOTION_ANIMATION_MAP — AIMascotKit 11-emotion system
 * Maps each emotion label to its VRMA body animation + VRM face preset.
 */
export const EMOTION_ANIMATION_MAP = {
  neutral:    { animation: 'Relax',     expression: 'neutral'   },
  normal:     { animation: 'Relax',     expression: 'neutral'   },
  happy:      { animation: 'Clapping',  expression: 'happy'     },
  excited:    { animation: 'Jump',      expression: 'happy'     },
  angry:      { animation: 'Angry',     expression: 'angry'     },
  sad:        { animation: 'Sad',       expression: 'sad'       },
  surprised:  { animation: 'Surprised', expression: 'surprised' },
  blush:      { animation: 'Blush',     expression: 'happy'     },
  sleepy:     { animation: 'Sleepy',    expression: 'relaxed'   },
  thinking:   { animation: 'Thinking',  expression: 'neutral'   },
  relax:      { animation: 'Relax',     expression: 'relaxed'   },
  goodbye:    { animation: 'Goodbye',   expression: 'neutral'   },
  // legacy aliases from ResponsePlan
  celebration:      { animation: 'Clapping',  expression: 'happy'  },
  encouraging:      { animation: 'Relax',     expression: 'happy'  },
  strictEvaluation: { animation: 'Thinking',  expression: 'angry'  },
  friendly:         { animation: 'Clapping',  expression: 'happy'  },
} as const;

export type AvatarEmotionKey = keyof typeof EMOTION_ANIMATION_MAP;

export interface ResponsePlan {
  text: string;
  language: 'ar' | 'en';
  tone: 'neutral' | 'friendly' | 'encouraging' | 'strict';
  emotion: 'neutral' | 'thinking' | 'friendly' | 'encouraging' | 'strictEvaluation' | 'celebration'
            | 'happy' | 'excited' | 'angry' | 'sad' | 'surprised' | 'blush' | 'sleepy' | 'relax' | 'goodbye'
            | 'proud' | 'curious' | 'attentive' | 'concerned';
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
// Extended 11-emotion patterns (AIMascotKit)
const SAD_PATTERNS      = /حزين|حزينة|أسف|متأسف|للأسف|خسرت|يؤسفني|sad|sorry|unfortunately|disappointed|失敗/i;
const ANGRY_PATTERNS    = /غاضب|غضب|مزعج|مستاء|angry|furious|annoyed|むかつく/i;
const SURPRISED_PATTERNS = /مفاجأة|مندهش|لا أصدق|لم أتوقع|surprised|shocking|unexpected|うそっ/i;
const BLUSH_PATTERNS    = /يخجل|محرج|خجلان|blush|embarrassed|shy|なんで/i;
const SLEEPY_PATTERNS   = /نعسان|نعاس|متعب|sleepy|tired|drowsy|眠い/i;
const RELAX_PATTERNS    = /راحة|استرخاء|هدوء|relaxed|calm|peaceful|リラックス/i;
const GOODBYE_PATTERNS  = /وداعاً|مع السلامة|إلى اللقاء|goodbye|bye|farewell|また今度/i;
const EXCITED_PATTERNS  = /متحمس|مثير|رائع جداً|لا يصدق|excited|amazing|fantastic|すごい/i;

export function inferResponsePlan(reply: string): ResponsePlan {
  const text = reply?.trim() ?? '';
  const isArabic = /[\u0600-\u06FF]/.test(text);
  const language = isArabic ? 'ar' : 'en';

  let emotion: ResponsePlan['emotion'] = 'neutral';
  if (CELEBRATION_PATTERNS.test(text)) emotion = 'celebration';
  else if (EXCITED_PATTERNS.test(text)) emotion = 'excited';
  else if (ENCOURAGING_PATTERNS.test(text)) emotion = 'encouraging';
  else if (STRICT_PATTERNS.test(text)) emotion = 'strictEvaluation';
  else if (ANGRY_PATTERNS.test(text)) emotion = 'angry';
  else if (SAD_PATTERNS.test(text)) emotion = 'sad';
  else if (SURPRISED_PATTERNS.test(text)) emotion = 'surprised';
  else if (BLUSH_PATTERNS.test(text)) emotion = 'blush';
  else if (SLEEPY_PATTERNS.test(text)) emotion = 'sleepy';
  else if (RELAX_PATTERNS.test(text)) emotion = 'relax';
  else if (GOODBYE_PATTERNS.test(text)) emotion = 'goodbye';
  else if (THINKING_PATTERNS.test(text)) emotion = 'thinking';
  else if (FRIENDLY_PATTERNS.test(text)) emotion = 'friendly';
  else if (QUESTION_PATTERNS.test(text)) emotion = 'thinking';

  const phraseCount = (text.match(/[.!?؟。،]/g) || []).length || 1;
  const gestures: ResponsePlan['gestures'] = [];

  // Map emotion to primary gesture type (covers all 11 AIMascotKit emotions)
  const emotionToGesture: Record<string, ResponsePlan['gestures'][0]['type']> = {
    celebration:      'openHand',
    excited:          'openHand',
    encouraging:      'openHand',
    happy:            'openHand',
    friendly:         'beat',
    strictEvaluation: 'point',
    angry:            'point',
    thinking:         'beat',
    neutral:          'beat',
    normal:           'beat',
    sad:              'beat',
    blush:            'beat',
    surprised:        'openHand',
    sleepy:           'beat',
    relax:            'beat',
    goodbye:          'openHand',
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

/**
 * Parses a backend reply that may contain Verona-style action/emotion tokens:
 *   "أهلاً! *تلوح بيدها* رائع [EMOTION: friendly]"
 *
 * Returns:
 *   dialogue — clean text for display + TTS (tokens stripped)
 *   emotion  — first [EMOTION: X] value found, or 'neutral'
 *   action   — concatenated *stage direction* text (for gesture dispatch)
 */
export function parseVeronaResponse(raw: string): { dialogue: string; emotion: string; action: string } {
  const src = raw ?? '';
  // Extract first [EMOTION: X] tag
  const emotionMatch = src.match(/\[EMOTION:\s*([a-zA-Z]+)\]/i);
  const emotion = emotionMatch ? emotionMatch[1].toLowerCase() : 'neutral';
  // Extract all *action* stage directions concatenated
  const actionMatches = src.match(/\*([^*]+)\*/g);
  const action = actionMatches ? actionMatches.map((m) => m.replace(/\*/g, '').trim()).join(' ') : '';
  // Strip tokens for clean dialogue
  const cleaned = src
    .replace(/\[.*?\]/g, '')
    .replace(/\*[^*]*\*/g, '')
    .replace(/^\s*[\r\n]+/gm, '')
    .trim();
  return { dialogue: cleaned || src, emotion, action };
}
