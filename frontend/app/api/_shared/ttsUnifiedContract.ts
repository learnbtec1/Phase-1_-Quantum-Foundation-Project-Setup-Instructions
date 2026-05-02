/**
 * Single deterministic TTS API contract — all neural routes must emit this JSON.
 */
export type UnifiedTtsJson = {
  audio_url: string;
  duration_ms: number;
  viseme_events: Array<Record<string, unknown>>;
  format: 'mp3';
};

export function isNonEmptyUnifiedTts(x: unknown): x is UnifiedTtsJson {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.audio_url === 'string' &&
    o.audio_url.length >= 24 &&
    typeof o.duration_ms === 'number' &&
    Number.isFinite(o.duration_ms) &&
    o.duration_ms > 0 &&
    Array.isArray(o.viseme_events) &&
    o.viseme_events.length > 0 &&
    o.format === 'mp3'
  );
}

export function syntheticVisemeEvents(durationMs: number): UnifiedTtsJson['viseme_events'] {
  const end = Math.max(80, Math.round(durationMs) - 40);
  return [
    { offset_ms: 0, viseme_id: 0 },
    { offset_ms: end, viseme_id: 0 },
  ];
}

/** Bitrate heuristic when no decoder is available (OpenAI/mp3 blobs). */
export function estimateMp3DurationMs(byteLength: number, textLen: number): number {
  const kbps = 128;
  const fromBytes = (byteLength * 8) / (kbps * 1000);
  const fromText = Math.max(0.4, textLen / 14);
  const sec = Math.min(120, Math.max(fromBytes * 0.85, fromText));
  return Math.max(200, Math.round(sec * 1000));
}

export function mp3Base64ToAudioUrl(audioBase64: string): string {
  const b64 = audioBase64.replace(/\s/g, '');
  return `data:audio/mpeg;base64,${b64}`;
}

function base64ByteLength(rawB64: string): number {
  const b64 = rawB64.replace(/\s/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').length;
  }
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(1, Math.floor((b64.length * 3) / 4) - pad);
}

/** Build unified envelope from MP3 bytes (already base64) + optional viseme list. */
export function unifiedFromMp3Base64(params: {
  audioBase64: string;
  textLength: number;
  viseme_events?: UnifiedTtsJson['viseme_events'];
  /** When known (decoded MP3 length), overrides bitrate heuristic */
  duration_ms?: number;
}): UnifiedTtsJson {
  const raw = params.audioBase64.replace(/\s/g, '');
  const byteLen = base64ByteLength(raw);
  const heuristic = Math.max(
    200,
    estimateMp3DurationMs(byteLen, Math.max(1, params.textLength)),
  );
  const duration_ms =
    typeof params.duration_ms === 'number' &&
    Number.isFinite(params.duration_ms) &&
    params.duration_ms > 0
      ? Math.max(120, Math.round(params.duration_ms))
      : heuristic;
  const viseme_events =
    params.viseme_events &&
    Array.isArray(params.viseme_events) &&
    params.viseme_events.length > 0
      ? params.viseme_events
      : syntheticVisemeEvents(duration_ms);

  return {
    audio_url: mp3Base64ToAudioUrl(raw),
    duration_ms,
    viseme_events,
    format: 'mp3',
  };
}

/**
 * Client + server: coerce BFF JSON (unified or legacy mp3-only) into UnifiedTtsJson.
 * Does not decode PCM/WAV — those must never be emitted once servers are unified.
 */
export function coerceToUnifiedJson(
  data: Record<string, unknown>,
  textForHeuristic: string,
): UnifiedTtsJson | null {
  const textLen = Math.max(1, textForHeuristic.length);
  if (isNonEmptyUnifiedTts(data)) {
    const o = data as UnifiedTtsJson;
    let viseme_events = o.viseme_events;
    if (!Array.isArray(viseme_events) || viseme_events.length === 0) {
      viseme_events = syntheticVisemeEvents(o.duration_ms);
    }
    return { ...o, viseme_events, format: 'mp3' };
  }
  const legacyB64 =
    typeof data.audio_base64 === 'string' ? String(data.audio_base64) : '';
  const clean = legacyB64.replace(/\s/g, '');
  const fmt = typeof data.format === 'string' ? data.format.toLowerCase() : '';
  if (clean.length >= 64 && (fmt === '' || fmt === 'mp3' || fmt === 'mpeg')) {
    return unifiedFromMp3Base64({ audioBase64: legacyB64, textLength: textLen });
  }
  const visFromPayload = data.viseme_events;
  const blobUrl =
    typeof data.audio_url === 'string'
      ? data.audio_url
      : typeof (data as { audioUrl?: unknown }).audioUrl === 'string'
        ? String((data as { audioUrl: string }).audioUrl)
        : '';
  if (
    blobUrl.startsWith('blob:') &&
    typeof data.duration_ms === 'number' &&
    Array.isArray(visFromPayload) &&
    visFromPayload.length > 0
  ) {
    return {
      audio_url: blobUrl,
      duration_ms: Math.max(120, Math.round(Number(data.duration_ms))),
      viseme_events: visFromPayload as UnifiedTtsJson['viseme_events'],
      format: 'mp3',
    };
  }
  return null;
}