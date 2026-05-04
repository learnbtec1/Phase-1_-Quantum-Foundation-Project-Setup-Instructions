import type { VisemeCue } from '@/app/avatar-agent/LipSyncManager';

/**
 * Build lip-sync cues in seconds from `/api/tts-with-timing` viseme_events
 * (offset_ms + viseme_id) or Azure-style { t, id }.
 */
export function visemeEventsToCues(
  raw: unknown,
): VisemeCue[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const cues: VisemeCue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    let tSec = 0;
    if ('offset_ms' in e) {
      const v = Number(e.offset_ms);
      tSec = Number.isFinite(v) ? Math.max(0, v / 1000) : 0;
    } else if ('time_ms' in e) {
      const v = Number(e.time_ms);
      tSec = Number.isFinite(v) ? Math.max(0, v / 1000) : 0;
    } else {
      const v = Number(e.t ?? 0);
      if (!Number.isFinite(v)) continue;
      /** `t` field is treated as seconds. Use explicit `offset_ms` / `time_ms` when the API sends millis. */
      tSec = Math.max(0, v);
    }
    const id = Number(e.viseme_id ?? e.id ?? e.visemeId ?? 0);
    cues.push({
      t: tSec,
      id: Math.min(21, Math.max(0, Math.round(Number.isFinite(id) ? id : 0))),
    });
  }
  cues.sort((a, b) => a.t - b.t);
  return cues;
}

/**
 * Agent bridge `agent:speak` payloads: `t` values are **seconds** unless `NEXT_PUBLIC_AGENT_VISEMES_T_UNIT=ms`.
 */
export function coerceBridgeVisemeTToSeconds(rawT: number): number {
  if (!Number.isFinite(rawT)) return 0;
  const unit =
    typeof process !== 'undefined'
      ? String(process.env.NEXT_PUBLIC_AGENT_VISEMES_T_UNIT ?? '').trim().toLowerCase()
      : '';
  if (unit === 'ms') return Math.max(0, rawT / 1000);
  return Math.max(0, rawT);
}


/** Match lip timeline span to decoded `audio.duration` (Edge / ElevenLabs drift). */
const STRETCH_SCALE_CLAMP = { min: 0.52, max: 1.48 } as const;
/** Skip remap only when already aligned (avoids float noise rebinds). */
const STRETCH_IDENTITY_EPS = 0.001;

/**
 * Re-time viseme cues so the last cue lands on `durationSec` when the synthetic
 * timeline differs from the real MP3/WAV length (Arabic / phoneme maps).
 */
export function stretchVisemeCuesToDuration(
  cues: VisemeCue[],
  durationSec: number,
): VisemeCue[] {
  if (!cues.length || !Number.isFinite(durationSec) || durationSec < 0.12) {
    return cues;
  }
  const maxT = cues[cues.length - 1]!.t;
  if (maxT < 0.02) return cues;
  const scaleRaw = durationSec / maxT;
  if (Math.abs(1 - scaleRaw) < STRETCH_IDENTITY_EPS) return cues;
  const s = Math.max(STRETCH_SCALE_CLAMP.min, Math.min(STRETCH_SCALE_CLAMP.max, scaleRaw));
  const tail = Math.max(1e-4, durationSec - 1e-3);
  const out = cues.map((c) => ({
    ...c,
    t: Math.min(Math.max(0, c.t * s), tail),
  }));
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.t < out[i - 1]!.t) out[i]!.t = out[i - 1]!.t;
  }
  return out;
}

export type VisemeStretchMode = 'fallback' | 'always' | 'never';

export function getVisemeStretchMode(): VisemeStretchMode {
  if (typeof process === 'undefined') return 'fallback';
  const raw = String(process.env.NEXT_PUBLIC_TTS_VISEME_STRETCH ?? '').trim().toLowerCase();
  if (raw === 'always' || raw === 'on' || raw === '1' || raw === 'true') return 'always';
  if (raw === 'never' || raw === 'off' || raw === '0' || raw === 'false') return 'never';
  return 'fallback';
}

/**
 * Linear remap of cue times to decoded duration (`stretchVisemeCuesToDuration`):
 * - `always` — same as unconditional stretch helper (historical behaviour).
 * - `never` — never stretch (sample-accuracy path; timelines must match decoded audio length).
 * - `fallback` (default) — only stretch when cue span vs decoded duration differs meaningfully,
 *    so corrections are occasional, not the primary synchronisation primitive.
 */
export function stretchVisemeCuesToDurationIfFallback(
  cues: VisemeCue[],
  durationSec: number,
): VisemeCue[] {
  const mode = getVisemeStretchMode();
  if (mode === 'never') return cues;
  if (mode === 'always') return stretchVisemeCuesToDuration(cues, durationSec);
  if (!cues.length || !Number.isFinite(durationSec) || durationSec < 0.12) return cues;
  const maxT = cues[cues.length - 1]!.t;
  if (maxT < 0.02) return cues;
  const deltaSec = Math.abs(durationSec - maxT);
  const ratioDelta = Math.abs(1 - durationSec / maxT);
  if (deltaSec < 0.08 && ratioDelta < 0.04) return cues;
  return stretchVisemeCuesToDuration(cues, durationSec);
}
