import type { PhonemeVisemeEvent } from '@/lib/server/arabicPhonemeVisemeTimeline';

/** Simple spaced viseme stubs for Latin / non-Arabic (client stretches to duration). */
export function stubVisemeTimelineForText(
  text: string,
  durationMs: number,
): PhonemeVisemeEvent[] {
  const trimmed = text.trim();
  const words =
    trimmed.length > 0
      ? trimmed.split(/\s+/).filter(Boolean)
      : [];
  const n = Math.min(48, Math.max(2, words.length || Math.ceil(trimmed.length / 6) || 2));
  const span = Math.max(120, durationMs - 40);
  const step = span / n;
  const out: PhonemeVisemeEvent[] = [{ offset_ms: 0, viseme_id: 0 }];
  for (let i = 1; i <= n; i++) {
    out.push({
      offset_ms: Math.min(durationMs - 20, Math.floor(i * step)),
      viseme_id: (i * 7) % 14,
    });
  }
  if (durationMs > 40) {
    out.push({
      offset_ms: Math.max(80, durationMs - 35),
      viseme_id: 0,
    });
  }
  out.sort((a, b) => a.offset_ms - b.offset_ms);
  return out;
}
