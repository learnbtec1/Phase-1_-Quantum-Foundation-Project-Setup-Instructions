/**
 * Level 6.2 — Subtle face / upper-face cues tied to cognitive intent (no VRM imports).
 */

import type { Intent } from './intentTypes';

export type MicroExpressionType =
  | 'eyebrow_raise'
  | 'eye_squint'
  | 'lip_press'
  | 'cheek_shift';

export type MicroExpression = {
  type: MicroExpressionType;
  intensity: number;
  durationMs: number;
};

export function generateMicroExpression(context: Intent): MicroExpression | null {
  switch (context.type) {
    case 'thinking':
      return {
        type: 'eye_squint',
        intensity: 0.32,
        durationMs: 620,
      };
    case 'reacting':
      return {
        type: 'eyebrow_raise',
        intensity: 0.48,
        durationMs: 420,
      };
    case 'speaking':
      return {
        type: 'lip_press',
        intensity: 0.22,
        durationMs: 340,
      };
    case 'listening':
      return {
        type: 'cheek_shift',
        intensity: 0.2,
        durationMs: 480,
      };
    case 'greeting':
      return {
        type: 'eyebrow_raise',
        intensity: 0.36,
        durationMs: 380,
      };
    default:
      return null;
  }
}

/** Maps to `avatar:micro:gesture` kinds supported by VRMSkeletonManager + AnimationController emphasis. */
export function dispatchMicroExpression(m: MicroExpression): void {
  if (typeof window === 'undefined') return;
  const kind =
    m.type === 'eyebrow_raise'
      ? 'eyebrow'
      : m.type === 'eye_squint'
        ? 'eye_squint'
        : m.type === 'lip_press'
          ? 'lip_press'
          : 'cheek_shift';

  window.dispatchEvent(
    new CustomEvent('avatar:micro:gesture', {
      detail: { kind, type: kind, durationMs: m.durationMs, intensity: m.intensity },
    }),
  );

  if (m.type === 'eyebrow_raise' || m.type === 'eye_squint') {
    window.dispatchEvent(
      new CustomEvent('avatar:speech:emphasis', {
        detail: { kind: m.type === 'eyebrow_raise' ? 'eyebrow_raise' : 'question_tilt' },
      }),
    );
  }
}
