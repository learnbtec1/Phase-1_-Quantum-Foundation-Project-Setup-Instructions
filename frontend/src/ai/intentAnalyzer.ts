/**
 * intentAnalyzer.ts
 * ──────────────────────────────────────────────────────────────
 * Fast, zero-latency keyword-based intent classifier for Arabic
 * (Jordanian dialect) and English. Runs client-side; no LLM call.
 *
 * Intent labels:
 *   question   — user asks for information
 *   joke       — playful / humorous input
 *   complaint  — frustration / difficulty
 *   greeting   — hello / goodbye
 *   command    — explicit action request (show, explain, repeat)
 *   agreement  — yes / correct / understood
 *   praise     — good job feedback to avatar
 *   neutral    — no strong signal
 *
 * Usage:
 *   const intent = analyzeIntent(userText);
 *   if (intent === 'joke') dispatchAvatar('avatar:emotion', { emotion: 'happy' });
 */

export type UserIntent =
  | 'question'
  | 'joke'
  | 'complaint'
  | 'greeting'
  | 'command'
  | 'agreement'
  | 'praise'
  | 'neutral';

// ─── Pattern catalogue ────────────────────────────────────────────────────────

const PATTERNS: Array<{ intent: UserIntent; re: RegExp }> = [
  // Greeting (high priority — check before question)
  {
    intent: 'greeting',
    re: /\b(أهلاً|مرحبا|هاي|هلا|سلام|صباح|مساء|ازيك|كيفك|وين|يا كوجني|hello|hi\b|hey\b|bye|مع السلامة|يسلمو)/i,
  },

  // Joke / playful
  {
    intent: 'joke',
    re: /\b(مزحة|بضحك|هاهاها|ههه|😂|🤣|خخخ|lol|haha|على حالك|بهدل|إيش هاد|يا لطيف|ما بصدق)\b|[😂🤣😆😄]{2,}/u,
  },

  // Complaint / frustration
  {
    intent: 'complaint',
    re: /\b(مش فاهم|ما فهمت|صعب|زهقت|ملل|مزنوق|تعبت|بحكي وما|لا أفهم|خايف|قلقان|مرهق|ما عرفت|ولا فكرة)\b/i,
  },

  // Agreement / confirmation
  {
    intent: 'agreement',
    re: /^(أيوه|نعم|صح|مزبوط|تمام|أكيد|هيك|ماشي|موافق|فهمت|بفهم|حلو|ف?هيمه?|yes\b|ok\b|sure\b|correct\b|understood\b)\.?$/i,
  },

  // Praise / compliment to avatar
  {
    intent: 'praise',
    re: /\b(شاطر|بارع|عظيم|احترافي|ممتاز|بتعلم منك|شكراً كوجني|حلو جداً|رائع|جميل|بحبك|great|amazing|awesome|thanks)\b/i,
  },

  // Command / imperative
  {
    intent: 'command',
    re: /\b(اشرح|اعد|أعطني|قلي|بيّن|أظهر|أضف|احكيلي|ابدأ|ارجع|وقف|كمّل|explain|show|tell me|repeat|start|stop|go back|continue)\b/i,
  },

  // Question (last among explicit — catches remaining ?)
  {
    intent: 'question',
    re: /[؟?]$|^(ما|ماذا|هل|كيف|لماذا|متى|أين|من|ليش|شو|وين|إيش|what|how|why|when|where|who|which)\b/i,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify the intent of a user's text utterance.
 * Pure function; runs synchronously; < 0.1 ms for typical inputs.
 */
export function analyzeIntent(text: string): UserIntent {
  if (!text?.trim()) return 'neutral';
  const t = text.trim();
  for (const { intent, re } of PATTERNS) {
    if (re.test(t)) return intent;
  }
  return 'neutral';
}

/**
 * Map intent to a suggested avatar emotion overlay.
 * Returns null when no overlay is needed.
 */
export function intentToEmotionOverlay(
  intent: UserIntent,
): { emotion: string; strength: number } | null {
  switch (intent) {
    case 'joke':      return { emotion: 'happy',      strength: 0.72 };
    case 'complaint': return { emotion: 'empathetic', strength: 0.65 };
    case 'greeting':  return { emotion: 'encouraging',strength: 0.60 };
    case 'praise':    return { emotion: 'proud',      strength: 0.68 };
    case 'agreement': return { emotion: 'calm',       strength: 0.45 };
    default:          return null;
  }
}

/**
 * Map intent to a suggested gesture type (or null if no gesture implied).
 */
export function intentToGestureHint(intent: UserIntent): string | null {
  switch (intent) {
    case 'question':  return 'think';
    case 'command':   return 'point';
    case 'joke':      return 'explain';
    case 'greeting':  return 'wave';
    default:          return null;
  }
}
