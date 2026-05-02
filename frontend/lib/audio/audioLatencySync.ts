/**
 * Closed-loop latency hint for lip-sync playhead vs wall clock / AudioContext hints.
 *
 * Combines stable output hints (`outputLatency` + `baseLatency` when exposed) with a
 * slow integrator comparing wall-clock Δ vs `HTMLAudioElement.currentTime` drift while playing.
 */

'use client';

import * as THREE from 'three';

let _dynamicLatencyOffsetSec = 0;
let _anchorWallMs = 0;
let _anchorMediaSec = 0;
let _anchored = false;

export function resetAudioLatencySync(): void {
  _dynamicLatencyOffsetSec = 0;
  _anchored = false;
}

/** Wall vs media progression while playing → slow bias (seconds added to audio.currentTime). */
export function tickAudioLatencySync(
  audio: HTMLAudioElement | null,
  ctx: AudioContext | null,
): void {
  if (!audio || audio.paused || Number.isNaN(audio.currentTime)) {
    _anchored = false;
    return;
  }
  const nowMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  if (!_anchored) {
    _anchorWallMs = nowMs;
    _anchorMediaSec = Math.max(0, audio.currentTime);
    _anchored = true;
    let hintSec = 0;
    try {
      if (ctx && ctx.state === 'running') {
        const ol = typeof ctx.outputLatency === 'number' ? ctx.outputLatency : 0;
        const base = (
          ctx as AudioContext & { baseLatency?: number }
        ).baseLatency;
        const bl = typeof base === 'number' ? base : 0;
        hintSec = THREE.MathUtils.clamp(ol + bl, 0, 0.12);
      }
    } catch {
      hintSec = 0;
    }
    _dynamicLatencyOffsetSec = THREE.MathUtils.lerp(_dynamicLatencyOffsetSec, hintSec, 1);
    return;
  }

  const wallDt = Math.max(0, (nowMs - _anchorWallMs) / 1000);
  const mediaDt = Math.max(0, audio.currentTime - _anchorMediaSec);
  const driftWallVsMedia = wallDt - mediaDt;
  const targetBias = THREE.MathUtils.clamp(driftWallVsMedia * 0.35, -0.06, 0.06);
  _dynamicLatencyOffsetSec += (targetBias - _dynamicLatencyOffsetSec) * 0.052;
  _dynamicLatencyOffsetSec = THREE.MathUtils.clamp(_dynamicLatencyOffsetSec, -0.09, 0.11);
}

export function getDynamicLatencyOffsetSec(): number {
  return _dynamicLatencyOffsetSec;
}

export function getDynamicLatencyOffsetMs(): number {
  return _dynamicLatencyOffsetSec * 1000;
}

/**
 * Same seconds domain as `HTMLAudioElement.currentTime`, corrected by dynamic offset only
 * (`getPlaybackTimeSec` in audioTimeline folds drift offsets too).
 */
export function getCorrectedTime(audio: HTMLAudioElement | null): number {
  if (!audio || Number.isNaN(audio.currentTime)) return 0;
  const ct = Math.max(0, audio.currentTime);
  return Math.max(0, ct + _dynamicLatencyOffsetSec);
}
