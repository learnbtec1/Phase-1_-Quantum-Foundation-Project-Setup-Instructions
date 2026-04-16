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
      tSec = v > 300 ? v / 1000 : v;
      tSec = Math.max(0, tSec);
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
