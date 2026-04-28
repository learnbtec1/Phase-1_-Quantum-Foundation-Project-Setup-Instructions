/**
 * Stub viseme timeline for BFF direct ElevenLabs (no phoneme alignment from API).
 * Mirrors backend `stub_viseme_timeline_for_text` + `estimate_mp3_duration_ms`.
 */

export function estimateMp3DurationMs(mp3Bytes: Uint8Array): number {
  const n = mp3Bytes.length;
  if (n < 32) return 800;
  const est = Math.floor((n * 1000) / 16000);
  return Math.min(180_000, Math.max(400, est));
}

export type StubVisemeEvent = { offset_ms: number; viseme_id: number };

export function stubVisemeTimelineForText(
  text: string,
  durationMs?: number,
): StubVisemeEvent[] {
  const nchars = text.trim().length;
  const textGuessMs = Math.min(180_000, Math.max(800, nchars * 45 + 600));
  let durMs: number;
  if (durationMs != null) {
    const measured = Math.min(180_000, Math.max(400, Math.floor(durationMs)));
    durMs = Math.max(measured, Math.min(textGuessMs, Math.floor(measured * 1.25)));
  } else {
    durMs = textGuessMs;
  }
  const out: StubVisemeEvent[] = [];
  const ids = [4, 6, 8, 12, 15, 7, 5, 9, 11, 13];
  let t = 0;
  let i = 0;
  const stepMs = 140;
  while (t < durMs) {
    out.push({ offset_ms: t, viseme_id: ids[i % ids.length]! });
    t += stepMs;
    i += 1;
  }
  return out;
}
