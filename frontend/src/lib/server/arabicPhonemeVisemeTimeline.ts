/**
 * Arabic grapheme → Azure viseme id (0–21) with **weighted** time distribution
 * (madd, qalqalah, shadda, spaces). Timestamps sum to measured audio duration.
 */

import { estimateMp3DurationMs } from '@/lib/server/elevenlabsTtsStub';

export type PhonemeVisemeEvent = { offset_ms: number; viseme_id: number };

export type PhonemeTimelineStats = {
  segmentCount: number;
  totalWeight: number;
  avgCharDurationMs: number;
};

export type PhonemeTimelineResult = {
  events: PhonemeVisemeEvent[];
  stats: PhonemeTimelineStats;
};

export { estimateMp3DurationMs };

const SHADDA = 0x0651; // ّ

function isArabicLetter(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x0621 && c <= 0x063a) || (c >= 0x0641 && c <= 0x064a);
}

/**
 * Strip tatweel + tashkeel but **keep shadda** (ّ) for gemination doubling.
 */
export function normalizeArabicForWeightedTimeline(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x0640) continue; // tatweel
    if (c === SHADDA) {
      out += ch;
      continue;
    }
    if (c >= 0x064b && c <= 0x065f) continue;
    if (c >= 0x0610 && c <= 0x061a) continue;
    if (c >= 0x06d6 && c <= 0x06ed) continue;
    out += ch;
  }
  return out;
}

/** Madd / long vowel carriers — more jaw travel → longer share of clip */
function isMaddLetter(c: number): boolean {
  return (
    c === 0x0627 || // ا
    c === 0x0622 || // آ
    c === 0x0623 || // أ
    c === 0x0625 || // إ
    c === 0x0648 || // و
    c === 0x064a || // ي
    c === 0x0649 // ى
  );
}

/** Qalqalah letters (قلقلة) — shorter burst */
function isQalqalahLetter(c: number): boolean {
  return (
    c === 0x0628 || // ب
    c === 0x062c || // ج
    c === 0x062f || // د
    c === 0x0637 || // ط
    c === 0x0642 // ق
  );
}

/**
 * Base duration weight per grapheme (before shadda doubling on previous segment).
 * Spec: madd carriers ا/و/ي (+ آ أ إ ى) = 1.5; qalqalah ب ج د ط ق = 0.8; spaces = 0.5; other Arabic = 1.0.
 */
export function phoneticWeightForGrapheme(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (ch === ' ' || ch === '\t' || ch === '\n') return 0.5;
  if (ch === '،' || ch === ',' || ch === '.' || ch === '!' || ch === '?' || ch === '؛' || ch === ';') {
    return 0.2;
  }
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) return 1.0;

  if (isMaddLetter(c)) return 1.5;
  if (isQalqalahLetter(c)) return 0.8;
  if (isArabicLetter(ch) || (c >= 0x0600 && c <= 0x06ff)) return 1.0;
  return 0.4;
}

/**
 * Map a single Arabic letter (or space) to a viseme id.
 * Heuristic: articulation class → Azure viseme used by our VRM blend table.
 */
export function arabicLetterToVisemeId(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (ch === ' ' || ch === '\t' || ch === '\n') return 0;
  if (ch === '،' || ch === ',' || ch === '.' || ch === '!' || ch === '?' || ch === '؛' || ch === ';') {
    return 0;
  }
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) return 4;

  switch (c) {
    case 0x0621: // ء
    case 0x0623: // أ
    case 0x0625: // إ
    case 0x0627: // ا
    case 0x0622: // آ
    case 0x0624: // ؤ
    case 0x0626: // ئ
    case 0x0629: // ة
    case 0x0649: // ى
      return 2;
    case 0x0628: // ب
    case 0x0645: // م
      return 18;
    case 0x062a: // ت
    case 0x062f: // د
    case 0x0637: // ط
    case 0x0643: // ك
      return 18;
    case 0x062b: // ث
    case 0x0630: // ذ
    case 0x0636: // ض
    case 0x0638: // ظ
      return 17;
    case 0x062c: // ج
    case 0x0634: // ش
      return 16;
    case 0x062d: // ح
    case 0x0639: // ع
    case 0x0647: // ه
      return 12;
    case 0x062e: // خ
    case 0x063a: // غ
    case 0x0642: // ق
      return 19;
    case 0x0631: // ر
    case 0x0644: // ل
      return 14;
    case 0x0632: // ز
    case 0x0633: // س
    case 0x0635: // ص
      return 15;
    case 0x0641: // ف
      return 16;
    case 0x0646: // ن
      return 18;
    case 0x0648: // و
      return 9;
    case 0x064a: // ي
      return 6;
    default:
      if (isArabicLetter(ch)) return 2;
      return 0;
  }
}

/** @deprecated use normalizeArabicForWeightedTimeline */
export function stripArabicDiacriticsAndTatweel(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x0640) continue;
    if (c >= 0x064b && c <= 0x065f) continue;
    if (c >= 0x0610 && c <= 0x061a) continue;
    if (c >= 0x06d6 && c <= 0x06ed) continue;
    out += ch;
  }
  return out;
}

/**
 * Weighted phoneme timeline: shadda doubles the **previous** segment's weight.
 */
export function buildArabicPhonemeVisemeTimeline(
  text: string,
  durationMs?: number,
): PhonemeTimelineResult {
  const cleaned = normalizeArabicForWeightedTimeline(text.trim());

  if (!cleaned.length) {
    return {
      events: [{ offset_ms: 0, viseme_id: 0 }],
      stats: { segmentCount: 0, totalWeight: 0, avgCharDurationMs: 0 },
    };
  }

  type Seg = { ch: string; weight: number };
  const segments: Seg[] = [];

  for (const ch of Array.from(cleaned)) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === SHADDA) {
      if (segments.length > 0) {
        const last = segments[segments.length - 1]!;
        last.weight *= 2;
      }
      continue;
    }
    segments.push({ ch, weight: phoneticWeightForGrapheme(ch) });
  }

  if (segments.length === 0) {
    return {
      events: [{ offset_ms: 0, viseme_id: 0 }],
      stats: { segmentCount: 0, totalWeight: 0, avgCharDurationMs: 0 },
    };
  }

  const weights = segments.map((s) => s.weight);
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;

  let durMs: number;
  if (durationMs != null) {
    const measured = Math.min(180_000, Math.max(400, Math.floor(durationMs)));
    const textGuess = Math.min(180_000, Math.max(800, cleaned.length * 45 + 600));
    durMs = Math.max(measured, Math.min(textGuess, Math.floor(measured * 1.25)));
  } else {
    durMs = Math.min(180_000, Math.max(800, cleaned.length * 45 + 600));
  }

  const out: PhonemeVisemeEvent[] = [];
  let accMs = 0;
  // Per segment: charDurationMs = (weight / totalWeight) * durMs; offsets are cumulative start times.
  for (let i = 0; i < segments.length; i++) {
    const ch = segments[i]!.ch;
    const id = arabicLetterToVisemeId(ch);
    const idClamped = Math.min(21, Math.max(0, id));
    out.push({ offset_ms: Math.floor(accMs), viseme_id: idClamped });
    accMs += (durMs * weights[i]!) / totalW;
  }

  const stats: PhonemeTimelineStats = {
    segmentCount: segments.length,
    totalWeight: totalW,
    avgCharDurationMs: durMs / segments.length,
  };

  return { events: out, stats };
}
