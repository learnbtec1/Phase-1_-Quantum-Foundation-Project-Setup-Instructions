/**
 * selfCheckGate.ts — IGNIS v15.5
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates and auto-fixes every Verona reply BEFORE it leaves the API route.
 * Run as a post-processing step on the raw AI response string.
 *
 * Checks (in order):
 *  1) BTEC Scope — if off-topic, replace entirely with a redirect response.
 *  2) 3-Part Contract — dialogue + action line + emotion tag all present.
 *  3) Progress nudge — reply includes at least one LO/P/M/D reference.
 */

const BTEC_RE =
  /btec|unit|lo\b|p\d|m\d|d\d|business|ethics|customer.?service|marketing|management|leadership|organizational|entrepreneurship|assignment|criterion|criteria|merit|distinction|pass/i;

// For short replies and greetings — let them through the scope check without blocking
const GREETING_RE =
  /^(مرحب|أهلاً|أهلا|مرحباً|مرحبا|السلام|وعليكم|welcome|hello|hi\b|hey\b|good\s*(morn|eve|afternoon|night|day)|كيف حالك|كيفك|صباح|مساء|سعيدة|wonderful|great|sure|okay|of course|بالطبع|تفضل|حاضر)/i;

const EMOTION_VALUES = ['neutral','friendly','thinking','encouraging','strict','celebrate'];
const EMOTION_TAG_RE = /\[EMOTION:\s*(neutral|friendly|thinking|encouraging|strict|celebrate)\s*\]\s*$/im;
const ACTION_LINE_RE = /^\s*\*.+?\*\s*$/m;
const PROGRESS_RE    = /lo\b|p\d|m\d|d\d|unit|\bnext\b|\bstep\b|\btask\b|\bنقطة\b|\bخطوة\b|\bتقدم\b/i;

/** Validate & auto-repair a Verona 3-part reply. Returns the (possibly fixed) reply. */
export function runSelfCheck(text: string, lang: 'ar' | 'en' = 'ar'): string {
  if (!text?.trim()) return _fallback(lang);

  // ── 1) BTEC Scope ──────────────────────────────────────────────────────────
  // Short replies, greetings, and affirmations pass scope check unconditionally
  const isGreeting  = GREETING_RE.test(text.trim()) || text.trim().length < 80;
  const inScope     = isGreeting || BTEC_RE.test(text);
  if (!inScope) {
    return lang === 'ar'
      ? `هذا السؤال خارج نطاق BTEC. ما الوحدة والـ LO والهدف (P/M/D)؟\n*تشير بهدوء إلى لوحة المهام برفق.*\n[EMOTION: thinking]`
      : `This is outside BTEC scope. Which Unit, LO, and target (P/M/D)?\n*She points calmly to the task board.*\n[EMOTION: thinking]`;
  }

  // ── 2) 3-Part Contract ─────────────────────────────────────────────────────
  const hasEmotionTag = EMOTION_TAG_RE.test(text);
  const hasActionLine = ACTION_LINE_RE.test(text);
  // Strip emotion tag to get the dialogue body
  const bodyWithoutTag = text.replace(EMOTION_TAG_RE, '').trim();
  const hasDialogue    = bodyWithoutTag.replace(ACTION_LINE_RE, '').trim().length > 0;

  if (!hasEmotionTag || !hasActionLine || !hasDialogue) {
    // Auto-repair: keep dialogue body, add missing parts
    const dialoguePart = hasDialogue
      ? bodyWithoutTag.replace(ACTION_LINE_RE, '').trim()
      : (lang === 'ar' ? 'لنُحدِّد الـ LO ونربطها بـ P/M/D — أعطني التفاصيل الآن.' : 'Let\'s pin down the LO and map to P/M/D — share details now.');
    const actionPart  = lang === 'ar'
      ? '*ترفع كفّها اليمنى بإيماءة مطمئنة نحو اللوحة.*'
      : '*She lifts her right palm reassuringly toward the board.*';
    return `${dialoguePart}\n${actionPart}\n[EMOTION: encouraging]`;
  }

  // ── 3) Progress Nudge ──────────────────────────────────────────────────────
  if (!PROGRESS_RE.test(bodyWithoutTag)) {
    // Append a short nudge + updated action/emotion at end
    const dialoguePart = bodyWithoutTag.replace(ACTION_LINE_RE, '').trim();
    const actionPart   = lang === 'ar'
      ? '*تميل قليلاً للأمام بابتسامة خفيفة.*'
      : '*She leans in with a soft smile.*';
    if (lang === 'ar') {
      return `${dialoguePart}\n\nما الـ LO أو المعيار (P/M/D) الذي تعمل عليه الآن؟\n${actionPart}\n[EMOTION: encouraging]`;
    } else {
      return `${dialoguePart}\n\nWhich LO or criterion (P/M/D) are you working on right now?\n${actionPart}\n[EMOTION: encouraging]`;
    }
  }

  // All checks pass — return original unchanged
  return text;
}

/** Detect language from a string (Arabic Unicode block heuristic). */
export function detectLang(text: string): 'ar' | 'en' {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinChars  = (text.match(/[a-zA-Z]/g) ?? []).length;
  return arabicChars >= latinChars ? 'ar' : 'en';
}

function _fallback(lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? `لنُثبت الـ Unit/LO ونربطها بـ P/M/D… أعطني التفاصيل الآن.\n*ترفع كفّها اليمنى بإيماءة مطمئنة نحو اللوحة.*\n[EMOTION: encouraging]`
    : `Let's pin down the Unit/LO and map to P/M/D… share details now.\n*She lifts her right palm reassuringly toward the board.*\n[EMOTION: encouraging]`;
}
