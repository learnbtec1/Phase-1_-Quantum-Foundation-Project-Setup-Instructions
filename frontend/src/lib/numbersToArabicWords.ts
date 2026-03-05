/**
 * Convert numbers in text to Arabic words for proper TTS pronunciation.
 * Prevents numbers from being spoken in English when using Arabic TTS.
 * Simple implementation — no external package required.
 */

const EASTERN_TO_WESTERN: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const ARABIC_0_99: string[] = [
  'صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
  'عشرون', 'واحد وعشرون', 'اثنان وعشرون', 'ثلاثة وعشرون', 'أربعة وعشرون', 'خمسة وعشرون', 'ستة وعشرون', 'سبعة وعشرون', 'ثمانية وعشرون', 'تسعة وعشرون',
  'ثلاثون', 'واحد وثلاثون', 'اثنان وثلاثون', 'ثلاثة وثلاثون', 'أربعة وثلاثون', 'خمسة وثلاثون', 'ستة وثلاثون', 'سبعة وثلاثون', 'ثمانية وثلاثون', 'تسعة وثلاثون',
  'أربعون', 'واحد وأربعون', 'اثنان وأربعون', 'ثلاثة وأربعون', 'أربعة وأربعون', 'خمسة وأربعون', 'ستة وأربعون', 'سبعة وأربعون', 'ثمانية وأربعون', 'تسعة وأربعون',
  'خمسون', 'واحد وخمسون', 'اثنان وخمسون', 'ثلاثة وخمسون', 'أربعة وخمسون', 'خمسة وخمسون', 'ستة وخمسون', 'سبعة وخمسون', 'ثمانية وخمسون', 'تسعة وخمسون',
  'ستون', 'واحد وستون', 'اثنان وستون', 'ثلاثة وستون', 'أربعة وستون', 'خمسة وستون', 'ستة وستون', 'سبعة وستون', 'ثمانية وستون', 'تسعة وستون',
  'سبعون', 'واحد وسبعون', 'اثنان وسبعون', 'ثلاثة وسبعون', 'أربعة وسبعون', 'خمسة وسبعون', 'ستة وسبعون', 'سبعة وسبعون', 'ثمانية وسبعون', 'تسعة وسبعون',
  'ثمانون', 'واحد وثمانون', 'اثنان وثمانون', 'ثلاثة وثمانون', 'أربعة وثمانون', 'خمسة وثمانون', 'ستة وثمانون', 'سبعة وثمانون', 'ثمانية وثمانون', 'تسعة وثمانون',
  'تسعون', 'واحد وتسعون', 'اثنان وتسعون', 'ثلاثة وتسعون', 'أربعة وتسعون', 'خمسة وتسعون', 'ستة وتسعون', 'سبعة وتسعون', 'ثمانية وتسعون', 'تسعة وتسعون',
];

function toArabicWord(num: number): string {
  const n = Math.floor(num);
  if (n >= 0 && n < 100) return ARABIC_0_99[n];
  if (n === 100) return 'مائة';
  if (n >= 101 && n < 200) return `مائة و ${toArabicWord(n - 100)}`;
  if (n >= 200 && n < 1000) return `${ARABIC_0_99[Math.floor(n / 100)]} مائة${n % 100 ? ` و ${toArabicWord(n % 100)}` : ''}`;
  if (n >= 1000 && n < 2000) return `ألف${n % 1000 ? ` و ${toArabicWord(n % 1000)}` : ''}`;
  if (n >= 2000 && n < 10000) return `${ARABIC_0_99[Math.floor(n / 1000)]} آلاف${n % 1000 ? ` و ${toArabicWord(n % 1000)}` : ''}`;
  return String(num);
}

/** Replace numbers in text with Arabic words. */
export function numbersToArabicWords(text: string): string {
  if (!text?.trim()) return text;

  let normalized = text;
  for (const [e, w] of Object.entries(EASTERN_TO_WESTERN)) {
    normalized = normalized.replaceAll(e, w);
  }

  return normalized.replace(/(\d+(?:\.\d+)?)/g, (match) => {
    const num = parseFloat(match.replace(/٫/g, '.'));
    if (Number.isNaN(num)) return match;
    try {
      return toArabicWord(num);
    } catch {
      return match;
    }
  });
}
