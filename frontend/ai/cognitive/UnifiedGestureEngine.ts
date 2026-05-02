/**
 * UnifiedGestureEngine — Cogni avatar gesture orchestration layer.
 *
 * Architecture (event-based, browser only):
 *   caller ─▶ play(name) ─▶ PriorityQueue ─▶ avatar:vrma:play (mixer) + avatar:gesture motion:vrma (head only)
 *
 * VRMSkeletonManager owns actual bone / VRMA playback.
 * This engine only gates and sequences the event dispatch.
 *
 * Priority (lower = more urgent):
 *   CRITICAL(0) > HIGH(1) > NORMAL(2) > LOW(3) > BACKGROUND(4)
 *
 * Cross-fade: brief idle dispatch + motion authority (cooldown, intensity clamp).
 * Gesture VRMA always dispatches `avatar:vrma:play` — VRMAPlayer crossfades over looping baseline (single mixer).
 */
'use client';

import { dispatchGestureFromActionText } from '@/ai/avatar/actions';
import type { BehaviorPayload } from '@/lib/behavior/types';
import { getGestureScheduler } from '@/lib/behavior/gestureScheduler';
import {
  GESTURE_FILENAME_MAP,
  GESTURE_FALLBACKS,
  GESTURE_PRIORITY_MAP,
  GESTURE_DURATION_MS,
  VRMA_TO_CANONICAL,
  CANONICAL_GESTURES,
  vrmaUrl,
  sanitizeVrmaStem,
  sanitizeVrmaAssetUrl,
  PRIORITY,
  type CanonicalGesture,
  type PriorityValue,
  type FallbackConfig,
} from '@/constants/gestures';
import { DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';
import { getGestureEnergyMul } from '@/lib/avatar/personalityEvolution';
import {
  applyReplyBehaviorPreamble,
  classifyReplyBehavior,
  getIntentDepthDurationMul,
  getIntentDepthIntensityOffset,
  getPresenceGapMs,
  getReactionDelayMs,
  replyClassFromGestureStem,
  resolveIntentDepth,
  type IntentDepthClass,
  type ReplyBehaviorClass,
} from '@/ai/avatar/responsePersonality';
import { microExprPulseFromIntentDepth } from '@/ai/avatar/microExpressionLayer';
import { getGestureDurationPersonalityMul, getHesitationChance } from '@/ai/avatar/avatarPersonality';
import {
  getMotionControllerState,
  motionEngineMayEnqueuePlay,
  releaseMotionIfHeld,
  releaseStaleNonVrmaAuthority,
  tryAcquireMotion,
} from '@/lib/avatar/motionAuthority';
import {
  behaviorMotionBrainGatePlay,
  getBehaviorMotionState,
  initBehaviorMotionBrainListeners,
  recordBehaviorMotionAction,
} from '@/lib/behavior/behaviorMotionBrain';
import { initAnticipationLayer } from '@/lib/behavior/anticipationLayer';
import { initInternalThoughtLayer, isInternalThinking } from '@/lib/behavior/internalThoughtLayer';
import { motionDebug } from '@/lib/avatar/motionDebug';
import {
  motionDiagIncrBlock,
  motionDiagIncrPlay,
  motionPlaySuccessCount,
} from '@/lib/avatar/motionDiagnosticsStore';
import { startMotionDiagnosticReporting } from '@/lib/avatar/motionDiagnostics';
import { startMotionScheduler } from '@/lib/avatar/motionScheduler';
import {
  bumpIntentFromGesturePlayName,
  tryMotionIntentOnlyFromPlayName,
} from '@/lib/avatar/motionIntentContinuity';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';

// ─── Dev helpers ─────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development';

type LogLevel = 'info' | 'warn' | 'error';
function devLog(level: LogLevel, msg: string, extra?: unknown): void {
  if (!IS_DEV) return;
  const line = `[UnifiedGestureEngine] ${msg}`;
  if (level === 'error') console.error(line, extra ?? '');
  else if (level === 'warn') console.warn(line, extra ?? '');
  else if (DEBUG_AVATAR) console.log(line, extra ?? '');
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** ─── Motion control gate (anti-spam + stability) — VRMAPlayer dispatches `avatar:vrma:active` ─── */
const PRODUCTION_GESTURE_INTENSITY_MIN = 0.08;
const PRODUCTION_GESTURE_INTENSITY_MAX = 0.22;
/** Idle bridge before VRMA — must allow mixer ≥ 0.25s crossfade budget. */
const MOTION_GATE_CROSSFADE_MS = 280;
const MOTION_GATE_POST_IDLE_MS = 140;

/** Skip `play()` when caller intensity is below this (weak / accidental cues). */
const WEAK_GESTURE_INTENSITY_SKIP = 0.06;

const THINKING_STEM_ALTS = ['Thinking', 'Agreeing', 'Acknowledging'] as const;

/** Debounce REACTION lane acquires — stops millisecond-scale authority flicker. */
let __reactionLaneLastMs = 0;
const REACTION_LANE_DEBOUNCE_MS = 500;

/** Throttle subtle “idle shift” nudges while VRMA is primary. */
let __lastVrmaIdleShiftMs = 0;
const VRMA_IDLE_SHIFT_MIN_INTERVAL_MS = 4200;

/** Full gestures allowed to blend on top of VRMA (canonical keys). */
const VRMA_PRIMARY_BLEND_CANONICAL = new Set<CanonicalGesture>(['agree', 'explain', 'think']);

function isBlendAllowedDuringVrmaPrimary(normalised: string): boolean {
  return VRMA_PRIMARY_BLEND_CANONICAL.has(toCanonicalGesture(normalised));
}

/** Posture / micro cues only — full VRMA stays primary on the mixer. */
function isMicroLayerGestureKey(raw: string): boolean {
  const key = raw.toLowerCase().replace(/\s+/g, '');
  return /think|listening|process|idle|curious|look|relax|nod|blink|micro/.test(key);
}

function clampMotionIntensity(v: number): number {
  const evMul = getGestureEnergyMul();
  const scaled = v * evMul;
  return Math.min(
    PRODUCTION_GESTURE_INTENSITY_MAX,
    Math.max(PRODUCTION_GESTURE_INTENSITY_MIN, scaled),
  );
}

// ─── Normalizer (used to be gestureNormalizer.ts) ────────────────────────────

const LEGACY_TO_CANONICAL: Record<string, CanonicalGesture> = {
  look: 'idle', wave: 'wave', waving: 'wave', clap: 'clap', clapping: 'clap',
  test_elbow: 'test_elbow', testelbow: 'test_elbow', 'test-elbow': 'test_elbow',
  agree: 'agree', agreeing: 'agree',
  nod: 'agree',        // nod → agree (head nod posture in VRMSkeletonManager)
  idle: 'idle', explain: 'explain',
  point: 'point', think: 'think',
  openhand: 'explain', openhandgesture: 'explain',
  pointhand: 'point', beat: 'explain', cheer: 'clap', celebration: 'clap',
  goodbye: 'wave', relax: 'idle', rest: 'idle', blink: 'idle',
  peace: 'wave',       // peace → gentle wave (open hand)
  smile: 'agree',      // smile → agree (upbeat open posture)
  handsup: 'explain', hands_up: 'explain',
  leanforward: 'think', lean_forward: 'think',
  beckon: 'point', ack: 'agree',
  tilt: 'think',       // tilt → think (head tilt curiosity)
  head_down: 'think', shoulder_sigh: 'idle', lean_back: 'idle',
  curious: 'think', shrug: 'agree',
};

export { CanonicalGesture };
export type { PriorityValue };
export type { IntentDepthClass, ReplyBehaviorClass } from '@/ai/avatar/responsePersonality';

export function toCanonicalGesture(raw: string): CanonicalGesture {
  const k = raw.replace(/\s+/g, '').toLowerCase();
  if (CANONICAL_GESTURES.has(k as CanonicalGesture)) return k as CanonicalGesture;
  const legacy = LEGACY_TO_CANONICAL[k];
  if (legacy) return legacy;
  // VRMA stems (Thinking, Idle1, standing-cheering, …) → procedural canonical
  for (const [stem, can] of Object.entries(VRMA_TO_CANONICAL)) {
    if (stem.replace(/\s+/g, '').toLowerCase() === k) return can;
  }
  return 'idle';
}

let normalizerAttached = false;
export function initGestureNormalizer(): void {
  if (typeof window === 'undefined' || normalizerAttached) return;
  normalizerAttached = true;
  const onGesture = (evt: Event) => {
    if (!(evt instanceof CustomEvent)) return;
    if (typeof window !== 'undefined' && (window as Window & { __COGNI_DISABLE_GESTURE_NORMALIZER__?: boolean }).__COGNI_DISABLE_GESTURE_NORMALIZER__) {
      return;
    }
    const d = evt.detail as Record<string, unknown> | null;
    if (!d || d._normalized === true) return;
    const raw = (typeof d.gesture === 'string' && d.gesture.trim())
      ? d.gesture.trim()
      : (typeof d.type === 'string' && d.type.trim())
        ? d.type.trim()
        : (typeof d.name === 'string' && d.name.trim()) ? d.name.trim() : 'idle';
    d.gesture = toCanonicalGesture(raw);
    if (typeof d.type !== 'string' || !d.type.trim()) d.type = raw;
    d._normalized = true;
  };
  window.addEventListener('avatar:gesture', onGesture, true);
  initBehaviorMotionBrainListeners();
  initAnticipationLayer();
  initInternalThoughtLayer();
  startMotionDiagnosticReporting();
  startMotionScheduler();
  devLog('info', 'capture normalizer attached');
}

// ─── Gesture descriptor (for AgentDirector / planGestures backward compat) ───

export interface GestureDescriptor {
  type: 'wave' | 'point' | 'openHand' | 'beat';
  side?: 'left' | 'right' | 'both';
  intensity?: number;
  duration?: number;
  speed?: number;
}

// ─── Priority queue entry ─────────────────────────────────────────────────────

interface QueueEntry {
  name: string;
  priority: PriorityValue;
  ts: number;
  durationMs: number;
  crossFade: boolean;
  intensity?: number;
  mood?: string;
  /** Human pacing: presence wait + reaction delay + subtle head prelude (NORMAL/HIGH only unless forced). */
  humanPad?: boolean;
  responseClass?: ReplyBehaviorClass;
  /** Finer reply intent — duration / intensity / preamble nuance. */
  intentDepth?: IntentDepthClass;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/** Action-text → procedural GestureDescriptor (legacy AgentDirector path) */
const EMOTION_HINTS: Record<string, Partial<GestureDescriptor>> = {
  celebrate:   { type: 'wave',      intensity: 1.3, duration: 3.0 },
  encouraging: { type: 'openHand',  intensity: 1.0, duration: 2.0 },
  thinking:    { type: 'beat',      intensity: 0.6, duration: 1.5 },
  friendly:    { type: 'openHand',  intensity: 0.8, duration: 1.5 },
  strict:      { type: 'point',     intensity: 0.9, duration: 1.5 },
  neutral:     { type: 'beat',      intensity: 0.5, duration: 1.0 },
};
const ACTION_PATTERNS: Array<{ pattern: RegExp; gesture: Partial<GestureDescriptor> }> = [
  { pattern: /يميل|lean forward/i,       gesture: { type: 'openHand', intensity: 0.8 } },
  { pattern: /يشير|points?|index finger/i, gesture: { type: 'point',   intensity: 0.9 } },
  { pattern: /يلوّح|wave|waves?/i,        gesture: { type: 'wave',     intensity: 1.0 } },
  { pattern: /يصفق|clap|enthusiastic/i,   gesture: { type: 'wave',     intensity: 1.3 } },
  { pattern: /يفرد|spread|open (palm|hand)/i, gesture: { type: 'openHand', intensity: 0.9 } },
  { pattern: /يضع يده|hand on chest/i,   gesture: { type: 'beat',     intensity: 0.6 } },
  { pattern: /يومئ|nod|يهز/i,            gesture: { type: 'beat',     intensity: 0.5 } },
];

export class UnifiedGestureEngine {
  // Perf snapshot
  readonly #stats = { plays: 0, interrupts: 0, fallbacks: 0, errors: 0, lastMs: 0 };
  // Queue
  readonly #queue: QueueEntry[] = [];
  // Current active gesture info
  #currentName: string | null = null;
  #currentPriority: PriorityValue = PRIORITY.BACKGROUND + 1 as PriorityValue;
  /** Pending one-shot timers (body completion, cross-fade bridge) — cleared on interrupt. */
  readonly #timeoutHandles: ReturnType<typeof setTimeout>[] = [];
  #processing = false;
  /** Bumped on interrupt so async preamble + body timers bail without blocking the queue. */
  #scheduleGeneration = 0;
  /** Logical plays still in preamble, VRMA body window, or fallback chain. */
  #inFlight = 0;
  /** Token for clearing `currentName` only when the finishing play still owns the HUD slot. */
  #gestureDisplayToken = 0;
  #nextGestureToken = 1;
  /** `motionPlaySuccessCount` snapshot at `#drain` start — micro idle pulse when wave adds no plays. */
  #drainWavePlaySnapshot = 0;
  #drainWavePendingCheck = false;
  // VRMA URL cache
  readonly #vrmaCache = new Map<string, string>();
  /** Time of last completed #execute (for cooldown between user-facing plays). */
  #lastGestureCompleteMs = 0;
  /** After a human-paced gesture, block next one until this wall time (ms). */
  #presenceQuietUntilMs = 0;
  /** Last VRMA stem played (after thinking-variety pick) — anti-repeat within random 3–5s window. */
  #lastGestureStemKey: string | null = null;
  #repeatGateUntilMs = 0;
  #lastCanonicalGesture: CanonicalGesture | null = null;
  #lastCanonicalGestureAt = 0;
  /** Wall time before another NORMAL+ gesture may start (jittered 1.2s + 0–1.5s + ambient). */
  #nextGestureCooldownUntilMs = 0;

  getStats(): Readonly<{
    plays: number;
    interrupts: number;
    fallbacks: number;
    errors: number;
    lastMs: number;
    /** Name of the gesture currently executing, or null if idle */
    currentGesture: string | null;
    /** Number of gestures waiting in the priority queue */
    queueLength: number;
    /** Numerical priority of the current gesture (0=CRITICAL … 4=BACKGROUND), or null */
    currentPriority: PriorityValue | null;
    /** True while a gesture is executing */
    isPlaying: boolean;
  }> {
    return {
      ...this.#stats,
      currentGesture:  this.#currentName,
      queueLength:     this.#queue.length,
      currentPriority: this.#currentName !== null ? this.#currentPriority : null,
      isPlaying:       this.#processing || this.#inFlight > 0,
    };
  }

  /** Backward compat: GestureCalibrator uses playCanonical */
  playCanonical(g: CanonicalGesture, _crossFade = true): Promise<void> {
    return this.play(g, { priority: PRIORITY.NORMAL, crossFade: _crossFade });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Play a gesture by name (display stem, alias, or virtual fallback name).
   * Priority: **lower numeric value = more urgent** (CRITICAL=0 … BACKGROUND=4).
   * Idle / no active gesture uses sentinel `PRIORITY.BACKGROUND + 1` (5) internally.
   */
  async play(
    name: string,
    opts: {
      priority?: PriorityValue;
      durationMs?: number;
      crossFade?: boolean;
      intensity?: number;
      mood?: string;
      /** When false, skip reaction delay / presence wait / preamble (ambient or CRITICAL-style). */
      humanTiming?: boolean;
      /** Optional transcript / cue text for reply classification. */
      replyText?: string;
      /** Override classifier: thinking | agreeing | explaining | neutral. */
      responseClass?: ReplyBehaviorClass;
      /** Override intent refinement (else derived from `responseClass` + `replyText`). */
      intentDepth?: IntentDepthClass;
      /** When false, skip behavior-motion brain (silence / mode gates). */
      behaviorBrain?: boolean;
      /**
       * When true (non-CRITICAL): if the gesture name maps to a motion intent, update intent only
       * and skip the VRMA queue — continuous presence + baseline VRMA carry the body.
       */
      motionIntentOnly?: boolean;
    } = {},
  ): Promise<void> {
    if (!name?.trim()) return;
    const normalised = name.trim();
    const priority: PriorityValue = opts.priority ?? this.#resolvePriority(normalised);
    motionDebug('PLAY REQUEST:', normalised, 'priority=', priority);
    const canonicalEarly = toCanonicalGesture(normalised);
    if (
      canonicalEarly !== 'idle'
      && this.#lastCanonicalGesture === canonicalEarly
      && perfNow() - this.#lastCanonicalGestureAt < 6000
    ) {
      devLog(
        'info',
        `skip repeat canonical gesture "${canonicalEarly}" (<6s)`,
      );
      motionDiagIncrBlock('gestureRepeat');
      motionDebug('PLAY BLOCKED:', 'canonical-repeat-<4s', canonicalEarly);
      return Promise.resolve();
    }
    let durationMs = opts.durationMs ?? this.#resolveDuration(normalised);
    const crossFade = opts.crossFade !== false;

    const humanPad =
      opts.humanTiming === false
        ? false
        : opts.humanTiming === true
          ? true
          : priority === PRIORITY.NORMAL || priority === PRIORITY.HIGH;

    if (typeof opts.intensity === 'number' && opts.intensity < WEAK_GESTURE_INTENSITY_SKIP) {
      devLog('info', `skip weak gesture "${normalised}" intensity=${opts.intensity.toFixed(2)}`);
      motionDiagIncrBlock('behavior');
      motionDebug('PLAY BLOCKED:', 'weak-intensity', normalised, opts.intensity);
      return Promise.resolve();
    }

    if (isInternalThinking() && priority > PRIORITY.CRITICAL) {
      devLog('info', `internal thought: skip "${normalised}"`);
      motionDiagIncrBlock('internalThought');
      motionDebug('INTERNAL THINK BLOCK PLAY', normalised, 'priority=', priority);
      return Promise.resolve();
    }

    releaseStaleNonVrmaAuthority();
    const mcPre = getMotionControllerState();
    const vrmaPrimaryBlocksCompeting =
      mcPre.active
      && mcPre.source === 'VRMA'
      && priority > PRIORITY.NORMAL
      && !isMicroLayerGestureKey(normalised)
      && !isBlendAllowedDuringVrmaPrimary(normalised);
    if (vrmaPrimaryBlocksCompeting) {
      devLog('info', `skip low-priority gesture while VRMA primary — "${normalised}" (prio=${priority})`);
      return Promise.resolve();
    }

    if (opts.motionIntentOnly === true && priority > PRIORITY.CRITICAL) {
      if (tryMotionIntentOnlyFromPlayName(normalised)) {
        motionDebug('INTENT ONLY (no VRMA queue):', normalised);
        return Promise.resolve();
      }
    }

    if (isVrmaPlaybackGloballyDisabled()) {
      motionDebug('VRMA POLICY:', 'global-bypass', normalised);
      return Promise.resolve();
    }

    const responseClass: ReplyBehaviorClass =
      opts.responseClass ??
      (opts.replyText
        ? classifyReplyBehavior(opts.replyText, opts.mood)
        : replyClassFromGestureStem(normalised));

    const intentDepth: IntentDepthClass =
      opts.intentDepth ?? resolveIntentDepth(responseClass, opts.replyText ?? '');

    durationMs = Math.round(
      durationMs *
        getIntentDepthDurationMul(intentDepth) *
        getGestureDurationPersonalityMul(),
    );
    durationMs = Math.min(3000, Math.max(220, durationMs));

    // Motion controller — block new gestures except CRITICAL (`tryAcquireMotion` force + barge in `#execute`).
    if (!motionEngineMayEnqueuePlay(priority)) {
      devLog('info', `motion authority: blocked — skip "${normalised}" (priority=${priority})`);
      motionDiagIncrBlock('authority');
      motionDebug('PLAY BLOCKED:', 'motionEngineMayEnqueuePlay', normalised);
      return Promise.resolve();
    }

    // Jittered global gap after last completed gesture (NORMAL+ only; CRITICAL/HIGH bypass).
    const idleForGate = !this.#processing && this.#queue.length === 0 && this.#inFlight === 0;
    if (
      idleForGate
      && priority >= PRIORITY.NORMAL
      && Date.now() < this.#nextGestureCooldownUntilMs
    ) {
      devLog('info', `motion gate: cooldown until ${this.#nextGestureCooldownUntilMs} — skip "${normalised}"`);
      motionDiagIncrBlock('authority');
      motionDebug('PLAY BLOCKED:', 'global-cooldown', normalised);
      return Promise.resolve();
    }

    initBehaviorMotionBrainListeners();
    const bypassBehaviorBrain =
      opts.behaviorBrain === false ||
      priority === PRIORITY.CRITICAL ||
      !humanPad;
    if (!bypassBehaviorBrain) {
      const proceed = await behaviorMotionBrainGatePlay({
        normalised,
        priority,
        humanPad,
      });
      if (!proceed) {
        devLog('info', `behavior motion brain: skip "${normalised}"`);
        motionDiagIncrBlock('behavior');
        motionDebug('PLAY BLOCKED:', 'behavior-motion-brain', normalised);
        return Promise.resolve();
      }
    }

    const intentOff = getIntentDepthIntensityOffset(intentDepth);
    let intensityOpt: number | undefined;
    if (typeof opts.intensity === 'number') {
      intensityOpt = clampMotionIntensity(opts.intensity + intentOff);
    } else if (humanPad) {
      intensityOpt = clampMotionIntensity(0.18 + intentOff);
    } else {
      intensityOpt = undefined;
    }

    const entry: QueueEntry = {
      name: normalised,
      priority,
      ts: Date.now(),
      durationMs,
      crossFade,
      intensity: intensityOpt,
      mood: opts.mood,
      humanPad,
      responseClass,
      intentDepth,
    };

    if (priority <= this.#currentPriority) {
      const idleSlot = (PRIORITY.BACKGROUND + 1) as PriorityValue;
      const note =
        this.#currentPriority === idleSlot
          ? ' (current=idle sentinel, not a conflict)'
          : '';
      this.#interrupt(`play(${normalised}) incomingPrio=${priority} ≤ currentPrio=${this.#currentPriority}${note}`);
      this.#stats.interrupts += 1;
      this.#executeSchedule(entry);
    } else {
      // Enqueue, sorted by priority then timestamp
      this.#queue.push(entry);
      this.#queue.sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : a.ts - b.ts);
      devLog('info', `queued "${normalised}" (priority=${priority}, queue=${this.#queue.length})`);
      if (!this.#processing) this.#drain();
    }
  }

  /** Shorthand methods */
  think()   { return this.play('Thinking',           { priority: PRIORITY.NORMAL }); }
  wave()    { return this.play('Waving',             { priority: PRIORITY.HIGH   }); }
  clap()    { return this.play('Clapping',           { priority: PRIORITY.NORMAL }); }
  agree()   { return this.play('Agreeing',           { priority: PRIORITY.NORMAL }); }
  listen()  { return this.play('listening',          { priority: PRIORITY.LOW,    humanTiming: false }); }
  process() { return this.play('processing',         { priority: PRIORITY.LOW,    humanTiming: false }); }
  error()   { return this.play('error',              { priority: PRIORITY.CRITICAL, humanTiming: false }); }
  curious() { return this.play('curious',            { priority: PRIORITY.LOW,    humanTiming: false }); }
  idle()    { return this.play(this.#randomIdle(),   { priority: PRIORITY.LOW, crossFade: false, humanTiming: false }); }

  /** Cancel all pending + stop current */
  cancelAll(): void {
    this.#queue.length = 0;
    this.#interrupt('cancelAll');
  }

  // ── Behavior JSON scheduling (gestureScheduler bridge) ──────────────────────

  scheduleBehavior(payload: BehaviorPayload | null | undefined, speechStartDelay = 0): void {
    try {
      getGestureScheduler().schedule(payload, speechStartDelay);
    } catch (e) {
      this.#stats.errors += 1;
      devLog('error', 'scheduleBehavior', e);
    }
  }

  cancelScheduledBehavior(): void {
    try { getGestureScheduler().cancelAll(); } catch { /* ignore */ }
  }

  // ── Legacy AgentDirector API (planGestures / playFromActionText) ─────────────

  playFromActionText(actionText: string, emotion?: string): void {
    if (!actionText) return;
    const desc = this.#resolveDescriptor(actionText, emotion);
    const hasText = ACTION_PATTERNS.some(({ pattern }) => pattern.test(actionText));
    const hasEmo = emotion !== undefined && Boolean(EMOTION_HINTS[emotion]);
    if (desc.type === 'beat' && desc.intensity === 0.5 && !hasText && !hasEmo) {
      try { dispatchGestureFromActionText(actionText); } catch { /* ignore */ }
      return;
    }
    this.#dispatchDescriptor(desc);
  }

  planGestures(
    actionText: string,
    emotion: string,
    speechDurationMs: number,
  ): Array<{ descriptor: GestureDescriptor; fireAtMs: number }> {
    const primary = this.#resolveDescriptor(actionText, emotion);
    const result: Array<{ descriptor: GestureDescriptor; fireAtMs: number }> = [
      { descriptor: primary, fireAtMs: 0 },
    ];
    const HIGH_ENERGY = ['excited', 'celebrate', 'celebration', 'encouraging', 'happy', 'proud'];
    if (HIGH_ENERGY.includes(emotion) && speechDurationMs > 2000) {
      result.push({
        descriptor: { type: 'beat', side: 'right', intensity: 0.55, duration: 1.2 },
        fireAtMs: Math.round(speechDurationMs * 0.48),
      });
    }
    return result;
  }

  playDescriptor(descriptor: GestureDescriptor): void { this.#dispatchDescriptor(descriptor); }
  celebrate():    void { this.#dispatchDescriptor({ type: 'wave',     side: 'right', intensity: 1.3, duration: 3.0 }); }
  explain():      void { this.#dispatchDescriptor({ type: 'point',    side: 'right', intensity: 0.9, duration: 2.0 }); }
  empathize():    void { this.#dispatchDescriptor({ type: 'openHand', side: 'right', intensity: 0.7, duration: 1.8 }); }
  warmGreeting(): void { this.#queueDescriptor({ type: 'wave',  side: 'right', intensity: 0.9, duration: 2.5, speed: 0.8 }); }
  emphaticPoint():void { this.#queueDescriptor({ type: 'point', side: 'right', intensity: 1.1, duration: 1.5, speed: 1.2 }); }
  waveBothHands(d: number): void { this.#dispatchDescriptor({ type: 'wave', side: 'both', intensity: 1.3, duration: d }); }

  headTilt(direction: 'left' | 'right', angle: number, durationMs: number): void {
    if (typeof window === 'undefined') return;
    const yaw = direction === 'left' ? -angle : angle;
    try { window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw, pitch: 0, duration: durationMs } })); } catch { /* ignore */ }
  }

  headJerks(): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: 0.08, pitch: -0.05, duration: 200 } }));
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: -0.06, pitch: 0, duration: 200 } }));
      }, 220);
    } catch { /* ignore */ }
  }

  /** VRMA URL resolver with cache */
  resolveVrmaUrl(stem: string): string {
    const s = sanitizeVrmaStem(stem);
    const cached = this.#vrmaCache.get(s);
    if (cached) return cached;
    const url = sanitizeVrmaAssetUrl(vrmaUrl(s));
    this.#vrmaCache.set(s, url);
    return url;
  }

  // ── Internal execution ──────────────────────────────────────────────────────

  #drain(): void {
    this.#processing = true;
    const playsAtDrainStart = motionPlaySuccessCount;
    this.#drainWavePlaySnapshot = playsAtDrainStart;
    this.#drainWavePendingCheck = true;
    while (this.#queue.length > 0) {
      const next = this.#queue.shift();
      if (!next) break;
      if (!this.#processing) break;
      this.#executeSchedule(next);
    }
    this.#processing = false;
    this.#tryDrainWaveMicroPulse();
  }

  #tryDrainWaveMicroPulse(): void {
    if (this.#inFlight > 0) return;
    if (this.#drainWavePendingCheck && motionPlaySuccessCount === this.#drainWavePlaySnapshot) {
      this.#dispatchMicroIdlePulse();
    }
    this.#drainWavePendingCheck = false;
    this.#maybeVrmaIdleShiftNudge();
  }

  #playDone(playGen: number): void {
    if (playGen !== this.#scheduleGeneration) return;
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    this.#tryDrainWaveMicroPulse();
  }

  #clearAllTimeouts(): void {
    for (const id of this.#timeoutHandles) clearTimeout(id);
    this.#timeoutHandles.length = 0;
  }

  /** One-shot timer — cleared on interrupt; does not use the old single `#delay` slot. */
  #armTimeout(ms: number, fn: () => void): void {
    const genAtArm = this.#scheduleGeneration;
    const id = setTimeout(() => {
      const i = this.#timeoutHandles.indexOf(id);
      if (i >= 0) this.#timeoutHandles.splice(i, 1);
      if (genAtArm !== this.#scheduleGeneration) return;
      fn();
    }, Math.max(0, ms));
    this.#timeoutHandles.push(id);
  }

  /** Min 1.2s + 0–1.5s jitter; LOW priority and thinking-like names add quiet time. */
  #scheduleNextGestureCooldown(entry: QueueEntry): void {
    const base = 1200 + Math.random() * 1500;
    let extra = entry.priority >= PRIORITY.LOW ? 600 : 0;
    const n = entry.name.toLowerCase();
    if (/think|processing|listening|idle|curious|relax/i.test(n)) {
      extra += 450;
    }
    this.#nextGestureCooldownUntilMs = Date.now() + base + extra;
  }

  #executeSchedule(entry: QueueEntry): void {
    const playGen = this.#scheduleGeneration;
    this.#inFlight += 1;
    bumpIntentFromGesturePlayName(entry.name);
    void this.#runEntryAsync(entry, playGen);
  }

  async #runEntryAsync(entry: QueueEntry, playGen: number): Promise<void> {
    const t0 = perfNow();
    const displayToken = this.#nextGestureToken++;
    this.#gestureDisplayToken = displayToken;
    this.#currentName = entry.name;
    this.#currentPriority = entry.priority;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, ms));
      });

    devLog('info', `🎭 Playing: ${entry.name} (priority=${entry.priority} duration=${entry.durationMs}ms)`);

    let bypassPresenceGap = false;
    let completedBodyPlay = false;
    let holdLane: 'REACTION' | 'GESTURE' | 'IDLE' | null = null;

    const finishDisplayIfOwner = () => {
      if (this.#gestureDisplayToken === displayToken) {
        this.#currentName = null;
        this.#currentPriority = (PRIORITY.BACKGROUND + 1) as PriorityValue;
      }
    };

    try {
      const resolvedStem = this.#resolveStemForPlay(entry.name);
      if (
        resolvedStem
        && this.#lastGestureStemKey === resolvedStem.toLowerCase()
        && Date.now() < this.#repeatGateUntilMs
      ) {
        devLog('info', `skip repeat stem "${resolvedStem}" (same VRMA within 3–5s gate)`);
        motionDiagIncrBlock('gestureRepeat');
        motionDebug('PLAY BLOCKED:', 'stem-repeat-gate', resolvedStem);
        finishDisplayIfOwner();
        this.#playDone(playGen);
        return;
      }

      bypassPresenceGap = entry.priority === PRIORITY.CRITICAL && !entry.humanPad;
      const nowWall = Date.now();
      if (!bypassPresenceGap && this.#presenceQuietUntilMs > nowWall) {
        await sleep(this.#presenceQuietUntilMs - nowWall);
      }
      if (playGen !== this.#scheduleGeneration) {
        finishDisplayIfOwner();
        this.#playDone(playGen);
        return;
      }

      if (entry.humanPad) {
        if (Math.random() < getHesitationChance()) {
          await sleep(120 + Math.floor(Math.random() * 181));
        }
        if (playGen !== this.#scheduleGeneration) {
          finishDisplayIfOwner();
          this.#playDone(playGen);
          return;
        }
        const reactTotal = getReactionDelayMs();
        const reactA = Math.floor(reactTotal * (0.3 + Math.random() * 0.25));
        await sleep(reactA);
        await sleep(Math.max(0, reactTotal - reactA));
        if (playGen !== this.#scheduleGeneration) {
          finishDisplayIfOwner();
          this.#playDone(playGen);
          return;
        }

        const replyClass = entry.responseClass ?? 'neutral';
        const idep = entry.intentDepth;
        await applyReplyBehaviorPreamble(replyClass, idep);
        microExprPulseFromIntentDepth(replyClass, idep);
        if (playGen !== this.#scheduleGeneration) {
          finishDisplayIfOwner();
          this.#playDone(playGen);
          return;
        }
      }

      const nameL = entry.name.trim().toLowerCase().replace(/\s+/g, '');
      const motionLane: 'REACTION' | 'GESTURE' | 'IDLE' =
        entry.humanPad ? 'REACTION'
        : /^(idle[1-4]|relax)$/.test(nameL) ? 'IDLE'
        : 'GESTURE';
      if (motionLane === 'REACTION') {
        const rn = perfNow();
        if (rn - __reactionLaneLastMs < REACTION_LANE_DEBOUNCE_MS) {
          devLog('info', `reaction lane debounced (${Math.round(rn - __reactionLaneLastMs)}ms since last)`);
          finishDisplayIfOwner();
          this.#playDone(playGen);
          return;
        }
        __reactionLaneLastMs = rn;
      }
      const lockMs = entry.durationMs + (motionLane === 'REACTION' ? 2200 : 1400);
      releaseStaleNonVrmaAuthority();
      const mc = getMotionControllerState();
      const vrmaPrimary = mc.active && mc.source === 'VRMA';
      const skipMotionAcquire = vrmaPrimary && entry.priority !== PRIORITY.CRITICAL;
      if (!skipMotionAcquire) {
        if (!tryAcquireMotion(motionLane, lockMs, { force: entry.priority === PRIORITY.CRITICAL })) {
          devLog('info', `motion controller: blocked acquire (${motionLane}) — skip "${entry.name}"`);
          motionDebug('PLAY BLOCKED:', 'tryAcquireMotion', motionLane, entry.name);
          finishDisplayIfOwner();
          this.#playDone(playGen);
          return;
        }
        holdLane = motionLane;
      }

      let bodyDurationMs = entry.durationMs;
      if (entry.humanPad && Math.random() < 0.2) {
        bodyDurationMs = Math.round(bodyDurationMs * (0.72 + Math.random() * 0.18));
      }

      if (entry.crossFade && typeof window !== 'undefined') {
        this.#rawDispatch({ gesture: 'idle', type: 'idle', intensity: 0.3, duration: 0.08, priority: entry.priority });
        await sleep(MOTION_GATE_CROSSFADE_MS + MOTION_GATE_POST_IDLE_MS);
      }
      if (playGen !== this.#scheduleGeneration) {
        if (holdLane) releaseMotionIfHeld(holdLane);
        finishDisplayIfOwner();
        this.#playDone(playGen);
        return;
      }

      const scheduleBodyEnd = (bodyMs: number) => {
        const tailMs = Math.max(0, bodyMs);
        this.#armTimeout(tailMs, () => {
          if (holdLane) releaseMotionIfHeld(holdLane);
          if (completedBodyPlay) {
            recordBehaviorMotionAction();
          }
          this.#stats.lastMs = perfNow() - t0;
          finishDisplayIfOwner();
          this.#lastGestureCompleteMs = Date.now();
          this.#scheduleNextGestureCooldown(entry);
          if (!bypassPresenceGap) {
            this.#presenceQuietUntilMs = Date.now() + getPresenceGapMs();
          }
          devLog('info', `done "${entry.name}" in ${this.#stats.lastMs.toFixed(1)}ms`);
          this.#playDone(playGen);
        });
      };

      if (resolvedStem) {
        this.#dispatchVrma(resolvedStem, bodyDurationMs, entry.priority, entry.intensity, entry.mood);
        this.#stats.plays += 1;
        this.#lastCanonicalGesture = toCanonicalGesture(entry.name);
        this.#lastCanonicalGestureAt = perfNow();
        completedBodyPlay = true;
        motionDiagIncrPlay();
        scheduleBodyEnd(bodyDurationMs);
      } else {
        const fallback = GESTURE_FALLBACKS[entry.name.toLowerCase().replace(/\s+/g, '')];
        if (fallback) {
          await this.#runFallbackChain(fallback, entry, playGen);
          if (playGen !== this.#scheduleGeneration) {
            if (holdLane) releaseMotionIfHeld(holdLane);
            finishDisplayIfOwner();
            this.#playDone(playGen);
            return;
          }
          this.#stats.plays += 1;
          this.#lastCanonicalGesture = toCanonicalGesture(entry.name);
          this.#lastCanonicalGestureAt = perfNow();
          completedBodyPlay = true;
          motionDiagIncrPlay();
          if (holdLane) releaseMotionIfHeld(holdLane);
          this.#stats.lastMs = perfNow() - t0;
          finishDisplayIfOwner();
          this.#lastGestureCompleteMs = Date.now();
          this.#scheduleNextGestureCooldown(entry);
          if (!bypassPresenceGap) {
            this.#presenceQuietUntilMs = Date.now() + getPresenceGapMs();
          }
          devLog('info', `done "${entry.name}" in ${this.#stats.lastMs.toFixed(1)}ms`);
          recordBehaviorMotionAction();
          this.#playDone(playGen);
        } else {
          devLog('warn', `"${entry.name}" has no VRMA or fallback — action-text dispatch`);
          this.#stats.fallbacks += 1;
          try { dispatchGestureFromActionText(entry.name); } catch { /* ignore */ }
          const tail = entry.durationMs > 0 ? Math.min(entry.durationMs, 3000) : 0;
          this.#stats.plays += 1;
          this.#lastCanonicalGesture = toCanonicalGesture(entry.name);
          this.#lastCanonicalGestureAt = perfNow();
          completedBodyPlay = true;
          motionDiagIncrPlay();
          scheduleBodyEnd(tail);
        }
      }
    } catch (e) {
      this.#stats.errors += 1;
      devLog('error', `execute "${entry.name}" failed`, e);
      if (holdLane) releaseMotionIfHeld(holdLane);
      finishDisplayIfOwner();
      this.#playDone(playGen);
    }
  }

  #dispatchVrma(stemIn: string, durationMs: number, priority: PriorityValue, intensity?: number, mood?: string): void {
    if (isVrmaPlaybackGloballyDisabled()) {
      motionDebug('VRMA POLICY:', 'dispatch-bypass', stemIn);
      return;
    }
    const stem = sanitizeVrmaStem(stemIn);
    const canonical = VRMA_TO_CANONICAL[stem] ?? 'idle';
    const url = this.resolveVrmaUrl(stem);
    const loop = /^Idle[1-4]$/i.test(stem) || stem === 'Relax';

    devLog('info', `📡 Dispatching gesture: ${stem} → ${canonical} url=${url} intensity=${intensity ?? 0.82} mood=${mood ?? 'neutral'}`);

    const i =
      typeof intensity === 'number' ? clampMotionIntensity(intensity) : clampMotionIntensity(0.18);

    // Single motion pipeline: mixer plays via `avatar:vrma:play` (VRMAPlayer). `avatar:gesture` with
    // `motion: 'vrma'` is head/gaze only (VRMAPlayer ignores that flag to avoid double-loading the same clip).
    // Baseline looping idle stays on one mixer action; gesture clips crossfade in and return to baseline when done.
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('avatar:vrma:play', {
            detail: {
              url,
              durationMs: Math.max(0, durationMs),
              loop,
              vrmaStem: stem,
            },
          }),
        );
      } catch { /* no loader mounted — safe to ignore */ }
    }

    const nowR = Date.now();
    this.#lastGestureStemKey = stem.toLowerCase();
    this.#repeatGateUntilMs = nowR + 3000;

    this.#rawDispatch({
      gesture: canonical,
      type: canonical,
      motion: 'vrma',
      intensity: i,
      mood: mood ?? 'neutral',
      duration: Math.max(0.5, durationMs / 1000),
      side: 'right',
      priority,
      vrmaStem: stem,
    });
  }

  async #runFallbackChain(fb: FallbackConfig, entry: QueueEntry, playGen: number): Promise<void> {
    this.#stats.fallbacks += 1;
    devLog('info', `fallback "${entry.name}" strategy=${fb.strategy} gestures=[${fb.gestures.join(',')}]`);

    const each = fb.eachDurationMs ?? this.#resolveDuration(fb.gestures[0] ?? 'idle');
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, ms));
      });

    switch (fb.strategy) {
      case 'single': {
        const stem = this.#resolveStemForPlay(fb.gestures[0] ?? 'idle');
        if (stem) {
          this.#dispatchVrma(stem, each, entry.priority, entry.intensity, entry.mood);
          if (each > 0) await sleep(each);
        } else {
          try { dispatchGestureFromActionText(fb.gestures[0] ?? 'idle'); } catch { /* ignore */ }
          if (each > 0) await sleep(Math.min(each, 3000));
        }
        break;
      }
      case 'blend': {
        for (const g of fb.gestures) {
          if (playGen !== this.#scheduleGeneration) return;
          const stem = this.#resolveStemForPlay(g);
          if (stem) {
            this.#dispatchVrma(stem, each, entry.priority, entry.intensity, entry.mood);
            if (each > 0) await sleep(each);
          } else {
            try { dispatchGestureFromActionText(g); } catch { /* ignore */ }
            if (each > 0) await sleep(Math.min(each, 3000));
          }
          if (fb.blendMs && fb.blendMs > 0) await sleep(fb.blendMs);
        }
        break;
      }
      case 'sequence': {
        const gap = fb.gapMs ?? 200;
        for (const g of fb.gestures) {
          if (playGen !== this.#scheduleGeneration) return;
          const stem = this.#resolveStemForPlay(g);
          if (stem) {
            this.#dispatchVrma(stem, each, entry.priority, entry.intensity, entry.mood);
            if (each > 0) await sleep(each);
          } else {
            try { dispatchGestureFromActionText(g); } catch { /* ignore */ }
            if (each > 0) await sleep(Math.min(each, 3000));
          }
          if (gap > 0) await sleep(gap);
        }
        break;
      }
    }
  }

  #interrupt(reason: string): void {
    devLog('info', `interrupt: ${reason}`);
    this.#clearAllTimeouts();
    this.#scheduleGeneration += 1;
    this.#inFlight = 0;
    for (const lane of ['REACTION', 'GESTURE', 'IDLE'] as const) {
      releaseMotionIfHeld(lane);
    }
    this.#currentName = null;
    this.#currentPriority = (PRIORITY.BACKGROUND + 1) as PriorityValue;
    this.#processing = false;
    this.#drainWavePendingCheck = false;
  }

  // ── Resolution helpers ───────────────────────────────────────────────────────

  #lookupStem(name: string): string | null {
    const key = name.toLowerCase().replace(/\s+/g, '');
    const stem = GESTURE_FILENAME_MAP[key];
    return stem ?? null;
  }

  /** Randomize among subtle “thinking” family clips (not always Thinking.vrma). */
  #pickThinkingStem(): string {
    const last = this.#lastGestureStemKey?.toLowerCase() ?? '';
    const pool =
      last.length > 0
        ? THINKING_STEM_ALTS.filter((s) => s.toLowerCase() !== last)
        : [...THINKING_STEM_ALTS];
    return pool[Math.floor(Math.random() * Math.max(1, pool.length))] ?? 'Thinking';
  }

  /** Map display name → VRMA stem; thinking-like inputs pick a random alt. */
  #resolveStemForPlay(name: string): string | null {
    const key = name.trim().toLowerCase().replace(/\s+/g, '');
    const mapped = GESTURE_FILENAME_MAP[key];
    if (!mapped) return null;
    if (mapped === 'Thinking' || key === 'thinking' || key === 'think') {
      return sanitizeVrmaStem(this.#pickThinkingStem());
    }
    if (mapped === 'Waving' && (key === 'wave' || key === 'waving')) {
      return sanitizeVrmaStem(Math.random() < 0.52 ? 'Waving' : 'greeting');
    }
    return sanitizeVrmaStem(mapped);
  }

  #resolvePriority(name: string): PriorityValue {
    const key = name.toLowerCase().replace(/\s+/g, '');
    // Check exact, then prefix match
    const exact = GESTURE_PRIORITY_MAP[key];
    if (exact !== undefined) return exact;
    for (const [k, v] of Object.entries(GESTURE_PRIORITY_MAP)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    return PRIORITY.NORMAL;
  }

  #resolveDuration(name: string): number {
    const key = name.toLowerCase().replace(/\s+/g, '');
    return GESTURE_DURATION_MS[key] ?? GESTURE_DURATION_MS['default'] ?? 2000;
  }

  #randomIdle(): string {
    const idles = ['Idle1', 'Idle2', 'Idle3', 'Idle4'];
    return idles[Math.floor(Math.random() * idles.length)];
  }

  // ── Procedural descriptor (AgentDirector) ────────────────────────────────────

  #resolveDescriptor(actionText: string, emotion?: string): GestureDescriptor {
    for (const { pattern, gesture } of ACTION_PATTERNS) {
      if (pattern.test(actionText)) {
        const eh = emotion ? EMOTION_HINTS[emotion] : undefined;
        return {
          type:      gesture.type      ?? 'openHand',
          side:      gesture.side      ?? 'right',
          intensity: Math.min(1.5, (gesture.intensity ?? 0.8) * (eh?.intensity ?? 1.0)),
          duration:  gesture.duration  ?? eh?.duration ?? 2.0,
        };
      }
    }
    if (emotion && EMOTION_HINTS[emotion]) {
      const h = EMOTION_HINTS[emotion];
      return { type: h.type ?? 'openHand', side: 'right', intensity: h.intensity ?? 0.8, duration: h.duration ?? 2.0 };
    }
    return { type: 'beat', side: 'right', intensity: 0.5, duration: 1.5 };
  }

  #descriptorToCanonical(t: GestureDescriptor['type']): CanonicalGesture {
    if (t === 'wave') return 'wave';
    if (t === 'point') return 'point';
    return 'explain';
  }

  #dispatchDescriptor(g: GestureDescriptor): void {
    this.#rawDispatch({
      type: g.type,
      gesture: this.#descriptorToCanonical(g.type),
      side: g.side ?? 'right',
      intensity: g.intensity ?? 0.8,
      duration: g.duration ?? 2.0,
      speed: g.speed ?? 1.0,
    });
  }

  #queueDescriptor(g: GestureDescriptor): void {
    void this.play(g.type, {
      priority: PRIORITY.NORMAL,
      durationMs: (g.duration ?? 2.0) * 1000,
    });
  }

  // ── Raw event dispatch ───────────────────────────────────────────────────────

  #rawDispatch(detail: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('avatar:gesture', { detail }));
    } catch (e) {
      this.#stats.errors += 1;
      devLog('error', '#rawDispatch', e);
    }
  }

  /** Minimal life when a drain wave completed without a successful body play. */
  #dispatchMicroIdlePulse(): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(
        new CustomEvent('avatar:micro:gesture', {
          detail: { kind: 'question_tilt', durationMs: 460 },
        }),
      );
    } catch {
      /* */
    }
  }

  /** Light idle-shift style motion when VRMA holds but last motion action has been quiet. */
  #maybeVrmaIdleShiftNudge(): void {
    const mc = getMotionControllerState();
    if (!mc.active || mc.source !== 'VRMA') return;
    const b = getBehaviorMotionState();
    const now = perfNow();
    if (b.lastActionTime <= 0) return;
    const idleTooLong = now - b.lastActionTime;
    if (idleTooLong <= 2000) return;
    if (now - __lastVrmaIdleShiftMs < VRMA_IDLE_SHIFT_MIN_INTERVAL_MS) return;
    __lastVrmaIdleShiftMs = now;
    queueMicrotask(() => {
      void this.play('Agreeing', {
        priority: PRIORITY.LOW,
        humanTiming: false,
        behaviorBrain: false,
      });
    });
  }
}

// ─── Singleton exports ────────────────────────────────────────────────────────

export const unifiedGestureEngine = new UnifiedGestureEngine();
/** Backward compat: AgentDirector imports `gestureEngine` from this path */
export const gestureEngine = unifiedGestureEngine;
