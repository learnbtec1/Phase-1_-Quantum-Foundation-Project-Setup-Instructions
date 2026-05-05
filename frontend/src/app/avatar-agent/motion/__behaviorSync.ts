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
import {
  computeBehavior,
  behaviorToMotion,
  type BehaviorInput,
  type BehaviorState as BehaviorEnginePlan,
} from './__behaviorEngine';
import { computeTimingState, applyTimingToMotion } from './__behaviorTiming';

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

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — Truth Mode flag (visibility-only — never changes behaviour)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Truth mode bypasses all log-cooldowns / dedup so every single self-heal
 * event becomes visible.  It does NOT disable the auto-fixes themselves —
 * the constraint is "DO NOT change animation behavior" — it just removes
 * the consoles' rate-limits so masked failures cannot hide.
 */
function _isTruthModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__AVATAR_TRUTH_MODE === true;
}

/** Effective cooldown — 0 in truth mode, otherwise the configured value. */
function _cooldown(ms: number): number {
  return _isTruthModeEnabled() ? 0 : ms;
}

/** Console gate that respects truth mode (always-on) OR AVATAR_DEBUG. */
function _logEnabled(): boolean {
  return AVATAR_DEBUG || _isTruthModeEnabled();
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — Self-heal counters
// ═══════════════════════════════════════════════════════════════════════════

export interface SelfHealStats {
  /** Sum of all auto-fix events across categories. */
  syncFixCount:      number;
  /** PART 1 injections (force minimum motion when speaking + frozen). */
  injectionCount:    number;
  /** PART 2 sync corrections (clock realigns after >120ms gap). */
  correctionCount:   number;
  /** PART 4 intent retriggers (cogni:intent:retrigger dispatched). */
  retriggerCount:    number;
  /** PART 3 emotion boost expansions (when posture didn't move for 2s). */
  emotionBoostCount: number;
  /** Number of distinct [HIDDEN_FAILURE] events raised. */
  hiddenFailures:    number;
  /** Number of distinct [BEHAVIOR_LOOP_FAILURE] events raised. */
  loopFailures:      number;
  /** Session start (performance.now). */
  startedAtMs:       number;
  /** Last update time (performance.now). */
  updatedAtMs:       number;
}

const _now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const _selfHealStats: SelfHealStats = {
  syncFixCount:      0,
  injectionCount:    0,
  correctionCount:   0,
  retriggerCount:    0,
  emotionBoostCount: 0,
  hiddenFailures:    0,
  loopFailures:      0,
  startedAtMs:       _now(),
  updatedAtMs:       _now(),
};

/** Snapshot of the self-heal counters since the avatar mounted. */
export function getSelfHealStats(): Readonly<SelfHealStats> {
  return { ..._selfHealStats };
}

/** Reset counters (debug-only — exposes via window for ad-hoc resets). */
export function resetSelfHealStats(): void {
  _selfHealStats.syncFixCount      = 0;
  _selfHealStats.injectionCount    = 0;
  _selfHealStats.correctionCount   = 0;
  _selfHealStats.retriggerCount    = 0;
  _selfHealStats.emotionBoostCount = 0;
  _selfHealStats.hiddenFailures    = 0;
  _selfHealStats.loopFailures      = 0;
  _selfHealStats.startedAtMs       = _now();
  _selfHealStats.updatedAtMs       = _now();
  _injectionTimes.length  = 0;
  _correctionTimes.length = 0;
  _retriggerTimes.length  = 0;
}

// Rolling-window timestamp arrays for rate analysis (PART 3).
const _injectionTimes:  number[] = [];
const _correctionTimes: number[] = [];
const _retriggerTimes:  number[] = [];
const HIDDEN_FAILURE_WINDOW_MS         = 10000;
const HIDDEN_FAILURE_INJECTION_MIN     = 30;   // ≥ 30 force injections / 10s
const HIDDEN_FAILURE_CORRECTION_MIN    = 5;    // ≥ 5 sync corrections / 10s
const HIDDEN_FAILURE_RETRIGGER_MIN     = 8;    // ≥ 8 intent retriggers / 10s
const HIDDEN_FAILURE_LOG_COOLDOWN_MS   = 5000;
const LOOP_FAILURE_THRESHOLD           = 4;
const LOOP_FAILURE_LOG_COOLDOWN_MS     = 5000;

let _lastHiddenFailureLogMs: number = -Infinity;
let _lastLoopFailureLogMs:   number = -Infinity;
let _consecutiveRetriggersWithoutGesture: number = 0;
let _lastRetriggerMs: number = 0;

function _trimWindow(times: number[], windowMs: number, now: number): void {
  while (times.length > 0 && now - times[0] > windowMs) times.shift();
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — Hidden failure detector
// ═══════════════════════════════════════════════════════════════════════════

interface HiddenFailureSignal {
  type:    'motion_missing' | 'clock_instability' | 'gesture_broken';
  cause:   string;
  count:   number;
  windowMs: number;
}

function _detectHiddenFailures(now: number): HiddenFailureSignal[] {
  _trimWindow(_injectionTimes,  HIDDEN_FAILURE_WINDOW_MS, now);
  _trimWindow(_correctionTimes, HIDDEN_FAILURE_WINDOW_MS, now);
  _trimWindow(_retriggerTimes,  HIDDEN_FAILURE_WINDOW_MS, now);
  const out: HiddenFailureSignal[] = [];
  if (_injectionTimes.length >= HIDDEN_FAILURE_INJECTION_MIN) {
    out.push({
      type:     'motion_missing',
      cause:    'system constantly injecting motion (' + _injectionTimes.length + '× in 10s)',
      count:    _injectionTimes.length,
      windowMs: HIDDEN_FAILURE_WINDOW_MS,
    });
  }
  if (_correctionTimes.length >= HIDDEN_FAILURE_CORRECTION_MIN) {
    out.push({
      type:     'clock_instability',
      cause:    'frequent audio-motion clock corrections (' + _correctionTimes.length + '× in 10s)',
      count:    _correctionTimes.length,
      windowMs: HIDDEN_FAILURE_WINDOW_MS,
    });
  }
  if (_retriggerTimes.length >= HIDDEN_FAILURE_RETRIGGER_MIN) {
    out.push({
      type:     'gesture_broken',
      cause:    'gesture system not responding to intent retriggers (' + _retriggerTimes.length + '× in 10s)',
      count:    _retriggerTimes.length,
      windowMs: HIDDEN_FAILURE_WINDOW_MS,
    });
  }
  if (out.length === 0) return out;
  if (now - _lastHiddenFailureLogMs < _cooldown(HIDDEN_FAILURE_LOG_COOLDOWN_MS)) return out;
  _lastHiddenFailureLogMs = now;
  _selfHealStats.hiddenFailures++;
  if (_logEnabled()) {
    console.error('[HIDDEN_FAILURE]', {
      issues:   out,
      stats:    {
        injectionCount:  _selfHealStats.injectionCount,
        correctionCount: _selfHealStats.correctionCount,
        retriggerCount:  _selfHealStats.retriggerCount,
      },
      truthMode: _isTruthModeEnabled(),
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 4 — Behavior loop detector (intent → retrigger → no gesture → repeat)
// ═══════════════════════════════════════════════════════════════════════════

function _checkLoopFailure(now: number): void {
  // If a gesture happened since the last retrigger, the loop broke — reset.
  const lastGestureMs = getLastGestureDispatchMs();
  if (lastGestureMs > _lastRetriggerMs && _lastRetriggerMs > 0) {
    _consecutiveRetriggersWithoutGesture = 0;
  } else if (_lastRetriggerMs > 0) {
    _consecutiveRetriggersWithoutGesture++;
  }
  _lastRetriggerMs = now;
  if (_consecutiveRetriggersWithoutGesture < LOOP_FAILURE_THRESHOLD) return;
  if (now - _lastLoopFailureLogMs < _cooldown(LOOP_FAILURE_LOG_COOLDOWN_MS)) return;
  _lastLoopFailureLogMs = now;
  _selfHealStats.loopFailures++;
  if (_logEnabled()) {
    console.error('[BEHAVIOR_LOOP_FAILURE]', {
      consecutiveRetriggers: _consecutiveRetriggersWithoutGesture,
      lastGestureMsAgo:      lastGestureMs > 0 ? Math.round(now - lastGestureMs) : 'never',
      cause:                 'intent → retrigger → no gesture → repeat',
      truthMode:             _isTruthModeEnabled(),
    });
  }
}

let _lastBehaviorState:     BehaviorState | null = null;
let _prevSpeechActive:      boolean              = false;
let _lastSpeechChangeMs:    number               = 0;
let _lastSyncLogMs:         number               = -Infinity;
let _lastDesyncLogMs:       number               = -Infinity;
let _lastSyncFailureLogMs:  number               = -Infinity;
let _consecutiveFrozenFrames: number             = 0;

// Audio event tracking (PART 5).  Captured on `avatar:speak:start` so the
// next motion frame can confirm it consumed the event in <120 ms.
//
// PART 2 root-cause fix: discard stale events instead of "correcting" them.
// `requestAnimationFrame` is paused while the tab is hidden; when the tab
// resumes, an `avatar:speak:start` that fired during the hidden period
// would otherwise show up as a 2-30 sec gap on the next frame and trigger
// `[SYNC_CORRECTED]`.  That isn't a real desync — it's the browser's
// scheduling, and reporting it muddies real bugs.  We now:
//   1.  Stamp each pending event with the page's visibility-state,
//   2.  Discard events older than `STALE_AUDIO_EVENT_MS` (browser jank
//       budget is roughly one breath; 700 ms is generous),
//   3.  Reset pending state on `visibilitychange`.
const STALE_AUDIO_EVENT_MS = 700;
let _pendingAudioEventMs:        number  = 0;
let _audioEventConsumed:         boolean = true;
let _audioEventVisibilityWasOk:  boolean = true;

if (typeof window !== 'undefined') {
  const onStart = (): void => {
    _pendingAudioEventMs       = performance.now();
    _audioEventConsumed        = false;
    _audioEventVisibilityWasOk = (typeof document !== 'undefined') ? !document.hidden : true;
  };
  const onEnd = (): void => {
    _pendingAudioEventMs = 0;
    _audioEventConsumed  = true;
  };
  window.addEventListener('avatar:speak:start', onStart);
  window.addEventListener('avatar:speak:end',   onEnd);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      // Tab visibility changed — any pending event spans a gap that is
      // entirely the browser's fault.  Drop it so it can't be misread as
      // an audio-motion desync.
      if (document.hidden) {
        _audioEventVisibilityWasOk = false;
      } else {
        // Returning from hidden: clear any stale pending event right away.
        _pendingAudioEventMs = 0;
        _audioEventConsumed  = true;
      }
    });
  }
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

  // ── PART 3: Emotion → posture (with EMOTION_NO_EFFECT boost applied) ──
  if (state.postureExpansion !== 0) {
    // PART 3 boost: when validateEmotionEffect detects no posture response
    // for >2s, _emotionBoost grows up to EMOTION_BOOST_CAP — applied here
    // to amplify the contribution and make the emotion visible.
    const expandBase = state.postureExpansion * 0.05;
    const expand     = expandBase * (1 + _emotionBoost);
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
  /** PART 2: true when auto-correction realigned the clocks this frame. */
  corrected:          boolean;
}

let _lastSyncCorrectedLogMs: number = -Infinity;

/**
 * Consume the pending `avatar:speak:start` event (if any) and compare its
 * timestamp to the current motion timestamp.  When the gap exceeds
 * `DESYNC_THRESHOLD_MS` (browser tab inactive, jank, blocked thread),
 * emits `[DESYNC_DETECTED]` with a 2 s cooldown.
 *
 * PART 2 (Auto-correction): when desync is detected, the motion clock is
 * realigned by treating the audio event as just consumed — preventing
 * accumulating drift on subsequent frames.  Logs `[SYNC_CORRECTED]`.
 */
export function checkSyncAlignment(motionTimestampMs: number): SyncAlignmentResult {
  if (_audioEventConsumed) {
    return { audioMotionDeltaMs: null, desync: false, audioEventPending: false, corrected: false };
  }
  const delta = motionTimestampMs - _pendingAudioEventMs;

  // PART 2 root-cause: silently drop stale or visibility-tainted events
  // BEFORE they enter the desync calculation.  These aren't real desyncs;
  // they're browser scheduling artefacts (background tab, throttled raf).
  if (!_audioEventVisibilityWasOk || delta > STALE_AUDIO_EVENT_MS) {
    _audioEventConsumed = true;
    _pendingAudioEventMs = 0;
    _audioEventVisibilityWasOk = true; // reset for next event
    return { audioMotionDeltaMs: delta, desync: false, audioEventPending: false, corrected: false };
  }

  // Mark consumed after the first frame past the event so we don't keep
  // re-comparing.  The next start event resets the flag.
  _audioEventConsumed = true;
  const desync = delta > DESYNC_THRESHOLD_MS;
  let corrected = false;
  if (desync) {
    if (_logEnabled() && motionTimestampMs - _lastDesyncLogMs > _cooldown(DESYNC_LOG_COOLDOWN_MS)) {
      _lastDesyncLogMs = motionTimestampMs;
      console.warn('[DESYNC_DETECTED]', {
        type:      'audio-motion',
        delayMs:   Math.round(delta),
        threshold: DESYNC_THRESHOLD_MS,
      });
    }
    // PART 2 — auto-correction: clear pending state and emit [SYNC_CORRECTED].
    // The next motion frame starts with a clean baseline, so drift cannot
    // accumulate over many speak:start events.
    corrected = true;
    _selfHealStats.correctionCount++;
    _selfHealStats.syncFixCount++;
    _selfHealStats.updatedAtMs = motionTimestampMs;
    _correctionTimes.push(motionTimestampMs);
    if (_logEnabled() && motionTimestampMs - _lastSyncCorrectedLogMs > _cooldown(2000)) {
      _lastSyncCorrectedLogMs = motionTimestampMs;
      console.warn('[SYNC_CORRECTED]', {
        previousDelayMs: Math.round(delta),
        realignedAtMs:   Math.round(motionTimestampMs),
        totalCorrections: _selfHealStats.correctionCount,
      });
    }
    _detectHiddenFailures(motionTimestampMs);
  }
  return { audioMotionDeltaMs: delta, desync, audioEventPending: false, corrected };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — Hard sync guarantee (force-injection when speaking + frozen)
// ═══════════════════════════════════════════════════════════════════════════

const HARD_SYNC_FORCE_HEAD_RAD = 0.030;
const HARD_SYNC_FORCE_ARM_RAD  = 0.020;
const HARD_SYNC_LOG_COOLDOWN_MS = 1500;
const CRITICAL_BONE_PATTERN_HARD = /(head|neck|UpperArm|Shoulder)/i;

let _lastForceInjectMs: number = -Infinity;
let _forceInjectionsThisSession: number = 0;

/**
 * PART 1 — Hard sync guarantee.  When the avatar is speaking AND any
 * critical bone (head / neck / shoulders / upper arms) appears in the
 * freeze detector's recent output, this function force-injects a small
 * sin-driven head nod and shoulder activation onto `pose`.
 *
 * The injection is additive (`q.multiply`) so it composes with whatever
 * higher-priority layer happens to be active — it does not "win" against
 * intent, gesture, or VRMA, it just guarantees a non-zero baseline.
 *
 * Returns `true` when an injection actually occurred this frame.
 */
export function enforceHardSyncGuarantee(pose: BonePoseMap, state: BehaviorState): boolean {
  if (!state.speechActive) return false;
  const summary  = getFrameDiagnosticSummary();
  const critical = summary.frozenBones.filter((b) => CRITICAL_BONE_PATTERN_HARD.test(b));
  if (critical.length === 0) return false;

  // Force-inject minimum motion onto pose (additive, never replace).
  const tSec = state.timestamp * 0.001;
  _addBoneEuler(pose, 'head',          Math.sin(tSec * 2.5) * HARD_SYNC_FORCE_HEAD_RAD, 0, 0);
  _addBoneEuler(pose, 'neck',          Math.sin(tSec * 2.5) * HARD_SYNC_FORCE_HEAD_RAD * 0.4, 0, 0);
  _addBoneEuler(pose, 'leftShoulder',  0, 0,  HARD_SYNC_FORCE_ARM_RAD);
  _addBoneEuler(pose, 'rightShoulder', 0, 0, -HARD_SYNC_FORCE_ARM_RAD);
  _forceInjectionsThisSession++;
  _selfHealStats.injectionCount++;
  _selfHealStats.syncFixCount++;
  _selfHealStats.updatedAtMs = state.timestamp;
  _injectionTimes.push(state.timestamp);

  if (_logEnabled() && state.timestamp - _lastForceInjectMs > _cooldown(HARD_SYNC_LOG_COOLDOWN_MS)) {
    _lastForceInjectMs = state.timestamp;
    console.warn('[SYNC_FORCE_INJECTION]', {
      reason:        'Speaking but critical bones frozen',
      frozenBones:   critical,
      headRad:       HARD_SYNC_FORCE_HEAD_RAD,
      shoulderRad:   HARD_SYNC_FORCE_ARM_RAD,
      sessionCount:  _forceInjectionsThisSession,
      truthMode:     _isTruthModeEnabled(),
    });
  }
  _detectHiddenFailures(state.timestamp);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — Emotion validation (detect EMOTION_NO_EFFECT + boost multiplier)
// ═══════════════════════════════════════════════════════════════════════════

const EMOTION_VALIDATION_DELAY_MS = 2000;
const EMOTION_BOOST_INCREMENT      = 0.05;
const EMOTION_BOOST_CAP            = 0.40;
const EMOTION_LOG_COOLDOWN_MS      = 3000;

let _lastEmotionRaw: string = 'neutral';
let _emotionChangedAtMs: number = 0;
let _postureBaseline: string = '';
let _lastEmotionWarnMs: number = -Infinity;
let _emotionBoost: number = 0;

function _postureFingerprint(pose: BonePoseMap): string {
  const fmt = (q: THREE.Quaternion | undefined): string =>
    q ? `${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)}` : 'na';
  return [
    fmt(pose.get('spine')),
    fmt(pose.get('chest')),
    fmt(pose.get('leftShoulder')),
    fmt(pose.get('rightShoulder')),
  ].join('|');
}

/**
 * PART 3 — Emotion validator.  Re-establishes the posture baseline every
 * time `state.emotionRaw` changes; after `EMOTION_VALIDATION_DELAY_MS`
 * with no posture drift, logs `[EMOTION_NO_EFFECT]` and gradually boosts
 * `_emotionBoost` (read by `getEmotionBoost()`).
 *
 * The boost is consumed by future `applyBehaviorSyncModifiers` calls:
 * when non-zero, it scales the postureExpansion contribution.
 */
export function validateEmotionEffect(pose: BonePoseMap, state: BehaviorState): void {
  if (state.emotionRaw !== _lastEmotionRaw) {
    _lastEmotionRaw     = state.emotionRaw;
    _emotionChangedAtMs = state.timestamp;
    _postureBaseline    = _postureFingerprint(pose);
    _emotionBoost       = 0; // reset on new emotion
    return;
  }
  if (state.emotion === 'neutral') {
    _emotionBoost = 0;
    return;
  }
  const elapsed = state.timestamp - _emotionChangedAtMs;
  if (elapsed < EMOTION_VALIDATION_DELAY_MS) return;

  const currentFingerprint = _postureFingerprint(pose);
  if (currentFingerprint === _postureBaseline) {
    // Posture has not changed since emotion change — ramp up boost.
    const wasZero = _emotionBoost === 0;
    _emotionBoost = Math.min(EMOTION_BOOST_CAP, _emotionBoost + EMOTION_BOOST_INCREMENT);
    if (wasZero || _emotionBoost >= EMOTION_BOOST_CAP) {
      _selfHealStats.emotionBoostCount++;
      _selfHealStats.syncFixCount++;
      _selfHealStats.updatedAtMs = state.timestamp;
    }
    if (_logEnabled() && state.timestamp - _lastEmotionWarnMs > _cooldown(EMOTION_LOG_COOLDOWN_MS)) {
      _lastEmotionWarnMs = state.timestamp;
      console.warn('[EMOTION_NO_EFFECT]', {
        emotion:           state.emotion,
        emotionRaw:        state.emotionRaw,
        durationMs:        elapsed,
        boostApplied:      +_emotionBoost.toFixed(3),
        boostCap:          EMOTION_BOOST_CAP,
        truthMode:         _isTruthModeEnabled(),
      });
    }
  } else {
    // Posture moved — release boost smoothly.
    _emotionBoost = Math.max(0, _emotionBoost - EMOTION_BOOST_INCREMENT * 0.5);
  }
}

/** Read the current emotion boost (0..EMOTION_BOOST_CAP). */
export function getEmotionBoost(): number {
  return _emotionBoost;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 4 — Intent validation (detect INTENT_LOST + dispatch retrigger)
// ═══════════════════════════════════════════════════════════════════════════

const INTENT_VALIDATION_GRACE_MS  = 800;
const INTENT_RETRIGGER_COOLDOWN_MS = 2000;
const INTENT_LOST_LOG_COOLDOWN_MS  = 3000;

let _intentRequestStartMs: number = 0;
let _lastIntentLostLogMs:  number = -Infinity;
let _lastIntentRetriggerMs: number = -Infinity;

/**
 * PART 4 — Intent validator.  When `intentIntensity > 0.5` and no gesture
 * has been dispatched within ~2 s, logs `[INTENT_LOST]` and (with a 2 s
 * cooldown) emits a `cogni:intent:retrigger` CustomEvent so downstream
 * gesture systems can respond.  Pure observability — never mutates pose.
 */
export function validateIntentEffect(state: BehaviorState): void {
  if (state.intentIntensity <= 0.5) {
    _intentRequestStartMs = 0;
    return;
  }
  if (_intentRequestStartMs === 0) {
    _intentRequestStartMs = state.timestamp;
  }

  const lastGestureMs = getLastGestureDispatchMs();
  const gestureRecent = lastGestureMs > 0 && (state.timestamp - lastGestureMs) < 2000;
  if (gestureRecent) return;

  const sinceIntent = state.timestamp - _intentRequestStartMs;
  if (sinceIntent < INTENT_VALIDATION_GRACE_MS) return; // give the gesture system a moment

  if (_logEnabled() && state.timestamp - _lastIntentLostLogMs > _cooldown(INTENT_LOST_LOG_COOLDOWN_MS)) {
    _lastIntentLostLogMs = state.timestamp;
    console.warn('[INTENT_LOST]', {
      intentIntensity:    +state.intentIntensity.toFixed(3),
      msSinceIntentStart: Math.round(sinceIntent),
      lastGestureMsAgo:   lastGestureMs > 0 ? Math.round(state.timestamp - lastGestureMs) : 'never',
      truthMode:          _isTruthModeEnabled(),
    });
  }

  if (
    typeof window !== 'undefined' &&
    state.timestamp - _lastIntentRetriggerMs > INTENT_RETRIGGER_COOLDOWN_MS
  ) {
    _lastIntentRetriggerMs = state.timestamp;
    _selfHealStats.retriggerCount++;
    _selfHealStats.syncFixCount++;
    _selfHealStats.updatedAtMs = state.timestamp;
    _retriggerTimes.push(state.timestamp);
    window.dispatchEvent(new CustomEvent('cogni:intent:retrigger', {
      detail: {
        intensity: state.intentIntensity,
        timestamp: state.timestamp,
        emotion:   state.emotion,
      },
    }));
    _checkLoopFailure(state.timestamp);
    _detectHiddenFailures(state.timestamp);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 5+6 — Full pipeline health check
// ═══════════════════════════════════════════════════════════════════════════

export interface PipelineValidation {
  status:    'OK' | 'PARTIAL' | 'BROKEN';
  failures:  string[];
  warnings:  string[];
  timestamp: number;
}

let _lastCriticalLogMs: number = -Infinity;

/**
 * Check the integrity of all subsystems.  Always cheap; can be called
 * once per frame without measurable overhead.
 *
 * Failures (status=BROKEN):
 *   • finalPose missing critical keys (head / arms / neck)
 *   • Speaking + critical bones frozen for ≥ freeze threshold
 *
 * Warnings (status=PARTIAL):
 *   • Intent ≥ 0.5 but no gesture dispatched in last 2 s
 *   • Frozen bones present during any active state
 *   • Emotion non-neutral for >2 s with no posture change
 */
export function validateAvatarPipeline(): PipelineValidation {
  const state    = _lastBehaviorState;
  const summary  = getFrameDiagnosticSummary();
  const failures: string[] = [];
  const warnings: string[] = [];
  const now = state?.timestamp ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());

  if (summary.missingPose.length > 0) {
    failures.push('Pose missing critical keys: ' + summary.missingPose.join(', '));
  }

  if (state?.speechActive) {
    const armPattern = /(head|neck|UpperArm|LowerArm|Shoulder|Hand)/i;
    const criticalFrozen = summary.frozenBones.filter((b) => armPattern.test(b));
    if (criticalFrozen.length > 0) {
      failures.push('Speaking but frozen critical bones: ' + criticalFrozen.join(', '));
    }
  }

  if (state && state.intentIntensity > 0.5) {
    const lastGesture = getLastGestureDispatchMs();
    if (lastGesture === 0 || now - lastGesture > 2000) {
      warnings.push('Intent ' + state.intentIntensity.toFixed(2) + ' but no recent gesture');
    }
  }

  if (state && state.emotion !== 'neutral' && _emotionBoost > 0) {
    warnings.push('Emotion "' + state.emotion + '" present without posture response (boost=' + _emotionBoost.toFixed(2) + ')');
  }

  if (summary.frozenBones.length > 0 && state?.speechActive) {
    const remaining = summary.frozenBones.slice(0, 5);
    warnings.push('Frozen bones during speech: ' + remaining.join(', '));
  }

  let status: 'OK' | 'PARTIAL' | 'BROKEN';
  if (failures.length > 0)        status = 'BROKEN';
  else if (warnings.length > 0)   status = 'PARTIAL';
  else                            status = 'OK';

  // PART 6 — surface critical failures in the console (rate-limited).
  if (
    AVATAR_DEBUG &&
    failures.length > 0 &&
    now - _lastCriticalLogMs > 3000
  ) {
    _lastCriticalLogMs = now;
    console.error('[CRITICAL_PIPELINE_FAILURE]', { failures, warnings });
  }

  return { status, failures, warnings, timestamp: now };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 7 — Combined root cause (pose + behavior)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Combine `__boneAuthority`'s pose-level root cause with the behavior-level
 * sync state.  When both layers report problems, returns a merged cause
 * with the higher of the two confidences.
 *
 * PART 5 — MASKED FAILURE DETECTION:
 *   When the visible pipeline appears OK but self-heal counters are
 *   abnormally high (system constantly rescuing itself), the cause is
 *   surfaced as "Motion missing (masked by SYNC_FORCE_INJECTION × N)"
 *   etc.  This prevents auto-fixes from hiding underlying bugs.
 */
export function detectFullRootCause(): RootCause {
  const poseCause   = detectRootCause(getFrameDiagnosticSummary());
  const validation  = validateAvatarPipeline();
  const behaviorOk  = validation.failures.length === 0 && validation.warnings.length === 0;
  const poseOk      = poseCause.cause === 'No issues detected';

  // PART 5 — masked-failure synthesis (only after a brief warm-up so we
  // don't flag the first second of the session).
  const sessionMs   = _now() - _selfHealStats.startedAtMs;
  const sessionMin  = Math.max(1 / 60, sessionMs / 60000);
  const injectionRate  = _selfHealStats.injectionCount  / sessionMin; // per minute
  const correctionRate = _selfHealStats.correctionCount / sessionMin;
  const retriggerRate  = _selfHealStats.retriggerCount  / sessionMin;
  const masked: string[] = [];
  if (sessionMs > 5000) {
    if (injectionRate >= 30) {
      masked.push(
        'Motion missing (masked by SYNC_FORCE_INJECTION × ' +
        _selfHealStats.injectionCount + ', ~' +
        injectionRate.toFixed(1) + '/min)',
      );
    }
    if (correctionRate >= 6) {
      masked.push(
        'Audio-motion clock unstable (masked by SYNC_CORRECTED × ' +
        _selfHealStats.correctionCount + ', ~' +
        correctionRate.toFixed(1) + '/min)',
      );
    }
    if (retriggerRate >= 4) {
      masked.push(
        'Gesture system unresponsive (masked by intent retriggers × ' +
        _selfHealStats.retriggerCount + ', ~' +
        retriggerRate.toFixed(1) + '/min)',
      );
    }
  }

  // Build base cause first
  let base: RootCause;
  if (poseOk && behaviorOk) {
    base = { cause: 'No issues detected', confidence: 'high' };
  } else if (!poseOk && behaviorOk) {
    base = poseCause;
  } else {
    const behaviorCause =
      validation.failures.length > 0
        ? 'Behavior desynchronization: ' + validation.failures.join('; ')
        : 'Behavior partial-sync: ' + validation.warnings.join('; ');
    if (poseOk) {
      base = {
        cause:      behaviorCause,
        confidence: validation.failures.length > 0 ? 'high' : 'medium',
      };
    } else {
      base = {
        cause:      poseCause.cause + ' | ' + behaviorCause,
        confidence: validation.failures.length > 0 || poseCause.confidence === 'high' ? 'high' : 'medium',
      };
    }
  }

  if (masked.length === 0) return base;
  // Masked failures override "No issues detected" — that's the whole point.
  if (base.cause === 'No issues detected') {
    return { cause: masked.join(' | '), confidence: 'high' };
  }
  // Otherwise append.
  return {
    cause:      base.cause + ' | MASKED: ' + masked.join(' | '),
    confidence: 'high',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 6 — Stability score (0..100)
// ═══════════════════════════════════════════════════════════════════════════

export interface StabilityScore {
  score:   number;                                              // 0..100
  verdict: 'stable' | 'masked' | 'fragile' | 'broken';
  factors: {
    sessionSec:       number;
    injectionRate:    number;   // per minute
    correctionRate:   number;
    retriggerRate:    number;
    frozenBoneCount:  number;
    failureCount:     number;
    selfHealReliance: number;   // 0..1 — share of frames "rescued"
  };
}

/**
 * Compute an integer-valued stability score [0..100].
 *
 *   Penalties:
 *     -0.5  per force-injection per minute (cap 40)
 *     -4    per sync correction per minute (cap 20)
 *     -5    per intent retrigger per minute (cap 25)
 *     -5    per frozen critical bone (cap 15)
 *     -20   per active pipeline failure (cap 40)
 *     -20   when at least one [HIDDEN_FAILURE] has fired (cap 20)
 *
 *   Verdict ladder:
 *     score ≥ 80  AND ≤ 5 self-heal events/min  → 'stable'
 *     score ≥ 60                                → 'masked'   (auto-fixes carrying the system)
 *     score ≥ 30                                → 'fragile'
 *     anything below or active failures present → 'broken'
 */
export function getStabilityScore(): StabilityScore {
  const summary    = getFrameDiagnosticSummary();
  const validation = validateAvatarPipeline();
  const sessionMs  = Math.max(1, _now() - _selfHealStats.startedAtMs);
  const sessionSec = sessionMs / 1000;
  const sessionMin = sessionMs / 60000;

  const injectionRate  = _selfHealStats.injectionCount  / Math.max(1 / 60, sessionMin);
  const correctionRate = _selfHealStats.correctionCount / Math.max(1 / 60, sessionMin);
  const retriggerRate  = _selfHealStats.retriggerCount  / Math.max(1 / 60, sessionMin);

  let score = 100;
  score -= Math.min(40, injectionRate  * 0.5);
  score -= Math.min(20, correctionRate * 4);
  score -= Math.min(25, retriggerRate  * 5);
  score -= Math.min(15, summary.frozenBones.length * 5);
  score -= Math.min(40, validation.failures.length * 20);
  if (_selfHealStats.hiddenFailures > 0) score -= 20;
  if (_selfHealStats.loopFailures   > 0) score -= 20;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const totalSelfHealsPerMin = injectionRate + correctionRate + retriggerRate;
  const selfHealReliance = Math.min(1, totalSelfHealsPerMin / 60); // 60/min = 1.0

  let verdict: 'stable' | 'masked' | 'fragile' | 'broken';
  if (validation.failures.length > 0 || _selfHealStats.loopFailures > 0) {
    verdict = 'broken';
  } else if (score >= 80 && totalSelfHealsPerMin <= 5) {
    verdict = 'stable';
  } else if (score >= 60) {
    verdict = 'masked';
  } else if (score >= 30) {
    verdict = 'fragile';
  } else {
    verdict = 'broken';
  }

  return {
    score,
    verdict,
    factors: {
      sessionSec:       +sessionSec.toFixed(1),
      injectionRate:    +injectionRate.toFixed(2),
      correctionRate:   +correctionRate.toFixed(2),
      retriggerRate:    +retriggerRate.toFixed(2),
      frozenBoneCount:  summary.frozenBones.length,
      failureCount:     validation.failures.length,
      selfHealReliance: +selfHealReliance.toFixed(3),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 9 — Test mode (window.__AVATAR_TEST_MODE)
// ═══════════════════════════════════════════════════════════════════════════

let _testTickIntervalId: ReturnType<typeof setInterval> | null = null;
let _testWatcherIntervalId: ReturnType<typeof setInterval> | null = null;

type TestMode = false | true | 'extreme';

function _readTestMode(): TestMode {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (window as any).__AVATAR_TEST_MODE;
  if (v === 'extreme') return 'extreme';
  return v === true;
}

function _isTestModeEnabled(): boolean {
  return _readTestMode() !== false;
}

function _startTestMode(): void {
  if (_testTickIntervalId !== null || typeof window === 'undefined') return;
  const extreme  = _readTestMode() === 'extreme';
  const tickMs   = extreme ? 200 : 500;
  console.warn('[TEST_MODE] Started — ' + (extreme ? 'EXTREME mode (rapid bursts + conflicting intents)' : 'normal') + ' — tick = ' + tickMs + ' ms');
  let cycle      = 0;
  let isSpeaking = false;
  _testTickIntervalId = setInterval(() => {
    const mode = _readTestMode();
    if (mode === false) {
      _stopTestMode();
      return;
    }
    cycle = (cycle + 1) % 16;

    if (mode === 'extreme') {
      // ── EXTREME mode: rapid speech bursts every cycle ──
      // 200ms tick × 4 cycles = 800ms speak / 200ms gap loops.
      if (cycle % 4 === 0 && !isSpeaking) {
        window.dispatchEvent(new CustomEvent('avatar:speak:start', { detail: { source: 'test-mode-extreme' } }));
        isSpeaking = true;
      } else if (cycle % 4 === 3 && isSpeaking) {
        window.dispatchEvent(new CustomEvent('avatar:speak:end', { detail: { source: 'test-mode-extreme' } }));
        isSpeaking = false;
      }
      // Emotion swaps every ~1 s (cycle 0, 5, 10, 15).
      if (cycle % 5 === 0) {
        const emotions: BehaviorEmotion[] = ['happy', 'serious', 'excited', 'neutral'];
        const e = emotions[Math.floor(Math.random() * emotions.length)];
        window.dispatchEvent(new CustomEvent('avatar:emotion', {
          detail: { emotion: e, strength: 0.7 + Math.random() * 0.3, source: 'test-mode-extreme' },
        }));
      }
      // ── Conflicting intents — fire two opposing intents in same tick ──
      if (cycle % 7 === 0) {
        window.dispatchEvent(new CustomEvent('avatar:gesture', {
          detail: { type: 'openHand',     side: 'right', duration: 1, source: 'test-mode-extreme' },
        }));
        window.dispatchEvent(new CustomEvent('avatar:gesture', {
          detail: { type: 'pointForward', side: 'left',  duration: 1, source: 'test-mode-extreme' },
        }));
      }
      return;
    }

    // ── Normal mode: speak from cycle 0..3, idle 4..7, speak 8..11, idle 12..15 ──
    if ((cycle === 0 || cycle === 8) && !isSpeaking) {
      window.dispatchEvent(new CustomEvent('avatar:speak:start', { detail: { source: 'test-mode' } }));
      isSpeaking = true;
    } else if ((cycle === 4 || cycle === 12) && isSpeaking) {
      window.dispatchEvent(new CustomEvent('avatar:speak:end', { detail: { source: 'test-mode' } }));
      isSpeaking = false;
    }
    // Emotion switch every ~3 s (cycle 0 and 6).
    if (cycle === 0 || cycle === 6) {
      const emotions: BehaviorEmotion[] = ['happy', 'serious', 'excited', 'neutral'];
      const e = emotions[Math.floor(Math.random() * emotions.length)];
      window.dispatchEvent(new CustomEvent('avatar:emotion', {
        detail: { emotion: e, strength: 0.6 + Math.random() * 0.3, source: 'test-mode' },
      }));
    }
  }, tickMs);
}

function _stopTestMode(): void {
  if (_testTickIntervalId === null) return;
  clearInterval(_testTickIntervalId);
  _testTickIntervalId = null;
  console.warn('[TEST_MODE] Stopped');
  if (typeof window !== 'undefined') {
    // Always end with speak:end so we don't leave the avatar permanently speaking.
    window.dispatchEvent(new CustomEvent('avatar:speak:end', { detail: { source: 'test-mode' } }));
  }
}

let _lastTestModeSeen: TestMode = false;

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__AVATAR_TEST_MODE = w.__AVATAR_TEST_MODE ?? false;
  w.__AVATAR_TRUTH_MODE = w.__AVATAR_TRUTH_MODE ?? false;
  // Watch the flag and start/stop the simulator accordingly.  Mode changes
  // (true → 'extreme' or vice versa) trigger a restart so the new tick-rate
  // takes effect.
  if (_testWatcherIntervalId === null) {
    _testWatcherIntervalId = setInterval(() => {
      const current = _readTestMode();
      if (current !== _lastTestModeSeen) {
        if (_testTickIntervalId !== null) _stopTestMode();
        _lastTestModeSeen = current;
      }
      if (current !== false && _testTickIntervalId === null) _startTestMode();
      if (current === false && _testTickIntervalId !== null) _stopTestMode();
    }, 1000);
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// PART 10 — Behavior Engine → motionState scalars (multiplicative blend only)
// ═══════════════════════════════════════════════════════════════════════════

let _lastBehaviorEngineLogMs = -Infinity;
const BEHAVIOR_ENGINE_LOG_MS = 450;

let _lastTimingPhaseLogMs = -Infinity;
const TIMING_PHASE_LOG_MS = 380;

let _lastPipelineTraceMs = -Infinity;
const PIPELINE_TRACE_MS = 500;
let _lastOverrideLogMs = -Infinity;
const OVERRIDE_LOG_MS = 600;
let _lastMotionZeroLogMs = -Infinity;
const MOTION_ZERO_LOG_MS = 600;
let _lastMotionGuardLogMs = -Infinity;
const MOTION_GUARD_LOG_MS = 600;

/** Counters surfaced via `window.__avatarMotionGuardStats` for tests / overlay. */
const _guardStats = {
  motionZero: 0,
  behaviorKilled: 0,
  timingKilled: 0,
  finalOverride: 0,
  guardApplied: 0,
  settlingClamped: 0,
};

/** Effective-zero threshold for motion scalars (avoids float-noise false negatives). */
const _MOTION_EPS = 0.0005;

function _energy(m: { headNod: number; openGesture: number }): number {
  return Math.abs(m.headNod) + Math.abs(m.openGesture);
}

/** Linear interpolation of a clamp floor based on intensity (0..1). */
function _dynamicFloor(intensity01: number, lo: number, hi: number): number {
  const i = Math.max(0, Math.min(1, intensity01));
  return lo + (hi - lo) * i;
}

/**
 * Smooth two-octave sinusoidal noise in ~[0.9, 1.1].
 * Avoids per-frame rng jitter (which would buzz the rig); coupled to monotonic clock so
 * head and arm channels can be desynchronised by `phaseOffset`.
 */
function _variationMul(now: number, phaseOffset: number): number {
  const a = Math.sin(now * 0.0023 + phaseOffset);
  const b = Math.sin(now * 0.0037 + phaseOffset + 1.7);
  const n = (a + b) * 0.5;
  return 1 + 0.1 * n;
}

/**
 * Multiplies existing `__cogniMotionState` scalars after intent/speech baseline — never replaces them.
 * Keeps VRMSkeletonManager as the sole writer of the base kinematic intent; this layer only biases energy.
 *
 * Pipeline observability + safety guards (additive, non-destructive):
 *   1. Snapshot motion at each stage: base → afterBehavior → afterTiming → final.
 *   2. Detect layer overrides ([BEHAVIOR_KILLED_MOTION] / [TIMING_KILLED_MOTION] / [FINAL_OVERRIDE]).
 *   3. Clamp `settling` floor so timing falloff cannot drive motion to absolute zero.
 *   4. Final motion guard — inject `_GUARD_FLOOR` if speaking but motion still zero.
 */
export function mergeBehaviorEngineMotionScalars(
  motion: { headNod: number; headTilt: number; openGesture: number },
  opts: { speaking: boolean; intent: string; emotion: string; intensity: number },
): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const baseMotion = { headNod: motion.headNod, openGesture: motion.openGesture };
  const baseEnergy = _energy(baseMotion);

  const input: BehaviorInput = {
    speaking: opts.speaking,
    intent: opts.intent ?? '',
    emotion: opts.emotion ?? '',
    intensity: Math.max(0, Math.min(1, opts.intensity)),
  };
  const plan: BehaviorEnginePlan = computeBehavior(input);
  const mul = behaviorToMotion(plan);
  motion.headNod *= mul.headNod;
  motion.openGesture *= mul.openGesture;

  const afterBehavior = { headNod: motion.headNod, openGesture: motion.openGesture };
  const afterBehaviorEnergy = _energy(afterBehavior);

  const timing = computeTimingState({ speaking: opts.speaking, now });
  applyTimingToMotion(motion, timing, now);

  // PART 2 — variation noise: keeps motion alive without robotic constancy.
  const jitterHead = _variationMul(now, 0);
  const jitterGesture = _variationMul(now, 1.3);
  motion.headNod *= jitterHead;
  motion.openGesture *= jitterGesture;

  // PART 3 — speech-intensity link: above ~0.35 intent intensity, modestly amplify motion.
  // Final clamp by `_VIS_AMP` block in VRMSkeletonManager prevents over-shoot.
  const intensity01 = Math.max(0, Math.min(1, opts.intensity));
  const speechBoost = 1 + 0.28 * Math.max(0, intensity01 - 0.35);
  motion.headNod *= speechBoost;
  motion.openGesture *= speechBoost;

  // PART 1 — dynamic floors (lerp(0.02, 0.08, intensity) for guard; tighter for settling).
  const settlingFloor = _dynamicFloor(intensity01, 0.015, 0.04);
  const guardFloor = _dynamicFloor(intensity01, 0.02, 0.08);

  if (timing.phase === 'settling' && opts.speaking === false) {
    if (Math.abs(motion.headNod) < settlingFloor) {
      motion.headNod = motion.headNod >= 0 ? settlingFloor : -settlingFloor;
      _guardStats.settlingClamped += 1;
    }
    if (motion.openGesture < settlingFloor) {
      motion.openGesture = settlingFloor;
      _guardStats.settlingClamped += 1;
    }
  }

  const afterTiming = { headNod: motion.headNod, openGesture: motion.openGesture };
  const afterTimingEnergy = _energy(afterTiming);

  let guardApplied = false;
  if (opts.speaking && afterTimingEnergy <= _MOTION_EPS) {
    motion.headNod = motion.headNod === 0 ? guardFloor : motion.headNod;
    motion.openGesture = motion.openGesture === 0 ? guardFloor : motion.openGesture;
    if (Math.abs(motion.headNod) < guardFloor) {
      motion.headNod = motion.headNod >= 0 ? guardFloor : -guardFloor;
    }
    if (motion.openGesture < guardFloor) motion.openGesture = guardFloor;
    guardApplied = true;
    _guardStats.guardApplied += 1;
  }

  const finalMotion = { headNod: motion.headNod, openGesture: motion.openGesture };
  const finalEnergy = _energy(finalMotion);

  const behaviorKilled =
    baseEnergy > _MOTION_EPS && afterBehaviorEnergy <= _MOTION_EPS;
  const timingKilled =
    afterBehaviorEnergy > _MOTION_EPS && afterTimingEnergy <= _MOTION_EPS;
  const finalOverride =
    afterTimingEnergy > _MOTION_EPS && finalEnergy <= _MOTION_EPS;
  if (behaviorKilled) _guardStats.behaviorKilled += 1;
  if (timingKilled) _guardStats.timingKilled += 1;
  if (finalOverride) _guardStats.finalOverride += 1;

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__behaviorEnginePlan = plan;
    w.__behaviorEngineMotionMul = mul;
    w.__behaviorTimingState = timing;
    w.__avatarMotionGuardStats = _guardStats;
    w.__avatarLastPipelineMotion = {
      base: baseMotion,
      afterBehavior,
      afterTiming,
      final: finalMotion,
    };
  }

  if (_logEnabled()) {
    if (now - _lastPipelineTraceMs > _cooldown(PIPELINE_TRACE_MS)) {
      _lastPipelineTraceMs = now;
      console.log('[PIPELINE_TRACE]', {
        speaking: opts.speaking,
        intent: input.intent || '(none)',
        emotion: input.emotion || 'neutral',
        timingPhase: timing.phase,
        motion: {
          base:           { hn: +baseMotion.headNod.toFixed(3),     og: +baseMotion.openGesture.toFixed(3) },
          afterBehavior:  { hn: +afterBehavior.headNod.toFixed(3),  og: +afterBehavior.openGesture.toFixed(3) },
          afterTiming:    { hn: +afterTiming.headNod.toFixed(3),    og: +afterTiming.openGesture.toFixed(3) },
          final:          { hn: +finalMotion.headNod.toFixed(3),    og: +finalMotion.openGesture.toFixed(3) },
        },
      });
    }

    if (
      opts.speaking &&
      finalEnergy <= _MOTION_EPS &&
      now - _lastMotionZeroLogMs > _cooldown(MOTION_ZERO_LOG_MS)
    ) {
      _lastMotionZeroLogMs = now;
      _guardStats.motionZero += 1;
      console.error('[MOTION_ZERO_ERROR]', {
        speaking: opts.speaking,
        baseEnergy: +baseEnergy.toFixed(3),
        afterBehaviorEnergy: +afterBehaviorEnergy.toFixed(3),
        afterTimingEnergy: +afterTimingEnergy.toFixed(3),
        finalEnergy: +finalEnergy.toFixed(3),
        timingPhase: timing.phase,
      });
    }

    if (
      (behaviorKilled || timingKilled || finalOverride) &&
      now - _lastOverrideLogMs > _cooldown(OVERRIDE_LOG_MS)
    ) {
      _lastOverrideLogMs = now;
      if (behaviorKilled) console.warn('[BEHAVIOR_KILLED_MOTION]', { base: baseMotion, afterBehavior });
      if (timingKilled)   console.warn('[TIMING_KILLED_MOTION]',   { afterBehavior, afterTiming, phase: timing.phase });
      if (finalOverride)  console.warn('[FINAL_OVERRIDE]',         { afterTiming, final: finalMotion });
    }

    if (guardApplied && now - _lastMotionGuardLogMs > _cooldown(MOTION_GUARD_LOG_MS)) {
      _lastMotionGuardLogMs = now;
      console.warn('[MOTION_GUARD_APPLIED]', {
        speaking: opts.speaking,
        injectedHeadNod: +motion.headNod.toFixed(3),
        injectedOpenGesture: +motion.openGesture.toFixed(3),
      });
    }
  }

  if (_logEnabled() && now - _lastBehaviorEngineLogMs > _cooldown(BEHAVIOR_ENGINE_LOG_MS)) {
    _lastBehaviorEngineLogMs = now;
    console.log('[BEHAVIOR_STATE]', {
      intent: input.intent || '(none)',
      emotion: input.emotion || 'neutral',
      gestureStyle: plan.gestureStyle,
      headMul: +mul.headNod.toFixed(3),
      armMul: +mul.openGesture.toFixed(3),
      speaking: input.speaking,
    });
  }

  if (_logEnabled() && now - _lastTimingPhaseLogMs > _cooldown(TIMING_PHASE_LOG_MS)) {
    _lastTimingPhaseLogMs = now;
    console.log('[TIMING_PHASE]', {
      phase: timing.phase,
      duration: timing.duration,
    });
  }
}

export function getMotionGuardStats(): Readonly<typeof _guardStats> {
  return _guardStats;
}

// ── Window helpers ────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__avatarBehaviorState     = getLastBehaviorState;
  w.__avatarSyncStatus        = getSyncStatus;
  w.__validateAvatarPipeline  = validateAvatarPipeline;
  w.__avatarFullRootCause     = detectFullRootCause;
  w.__avatarEmotionBoost      = getEmotionBoost;
  // Truth-mode diagnostics
  w.__avatarSelfHealStats     = getSelfHealStats;
  w.__avatarStabilityScore    = getStabilityScore;
  w.__avatarResetSelfHealStats = resetSelfHealStats;
  w.__avatarGetMotionGuardStats = getMotionGuardStats;
}
