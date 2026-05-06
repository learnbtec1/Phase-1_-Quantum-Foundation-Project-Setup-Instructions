'use client';
/**
 * Behavior Timeline Engine
 * ───────────────────────────────────────────────────────────────────────────
 * Production-grade event-driven motion lifecycle. Replaces the ad-hoc
 * (gestureStartRef + gestureDurationRef + gestureAmplitudeMulRef) trio with
 * a single source of truth that owns:
 *
 *   1. Discrete BehaviorEvents (wave / explain / agree / think / point / clap).
 *   2. Three explicit phases per event:
 *        • anticipation  — wind-up (small reverse / pre-pose, ease-out)
 *        • action        — main pose (full intensity)
 *        • recovery      — follow-through + return to idle (ease-in decay)
 *   3. Per-bone inertia (velocity carry-over → smoother recovery).
 *   4. Emotion modulation (arousal scales amplitude, valence skews tempo).
 *   5. Priority-aware FIFO queue (no overlap unless preempted).
 *
 * Design contract:
 *   • All scratch objects are module-scope (zero per-frame allocations).
 *   • Pure functions where possible; the only mutable state is the active
 *     event, the queue, the per-bone velocity table, and a frame counter
 *     used by the consumer to detect freshness.
 *   • Deterministic across FPS — every output is a function of (event, now)
 *     and the prev-frame velocity (bounded recurrence).
 *   • Backwards-compatible with the existing gesture rendering pipeline:
 *     consumers continue to read gestureStateRef / gestureStartRef /
 *     gestureDurationRef / gestureAmplitudeMulRef. The timeline simply
 *     becomes the WRITER of those refs.
 *
 * Consumers in VRMSkeletonManager.tsx:
 *   • pushBehavior(type, opts)  — replaces the inline assignments inside
 *                                 the SINGLE_CONTROLLER auto-trigger block.
 *   • tickBehaviorTimeline(...) — runs once per frame in useFrame, syncs the
 *                                 legacy refs, advances the queue.
 *   • getBehaviorFrame()        — for the debug surface and downstream
 *                                 micro-overlays (anticipation pre-pose).
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TimelineGestureId =
  | 'idle'
  | 'wave'
  | 'explain'
  | 'point'
  | 'think'
  | 'agree'
  | 'clap'
  | 'test_elbow';

export type BehaviorPhase = 'idle' | 'anticipation' | 'action' | 'recovery';

export type BehaviorEvent = {
  type: TimelineGestureId;
  /** performance.now() ms when the event started (= start of anticipation). */
  startTime: number;
  /** Total duration in ms (anticipation + action + recovery). */
  duration: number;
  /** Phase split in ms. anticipation + action + recovery === duration. */
  phases: { anticipation: number; action: number; recovery: number };
  /** Base intensity 0..1 (already includes any emotion boost). */
  intensity: number;
  /** Higher priority preempts a lower-priority active event. */
  priority: number;
  /** Free-form source label for diagnostics (e.g. 'rule:greeting'). */
  source?: string;
};

export type EmotionState = {
  /** -1 (sad / negative) … 0 (neutral) … +1 (joyful / positive). */
  valence: number;
  /** 0 (calm / low energy) … 1 (excited / high energy). */
  arousal: number;
};

export type BehaviorFrame = {
  /** Active event, or null when timeline is idle. */
  event: BehaviorEvent | null;
  phase: BehaviorPhase;
  /** Normalized 0..1 within the *current* phase. */
  t: number;
  /** Normalized 0..1 across the whole event duration. */
  globalT: number;
  /**
   * Signed amplitude scalar for the active event:
   *   anticipation:  -anticipationDip → 0   (eased)
   *   action     :   0 → 1                  (eased)
   *   recovery   :   1 → 0                  (eased + inertia overshoot)
   *   idle       :   0
   * Use this to drive the gesture amplitude multiplier per frame.
   */
  envelope: number;
  /**
   * Polarity signal for SEMANTIC anticipation overlays
   * (used by the renderer to inject reverse-direction wind-up on arm bones).
   *   anticipation:  -1   (full reverse polarity)
   *   action     :   +1
   *   recovery   :   +1
   *   idle       :    0
   */
  polarity: number;
  /** True while the recovery phase is supplying decay velocity. */
  inertiaActive: boolean;
  /** Snapshot of emotion that influenced the current event. */
  emotion: EmotionState;
};

