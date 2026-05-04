/**
 * AudioTimeline — unified viseme cues + lip-sync **playhead** driven by shared AudioContext
 * time (anchored at `playing` / `seeked`) with fallback to HTMLMediaElement.currentTime.
 * Keeps cues in **seconds only** contract for consumers (see LipSyncManager).
 */
'use client';

import * as THREE from 'three';
import { getSharedAudioContext, resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';

export type AudioTimelineCue = { t: number; id: number };

export type AudioTimelineSource = 'http_tts' | 'ws_tts' | 'bridge' | 'azure_client';

let _utteranceGen = 0;
let _audio: HTMLAudioElement | null = null;
let _cues: AudioTimelineCue[] = [];
let _source: AudioTimelineSource | null = null;
/** Manual lip nudge only (optional hotkey); never auto-applied to playhead. */
let _driftOffsetSec = 0;

/** Media clock anchor paired with AudioContext.currentTime while element is advancing. */
let _anchorCtxSec: number | null = null;
let _anchorMediaSec = 0;

/** When set, lip playhead uses wall clock — Web Speech API (no `<audio>` timeline). */
let _webSpeechT0Ms: number | null = null;

type AnchorHandlers = {
  audio: HTMLAudioElement;
  onPlaying: () => void;
  onSeeked: () => void;
  onRateChange: () => void;
};

let _anchorHandlers: AnchorHandlers | null = null;

function detachPlaybackAnchorListeners(): void {
  if (_anchorHandlers) {
    const { audio, onPlaying, onSeeked, onRateChange } = _anchorHandlers;
    audio.removeEventListener('playing', onPlaying);
    audio.removeEventListener('seeked', onSeeked);
    audio.removeEventListener('ratechange', onRateChange);
    _anchorHandlers = null;
  }
  _anchorCtxSec = null;
}

function snapPlaybackAnchor(audio: HTMLAudioElement): void {
  const ctx = getSharedAudioContext();
  if (!ctx || audio !== _audio) {
    _anchorCtxSec = null;
    return;
  }
  _anchorCtxSec = ctx.currentTime;
  _anchorMediaSec = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
}

/** Re-bind anchor whenever decoded stream position jumps (playback, seek, rate). */
export function attachPlaybackClockToAudioElement(audio: HTMLAudioElement): void {
  detachPlaybackAnchorListeners();
  const onPlaying = (): void => {
    if (_audio !== audio) return;
    void resumeSharedAudioContext().finally(() => {
      if (_audio === audio) snapPlaybackAnchor(audio);
    });
    snapPlaybackAnchor(audio);
  };
  const onSeeked = (): void => {
    if (_audio !== audio) return;
    snapPlaybackAnchor(audio);
  };
  const onRateChange = (): void => {
    if (_audio !== audio) return;
    snapPlaybackAnchor(audio);
  };
  audio.addEventListener('playing', onPlaying);
  audio.addEventListener('seeked', onSeeked);
  audio.addEventListener('ratechange', onRateChange);
  _anchorHandlers = { audio, onPlaying, onSeeked, onRateChange };
}

export function isPlaybackAnchored(): boolean {
  return _anchorCtxSec !== null;
}

/**
 * Begin a new utterance (increments generation — stale readers ignore old audio).
 */
export function bindAudioUtterance(args: {
  audio: HTMLAudioElement;
  cues: AudioTimelineCue[];
  source: AudioTimelineSource;
}): number {
  _webSpeechT0Ms = null;
  _utteranceGen += 1;
  _audio = args.audio;
  _cues = args.cues.map((c) => ({ t: c.t, id: c.id }));
  _source = args.source;
  _driftOffsetSec = 0;
  attachPlaybackClockToAudioElement(args.audio);
  return _utteranceGen;
}

/** Replace viseme timeline; optional source override for bridge vs HTTP coherence. */
/** Clear only the viseme cue buffer (e.g. avatar:visemes:clear) — does not release the audio element binding. */
export function clearVisemeTimelineCues(): void {
  _cues = [];
}

export function patchTimelineCues(
  cues: AudioTimelineCue[],
  source?: AudioTimelineSource,
): void {
  if (!cues.length) return;
  _webSpeechT0Ms = null;
  _cues = cues.map((c) => ({ t: c.t, id: c.id }));
  if (source !== undefined) _source = source;
}

/** Attach element when cues arrive earlier (audio path). Keeps Clock listeners on the active element. */
export function setPlaybackAudio(audio: HTMLAudioElement | null): void {
  if (audio) _webSpeechT0Ms = null;
  _audio = audio;
  detachPlaybackAnchorListeners();
  _anchorCtxSec = null;
  if (audio) attachPlaybackClockToAudioElement(audio);
}

export function clearAudioTimeline(_reason?: string): void {
  detachPlaybackAnchorListeners();
  _audio = null;
  _cues = [];
  _source = null;
  _driftOffsetSec = 0;
  _anchorCtxSec = null;
  _anchorMediaSec = 0;
  _webSpeechT0Ms = null;
}

/**
 * Web Speech fallback: viseme cues append in real time (`utterance.onboundary`);
 * playhead = elapsed time since utterance actually started (`onstart`).
 */
export function beginWebSpeechLipTimeline(): number {
  _utteranceGen += 1;
  detachPlaybackAnchorListeners();
  _audio = null;
  _cues = [];
  _source = 'http_tts';
  _driftOffsetSec = 0;
  _anchorCtxSec = null;
  _anchorMediaSec = 0;
  _webSpeechT0Ms = performance.now();
  return _utteranceGen;
}

export function appendWebSpeechVisemeCue(elapsedSec: number, id: number): void {
  if (_webSpeechT0Ms === null) return;
  let t = Math.max(0, elapsedSec);
  const vid = Math.min(21, Math.max(0, Math.round(id)));
  const last = _cues[_cues.length - 1];
  if (last) {
    if (last.id === vid && t - last.t < 0.018) return;
    if (t < last.t) t = last.t + 0.004;
  }
  _cues.push({ t, id: vid });
}

export function isWebSpeechLipTimelineActive(): boolean {
  return _webSpeechT0Ms !== null;
}

export function getActiveAudioElement(): HTMLAudioElement | null {
  return _audio;
}

/**
 * Lip-sync playhead: **elapsed AudioContext time** since last anchor (+ media offset at anchor),
 * falling back to `HTMLAudioElement.currentTime` when paused or context unavailable.
 */
export function getPlaybackTimeSec(): number {
  if (_webSpeechT0Ms !== null) {
    return Math.max(0, (performance.now() - _webSpeechT0Ms) / 1000);
  }
  if (!_audio) return 0;
  const ctx = getSharedAudioContext();
  try {
    if (
      ctx
      && _anchorCtxSec !== null
      && !_audio.paused
      && ctx.state === 'running'
    ) {
      const elapsed = ctx.currentTime - _anchorCtxSec;
      const t = _anchorMediaSec + elapsed;
      if (Number.isFinite(t) && t >= 0) return t;
    }
    const ct = _audio.currentTime;
    if (!Number.isFinite(ct) || ct < 0) return 0;
    return Math.max(0, ct);
  } catch {
    return 0;
  }
}

export function getRawPlaybackTimeSec(): number {
  if (!_audio) return 0;
  try {
    const ct = _audio.currentTime;
    if (!Number.isFinite(ct) || ct < 0) return 0;
    return Math.max(0, ct);
  } catch {
    return 0;
  }
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

export function nudgeDriftManual(deltaSec: number): void {
  _driftOffsetSec = THREE.MathUtils.clamp(_driftOffsetSec + deltaSec, -0.12, 0.12);
}
