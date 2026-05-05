'use client';
/**
 * __behaviorSync.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Behavior Synchronization Layer (additive, log-only by default).
 *
 * PURPOSE
 *   Tie speech / emotion / intent / motion together so they are seen by the
 *   pose pipeline as a SINGLE coordinated frame state instead of four
 *   independent subsystems that can drift apart.
 *
 *   This module DOES NOT own bones.  It writes only ADDITIVE deltas onto
 *   the existing `BonePoseMap` (`q.multiply(...)`), exactly like
 *   `humanMicroBehavior` does — so every pre-existing layer (intent,
 *   gesture, VRMA, micro) keeps its authority.
 *
 * RESPONSIBILITIES
 *   PART 1   `getBehaviorState()` — aggregate speech / emotion / intent /
 *            gesture into one structured snapshot.
 *   PART 2   Audio → motion: tiny additive head nod + arm activation
 *            during speech.
 *   PART 3   Emotion → posture: shoulder/spine offsets per affect tag.
 *   PART 4   Intent → gesture activation: surface a `gestureActive` flag
 *            and amplitude multiplier consumers can read.
 *   PART 5   Timing alignment check via `avatar:speak:start` event vs the
 *            next motion frame — logs `[DESYNC_DETECTED]` over 120ms.
 *   PART 6   Freeze-vs-speech check using `__boneAuthority` freeze data —
 *            logs `[SYNC_FAILURE]` when speaking but critical bones idle
 *            for ≥60 consecutive frames.
 *   PART 9   `getSyncStatus()` returns OK / DESYNC / PARTIAL for the HUD.
 *
 * INVARIANTS
 *   • No React, no Three.js scene access, no backend mutation.
 *   • All warnings throttled and gated behind `AVATAR_DEBUG`.
 *   • Pure data plus a single additive `applyBehaviorSyncModifiers` helper.
 */

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { AVATAR_DEBUG } from './__avatarErrorTracker';
import {
  getFrameDiagnosticSummary,
  detectRootCause,
  getLastGestureDispatchMs,
  type RootCause,
} from './__boneAuthority';

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — Types & aggregator
// ═══════════════════════════════════════════════════════════════════════════

export type BehaviorEmotion = 'neutral' | 'happy' | 'serious' | 'excited';

export interface BehaviorState {
  /** `performance.now()` when this state was computed. */
  timestamp:           number;
  speechActive:        boolean;
  /** 0..1 instantaneous speech amplitude (smoothed unified energy). */
  speechEnergy:        number;
  emotion:             BehaviorEmotion;
  /** Raw upstream emotion tag (e.g. "thinking", "joy") — kept for the HUD. */
  emotionRaw:          string;
  intentIntensity:     number;
  gestureActive:       boolean;

  // ── Modifier outputs (consumers may read directly or rely on
  //    `applyBehaviorSyncModifiers` to apply them) ─────────────────────────
  /** Sin-driven head nod target rad (≈ ±0.35 × energy when speaking). */
  headSpeechNod:       number;
  /** 0..1 arm-activation envelope while speaking. */
  armSpeechActivation: number;
  /** -1..+1 — negative tightens posture, positive opens it. */
  postureExpansion:    number;
  /** 0..2 multiplier consumers should apply to gesture amplitudes. */
  gestureAmpMul:       number;
  /** 0..1.5 overall motion scale (emotion-driven). */
  motionIntensityMul:  number;
}

const INTENT_GESTURE_THRESHOLD     = 0.4;
const DESYNC_THRESHOLD_MS          = 120;
const SYNC_FAILURE_FROZEN_FRAMES   = 60;     // ≈1 s at 60fps
const SYNC_LOG_COOLDOWN_MS         = 1000;
const DESYNC_LOG_COOLDOWN_MS       = 2000;
const SYNC_FAILURE_LOG_COOLDOWN_MS = 3000;