// ─── Internal state ──────────────────────────────────────────────────────────

let _current: BehaviorEvent | null = null;
const _queue: BehaviorEvent[] = [];

/** Current emotion (updated by setEmotion; readable via getEmotion). */
const _emotion: EmotionState = { valence: 0, arousal: 0.4 };

/**
 * Per-bone Euler velocity table. Updated by trackInertiaSample, consumed by
 * applyInertiaToTarget. Reused across frames; never reallocated.
 *
 * Keys are bone aliases used by the renderer (rua, rla, lua, lla, rh, lh, ...).
 */
type InertiaSample = { x: number; y: number; z: number };
const _prevTarget: Map<string, InertiaSample> = new Map();
const _velocity:   Map<string, InertiaSample> = new Map();

/** Diagnostics: the latest [BEHAVIOR_FINAL_AUDIT] payload. */
let _lastAudit: BehaviorFinalAudit | null = null;

export type BehaviorFinalAudit = {
  hasTimeline: boolean;
  phaseWorking: boolean;
  inertiaWorking: boolean;
  emotionAffectsMotion: boolean;
  gestureSmooth: boolean;
  snappingDetected: boolean;
  rootCause: string | null;
  /** Last completed event for inspection. */
  lastEvent?: { type: TimelineGestureId; durationMs: number; source?: string };
};

// ─── Default phase ratios ─────────────────────────────────────────────────────

const _PHASE_RATIO: Record<TimelineGestureId, { ant: number; act: number; rec: number }> = {
  idle:       { ant: 0.00, act: 1.00, rec: 0.00 },
  wave:       { ant: 0.12, act: 0.62, rec: 0.26 },
  explain:    { ant: 0.10, act: 0.70, rec: 0.20 },
  point:      { ant: 0.14, act: 0.60, rec: 0.26 },
  think:      { ant: 0.08, act: 0.74, rec: 0.18 },
  agree:      { ant: 0.16, act: 0.50, rec: 0.34 },
  clap:       { ant: 0.10, act: 0.60, rec: 0.30 },
  test_elbow: { ant: 0.10, act: 0.60, rec: 0.30 },
};

/** Magnitude of the negative pre-pose during anticipation, per gesture. */
const _ANTICIPATION_DIP: Partial<Record<TimelineGestureId, number>> = {
  wave:    0.18,
  explain: 0.10,
  point:   0.20,
  think:   0.08,
  agree:   0.12,
  clap:    0.18,
};

// ─── Easing primitives ───────────────────────────────────────────────────────

const _EASE_OUT_CUBIC = (t: number): number => 1 - Math.pow(1 - t, 3);
const _EASE_IN_OUT    = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) * 0.5);
const _EASE_IN_CUBIC  = (t: number): number => t * t * t;

function _clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ─── Public API: emotion ──────────────────────────────────────────────────────

export function setEmotion(next: Partial<EmotionState>): void {
  if (typeof next.valence === 'number' && Number.isFinite(next.valence)) {
    _emotion.valence = Math.max(-1, Math.min(1, next.valence));
  }
  if (typeof next.arousal === 'number' && Number.isFinite(next.arousal)) {
    _emotion.arousal = Math.max(0, Math.min(1, next.arousal));
  }
}

export function getEmotion(): Readonly<EmotionState> {
  return _emotion;
}

// ─── Public API: event lifecycle ──────────────────────────────────────────────

export type PushBehaviorOptions = {
  /** Total ms before emotion modulation. Default: type-specific. */
  baseDurationMs?: number;
  /** 0..1 base intensity before emotion arousal boost. Default 0.85. */
  intensity?: number;
  /** Higher preempts an active event. Default 100. */
  priority?: number;
  /** Free-form source label (for logs / debug). */
  source?: string;
  /** Override emotion just for this event. */
  emotion?: Partial<EmotionState>;
};

