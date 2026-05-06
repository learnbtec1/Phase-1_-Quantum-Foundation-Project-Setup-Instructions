'use client';
/**
 * Arabic (and mixed) text normalization for rule-based intent classification.
 * Applied before regex matching so dialect / orthography variants still hit rules.
 */

/** Lowercase Latin letters only; Arabic case is not applicable. */
function lowercaseLatinFragments(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * NFKC, alef/hamza variants → ا، ة→ه، tatweel strip، علامات ترقيم → فراغ، تقليل مسافات.
 */
export function normalizeForIntentClassification(raw: string): string {
  let s = (raw ?? '').normalize('NFKC');
  // Tatweel
  s = s.replace(/\u0640/g, '');
  // Alef / alef-hamza variants → ا
  s = s.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627');
  // Tā marbūṭa → hā (matches spoken Jordanian + broadens keyword hit rate)
  s = s.replace(/\u0629/g, '\u0647');
  // Arabic presentation forms occasionally leak — fold common lam-alef ligatures to letters
  s = s.replace(/[\uFEFB\uFEFC]/g, 'لا');
  s = s.replace(/[\uFEF7\uFEF8]/g, 'لآ');
  s = s.replace(/[\uFEF5\uFEF6]/g, 'لأ');

  // Replace punctuation / symbols with space (keep ? ؟ for questioning cues)
  s = s.replace(/[^\p{L}\p{N}\s؟?]/gu, ' ');
  s = lowercaseLatinFragments(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export type CanonicalIntentLabel =
  | 'greeting'
  | 'explaining'
  | 'questioning'
  | 'thinking'
  | 'emphasizing'
  | 'listening'
  | 'confirming'
  | 'disagreeing'
  | 'agreeing'
  | '';

/**
 * Map free-form / bilingual LLM intent strings to a canonical label for the gesture bridge.
 */
export function canonicalizeLlmIntentLabel(raw: string | null | undefined): CanonicalIntentLabel {
  const n = normalizeForIntentClassification(raw ?? '');
  if (!n) return '';
  const s = n.toLowerCase();

  const tests: { re: RegExp; out: CanonicalIntentLabel }[] = [
    { re: /^(greeting|salutation|hello|hi|hey|welcome|تحيه|ترحيب|تحية)$/u, out: 'greeting' },
    { re: /^(explaining|explanation|teach|teaching|instruction|instruct)$/u, out: 'explaining' },
    { re: /^(questioning|question|ask|inquiry)$/u, out: 'questioning' },
    { re: /^(thinking|think|ponder|hesitat)/u, out: 'thinking' },
    { re: /^(emphasizing|emphasis|stress|highlight)$/u, out: 'emphasizing' },
    { re: /^(listening|listen)$/u, out: 'listening' },
    { re: /^(confirming|confirm|affirm|acknowledg)/u, out: 'confirming' },
    { re: /^(disagreeing|disagree|reject|object)/u, out: 'disagreeing' },
    { re: /^(agreeing|agree|concur)/u, out: 'agreeing' },
    // Arabic labels some models emit
    { re: /^(تحيه|تحية|ترحيب|سلام)$/u, out: 'greeting' },
    { re: /^(شرح|تفسير|توضيح)$/u, out: 'explaining' },
    { re: /^(سؤال|استفسار|استجواب)$/u, out: 'questioning' },
    { re: /^(تفكير)$/u, out: 'thinking' },
    { re: /^(تأكيد|توكيد)$/u, out: 'emphasizing' },
    { re: /^(استماع)$/u, out: 'listening' },
    { re: /^(موافقه|موافقة|تصديق)$/u, out: 'confirming' },
    { re: /^(رفض|اعتراض)$/u, out: 'disagreeing' },
  ];

  for (const { re, out } of tests) {
    if (re.test(s)) return out;
  }
  return '';
}