let _lastBehaviorState:     BehaviorState | null = null;
let _prevSpeechActive:      boolean              = false;
let _lastSpeechChangeMs:    number               = 0;
let _lastSyncLogMs:         number               = -Infinity;
let _lastDesyncLogMs:       number               = -Infinity;
let _lastSyncFailureLogMs:  number               = -Infinity;
let _consecutiveFrozenFrames: number             = 0;

// Audio event tracking (PART 5).  Captured on `avatar:speak:start` so the
// next motion frame can confirm it consumed the event in <120 ms.
let _pendingAudioEventMs: number  = 0;
let _audioEventConsumed:  boolean = true;

if (typeof window !== 'undefined') {
  const onStart = (): void => {
    _pendingAudioEventMs = performance.now();
    _audioEventConsumed  = false;
  };
  const onEnd = (): void => {
    _pendingAudioEventMs = 0;
    _audioEventConsumed  = true;
  };
  window.addEventListener('avatar:speak:start', onStart);
  window.addEventListener('avatar:speak:end',   onEnd);
}

const EMOTION_NORMALIZE_MAP: Readonly<Record<string, BehaviorEmotion>> = {
  neutral:    'neutral',
  happy:      'happy',
  joy:        'happy',
  laughing:   'happy',
  smile:      'happy',
  cheerful:   'happy',
  friendly:   'happy',
  serious:    'serious',
  thinking:   'serious',
  focused:    'serious',
  sad:        'serious',
  concerned:  'serious',
  excited:    'excited',
  surprised:  'excited',
  energetic:  'excited',
  angry:      'excited',
};

function _normalizeEmotion(raw: string | null | undefined): BehaviorEmotion {
  if (!raw) return 'neutral';
  const k = raw.toLowerCase();
  return EMOTION_NORMALIZE_MAP[k] ?? 'neutral';
}

function _emotionPostureExpansion(e: BehaviorEmotion): number {
  switch (e) {
    case 'happy':   return 0.4;
    case 'excited': return 0.7;
    case 'serious': return -0.3;
    default:        return 0;
  }
}

function _emotionMotionMul(e: BehaviorEmotion): number {
  switch (e) {
    case 'happy':   return 1.10;
    case 'excited': return 1.30;
    case 'serious': return 0.70;
    default:        return 1.00;
  }
}

/**
 * Aggregate the four subsystems into one BehaviorState snapshot for the
 * current frame.  Pure function except for module-level diff trackers
 * (last speech timestamp, last state).
 */
export function getBehaviorState(input: {
  nowMs:           number;
  speechActive:    boolean;
  speechEnergy:    number;
  emotionRaw?:     string | null;
  intentIntensity: number;
  /** Optional override; otherwise derived from intentIntensity threshold. */
  gestureActive?:  boolean;
}): BehaviorState {
  const emotion        = _normalizeEmotion(input.emotionRaw);
  const energy         = Math.max(0, Math.min(1, input.speechEnergy));
  const intent         = Math.max(0, Math.min(1, input.intentIntensity));
  const motionMul      = _emotionMotionMul(emotion);
  const postureExpand  = _emotionPostureExpansion(emotion);
  const intentActive   = intent > INTENT_GESTURE_THRESHOLD;
  const gestureActive  = !!input.gestureActive || intentActive;

  // Speech edge tracking (used by checkSyncAlignment for diff timing).
  if (_prevSpeechActive !== input.speechActive) {
    _lastSpeechChangeMs = input.nowMs;
    _prevSpeechActive   = input.speechActive;
  }

  // Audio activations (additive, modest amplitudes — never replace pose).
  const tSec        = input.nowMs * 0.001;
  const headNod     = input.speechActive
    ? Math.sin(tSec * 2.1) * 0.30 * (0.55 + energy * 0.45)
    : 0;
  const armEnvelope = input.speechActive
    ? 0.55 + Math.abs(Math.sin(tSec * 1.5)) * 0.45
    : 0;

  // Gesture amplitude multiplier — scales gesture layers' contributions.
  const gestureAmpMul = (intentActive
    ? 1.0 + (intent - INTENT_GESTURE_THRESHOLD) * 1.2
    : 0.5) * motionMul;

  const state: BehaviorState = {
    timestamp:           input.nowMs,
    speechActive:        input.speechActive,
    speechEnergy:        energy,
    emotion,
    emotionRaw:          input.emotionRaw ?? 'neutral',
    intentIntensity:     intent,
    gestureActive,
    headSpeechNod:       headNod,
    armSpeechActivation: armEnvelope,
    postureExpansion:    postureExpand,
    gestureAmpMul,
    motionIntensityMul:  motionMul,
  };
  _lastBehaviorState = state;
  return state;
}

