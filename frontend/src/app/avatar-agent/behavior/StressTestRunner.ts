/**
 * Dev-only behavioral stress harness: replays scenarios through the same pipeline
 * modules as {@link BehaviorBrainHost} (no React), collects {@link StressReport}.
 */

import { BehaviorBrain } from './BehaviorBrain';
import { BehaviorArbitrator } from './BehaviorArbitrator';
import type { Intent, IntentEmotion, ApprovedIntent } from './intentTypes';
import { BehaviorMemory } from './BehaviorMemory';
import { mergeIntents } from './IntentMerger';
import { TimeCore } from './TimeCore';
import { buildFrame } from './FrameBuilder';
import { perturbMindFrame, microConflictHesitationMs } from './ConsciousInstability';
import { applyCoherenceGate, computeCoherence } from './CoherenceGate';
import { dampen } from './StabilityDampener';
import { defaultBudget } from './InstabilityBudget';
import { composeBehavior } from './BehaviorComposer';
import {
  createEmotionContinuity,
  setApprovedTarget,
  tickEmotionContinuity,
  type EmotionContinuityCore,
} from './EmotionContinuity';
import { STRESS_SCENARIOS, type StressScenario, type StressScenarioStep } from './StressScenarios';
import {
  StressMetricsCollector,
  type StressReport,
  type StressTickSample,
} from './StressMetricsCollector';

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

type SimContext = {
  brain: BehaviorBrain;
  memory: BehaviorMemory;
  arbitrator: BehaviorArbitrator;
  continuity: EmotionContinuityCore;
  lastMerged: Intent | null;
  lastDeltaMs: number;
};

function createSimContext(): SimContext {
  return {
    brain: new BehaviorBrain(),
    memory: new BehaviorMemory(),
    arbitrator: new BehaviorArbitrator(),
    continuity: createEmotionContinuity(),
    lastMerged: null,
    lastDeltaMs: 16,
  };
}

/**
 * One push through merge → memory → arbitrate → 7.3 continuity → L7 frame → 7.1/7.2 compose.
 * Mirrors {@link BehaviorBrainHost} `pushApprovedPipeline` without dispatch / queue.
 */
function runPipelineOnce(
  ctx: SimContext,
  opts: { agentSpeaking: boolean },
): StressTickSample | null {
  let proposed = ctx.brain.getIntent();
  const prevMergedType = ctx.lastMerged?.type;

  proposed = mergeIntents(ctx.lastMerged, proposed);
  ctx.lastMerged = { ...proposed };

  proposed = applyMemorySoftenIntent(proposed, ctx.memory);

  const res = ctx.arbitrator.arbitrate({
    proposed,
    agentSpeaking: opts.agentSpeaking,
    userListeningPosture: proposed.type === 'listening',
  });
  if (!res.ok) return null;

  setApprovedTarget(ctx.continuity, {
    current: res.approved.emotion,
    intensity: res.approved.adjustedIntensity,
  });
  tickEmotionContinuity(ctx.continuity, Math.max(12, ctx.lastDeltaMs));

  ctx.memory.add({
    intentType: res.approved.type,
    emotion: res.approved.emotion,
    timestamp: Date.now(),
  });

  const d = ctx.continuity.display;
  const emotionSafe: IntentEmotion = isIntentEmotion(d.current) ? d.current : res.approved.emotion;

  const intentSnapshot: Intent = {
    type: res.approved.type,
    emotion: emotionSafe,
    intensity: d.intensity,
    confidence: res.approved.confidence,
    duration: res.approved.duration,
    source: res.approved.source,
  };

  const frame = buildFrame(intentSnapshot, { ...d });
  const budgetForPerturb = dampen(defaultBudget, computeCoherence(frame));
  const shaken = perturbMindFrame(frame, TimeCore.get(), budgetForPerturb);
  const gated = applyCoherenceGate(shaken);
  const budget = dampen(defaultBudget, gated.coherence);
  const conflictMs = microConflictHesitationMs(
    TimeCore.get(),
    res.approved.type,
    prevMergedType,
    budget.conflict / defaultBudget.conflict,
  );
  const approved: ApprovedIntent = { ...res.approved };
  const composed = composeBehavior(gated, approved, {
    conflictHesitationExtraMs: conflictMs,
    budget,
  });

  const plan = composed.motionPlan;
  const lt = plan.layerTimings;
  const timingIntentToGestureMs = plan.timing.delayMs + (lt?.gestureDelayMs ?? 0);
  const speechActionDelayMs = composed.hesitationMs + plan.timing.delayMs;
  const pe = composed.partialExecution;

  return {
    scenarioId: '',
    timingIntentToGestureMs,
    emotionLabel: gated.emotion.current,
    emotionIntensityValue: gated.emotion.intensity,
    coherence: gated.coherence,
    partialDropGesture: Boolean(pe.dropGesture || !plan.gesture),
    partialDropMicro: pe.dropMicro,
    partialDropSaccade: pe.dropSaccade,
    gazeEyeFocus: plan.poseModifiers?.eyeFocus,
    speechActionDelayMs,
  };
}

function applyScenarioStep(ctx: SimContext, step: StressScenarioStep): number {
  if (step.type === 'behavior_text') {
    ctx.brain.ingest({ type: 'behavior_text', text: step.text, context: step.context });
    return 20;
  }
  ctx.brain.ingest({ type: 'tick', deltaMs: step.deltaMs });
  return step.deltaMs;
}

function runScenario(
  scenario: StressScenario,
  collector: StressMetricsCollector,
): void {
  const ctx = createSimContext();
  for (const step of scenario.steps) {
    const dms = Math.min(200, Math.max(4, applyScenarioStep(ctx, step)));
    ctx.lastDeltaMs = dms;
    TimeCore.tick(dms);
    const sample = runPipelineOnce(ctx, { agentSpeaking: false });
    if (sample) sample.scenarioId = scenario.id;
    collector.addSample(scenario.id, sample);
  }
}

/**
 * Run all predefined scenarios; advances {@link TimeCore} monotonically (no reset).
 * Safe to call while the host is mounted: only adds simulated ms to the shared clock.
 */
export async function runStressTestPipeline(): Promise<StressReport> {
  const collector = new StressMetricsCollector();
  for (const scenario of STRESS_SCENARIOS) {
    runScenario(scenario, collector);
    await Promise.resolve();
  }
  return collector.finalize(STRESS_SCENARIOS.map((s) => ({ id: s.id, name: s.name })));
}

export { STRESS_SCENARIOS, type StressScenario } from './StressScenarios';
export type { StressReport, StressTickSample } from './StressMetricsCollector';
