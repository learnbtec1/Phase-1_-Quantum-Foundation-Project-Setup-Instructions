/**
 * Avatar Managers barrel export
 *
 * Sources:
 *   ExpressionManager — r3f-vrm (DavidCks/r3f-vrm)
 *   PositionManager   — r3f-vrm (DavidCks/r3f-vrm)
 *   EmotionManager    — AIMascotKit (tk256ailab/AIMascotKit)
 *   PhonemeManager    — svelte-vrm-live (dexvdev/svelte-vrm-live)
 */
export { ExpressionManager } from './ExpressionManager';
export type { FaceExpressionFrame } from './ExpressionManager';

export { PositionManager } from './PositionManager';
export type { PositionManagerConfig, LocomotionState } from './PositionManager';

export { EmotionManager, EMOTION_CONFIG, EMOTION_ANIMATION_MAP } from './EmotionManager';
export type { AvatarEmotion } from './EmotionManager';

export { PhonemeManager } from './PhonemeManager';
export type { PhonemeFrame } from './PhonemeManager';