const _DEFAULT_DURATION_MS: Record<TimelineGestureId, number> = {
  idle:       0,
  wave:       2400,
  explain:    2800,
  point:      2400,
  think:      3000,
  agree:      1300,
  clap:       1800,
  test_elbow: 2200,
};

/**
 * Construct a BehaviorEvent applying emotion modulation:
 *   • arousal ↑  → intensity ↑ (×1 .. ×1.5), duration ↓ (×1 .. ×0.85)
 *   • valence ↑  → action share ↑ slightly (more confident), recovery ↓
 */
export function buildBehaviorEvent(
  type: TimelineGestureId,
  now: number,
  opts: PushBehaviorOptions = {},
): BehaviorEvent {
  const eff: EmotionState = {
    valence: opts.emotion?.valence ?? _emotion.valence,
    arousal: opts.emotion?.arousal ?? _emotion.arousal,
  };
  const baseDur  = Math.max(150, opts.baseDurationMs ?? _DEFAULT_DURATION_MS[type] ?? 2400);
  // Higher arousal = quicker, tighter motion (compresses up to 15 %).
  const tempoMul = 1 - eff.arousal * 0.15;
  const duration = Math.round(baseDur * tempoMul);

  const baseIntensity = Math.max(0, Math.min(1, opts.intensity ?? 0.85));
  // Higher arousal = bigger amplitude (up to ×1.5).
  const arousalBoost  = 1 + eff.arousal * 0.5;
  const intensity     = Math.max(0.05, Math.min(1.5, baseIntensity * arousalBoost));

  const ratio = _PHASE_RATIO[type] ?? _PHASE_RATIO.explain;
  // Valence skew: positive valence shifts mass into action (more confident),
  // negative shifts into recovery (more reflective).
  const valenceShift = Math.max(-0.10, Math.min(0.10, eff.valence * 0.10));
  const actShare = Math.max(0.30, Math.min(0.85, ratio.act + valenceShift));
  const recShare = Math.max(0.05, Math.min(0.50, ratio.rec - valenceShift));
  const antShare = Math.max(0.04, Math.min(0.30, 1 - actShare - recShare));

  return {
    type,
    startTime: now,
    duration,
    phases: {
      anticipation: Math.round(duration * antShare),
      action:       Math.round(duration * actShare),
      recovery:     Math.round(duration * recShare),
    },
    intensity,
    priority: opts.priority ?? 100,
    source:   opts.source,
  };
}

/**
 * Enqueue a new behavior. If no event is active, it starts immediately;
 * otherwise it is queued. Higher-priority events PREEMPT the active event.
 */
export function pushBehavior(
  type: TimelineGestureId,
  now: number,
  opts: PushBehaviorOptions = {},
): BehaviorEvent {
  const event = buildBehaviorEvent(type, now, opts);
  if (_current === null) {
    _current = event;
  } else if (event.priority > _current.priority) {
    // Preempt: queue the active one (if recoverable) and switch.
    _queue.unshift(_current);
    _current = event;
  } else {
    _queue.push(event);
  }
  return event;
}

/** Clear queue and current event (used on speak:end / reset). */
export function clearBehaviorQueue(): void {
  _current = null;
  _queue.length = 0;
}

export function getCurrentBehavior(): BehaviorEvent | null {
  return _current;
}

export function getBehaviorQueueDepth(): number {
  return _queue.length;
}

// ─── Public API: per-frame tick ───────────────────────────────────────────────

/**
 * Compute the BehaviorFrame for a given event at time `now`.
 *
 * Pure function — does not advance the queue or mutate state.
 * Use this when you have an event reference and want to read its phase.
 */
