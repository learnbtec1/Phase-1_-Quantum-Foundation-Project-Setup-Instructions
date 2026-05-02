/**
 * Shared JSON shape for `/api/tts-with-timing` BFF and FastAPI (Edge neural TTS).
 */
export function wavDurationSeconds(buf: Buffer): number {
  if (buf.length < 44) return Math.max(0.5, buf.length / 48000);
  const byteRate = buf.readUInt32LE(28);
  const dataSize = buf.readUInt32LE(40);
  if (byteRate > 0 && dataSize > 0) return dataSize / byteRate;
  return 2;
}

export function roughWordTimings(text: string, durationSec: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const per = durationSec / words.length;
  return words.map((word, i) => ({
    word,
    start_time: i * per,
    end_time: (i + 1) * per,
  }));
}

export function syntheticVisemeEvents(durationMs: number) {
  const end = Math.max(80, durationMs - 40);
  return [
    { offset_ms: 0, viseme_id: 0 },
    { offset_ms: Math.floor(end), viseme_id: 0 },
  ];
}

/** Rough duration from MP3 byte length when header parsing is skipped (lip-sync estimate). */
export function estimateMp3DurationSec(byteLength: number, textLen: number): number {
  const kbps = 128;
  const fromBytes = (byteLength * 8) / (kbps * 1000);
  const fromText = Math.max(0.4, textLen / 14);
  return Math.min(120, Math.max(fromBytes * 0.85, fromText));
}
