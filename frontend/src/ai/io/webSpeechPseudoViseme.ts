/**
 * Pseudo–lip-sync for Web Speech API: map grapheme at a boundary `charIndex`
 * to an Azure-style viseme id (0–21) consumed by LipSyncManager.
 *
 * No phoneme pipeline — heuristic buckets for Arabic + Latin. Quality: teaching-demo tier.
 */

const PUNCT_OR_SPACE = /^[\s.,;:!?\-–—()[\]{}«»،؟؛۔…"'`]$/u;

/** Skip whitespace after boundary index; fall back to last non-space before. */
export function resolveSpeechBoundaryChar(text: string, charIndex: number): string {
  if (!text.length) return ' ';
  let i = Math.min(Math.max(0, charIndex | 0), text.length - 1);
  if (/\s/.test(text[i]!)) {
    let j = i;
    while (j < text.length && /\s/.test(text[j]!)) j += 1;
    if (j < text.length) return text[j]!;
    while (i > 0 && /\s/.test(text[i]!)) i -= 1;
    return text[i]!;
  }
  return text[i]!;
}

/**
 * Azure viseme ids align with LipSyncManager.AZURE_VISEME_TO_BLEND (0=rest).
 */
export function azureVisemeIdFromSpeechBoundaryChar(ch: string, langHint: string): number {
  const c = ch;
  if (!c || PUNCT_OR_SPACE.test(c)) return 0;

  const cp = c.codePointAt(0)!;
  const lang = (langHint || '').toLowerCase();

  // Basic Latin + common extended Latin for English fragments in Arabic scaffolding
  if (cp <= 0x024f) {
    const x = c.toLowerCase();
    if ('aeiou'.includes(x)) {
      if (x === 'a') return 2;
      if (x === 'e' || x === 'i') return 7;
      if (x === 'o') return 3;
      if (x === 'u') return 9;
    }
    if ('bmp'.includes(x)) return 15;
    if ('fv'.includes(x)) return 19;
    if ('sz'.includes(x)) return 16;
    if (x === 'c') return 16;
    if ('tdn'.includes(x)) return 20;
    if ('kg'.includes(x)) return 21;
    if ('lr'.includes(x)) return 14;
    if (x === 'w') return 8;
    if (x === 'y' || x === 'j') return 6;
    if (x === 'h') return 13;
    if (x === 'q') return 21;
    return 4;
  }

  // Arabic presentation forms / compatibility are rare in cleanText — main Arabic block
  if (cp >= 0x0600 && cp <= 0x06ff) {
    // Open / neutral vowel carriers & alif forms
    if ('أإآاٱىةهدءئؤ'.includes(c)) return 2;
    // Rounded / labial-velar
    if ('وؤ'.includes(c)) return 9;
    // Front / palatal
    if ('يى'.includes(c)) return 7;
    // Strong labials
    if ('بم'.includes(c)) return 15;
    // Labio-dental
    if ('ف'.includes(c)) return 19;
    // Coronal fricatives
    if ('ثذظ'.includes(c)) return 18;
    if ('صضط'.includes(c)) return 17;
    if ('سش'.includes(c)) return 16;
    if ('ز'.includes(c)) return 16;
    // Liquids / nasals / coronals
    if ('نلر'.includes(c)) return 15;
    if ('تدج'.includes(c)) return 20;
    // Dorsals / pharyngeals / laryngeals
    if ('قكعغخح'.includes(c)) return 21;
    if ('؟،؛'.includes(c)) return 0;
    return lang.startsWith('ar') ? 4 : 2;
  }

  // Default slight jaw — works for uncommon scripts embedded in lessons
  return 2;
}