/** Read the most recent state (for HUDs / external consumers).  May be null. */
export function getLastBehaviorState(): BehaviorState | null {
  return _lastBehaviorState;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2+3 — Apply sync modifiers (additive, never override)
// ═══════════════════════════════════════════════════════════════════════════

const _eulerScratch = new THREE.Euler(0, 0, 0, 'YXZ');
const _quatScratch  = new THREE.Quaternion();

function _addBoneEuler(pose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  const q = pose.get(key);
  if (!q) return;
  _eulerScratch.set(rx, ry, rz, 'YXZ');
  _quatScratch.setFromEuler(_eulerScratch);
  q.multiply(_quatScratch);
}

/**
 * Apply behavior-sync deltas to `pose`.  Always additive (`q.multiply`),
 * never replacement — composes safely with intent / gesture / VRMA / MICRO
 * layers that already wrote to these bones.
 *
 * Amplitudes are deliberately small (≤ 0.05 rad) — this layer is a
 * coordination signal, not a primary motion source.
 */
export function applyBehaviorSyncModifiers(pose: BonePoseMap, state: BehaviorState): void {
  // ── PART 2: Audio → motion ────────────────────────────────────────────
  if (state.speechActive) {
    _addBoneEuler(pose, 'head', state.headSpeechNod * 0.05, 0, 0);
    _addBoneEuler(pose, 'neck', state.headSpeechNod * 0.025, 0, 0);
    const armOpen = state.armSpeechActivation * 0.06;
    _addBoneEuler(pose, 'leftShoulder',  0, 0,  armOpen);
    _addBoneEuler(pose, 'rightShoulder', 0, 0, -armOpen);
  }

  // ── PART 3: Emotion → posture ─────────────────────────────────────────
  if (state.postureExpansion !== 0) {
    const expand = state.postureExpansion * 0.05;
    _addBoneEuler(pose, 'leftShoulder',  0, 0,  expand);
    _addBoneEuler(pose, 'rightShoulder', 0, 0, -expand);
    _addBoneEuler(pose, 'spine', expand * 0.25, 0, 0);
    _addBoneEuler(pose, 'chest', expand * 0.15, 0, 0);
  }

  // ── Throttled diagnostic logs (1/s) ───────────────────────────────────
  if (!AVATAR_DEBUG) return;
  if (state.timestamp - _lastSyncLogMs < SYNC_LOG_COOLDOWN_MS) return;
  _lastSyncLogMs = state.timestamp;

  if (state.speechActive) {
    console.log('[SYNC_AUDIO_MOTION]', {
      speaking:      true,
      motionApplied: true,
      headNod:       +state.headSpeechNod.toFixed(3),
      armEnvelope:   +state.armSpeechActivation.toFixed(3),
    });
  }
  if (state.emotion !== 'neutral') {
    console.log('[SYNC_EMOTION]', {
      emotion:       state.emotion,
      effect:        state.postureExpansion > 0 ? 'expanded posture'
                   : state.postureExpansion < 0 ? 'tightened posture'
                   : 'baseline',
      motionMul:     +state.motionIntensityMul.toFixed(2),
    });
  }
  console.log('[SYNC_INTENT]', {
    intensity: +state.intentIntensity.toFixed(3),
    gestures:  state.gestureActive ? 'enabled' : 'suppressed',
    ampMul:    +state.gestureAmpMul.toFixed(2),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 5 — Timing alignment (audio vs motion)
// ═══════════════════════════════════════════════════════════════════════════

export interface SyncAlignmentResult {
  audioMotionDeltaMs: number | null;
  desync:             boolean;
  audioEventPending:  boolean;
}

/**
 * Consume the pending `avatar:speak:start` event (if any) and compare its
 * timestamp to the current motion timestamp.  When the gap exceeds
 * `DESYNC_THRESHOLD_MS` (browser tab inactive, jank, blocked thread),
 * emits `[DESYNC_DETECTED]` with a 2 s cooldown.
 */
export function checkSyncAlignment(motionTimestampMs: number): SyncAlignmentResult {
  if (_audioEventConsumed) {
    return { audioMotionDeltaMs: null, desync: false, audioEventPending: false };
  }
  const delta = motionTimestampMs - _pendingAudioEventMs;
  // Mark consumed after the first frame past the event so we don't keep
  // re-comparing.  The next start event resets the flag.
  _audioEventConsumed = true;
  const desync = delta > DESYNC_THRESHOLD_MS;
  if (
    desync &&
    AVATAR_DEBUG &&
    motionTimestampMs - _lastDesyncLogMs > DESYNC_LOG_COOLDOWN_MS
  ) {
    _lastDesyncLogMs = motionTimestampMs;
    console.warn('[DESYNC_DETECTED]', {
      type:      'audio-motion',
      delayMs:   Math.round(delta),
      threshold: DESYNC_THRESHOLD_MS,
    });
  }
  return { audioMotionDeltaMs: delta, desync, audioEventPending: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 6 — Freeze-vs-speech failure detector
// ═══════════════════════════════════════════════════════════════════════════

const CRITICAL_BONE_PATTERN = /(head$|neck$|UpperArm$|LowerArm$|Shoulder$|Hand$|lua|rua|lla|rla|lh|rh)/i;

/**
 * Critical sync failure: avatar is speaking but no critical bone has moved
 * for ≥`SYNC_FAILURE_FROZEN_FRAMES`.  Returns `true` once the failure
 * latches (caller can use the boolean to surface UI state).
 */
export function checkFreezeVsSpeech(state: BehaviorState): boolean {
  if (!state.speechActive) {
    _consecutiveFrozenFrames = 0;
    return false;
  }
  const summary  = getFrameDiagnosticSummary();
  const critical = summary.frozenBones.filter((b) => CRITICAL_BONE_PATTERN.test(b));
  if (critical.length === 0) {
    _consecutiveFrozenFrames = 0;
    return false;
  }
  _consecutiveFrozenFrames++;
  if (_consecutiveFrozenFrames < SYNC_FAILURE_FROZEN_FRAMES) return false;
  if (state.timestamp - _lastSyncFailureLogMs < SYNC_FAILURE_LOG_COOLDOWN_MS) return true;
  _lastSyncFailureLogMs = state.timestamp;
  console.error('[SYNC_FAILURE]', {
    reason:        'Speaking but no motion',
    frozenBones:   critical,
    framesFrozen:  _consecutiveFrozenFrames,
    speechEnergy:  +state.speechEnergy.toFixed(3),
  });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 9 — Aggregate sync status for HUD / overlay
// ═══════════════════════════════════════════════════════════════════════════

export type SyncStatus = 'OK' | 'PARTIAL' | 'DESYNC';

const RECENT_DESYNC_WINDOW_MS         = 5000;
const RECENT_SYNC_FAILURE_WINDOW_MS   = 5000;

/** Best-effort overall sync verdict.  Read from console / overlay. */
export function getSyncStatus(): SyncStatus {
  const s = _lastBehaviorState;
  if (!s) return 'OK';
  const now            = s.timestamp;
  const recentDesync   = (now - _lastDesyncLogMs)      < RECENT_DESYNC_WINDOW_MS;
  const recentFailure  = (now - _lastSyncFailureLogMs) < RECENT_SYNC_FAILURE_WINDOW_MS;
  if (recentFailure) return 'DESYNC';
  if (recentDesync)  return 'PARTIAL';
  return 'OK';
}

// ── Window helpers ────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__avatarBehaviorState = getLastBehaviorState;
  w.__avatarSyncStatus    = getSyncStatus;
}
