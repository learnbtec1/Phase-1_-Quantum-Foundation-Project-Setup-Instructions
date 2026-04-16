/**
 * AudioTimeline — single playback authority for lip-sync timing.
 * `HTMLAudioElement.currentTime` is the source of truth during an utterance.
 * Viseme cues are stored here; LipSyncManager reads cues + time from this module only.
 */
'use client';

import * as THREE from 'three';

export type AudioTimelineCue = { t: number; id: number };

export type AudioTimelineSource = 'http_tts' | 'ws_tts' | 'bridge' | 'azure_client';

let _utteranceGen = 0;
let _audio: HTMLAudioElement | null = null;
let _cues: AudioTimelineCue[] = [];
let _source: AudioTimelineSource | null = null;
/** Manual lip nudge only (optional hotkey); never auto-applied to playhead. */
let _driftOffsetSec = 0;

/**
 * Begin a new utterance (increments generation — stale readers ignore old audio).
 * Call once the authoritative `HTMLAudioElement` for this reply is known.
 */
export function bindAudioUtterance(args: {
  audio: HTMLAudioElement;
  cues: AudioTimelineCue[];
  source: AudioTimelineSource;
}): number {
  _utteranceGen += 1;
  _audio = args.audio;
  _cues = args.cues.map((c) => ({ t: c.t, id: c.id }));
  _source = args.source;
  _driftOffsetSec = 0;
  return _utteranceGen;
}

/** Replace viseme timeline (e.g. async fetch after WS play started). */
export function patchTimelineCues(cues: AudioTimelineCue[]): void {
  if (!cues.length) return;
  _cues = cues.map((c) => ({ t: c.t, id: c.id }));
}

/** Attach element when cues arrive earlier (bridge paths). */
export function setPlaybackAudio(audio: HTMLAudioElement | null): void {
  _audio = audio;
}

export function clearAudioTimeline(_reason?: string): void {
  _audio = null;
  _cues = [];
  _source = null;
  _driftOffsetSec = 0;
}

export function getActiveAudioElement(): HTMLAudioElement | null {
  return _audio;
}

/**
 * Lip-sync playhead — **HTMLAudioElement.currentTime only** (single source of truth).
 * Manual nudge (`nudgeDriftManual`) is not folded in; use for diagnostics/UI only.
 */
export function getPlaybackTimeSec(): number {
  if (!_audio) return 0;
  try {
    const ct = _audio.currentTime;
    if (!Number.isFinite(ct) || ct < 0) return 0;
    return Math.max(0, ct);
  } catch {
    return 0;
  }
}

/** Same as getPlaybackTimeSec (kept for call sites that name “raw”). */
export function getRawPlaybackTimeSec(): number {
  return getPlaybackTimeSec();
}

export function getVisemeCues(): AudioTimelineCue[] {
  return _cues;
}

export function getUtteranceGeneration(): number {
  return _utteranceGen;
}

export function getTimelineSource(): AudioTimelineSource | null {
  return _source;
}

export function resetDriftOffset(): void {
  _driftOffsetSec = 0;
}

/** Apply gradual heal toward sync (called from LipSyncManager when cue error detected). */
export function healDriftTowardZero(errSec: number): void {
  _driftOffsetSec = THREE.MathUtils.lerp(
    _driftOffsetSec,
    _driftOffsetSec - errSec * 0.22,
    0.42,
  );
  _driftOffsetSec = THREE.MathUtils.clamp(_driftOffsetSec, -0.18, 0.18);
}

export function getDriftOffsetSec(): number {
  return _driftOffsetSec;
}

/** Manual heal (`cogni:heal:lip-offset`). */
export function nudgeDriftManual(deltaSec: number): void {
  _driftOffsetSec = THREE.MathUtils.clamp(_driftOffsetSec + deltaSec, -0.12, 0.12);
}
