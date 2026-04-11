/**
 * Level 7 — Single source for motion + micro + breath + gaze nudge + timing.
 * Level 7.2 — Coherence gate, damped instability budget, governed partial execution, unified timing.
 * Host only executes {@link ComposedBehavior}; no parallel 6.2 engines in the host.
 */

import type { GlobalMindFrame } from './GlobalMindFrame';
import type { ApprovedIntent, MotionPlan } from './intentTypes';
import { approvedIntentToMotionPlan } from './BehaviorToMotionMapper';
import { applyGazeFirst } from './GazePriority';
import { computeHesitation } from './HesitationEngine';
import { generateMicroExpression, type MicroExpression } from './MicroExpressionEngine';
import { getBreathingAmplitude, getBreathingRate } from './BreathingEngine';
import { generateSaccade, type SaccadeSample } from './EyeMicroMovement';
import { mindJitterMs } from './FrameBuilder';
import { TimeCore } from './TimeCore';
import { warpDelayMs, warpDurationMs } from './ImperfectTiming';
import type { SpeechCouplingPhase } from './SpeechCoupling';
import { applySpeechCouplingPhase } from './SpeechCoupling';
import { applyCoherenceGate, type GatedMindFrame } from './CoherenceGate';
import { dampen } from './StabilityDampener';
import { defaultBudget, type InstabilityBudget } from './InstabilityBudget';
import {
  governedPartialExecution,
  evaluatePartialExecution,
  type PartialExecutionRoll,
} from './PartialExecution';
import { UnifiedTimingController } from './UnifiedTimingController';

export type ComposeBehaviorOptions = {
  /** Extra hesitation from micro-conflict between intent streams (ms). */
  conflictHesitationExtraMs?: number;
  /** Level 7.2 — dampened caps; defaults from {@link dampen} + {@link defaultBudget}. */
  budget?: InstabilityBudget;
};

export type ComposedBehavior = {
  motionPlan: MotionPlan;
  micro: MicroExpression | null;
  saccade: SaccadeSample | null;
  breathingMotorMul: number;
  hesitationMs: number;
  /** Intensity multiplier after partial roll (host passes through to gesture dispatch). */
  gestureIntensityScale?: number;
  /** Baked at compose time; host uses motor breath scale from here. */
  partialExecution: PartialExecutionRoll;
};

function humanizeMind(plan: MotionPlan): MotionPlan {
  const delayJitter = mindJitterMs(60);
  const durationJitter = mindJitterMs(120);
  const next: MotionPlan = {
    ...plan,
    timing: {
      delayMs: plan.timing.delayMs + delayJitter,
      durationMs: plan.timing.durationMs + durationJitter,
    },
  };
  if (next.layerTimings) {
    const lt = next.layerTimings;
    next.layerTimings = {
      gazeDelayMs: lt.gazeDelayMs + mindJitterMs(12),
      headDelayMs: lt.headDelayMs + mindJitterMs(22),
      gestureDelayMs: lt.gestureDelayMs + mindJitterMs(28),
    };
  }
  return next;
}

function applyPartialPlanMutations(plan: MotionPlan, pe: PartialExecutionRoll): MotionPlan {
  let next: MotionPlan = { ...plan };
  if (pe.dropGesture && next.gesture && next.gesture !== 'idle') {
    next = {
      ...next,
      gesture: 'idle',
      timing: {
        ...next.timing,
        durationMs: Math.min(next.timing.durationMs, 380),
      },
    };
  }
  if (pe.delayGestureExtraMs > 0) {
    if (next.layerTimings) {
      next = {
        ...next,
        layerTimings: {
          ...next.layerTimings,
          gestureDelayMs: next.layerTimings.gestureDelayMs + pe.delayGestureExtraMs,
        },
      };
    } else {
      next = {
        ...next,
        timing: {
          ...next.timing,
          delayMs: next.timing.delayMs + pe.delayGestureExtraMs,
        },
      };
    }
  }
  return next;
}

/**
 * Fold L6 motion map + L6.1 gaze stagger + L6.2 hesitation / breath / micro / saccade intent.
 */
export function composeBehavior(
  frame: GlobalMindFrame,
  approved: ApprovedIntent,
  opts?: ComposeBehaviorOptions,
): ComposedBehavior {
  const t = TimeCore.get();

  const framed: GatedMindFrame =
    frame.coherence !== undefined
      ? (frame as GatedMindFrame)
      : applyCoherenceGate(frame);

  const budget = opts?.budget ?? dampen(defaultBudget, framed.coherence);
  const timingStrength = Math.max(0, Math.min(1.15, budget.timing / defaultBudget.timing));

  let plan = approvedIntentToMotionPlan(approved);
  plan = applyGazeFirst(plan);
  plan = humanizeMind(plan);

  const hesitationMs = computeHesitation(framed.intent);
  plan.timing.delayMs += hesitationMs + (opts?.conflictHesitationExtraMs ?? 0);

  plan.timing.delayMs = warpDelayMs(plan.timing.delayMs, t, timingStrength);
  plan.timing.durationMs = warpDurationMs(plan.timing.durationMs, t + 13, timingStrength);
  if (plan.layerTimings) {
    const lt = plan.layerTimings;
    plan = {
      ...plan,
      layerTimings: {
        gazeDelayMs: warpDelayMs(lt.gazeDelayMs, t + 17, timingStrength),
        headDelayMs: warpDelayMs(lt.headDelayMs, t + 29, timingStrength),
        gestureDelayMs: warpDelayMs(lt.gestureDelayMs, t + 41, timingStrength),
      },
    };
  }

  plan = governedPartialExecution(plan, budget, framed.coherence, t);

  const pe = evaluatePartialExecution(t, framed, budget, framed.coherence);
  plan = applyPartialPlanMutations(plan, pe);

  plan = UnifiedTimingController.applyToMotionPlan(plan, budget.timing);

  const rate = getBreathingRate(framed.emotion.current);
  const amp = getBreathingAmplitude(framed.arousal);
  const breathingMotorMul = Math.min(
    1.45,
    Math.max(0.55, 0.82 + (rate - 1) * 0.22 + amp * 1.1),
  );

  const micro =
    framed.cognitiveLoad > 0.3 && !pe.dropMicro
      ? generateMicroExpression(framed.intent)
      : null;

  const saccade =
    !pe.dropSaccade &&
    (framed.attention > 0.56 || framed.cognitiveLoad > 0.42)
      ? generateSaccade()
      : null;

  return {
    motionPlan: plan,
    micro,
    saccade,
    breathingMotorMul,
    hesitationMs,
    gestureIntensityScale: pe.gestureIntensityScale,
    partialExecution: pe,
  };
}

/** Speech side-effects still use the same channel stack; entry point is unified here. */
export function runSpeechMindPhase(
  phase: SpeechCouplingPhase,
  _frame: GlobalMindFrame | null,
): void {
  void _frame;
  applySpeechCouplingPhase(phase);
}
