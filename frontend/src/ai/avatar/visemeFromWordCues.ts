/**
 * Approximate Azure-style viseme timeline from word boundary cues (same time base as WS audio).
 * Used when the client must not call /api/tts-with-timing for the same text as server TTS.
 */
export function normalizeWordCuesForViseme(
  raw: unknown,
): Array<{ t: number; w?: string }> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Array<{ t: number; w?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const t = Number(o.t ?? o.offset_ms ?? o.time_ms);
    if (!Number.isFinite(t)) continue;
    const w = o.w ?? o.word;
    out.push({
      t: Math.max(0, t),
      w: typeof w === 'string' ? w : undefined,
    });
  }
  return out.length ? out : null;
}

export function visemeTimelineFromWordCues(
  wordCues: Array<{ t: number; w?: string }>,
  dialogue: string,
): Array<{ t: number; id: number }> {
  if (!wordCues.length) return [];
  const sorted = [...wordCues].sort((a, b) => a.t - b.t);
  const d = dialogue.trim();
  const estEnd =
    sorted[sorted.length - 1]!.t + Math.max(250, Math.min(8000, d.length * 42 || 600));
  const cues: Array<{ t: number; id: number }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i]!;
    const next = sorted[i + 1];
    const t = Math.max(0, w.t);
    const nextT = next ? next.t : estEnd;
    const span = Math.max(80, nextT - t);
    cues.push({ t, id: 4 });
    const mid = t + Math.min(140, Math.max(50, Math.floor(span / 3)));
    cues.push({ t: mid, id: 12 });
    const tail = Math.min(nextT - 15, mid + Math.min(90, Math.floor(span / 2)));
    if (tail > mid) cues.push({ t: tail, id: 0 });
  }
  return cues.sort((a, b) => a.t - b.t);
}
