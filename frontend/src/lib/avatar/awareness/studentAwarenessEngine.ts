/**
 * Student Awareness Layer — Observer that tracks interaction history, performance,
 * and engagement and emits **modulators** (multipliers) consumed by Persona,
 * Motion Sequencer, and Expression engines.
 *
 * Design contract: this layer **modulates**, never **overrides**.
 *   - The normal stance pipeline (emotion + pedagogy in `cogniPersonaStance.ts`) is
 *     the source of truth for stance string. Awareness only multiplies the resulting
 *     scalars (intensity, voice rate, pause duration).
 *   - Awareness can BIAS but never replace.
 *
 * Architecture:
 *   Singleton state manager (not Zustand) — no React coupling on a per-frame read path.
 *   External callers push events in (`registerSuccess` / `registerError` / `registerInteraction`);
 *   downstream readers pull modulators (`getAwarenessMotionIntensityMul`, etc.).
 *
 * Integration points (single source of truth):
 *   → cogniPersonaStance.getCogniPersonaPerformanceScales() — multiplies awareness scalars
 *     onto the existing stance bases. Stance string is NOT mutated.
 *   → motionSequencer.pickSequenceFor() — pause-step duration only.
 *   → VRMSkeletonManager.useFrame — calls `tickAwareness(dt)` once per ~500ms.
 *   → window event `avatar:awareness:state_change` — devtools / tests observe.
 */
'use client';

// ─── Public types ─────────────────────────────────────────────────────────────

export type CognitiveLoad      = 'low' | 'optimal' | 'overloaded';
export type PerformanceState   = 'struggling' | 'learning' | 'excelling';
export type InteractionStatus  = 'active' | 'idle' | 'distracted';

export interface StudentAwarenessState {
  engagementLevel:    number;           // 0.0 – 1.0
  cognitiveLoad:      CognitiveLoad;
  performanceState:   PerformanceState;
  interactionStatus:  InteractionStatus;
  consecutiveErrors:  number;
  lastInteractionTime: number;          // performance.now() / Date.now() ms
}

/**
 * Soft persona BIAS — a hint, not a replacement. The persona pipeline may use this
 * to nudge stance selection when its own signals are weak (neutral pedagogical /
 * neutral emotion). When the pipeline already has a strong signal, this is ignored.
 */
export type AwarenessPersonaBias =
  | 'soften'      // struggling → reinforce calmer stance
  | 'amplify'    // excelling   → reinforce celebratory stance
  | 'attention'  // distracted  → small attention nudge
  | null;

/**
 * Modulator bundle — everything the Persona layer needs in one read.
 * Multiplicative scalars; identity = 1.0 (no effect). Voice rate is also multiplicative.
 */
export interface AwarenessModulators {
  /** Multiply on top of stance.proceduralIntensityMul / semanticGestureMul. */
  intensityMul:       number;
  /** Multiply on top of stance.voiceRateMul. 0.85 when struggling. */
  voiceRateMul:       number;
  /** Multiply on top of motionSequencer pause durations. 1.3 when overloaded. */
  pauseDurationMul:   number;
  /** Soft bias — persona reads this only when own signals are neutral. */
  bias:               AwarenessPersonaBias;
}

// ─── Internal state ───────────────────────────────────────────────────────────

const _DEFAULT: StudentAwarenessState = {
  engagementLevel:    0.65,
  cognitiveLoad:      'optimal',
  performanceState:   'learning',
  interactionStatus:  'active',
  consecutiveErrors:  0,
  lastInteractionTime: 0,
};

let _state: StudentAwarenessState = { ..._DEFAULT };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function dispatchChangeEvent(prev: StudentAwarenessState, next: StudentAwarenessState): void {
  // eslint-disable-next-line no-console -- awareness state transition checkpoint
  console.log('[AWARENESS_LAYER] State Transition:', prev, '->', next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('avatar:awareness:state_change', {
        detail: { prev: { ...prev }, next: { ...next } },
      }),
    );
  }
}

/**
 * Field-level diff — replaces the old `JSON.stringify` snapshot.
 * The old version allocated ~80 bytes per call; with `registerInteraction`
 * potentially firing on every keystroke, that was sustained GC pressure.
 * This version is allocation-free and produces identical change-detection
 * semantics for the *categorical* fields (logs only when something the user
 * could perceive has changed). `engagementLevel` and `lastInteractionTime`
 * are intentionally excluded from the diff because they tick continuously.
 */
