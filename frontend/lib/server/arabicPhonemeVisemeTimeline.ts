import { estimateMp3DurationSec } from '@/app/api/_shared/ttsResponse';

export type PhonemeVisemeEvent = {
  offset_ms: number;
  viseme_id: number;
};

export function estimateMp3DurationMs(bytes: Uint8Array): number {
  const len = bytes?.length ?? 0;
  const textLenGuess = Math.max(4, Math.ceil(len / 120));
  return Math.round(estimateMp3DurationSec(len, textLenGuess) * 1000);
}

/** Coarse grapheme buckets → Oculus viseme id range 0–15 (Enough for LipSync stretch). */
function charToVisemeId(ch: string): number {
  const c = ch;
  const code = c.codePointAt(0) ?? 0;
  if (code >= 0x0600 && code <= 0x06ff) {
    /** Arabic consonant / vowel hints */
    const strong = /ب|ت|ث|ج|ح|خ|د|ذ|ر|ز|س|ش|ص|ض|ط|ظ|ع|غ|ف|ق|ك|ل|م|ن|ه/;
    const open = /ا|آ|أ|إ|ى|ة|و|ي|ؤ|ئ/;
    if (/ّ|ْ|ُ|ِ|َ|ْ/.test(c)) return 11;
    if (open.test(c)) return 2;
    if (strong.test(c)) return (code % 7) + 4;
    return ((code >> 3) % 10) + 3;
  }
  const lower = c.toLowerCase();
  if ('aeiou'.includes(lower)) return 2 + (lower.charCodeAt(0) % 6);
  if (/[bcdfgkmnpqvwxz]/i.test(c)) return 6 + (lower.charCodeAt(0) % 8);
  if (/\d/.test(c)) return 9;
  return 0;
}

export function buildArabicPhonemeVisemeTimeline(
  text: string,
  durationMs: number,
): {
  events: PhonemeVisemeEvent[];
  stats: { avgCharDurationMs: number; totalWeight: number };
} {
  const chars = [...text.trim()].filter((ch) => !/\s/.test(ch));
  const safeDur = Math.max(200, durationMs);
  if (chars.length === 0) {
    const stub = [{ offset_ms: 0, viseme_id: 0 }];
    stub.push({
      offset_ms: Math.max(120, safeDur - 45),
      viseme_id: 0,
    });
    return {
      events: stub,
      stats: { avgCharDurationMs: safeDur / 2, totalWeight: 1 },
    };
  }

  let totalWeight = 0;
  const weights = chars.map((ch) => {
    const w = 0.6 + Math.min(1.4, Math.max(0.2, charToVisemeId(ch) / 12));
    totalWeight += w;
    return w;
  });

  let accMs = 0;
  const events: PhonemeVisemeEvent[] = [];
  for (let i = 0; i < chars.length; i++) {
    const frac = weights[i]! / Math.max(totalWeight, 1e-6);
    accMs += frac * safeDur * 0.98;
    const offset_ms = Math.min(safeDur - 15, Math.max(0, Math.floor(accMs)));
    if (events.length && events[events.length - 1]!.offset_ms === offset_ms)
      events[events.length - 1]!.viseme_id = charToVisemeId(chars[i]!);
    else
      events.push({
        offset_ms,
        viseme_id: Math.min(15, Math.max(0, charToVisemeId(chars[i]!))),
      });
  }

  /** De-dup timestamps + ensure anchors */
  const deduped: PhonemeVisemeEvent[] = [];
  let last = -1;
  for (const e of events.sort((a, b) => a.offset_ms - b.offset_ms)) {
    if (e.offset_ms !== last || deduped.length === 0) {
      deduped.push({ ...e });
      last = e.offset_ms;
    }
  }

  deduped[0] = { offset_ms: 0, viseme_id: deduped[0]?.viseme_id ?? 0 };
  const tailMs = Math.max(80, safeDur - 30);
  if (!deduped.some((x) => x.offset_ms >= tailMs)) {
    deduped.push({
      offset_ms: Math.min(safeDur - 20, tailMs),
      viseme_id: 0,
    });
  }

  const avgCharDurationMs = chars.length ? safeDur / chars.length : safeDur / 12;
  return {
    events: deduped.slice(0, 256),
    stats: {
      avgCharDurationMs,
      totalWeight,
    },
  };
}
