'use client';

/**
 * __behaviorEngine.ts — lightweight **decision plane** over speech / intent / emotion.
 *
 * Owns NO bones, NO React, NO scene.  Produces scalars consumed by `mergeBehaviorEngineMotionScalars`
 * in `__behaviorSync.ts`, which **multiplies** into the existing `__cogniMotionState` scalars —
 * the animation pipeline (`VRMSkeletonManager` → `applyIntentMotionState`) stays authoritative.
 */

export type BehaviorInput = {
  speaking: boolean;
  intent: string;
  emotion: string;
  /** 0..1 cognitive / motor intensity (from embodiment or brain payload). */
  intensity: number;
};

/**
 * Derived behavior plan — **not** the same shape as `BehaviorState` in `__behaviorSync.ts`
 * (that type is the per-frame sync aggregate for pose modifiers).
 */
export type BehaviorState = {
  gestureStyle: 'none' | 'subtle' | 'normal' | 'expressive';
  /** 0..~1.5 scale for head channels (nod / tilt feel). */
  headMovement: number;
  /** 0..~1.5 scale for procedural open-gesture / arm openness. */
  armMovement: number;
};

export type BehaviorMotionScalars = {
  headNod: number;
  openGesture: number;
};

function _norm(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Decision rules (MVP):
 * - Not speaking → suppress gesture-like energy (`gestureStyle: none`, low arm gain).
 * - Explaining → `normal`; emphasizing → `expressive`.
 * - Serious-like tags → damp; excited / joy → amplify.
 * - `intensity` slightly modulates overall energy.
 */
export function computeBehavior(input: BehaviorInput): BehaviorState {
  const intent = _norm(input.intent);
  const emotion = _norm(input.emotion);

  if (!input.speaking) {
    return { gestureStyle: 'none', headMovement: 0.32, armMovement: 0.06 };
  }

  let gestureStyle: BehaviorState['gestureStyle'] = 'subtle';
  let headMovement = 0.92;
  let armMovement = 0.9;

  if (intent.includes('emphas')) {
    gestureStyle = 'expressive';
    headMovement = 1.05;
    armMovement = 1.08;
  } else if (intent.includes('explain')) {
    gestureStyle = 'normal';
    headMovement = 1.0;
    armMovement = 1.0;
  }

  if (
    emotion === 'serious' ||
    emotion === 'focused' ||
    emotion === 'thinking' ||
    emotion === 'sad' ||
    emotion === 'concerned'
  ) {
    headMovement *= 0.64;
    armMovement *= 0.58;
  } else if (emotion === 'excited' || emotion === 'surprised' || emotion === 'angry') {
    headMovement *= 1.18;
    armMovement *= 1.32;
  } else if (emotion === 'happy' || emotion === 'joy' || emotion === 'friendly') {
    headMovement *= 1.06;
    armMovement *= 1.12;
  }

  const i = Math.max(0, Math.min(1, input.intensity));
  headMovement *= 0.84 + 0.2 * i;
  armMovement *= 0.82 + 0.26 * i;

  return { gestureStyle, headMovement, armMovement };
}

/** Map high-level behavior plan → scalars that multiply into `motionState.headNod` / `openGesture`. */
export function behaviorToMotion(state: BehaviorState): BehaviorMotionScalars {
  let hn = state.headMovement;
  let og = state.armMovement;
  switch (state.gestureStyle) {
    case 'none':
      hn *= 0.42;
      og *= 0.1;
      break;
    case 'subtle':
      hn *= 0.76;
      og *= 0.58;
      break;
    case 'normal':
      break;
    case 'expressive':
      hn *= 1.24;
      og *= 1.36;
      break;
    default:
      break;
  }
  return {
    headNod: Math.max(0.05, Math.min(1.7, hn)),
    openGesture: Math.max(0, Math.min(1.7, og)),
  };
}