function categoricalChanged(a: StudentAwarenessState, b: StudentAwarenessState): boolean {
  return (
    a.cognitiveLoad     !== b.cognitiveLoad     ||
    a.performanceState  !== b.performanceState  ||
    a.interactionStatus !== b.interactionStatus ||
    a.consecutiveErrors !== b.consecutiveErrors
  );
}

function commitState(next: StudentAwarenessState): void {
  const prev = _state;
  _state = next;
  if (categoricalChanged(prev, next)) {
    dispatchChangeEvent(prev, next);
  }
}

// ─── Cognitive load derivation ────────────────────────────────────────────────

function deriveCognitiveLoad(errors: number, engagement: number): CognitiveLoad {
  if (errors >= 3 || engagement < 0.25) return 'overloaded';
  if (errors >= 1 || engagement < 0.45) return 'optimal';
  return 'low';
}

// ─── Public API — event sinks ─────────────────────────────────────────────────

/**
 * Call when the student submits a correct answer or receives a positive LLM reply.
 * Increases engagement, resets error counter, shifts performance to "excelling".
 */
export function registerSuccess(): void {
  const s = { ..._state };
  const eng = clamp01(s.engagementLevel + 0.15);
  commitState({
    ...s,
    engagementLevel:   eng,
    consecutiveErrors: 0,
    performanceState:  'excelling',
    cognitiveLoad:     deriveCognitiveLoad(0, eng),
    lastInteractionTime: nowMs(),
    interactionStatus: 'active',
  });
}

/**
 * Call when the student submits an incorrect answer or triggers an error frame.
 * Increments errors; ≥2 shifts performance to "struggling".
 */
export function registerError(): void {
  const s = { ..._state };
  const errors = s.consecutiveErrors + 1;
  const eng = clamp01(s.engagementLevel - 0.08);
  const perf: PerformanceState = errors >= 2 ? 'struggling' : 'learning';
  commitState({
    ...s,
    consecutiveErrors:  errors,
    engagementLevel:    eng,
    performanceState:   perf,
    cognitiveLoad:      deriveCognitiveLoad(errors, eng),
    lastInteractionTime: nowMs(),
    interactionStatus:  'active',
  });
}

/**
 * Call on any user interaction (typing, mic, button press).
 * Resets idle timer and sets status to "active".
 */
export function registerInteraction(): void {
  const t = nowMs();
  const s = { ..._state };
  const eng = clamp01(s.engagementLevel + 0.04);
  commitState({
    ...s,
    lastInteractionTime: t,
    interactionStatus:   'active',
    engagementLevel:     eng,
    cognitiveLoad:       deriveCognitiveLoad(s.consecutiveErrors, eng),
  });
}

/**
 * Throttle the next idle micro-gesture dispatch (re-armed on each commit).
 * Prevents spam: at most one micro every 7±3s while idle/distracted.
 */
let _nextIdleMicroAtMs = 0;

function maybeDispatchIdleMicro(): void {
  if (typeof window === 'undefined') return;
  if (_state.interactionStatus !== 'idle' && _state.interactionStatus !== 'distracted') return;
  const t = nowMs();
  if (t < _nextIdleMicroAtMs) return;
  _nextIdleMicroAtMs = t + 7000 + Math.random() * 3000;
  // Reuse existing system: avatar:micro:gesture is consumed by VRMSkeletonManager.
  const kinds = _state.interactionStatus === 'distracted'
    ? ['question_tilt', 'lean_in', 'chin_up'] as const
    : ['nod', 'question_tilt'] as const;
  const kind = kinds[Math.floor(Math.random() * kinds.length)] ?? 'nod';
  window.dispatchEvent(
    new CustomEvent('avatar:micro:gesture', {
      detail: { kind, durationMs: 380, source: 'awareness:idle' },
    }),
  );
}

/**
 * Tick from VRMSkeletonManager useFrame **throttled to ~500ms** by the caller.
 * Handles engagement decay, idle/distracted transitions, and idle micro-cues.
 *
 * @param deltaTimeSec  Real seconds since the last tickAwareness call (NOT frame delta).
 */
