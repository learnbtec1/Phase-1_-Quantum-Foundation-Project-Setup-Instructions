/**
 * Lightweight local similarity: 3-grams over word tokens, Jaccard on sets.
 * Used to flag overlap between student work and a reference / criteria text (or self-split).
 */
const WORD = /\S+/g;

function normalizeWords(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .match(WORD) ?? [];
}

function trigramsFromWords(words: string[]): string[] {
  if (words.length < 3) return [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - 3; i++) {
    out.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return out;
}

function toSet(trigrams: string[]): Set<string> {
  return new Set(trigrams);
}

/**
 * Jaccard similarity in [0, 1] between two texts (trigram sets on words).
 */
export function textTrigramJaccard(a: string, b: string): number {
  const wa = normalizeWords(a);
  const wb = normalizeWords(b);
  const ta = toSet(trigramsFromWords(wa));
  const tb = toSet(trigramsFromWords(wb));
  if (ta.size === 0 && tb.size === 0) return 0;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * When no external reference, compare first vs second half of document (intra-sim / repetitive blocks).
 * Requires at least a few words on each side.
 */
export function splitSelfJaccard(student: string): number | null {
  const w = normalizeWords(student);
  if (w.length < 40) return null;
  const mid = Math.floor(w.length / 2);
  const left = w.slice(0, mid).join(" ");
  const right = w.slice(mid).join(" ");
  return textTrigramJaccard(left, right);
}

/**
 * Primary local check: student vs reference or criteria. Falls back to split-self if no partner text.
 * Returns [0,100] or null if not computable.
 */
export function localPlagiarismPercent(
  student: string,
  options: { referenceOrCriteria: string } | { useSplitSelf: true }
): number | null {
  if ("useSplitSelf" in options && options.useSplitSelf) {
    const s = splitSelfJaccard(student);
    return s == null ? null : s * 100;
  }
  const r = (options as { referenceOrCriteria: string }).referenceOrCriteria?.trim() ?? "";
  if (r.length >= 30) {
    return textTrigramJaccard(student, r) * 100;
  }
  const s = splitSelfJaccard(student);
  return s == null ? null : s * 100;
}

/** Inclusive: values at `max` count as within policy. */
export function similarityStatus(percent: number, max: number): "acceptable" | "high" {
  return percent <= max ? "acceptable" : "high";
}
