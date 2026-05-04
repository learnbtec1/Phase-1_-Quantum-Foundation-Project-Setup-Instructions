'use client';

export type { BoneCoordinateSystem, EulerAxis } from './skeletonCoordinateSystem';
export { PROCEDURAL_V2_BONE_AXES } from './skeletonCoordinateSystem';
export type { AnatomicalDelta } from './calibratedAnatomicalMotion';
export {
  applyCalibratedAnatomicalDelta,
  anatomicalToEulerDelta,
  assertGlobalRotationGuardNotUsed,
} from './calibratedAnatomicalMotion';
export type {
  ProceduralPrimitiveContext,
  AnatomicalDeltaMap,
  ProceduralPrimitiveFn,
} from './motionPrimitives';
export {
  primitiveBreathing,
  primitiveHeadNod,
  primitiveHeadTilt,
  primitiveHeadTurn,
  primitiveShoulderShift,
  primitiveTorsoCoupledArmSway,
  PROCEDURAL_BASE_LAYER,
  PROCEDURAL_HEAD_LAYER,
  DEFAULT_PROCEDURAL_STACK,
} from './motionPrimitives';
export type { EulerDeltaMap } from './motionComposition';
export {
  composeMotion,
  composeLayeredProceduralDeltas,
  applyComposedProceduralMotion,
  applyProceduralPrimitiveStack,
  applyLayeredProceduralStack,
  resetProceduralMotionSmoother,
} from './motionComposition';
export { installVrmHumanoidBypassProbe } from './boneBypassProbe';
export type {
  ExpressionState,
  ExpressionPrimitiveName,
} from '../expression/expressionMap';
export {
  EXPRESSION_ALLOWED,
  EXPRESSION_TO_PRIMITIVES,
  EXPRESSION_HEAD_TIME_SCALE,
  EXPRESSION_GAIN_MUL,
  EXPRESSION_PRIORITY,
  EXPRESSION_ENERGY_INFLUENCE,
  expressionBlockedPrimitives,
  mapIntentToExpression,
  personaHeadOverride,
} from '../expression/expressionMap';
export type { PersonaExpressionHeadOverride } from '../expression/expressionMap';
export type {
  ExpressionMotionEntry,
  ExpressionMotionResult,
  ExpressionHeadPlan,
} from '../expression/expressionMotionEngine';
export {
  tickExpressionHeadMotionPlan,
  selectExpressionMotions,
  resetExpressionMotionEngine,
} from '../expression/expressionMotionEngine';
export type {
  Sequence,
  SequenceStep,
  SequenceStepKind,
  SequencerOutput,
} from './motionSequencer';
export {
  tickMotionSequencer,
  resetMotionSequencer,
  getMotionSequencerSnapshot,
} from './motionSequencer';
