'use client';

/**
 * Level 6 + 6.1 + 7 + 7.1 + 7.2 + 7.3 execution bridge:
 * brain → merge → memory → arbitrator → emotion continuity (temporal affect) → GlobalMindFrame
 * → budget-scaled perturb → coherence gate → damped budget → BehaviorComposer
 * → queued staggered dispatch (TimeCore + UnifiedTimingController).
 */

import React, { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { LEVEL6_UNIFIED_BEHAVIOR } from '@/config/avatar';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';
import { BehaviorBrain, type BehaviorBrainEvent } from './BehaviorBrain';
import { BehaviorArbitrator } from './BehaviorArbitrator';
import type { Intent, IntentEmotion, MotionPlan } from './intentTypes';
import { BehaviorMemory } from './BehaviorMemory';
import type { EmotionState } from './EmotionDrift';
import {
  createEmotionContinuity,
  resetEmotionContinuity,
  setApprovedTarget,
  tickEmotionContinuity,
  type EmotionContinuityCore,
} from './EmotionContinuity';
import { mergeIntents } from './IntentMerger';
import { TimeCore } from './TimeCore';
import { buildFrame, mindJitterMs } from './FrameBuilder';
import { setGlobalFrame, getGlobalFrame } from './GlobalMindStore';
import {
  composeBehavior,
  runSpeechMindPhase,
  type ComposedBehavior,
} from './BehaviorComposer';
import { perturbMindFrame, microConflictHesitationMs } from './ConsciousInstability';
import { applyCoherenceGate, computeCoherence } from './CoherenceGate';
import { dampen } from './StabilityDampener';
import { defaultBudget } from './InstabilityBudget';
import { UnifiedTimingController } from './UnifiedTimingController';
import { dispatchMicroExpression } from './MicroExpressionEngine';
import { dispatchSaccadeSample } from './EyeMicroMovement';

export const BEHAVIOR_TEXT_EVENT = 'avatar:behavior:text' as const;

const STRESS_TEST_MODE =
  typeof process !== 'undefined' &&
  (process.env.NEXT_PUBLIC_STRESS_TEST_MODE === 'true' ||
    process.env.STRESS_TEST_MODE === 'true');

export type BehaviorBrainHostProps = {
  enabled?: boolean;
  motorSpeedMulRef?: MutableRefObject<number>;
  isTalkingRef?: MutableRefObject<boolean>;
};

const INTENT_EMOTIONS: readonly IntentEmotion[] = [
  'neutral',
  'happy',
  'curious',
  'focused',
  'surprised',
];

function isIntentEmotion(s: string): s is IntentEmotion {
  return (INTENT_EMOTIONS as readonly string[]).includes(s);
}

function applyMemorySoftenIntent(intent: Intent, memory: BehaviorMemory): Intent {
  if (!memory.wasRecentlyUsed(intent.type)) return intent;
  if (intent.type === 'speaking' || intent.type === 'listening') return intent;
  return {
    ...intent,
    type: 'thinking',
    emotion: 'curious',
    intensity: Math.min(1, Math.max(0, intent.intensity * 0.75)),
    confidence: Math.min(intent.confidence, 0.72),
  };
}

function dispatchGazeOnly(plan: MotionPlan): void {
  const pm = plan.poseModifiers;
  if (!pm) return;
  if (pm.eyeFocus === 'user') {
    window.dispatchEvent(
      new CustomEvent('avatar:gaze', {
        detail: { yaw: 0.05, pitch: -0.03, durationMs: plan.timing.durationMs },
      }),
    );
  } else if (pm.eyeFocus === 'away') {
    window.dispatchEvent(
      new CustomEvent('avatar:gaze', {
        detail: { yaw: -0.14, pitch: 0.07, durationMs: plan.timing.durationMs },
      }),
    );
  }
}

function dispatchHeadOnly(plan: MotionPlan): void {
  const pm = plan.poseModifiers;
  if (!pm || typeof pm.headTilt !== 'number') return;
  window.dispatchEvent(
    new CustomEvent('avatar:headpose', {
      detail: {
        pitch: Math.max(-0.22, Math.min(0.22, pm.headTilt * 0.75)),
        yaw: typeof pm.spineLean === 'number' ? pm.spineLean * 0.12 : 0,
        durationMs: plan.timing.durationMs,
      },
    }),
  );
}

function dispatchEmotionOnly(plan: MotionPlan): void {
  if (!plan.emotionDispatch) return;
  dispatchAvatar('avatar:emotion', {
    emotion: plan.emotionDispatch.emotion,
    strength: plan.emotionDispatch.strength,
  });
}

function dispatchGestureOnly(
  plan: MotionPlan,
  lastGestureRef: React.MutableRefObject<string | null>,
  intensityScale = 1,
): void {
  if (!plan.gesture) return;
  const g = plan.gesture;
  if (g === 'idle') {
    if (lastGestureRef.current === 'idle') return;
    lastGestureRef.current = 'idle';
  } else {
    lastGestureRef.current = g;
  }
  const s = Math.min(1.05, Math.max(0.45, intensityScale));
  dispatchAvatar('avatar:gesture', {
    gesture: g,
    type: g,
    duration: Math.max(0.35, plan.timing.durationMs / 1000),
    source: 'behavior_l7',
    intensity: Math.min(0.94, 0.72 * s),
    variance: Math.min(0.22, 0.08 + (1 - s) * 0.2),
  });
}

function dispatchMotorOnly(
  plan: MotionPlan,
  motorSpeedMulRef?: MutableRefObject<number>,
): void {
  if (
    !motorSpeedMulRef ||
    typeof plan.motorMulHint !== 'number' ||
    !Number.isFinite(plan.motorMulHint)
  ) {
    return;
  }
  const pad = motorSpeedMulRef.current;
  const hint = Math.max(0.55, Math.min(1.45, plan.motorMulHint));
  motorSpeedMulRef.current = pad * 0.62 + hint * 0.38;
}

function executeMotionPlanMonolithic(
  plan: MotionPlan,
  lastGestureRef: React.MutableRefObject<string | null>,
  motorSpeedMulRef: MutableRefObject<number> | undefined,
  gestureIntensityScale: number,
): void {
  const pm = plan.poseModifiers;
  if (pm) {
    dispatchGazeOnly(plan);
    if (typeof pm.headTilt === 'number') dispatchHeadOnly(plan);
  }
  dispatchEmotionOnly(plan);
  dispatchGestureOnly(plan, lastGestureRef, gestureIntensityScale);
  dispatchMotorOnly(plan, motorSpeedMulRef);
}

function scheduleStaggeredPlan(
  plan: MotionPlan,
  lastGestureRef: React.MutableRefObject<string | null>,
  motorSpeedMulRef: MutableRefObject<number> | undefined,
  timeoutIds: number[],
  gestureIntensityScale: number,
): number {
  const lt = plan.layerTimings;
  if (!lt) {
    const d = Math.max(0, plan.timing.delayMs);
    timeoutIds.push(
      window.setTimeout(
        () =>
          executeMotionPlanMonolithic(
            plan,
            lastGestureRef,
            motorSpeedMulRef,
            gestureIntensityScale,
          ),
        d,
      ),
    );
    return d + Math.min(1600, plan.timing.durationMs * 0.28);
  }

  const base = Math.max(0, plan.timing.delayMs);
  const emotionAt = base + (lt.headDelayMs + lt.gestureDelayMs) * 0.45;

  timeoutIds.push(
    window.setTimeout(() => dispatchGazeOnly(plan), base + lt.gazeDelayMs),
  );
  timeoutIds.push(window.setTimeout(() => dispatchEmotionOnly(plan), emotionAt));
  timeoutIds.push(
    window.setTimeout(() => dispatchHeadOnly(plan), base + lt.headDelayMs),
  );
  timeoutIds.push(
    window.setTimeout(
      () => dispatchGestureOnly(plan, lastGestureRef, gestureIntensityScale),
      base + lt.gestureDelayMs,
    ),
  );
  timeoutIds.push(
    window.setTimeout(
      () => dispatchMotorOnly(plan, motorSpeedMulRef),
      base + lt.gestureDelayMs + 40,
    ),
  );

  const lastFire = base + lt.gestureDelayMs + 80;
  return lastFire + Math.min(1600, plan.timing.durationMs * 0.22);
}

export function BehaviorBrainHost({
  enabled = true,
  motorSpeedMulRef,
  isTalkingRef,
}: BehaviorBrainHostProps): null {
  const brainRef = useRef(new BehaviorBrain());
  const arbitratorRef = useRef(new BehaviorArbitrator());
  const memoryRef = useRef(new BehaviorMemory());
  const lastMergedIntentRef = useRef<Intent | null>(null);
  const emotionContinuityRef = useRef<EmotionContinuityCore>(createEmotionContinuity());
  const emotionDriftRef = useRef<EmotionState>({ ...emotionContinuityRef.current.display });
  const lastRafDmsRef = useRef(16);

  const lastGestureRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const queueRef = useRef<ComposedBehavior[]>([]);
  const processingRef = useRef(false);
  const processTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainTimeoutIdsRef = useRef<number[]>([]);
  const speechAuxTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !LEVEL6_UNIFIED_BEHAVIOR) return;

    const brain = brainRef.current;
    const arbitrator = arbitratorRef.current;
    const memory = memoryRef.current;

    const clearSpeechAux = () => {
      speechAuxTimersRef.current.forEach((id) => clearTimeout(id));
      speechAuxTimersRef.current = [];
    };

    const clearChainTimeouts = () => {
      chainTimeoutIdsRef.current.forEach((id) => clearTimeout(id));
      chainTimeoutIdsRef.current = [];
    };

    const drainQueue = () => {
      if (processingRef.current) return;
      const composed = queueRef.current.shift();
      if (!composed) return;
      processingRef.current = true;
      clearChainTimeouts();

      const pe = composed.partialExecution;
      const plan = composed.motionPlan;
      const micro = composed.micro;
      const saccade = composed.saccade;
      const gestureIntensityScale = composed.gestureIntensityScale ?? 1;

      if (motorSpeedMulRef) {
        const cur = motorSpeedMulRef.current;
        motorSpeedMulRef.current =
          cur * 0.78 +
          composed.breathingMotorMul * 0.22 * pe.motorBreathScale;
      }

      const base = Math.max(0, plan.timing.delayMs);

      if (micro) {
        const md = Math.min(900, Math.max(50, base * 0.22));
        chainTimeoutIdsRef.current.push(
          window.setTimeout(() => dispatchMicroExpression(micro), md),
        );
      }
      if (saccade) {
        const sd = Math.min(220, Math.max(30, base * 0.12 + 35));
        chainTimeoutIdsRef.current.push(
          window.setTimeout(() => dispatchSaccadeSample(saccade), sd),
        );
      }

      const unlockMs = scheduleStaggeredPlan(
        plan,
        lastGestureRef,
        motorSpeedMulRef,
        chainTimeoutIdsRef.current,
        gestureIntensityScale,
      );
      const cool = Math.min(2600, Math.max(200, unlockMs));
      processTimerRef.current = setTimeout(() => {
        processingRef.current = false;
        drainQueue();
      }, cool);
    };

    const pushApprovedPipeline = () => {
      let proposed = brain.getIntent();
      const prevMergedType = lastMergedIntentRef.current?.type;

      proposed = mergeIntents(lastMergedIntentRef.current, proposed);
      lastMergedIntentRef.current = { ...proposed };

      proposed = applyMemorySoftenIntent(proposed, memory);

      const agentSpeaking = Boolean(isTalkingRef?.current);
      const res = arbitrator.arbitrate({
        proposed,
        agentSpeaking,
        userListeningPosture: proposed.type === 'listening',
      });
      if (!res.ok) return;

      const core = emotionContinuityRef.current;
      setApprovedTarget(core, {
        current: res.approved.emotion,
        intensity: res.approved.adjustedIntensity,
      });
      tickEmotionContinuity(core, Math.max(12, lastRafDmsRef.current));
      emotionDriftRef.current = { ...core.display };

      memory.add({
        intentType: res.approved.type,
        emotion: res.approved.emotion,
        timestamp: Date.now(),
      });

      const d = core.display;
      const emotionSafe: IntentEmotion = isIntentEmotion(d.current)
        ? d.current
        : res.approved.emotion;

      const intentSnapshot: Intent = {
        type: res.approved.type,
        emotion: emotionSafe,
        intensity: d.intensity,
        confidence: res.approved.confidence,
        duration: res.approved.duration,
        source: res.approved.source,
      };

      const frame = buildFrame(intentSnapshot, emotionDriftRef.current);
      const budgetForPerturb = dampen(defaultBudget, computeCoherence(frame));
      const shaken = perturbMindFrame(frame, TimeCore.get(), budgetForPerturb);
      const gated = applyCoherenceGate(shaken);
      setGlobalFrame(gated);

      const budget = dampen(defaultBudget, gated.coherence);
      const conflictMs = microConflictHesitationMs(
        TimeCore.get(),
        res.approved.type,
        prevMergedType,
        budget.conflict / defaultBudget.conflict,
      );
      const composed = composeBehavior(gated, res.approved, {
        conflictHesitationExtraMs: conflictMs,
        budget,
      });
      queueRef.current.push(composed);
      if (queueRef.current.length > 4) {
        queueRef.current.splice(0, queueRef.current.length - 4);
      }
      drainQueue();
    };

    const onListening = (e: Event) => {
      const d = (e as CustomEvent<{ active?: boolean; state?: string }>).detail;
      const active =
        d?.active !== undefined ? Boolean(d.active) : d?.state === 'start';
      const ev: BehaviorBrainEvent = { type: 'listening', active };
      brain.ingest(ev);
      pushApprovedPipeline();
    };

    const onBehaviorText = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; context?: 'conversation' | 'system' }>).detail;
      const text = typeof d?.text === 'string' ? d.text : '';
      if (!text.trim()) return;
      brain.ingest({
        type: 'behavior_text',
        text,
        context: d?.context === 'system' ? 'system' : 'conversation',
      });
      pushApprovedPipeline();
    };

    const onSpeechBridge = (e: Event) => {
      const d = (e as CustomEvent<{ phase?: string }>).detail;
      const phase = d?.phase;
      if (phase === 'pre_speech') {
        runSpeechMindPhase('pre_speech', getGlobalFrame());
        return;
      }
      if (phase === 'user_start') brain.ingest({ type: 'speech', phase: 'user_start' });
      else if (phase === 'user_end') brain.ingest({ type: 'speech', phase: 'user_end' });
      else if (phase === 'agent_start') {
        runSpeechMindPhase('speech_start', getGlobalFrame());
        const midDelay = 420 + mindJitterMs(220);
        const midId = window.setTimeout(() => {
          speechAuxTimersRef.current = speechAuxTimersRef.current.filter((x) => x !== midId);
          runSpeechMindPhase('speech_mid', getGlobalFrame());
        }, midDelay);
        speechAuxTimersRef.current.push(midId);
        brain.ingest({ type: 'speech', phase: 'agent_start' });
      } else if (phase === 'agent_end') {
        runSpeechMindPhase('speech_end', getGlobalFrame());
        brain.ingest({ type: 'speech', phase: 'agent_end' });
      } else return;
      pushApprovedPipeline();
    };

    window.addEventListener('avatar:listening', onListening);
    window.addEventListener(BEHAVIOR_TEXT_EVENT, onBehaviorText as EventListener);
    window.addEventListener('avatar:behavior:speech', onSpeechBridge as EventListener);

    const loop = (t: number) => {
      if (lastTickRef.current === 0) lastTickRef.current = t;
      const dt = t - lastTickRef.current;
      lastTickRef.current = t;
      const dms = Math.min(dt, 200);
      lastRafDmsRef.current = dms;
      tickEmotionContinuity(emotionContinuityRef.current, dms);
      emotionDriftRef.current = { ...emotionContinuityRef.current.display };
      TimeCore.tick(dms);
      UnifiedTimingController.sync(dms);
      brain.ingest({ type: 'tick', deltaMs: dms });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('avatar:listening', onListening);
      window.removeEventListener(BEHAVIOR_TEXT_EVENT, onBehaviorText as EventListener);
      window.removeEventListener('avatar:behavior:speech', onSpeechBridge as EventListener);
      cancelAnimationFrame(rafRef.current);
      if (processTimerRef.current) clearTimeout(processTimerRef.current);
      clearChainTimeouts();
      clearSpeechAux();
      queueRef.current = [];
      processingRef.current = false;
      TimeCore.reset();
      UnifiedTimingController.reset();
      resetEmotionContinuity(emotionContinuityRef.current);
      emotionDriftRef.current = { ...emotionContinuityRef.current.display };
    };
  }, [enabled, isTalkingRef, motorSpeedMulRef]);

  useEffect(() => {
    if (!enabled || !STRESS_TEST_MODE || typeof window === 'undefined' || !LEVEL6_UNIFIED_BEHAVIOR) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        try {
          const { runStressTestPipeline } = await import('./StressTestRunner');
          const report = await runStressTestPipeline();
          console.info('[BehaviorStressTest:StressReport]', report);
        } catch (e) {
          console.error('[BehaviorStressTest]', e);
        }
      })();
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);

  return null;
}