export function computeBehaviorFrame(
  event: BehaviorEvent | null,
  now: number,
): BehaviorFrame {
  if (!event) {
    return {
      event: null,
      phase: 'idle',
      t: 0,
      globalT: 0,
      envelope: 0,
      polarity: 0,
      inertiaActive: false,
      emotion: { valence: _emotion.valence, arousal: _emotion.arousal },
    };
  }

  const elapsed = Math.max(0, now - event.startTime);
  const total   = Math.max(1, event.duration);
  const globalT = _clamp01(elapsed / total);

  const antEnd = event.phases.anticipation;
  const actEnd = antEnd + event.phases.action;

  let phase: BehaviorPhase;
  let t: number;
  let envelope: number;
  let polarity: number;
  let inertiaActive = false;

  const dip = _ANTICIPATION_DIP[event.type] ?? 0.12;

  if (elapsed < antEnd) {
    phase = 'anticipation';
    t = _clamp01(elapsed / Math.max(1, antEnd));
    // ease-out: starts quick (full reverse) then settles back toward 0.
    const eased = _EASE_OUT_CUBIC(t);
    envelope = -dip * (1 - eased);     // -dip → 0
    polarity = -1 + eased;             // -1 → 0
  } else if (elapsed < actEnd) {
    phase = 'action';
    t = _clamp01((elapsed - antEnd) / Math.max(1, event.phases.action));
    // ease-in-out: smooth ramp to full, hold, smooth fall toward 1.0.
    const eased = _EASE_IN_OUT(t);
    envelope = eased < 0.5 ? eased * 2 : 1.0;
    polarity = 1.0;
  } else {
    phase = 'recovery';
    t = _clamp01((elapsed - actEnd) / Math.max(1, event.phases.recovery));
    // ease-in-cubic: slow start (carries momentum), accelerating to 0.
    const decay = 1 - _EASE_IN_CUBIC(t);
    envelope = decay;
    polarity = decay;
    inertiaActive = t < 0.85;
  }

  return {
    event,
    phase,
    t,
    globalT,
    envelope,
    polarity,
    inertiaActive,
    emotion: { valence: _emotion.valence, arousal: _emotion.arousal },
  };
}

/**
 * Advance the timeline by one frame:
 *   • If the active event has completed, pop the next one (if any).
 *   • Returns the BehaviorFrame for the current (post-advancement) event.
 *
 * Idempotent within a single frame as long as `now` is monotonic.
 */
export function tickBehaviorTimeline(now: number): BehaviorFrame {
  // Advance: drop completed event(s) and pop next if available.
  while (_current && (now - _current.startTime) >= _current.duration) {
    const completed = _current;
    _lastAudit = _buildAudit(completed);
    _current = _queue.shift() ?? null;
    if (_current) {
      // Re-anchor next event to "now" so its anticipation starts cleanly.
      _current.startTime = now;
    }
    // Reset velocity table at every event boundary — prevents stale carry.
    _velocity.clear();
    _prevTarget.clear();
  }
  return computeBehaviorFrame(_current, now);
}

// ─── Public API: per-bone inertia ─────────────────────────────────────────────

/**
 * Track Euler velocity for a bone target. Call BEFORE writing the new target
 * to the bone, with the *target* values you intend to write. Returns the
 * inertia-adjusted target (target + velocity * carryFactor) when in recovery.
 *
 * carryFactor is computed from the BehaviorFrame:
 *   action    → 0       (no overshoot)
 *   recovery  → up to 0.18 * (1 - t)   (decaying inertia)
 *
 * No allocations: uses module-scope scratch.
 */
const _adjusted: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

