/**
 * Duration arbitration: WebSocket MP3 clip (`speech_data`) vs dialogue length (`speech`).
 * Used to avoid suppressing HTTP TTS when the WS clip is only a fragment (e.g. short Latin acronym).
 *
 * **Decision rule:** Only `<audio>` **decoded duration** (`loadedmetadata` / `exactSec`) is authoritative.
 * `roughMp3DurationSecFromBase64` is a non-binding preview — VBR, padding, and API quirks make it unreliable.
 */

/** Minimum fraction of estimated speech duration the WS clip must cover to mute HTTP fallback. */
export const DEFAULT_WS_TTS_DURATION_MIN_RATIO = 0.6;

/** Multi-signal floor: payloads smaller than this are not treated as plausible full utterance clips. */
export const DEFAULT_MIN_WS_SPEECH_DATA_B64_CHARS = 200;

export function wsSpeechDataMinBase64CharsFromEnv(): number {
  if (typeof process === 'undefined') return DEFAULT_MIN_WS_SPEECH_DATA_B64_CHARS;
  const raw = (process.env.NEXT_PUBLIC_WS_SPEECH_DATA_MIN_B64_CHARS ?? '').trim();
  if (!raw) return DEFAULT_MIN_WS_SPEECH_DATA_B64_CHARS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(500_000, Math.max(32, n)) : DEFAULT_MIN_WS_SPEECH_DATA_B64_CHARS;
}

export function wsTtsDurationMinRatioFromEnv(): number {
  if (typeof process === 'undefined') return DEFAULT_WS_TTS_DURATION_MIN_RATIO;
  const raw = (process.env.NEXT_PUBLIC_WS_TTS_DURATION_MIN_RATIO ?? '').trim();
  if (!raw) return DEFAULT_WS_TTS_DURATION_MIN_RATIO;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0.2, n)) : DEFAULT_WS_TTS_DURATION_MIN_RATIO;
}

/**
 * Heuristic expected audible duration from assistant dialogue (seconds).
 * ~400 ms/word blended with chars/sec fallback for Arabic / mixed scripts.
 */
export function estimateSpeechDurationSecondsFromText(text: string): number {
  const t = (text ?? '').trim();
  if (!t.length) return 0.35;
  const wc = Math.max(1, t.split(/\s+/).filter(Boolean).length);
  const fromWordsSec = wc * 0.4;
  const fromCharsSec = Math.max(0.35, Math.min(120, t.length / 14));
  return Math.min(120, Math.max(fromWordsSec, fromCharsSec));
}

/** Rough MP3 length from Base64 payload (browser-safe, mirrors BFF heuristic order of magnitude). */
export function roughMp3DurationSecFromBase64(
  audioBase64: string,
  textCharsForFloor: number,
): number {
  const b = audioBase64.replace(/\s/g, '');
  let pad = 0;
  if (b.endsWith('==')) pad = 2;
  else if (b.endsWith('=')) pad = 1;
  const byteLen = Math.max(1, Math.floor((b.length * 3) / 4) - pad);
  const kbps = 128;
  const fromBytesSec = (byteLen * 8) / (kbps * 1000);
  const fromTextSec = Math.max(0.4, textCharsForFloor / 14);
  return Math.min(120, Math.max(fromBytesSec * 0.85, fromTextSec));
}

/** @param decodedAudioSec Duration from `<audio>` after `loadedmetadata` (do not pass rough bitrate estimates here). */
export function wsClipCoversExpectedSpeech(
  decodedAudioSec: number | undefined,
  expectedSpeechSec: number,
  ratio?: number,
): boolean {
  const r = ratio ?? wsTtsDurationMinRatioFromEnv();
  const w = decodedAudioSec;
  if (w === undefined || !Number.isFinite(w)) return false;
  if (w <= 0.12) return false;
  const exp = Math.max(0.2, expectedSpeechSec);
  return w >= exp * r;
}
