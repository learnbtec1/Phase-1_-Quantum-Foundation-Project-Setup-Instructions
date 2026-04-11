export type { GlobalMindFrame } from './GlobalMindFrame';
export { setGlobalFrame, getGlobalFrame, clearGlobalFrame } from './GlobalMindStore';
export { buildFrame, mindJitterMs } from './FrameBuilder';
export { TimeCore } from './TimeCore';
export { composeBehavior, runSpeechMindPhase, type ComposedBehavior, type ComposeBehaviorOptions } from './BehaviorComposer';
export { perturbMindFrame, microConflictHesitationMs } from './ConsciousInstability';
export { warpDelayMs, warpDurationMs } from './ImperfectTiming';
export {
  evaluatePartialExecution,
  governedPartialExecution,
  type PartialExecutionRoll,
} from './PartialExecution';
export type { InstabilityBudget } from './InstabilityBudget';
export { defaultBudget } from './InstabilityBudget';
export {
  computeCoherence,
  applyCoherenceGate,
  COHERENCE_LOW_THRESHOLD,
  type GatedMindFrame,
} from './CoherenceGate';
export { dampen } from './StabilityDampener';
export { UnifiedTimingController } from './UnifiedTimingController';
export type { Intent, ApprovedIntent, MotionPlan, IntentType, IntentEmotion } from './intentTypes';
export { BehaviorBrain, type BehaviorBrainEvent } from './BehaviorBrain';
export type { BehaviorIntent, BehaviorEmotion, BehaviorState } from './BehaviorBrain';
export { BehaviorArbitrator, type ArbitrateInput, type ArbitrateResult } from './BehaviorArbitrator';
export { approvedIntentToMotionPlan } from './BehaviorToMotionMapper';
export { BehaviorMemory, type BehaviorMemoryEntry } from './BehaviorMemory';
export { driftEmotion, type EmotionState } from './EmotionDrift';
export {
  createEmotionContinuity,
  resetEmotionContinuity,
  setApprovedTarget,
  tickEmotionContinuity,
  type EmotionContinuityCore,
} from './EmotionContinuity';
export { applyGazeFirst } from './GazePriority';
export { mergeIntents } from './IntentMerger';
export { humanize } from './MotionHumanizer';
export {
  generateMicroExpression,
  dispatchMicroExpression,
  type MicroExpression,
  type MicroExpressionType,
} from './MicroExpressionEngine';
export { getBreathingRate, getBreathingAmplitude, applyBreathingMotorCoupling } from './BreathingEngine';
export { applySpeechCouplingPhase, type SpeechCouplingPhase } from './SpeechCoupling';
export { computeHesitation } from './HesitationEngine';
export { generateSaccade, dispatchSaccade, type SaccadeSample } from './EyeMicroMovement';
/** @deprecated Level 5 mapper — retained for reference; Level 6 uses BehaviorToMotionMapper. */
export { behaviorStateToPoseHints, type PoseMotionHints } from './BehaviorToPoseMapper';
export { BehaviorBrainHost, BEHAVIOR_TEXT_EVENT, type BehaviorBrainHostProps } from './BehaviorBrainHost';
export { runStressTestPipeline, STRESS_SCENARIOS, type StressReport, type StressScenario } from './StressTestRunner';
export type { StressTickSample } from './StressMetricsCollector';