export function tickAwareness(deltaTimeSec: number): void {
  if (deltaTimeSec <= 0) return;
  const s = { ..._state };
  const t = nowMs();
  // Lazy-init: first tick anchors the idle clock so a session that never sees
  // any user interaction will still progress idle → distracted on schedule.
  if (s.lastInteractionTime <= 0) {
    s.lastInteractionTime = t;
  }
  const idleMs = t - s.lastInteractionTime;

  // Idle decay: engagement drains at ~1% per real second of inactivity.
  const decayRate = 0.01 * deltaTimeSec;
  const eng = clamp01(s.engagementLevel - decayRate);

  let status: InteractionStatus = s.interactionStatus;
  if      (idleMs > 45_000) status = 'distracted';
  else if (idleMs > 15_000) status = 'idle';
  else                      status = 'active';

  commitState({
    ...s,
    engagementLevel:   eng,
    interactionStatus: status,
    cognitiveLoad:     deriveCognitiveLoad(s.consecutiveErrors, eng),
  });

  maybeDispatchIdleMicro();
}

/**
 * Reset to defaults (new session / VRM load).
 */
export function resetAwarenessEngine(): void {
  _state = { ..._DEFAULT, lastInteractionTime: nowMs() };
}

// ─── Public API — context reads ───────────────────────────────────────────────

export function getStudentAwarenessState(): Readonly<StudentAwarenessState> {
  return _state;
}

/**
 * Soft persona bias — read ONLY when the normal persona pipeline has neutral signals.
 * Awareness never replaces an emotion- or pedagogy-driven persona.
 */
export function getAwarenessPersonaBias(): AwarenessPersonaBias {
  const { interactionStatus, performanceState } = _state;
  if (performanceState  === 'struggling')   return 'soften';
  if (performanceState  === 'excelling')    return 'amplify';
  if (interactionStatus === 'distracted')   return 'attention';
  return null;
}

/**
 * Pause duration multiplier for the motion sequencer.
 * Returns 1.3 when the student is cognitively overloaded so pause steps are
 * 30% longer (visual "breathing room"). Returns 1.0 otherwise.
 */
export function getAwarenessPauseDurationMul(): number {
  return _state.cognitiveLoad === 'overloaded' ? 1.3 : 1.0;
}

/**
 * Procedural intensity multiplier — softer bands than before so awareness
 * MODULATES the existing stance instead of overpowering it.
 */
export function getAwarenessMotionIntensityMul(): number {
  const { performanceState, interactionStatus } = _state;
  if (performanceState  === 'struggling')                  return 0.82;  // was 0.65
  if (interactionStatus === 'distracted')                  return 1.18;  // was 1.35
  if (performanceState  === 'excelling')                   return 1.10;  // was 1.18
  if (interactionStatus === 'idle' && _state.engagementLevel < 0.35) return 1.10; // gentle nudge
  return 1.0;
}

/**
 * Voice rate multiplier — only slows speech for genuinely struggling students.
 * Returns 1.0 in every other case.
 */
export function getAwarenessVoiceRateMul(): number {
  if (_state.performanceState === 'struggling') return 0.85;
  return 1.0;
}

/**
 * Single-call accessor returning all modulators at once. Preferred over individual
 * getters because it avoids 4× function call overhead on the per-frame read path.
 */
export function getAwarenessModulators(): AwarenessModulators {
  return {
    intensityMul:     getAwarenessMotionIntensityMul(),
    voiceRateMul:     getAwarenessVoiceRateMul(),
    pauseDurationMul: getAwarenessPauseDurationMul(),
    bias:             getAwarenessPersonaBias(),
  };
}

/** True when the avatar should run subtle "looking around" / curiosity micros. */
export function shouldTriggerIdleMicros(): boolean {
  return _state.interactionStatus === 'idle' || _state.interactionStatus === 'distracted';
}

// ─── Bootstrap (idempotent — anchors idle clock on first call) ───────────────

let _initialized = false;

/**
 * Single-source-of-truth bootstrap. Anchors `lastInteractionTime` so the idle
 * decay clock is correct for sessions that never see user input.
 *
 * Event sources are wired DIRECTLY at their call sites (not through window
 * events) to keep the data flow explicit and prevent double-counting:
 *   - text submit:  AvatarAgentClient.submitMessage   → registerInteraction
 *   - mic submit:   useAgentAgent.sendAudioBlobNow    → registerInteraction
 *   - pedagogical:  cogniPersonaStance.ingestPedagogicalFromAgentFrame
 *                   → registerSuccess / registerError
 *
 * Window-event listeners were intentionally removed because:
 *   1. No code in the project dispatches `avatar:pedagogical` / `user:*` events.
 *   2. If any future code dispatches them, they would double-count the
 *      pedagogical signal already being forwarded from `ingestPedagogicalFromAgentFrame`.
 */
export function initStudentAwarenessListeners(): void {
  if (typeof window === 'undefined' || _initialized) return;
  _initialized = true;
  resetAwarenessEngine();
}
