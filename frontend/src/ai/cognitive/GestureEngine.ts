/**
 * Compatibility shim — all logic lives in UnifiedGestureEngine.
 */
export type { GestureDescriptor, CanonicalGesture } from './UnifiedGestureEngine';
export {
  UnifiedGestureEngine,
  UnifiedGestureEngine as GestureEngine,
  unifiedGestureEngine,
  gestureEngine,
  initGestureNormalizer,
  toCanonicalGesture,
} from './UnifiedGestureEngine';