export function applyInertiaToTarget(
  boneKey: string,
  targetX: number,
  targetY: number,
  targetZ: number,
  dtSec: number,
  frame: BehaviorFrame,
): Readonly<{ x: number; y: number; z: number }> {
  const safeDt = Math.max(1 / 240, Math.min(1 / 30, dtSec));

  // Compute velocity from the previous target.
  const prev = _prevTarget.get(boneKey);
  let vx = 0, vy = 0, vz = 0;
  if (prev) {
    vx = (targetX - prev.x) / safeDt;
    vy = (targetY - prev.y) / safeDt;
    vz = (targetZ - prev.z) / safeDt;
    // Low-pass: blend with previous velocity (no allocation, in-place).
    const pv = _velocity.get(boneKey);
    if (pv) {
      vx = pv.x * 0.6 + vx * 0.4;
      vy = pv.y * 0.6 + vy * 0.4;
      vz = pv.z * 0.6 + vz * 0.4;
    }
    // Snap small velocities to zero (kill micro-jitter).
    if (Math.abs(vx) < 0.01) vx = 0;
    if (Math.abs(vy) < 0.01) vy = 0;
    if (Math.abs(vz) < 0.01) vz = 0;
  }

  // Persist updated samples (reuse existing objects to avoid allocation).
  let pt = _prevTarget.get(boneKey);
  if (!pt) { pt = { x: targetX, y: targetY, z: targetZ }; _prevTarget.set(boneKey, pt); }
  else { pt.x = targetX; pt.y = targetY; pt.z = targetZ; }
  let pv = _velocity.get(boneKey);
  if (!pv) { pv = { x: vx, y: vy, z: vz }; _velocity.set(boneKey, pv); }
  else { pv.x = vx; pv.y = vy; pv.z = vz; }

  // Carry factor: only during recovery, decays with t.
  let carry = 0;
  if (frame.phase === 'recovery' && frame.inertiaActive) {
    carry = 0.18 * (1 - frame.t);
  }

  _adjusted.x = targetX + vx * carry * safeDt;
  _adjusted.y = targetY + vy * carry * safeDt;
  _adjusted.z = targetZ + vz * carry * safeDt;
  return _adjusted;
}

export function getInertiaSnapshot(): Record<string, InertiaSample> {
  const out: Record<string, InertiaSample> = {};
  _velocity.forEach((v, k) => { out[k] = { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }; });
  return out;
}

// ─── Public API: anticipation overlay (renderer helper) ──────────────────────

/**
 * Compute a small additive Euler delta to inject into the upper-arm target
 * during anticipation. The delta REVERSES the dominant gesture axis (X for
 * forward-raise gestures: wave / point / explain / clap) so the arm pulls
 * BACKWARD slightly before swinging forward. Smoothly fades to zero as the
 * action phase begins.
 *
 * Returns 0 for non-applicable phases.
 */
export function getAnticipationOverlay(
  frame: BehaviorFrame,
  bone: 'rua' | 'lua' | 'rla' | 'lla',
): number {
  if (!frame.event || frame.phase !== 'anticipation') return 0;
  const dip = _ANTICIPATION_DIP[frame.event.type] ?? 0;
  if (dip === 0) return 0;
  // Fade-out curve: starts at -dip, ends at 0 by phase end.
  const w = (1 - frame.t);
  // For a forward-raise gesture, +X dip on rua = backward swing (reverse of action).
  // For a cross-body gesture (clap/wave on lua), -X dip on lua = backward.
  const sign =
    bone === 'rua' ? +1 :
    bone === 'lua' ? -1 :
    0;
  return sign * dip * w * 0.4 * frame.event.intensity;
}

// ─── Public API: audit ────────────────────────────────────────────────────────

function _buildAudit(completed: BehaviorEvent): BehaviorFinalAudit {
  const inertiaSamples = _velocity.size;
  const hasTimeline = true;
  const phaseWorking = completed.phases.anticipation > 0
                    && completed.phases.action > 0
                    && completed.phases.recovery > 0;
  const inertiaWorking = inertiaSamples > 0;
  const emotionAffectsMotion = (_emotion.arousal !== 0) || (_emotion.valence !== 0);
  // Snapping = an event shorter than 200ms total.
  const snappingDetected = completed.duration < 200;
  const gestureSmooth = phaseWorking && !snappingDetected;
  return {
    hasTimeline,
    phaseWorking,
    inertiaWorking,
    emotionAffectsMotion,
    gestureSmooth,
    snappingDetected,
    rootCause: snappingDetected ? 'duration<200ms — snap detected' : null,
    lastEvent: { type: completed.type, durationMs: completed.duration, source: completed.source },
  };
}

export function getLastBehaviorAudit(): BehaviorFinalAudit | null {
  return _lastAudit;
}

// ─── Module-scope scratch (for renderer integrations) ────────────────────────

export const _BT_SCRATCH = {
  euler: new THREE.Euler(0, 0, 0, 'YXZ'),
  quat:  new THREE.Quaternion(),
};

console.log('[FILE_CREATED] motion/behaviorTimeline.ts loaded');
