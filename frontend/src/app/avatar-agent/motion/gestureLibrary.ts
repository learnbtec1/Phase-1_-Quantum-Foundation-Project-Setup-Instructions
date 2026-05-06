/**
 * Lightweight procedural gesture clips — additive on top of intent motor (no VRMA replacement).
 * Rotations are small Euler deltas (radians), YXZ order, matching intentMotorLayer bone keys.
 *
 * Stage 4: conversational meaning is routed through `semanticGestureBridge.ts` →
 * `behaviorTimeline.pushBehaviorFromSemanticDecision` → timeline `wave` / `explain` /
 * `point` / `think`. Clips here (`listening`, `emphasis`) align with calm teacher
 * body language when referenced by downstream gesture players.
 */
'use client';

export type GestureBoneDelta = { rx: number; ry: number; rz: number };

export type GestureEasing = 'sineBell' | 'easeInOut' | 'linear';

export type GestureClipDef = {
  /** Stable id for cooldown bookkeeping */
  id: string;
  bones: Partial<Record<string, GestureBoneDelta>>;
  durationSec: number;
  easing: GestureEasing;
};

/**
 * Subtle, non-repetitive shapes — scaled by gesturePlayer global weight.
 */
export const GestureLibrary = {
  explain: {
    id: 'explain',
    durationSec: 2.1,
    easing: 'sineBell' as const,
    bones: {
      neck: { rx: 0.02, ry: 0.014, rz: 0 },
      head: { rx: 0.028, ry: 0.022, rz: 0.01 },
      chest: { rx: -0.018, ry: 0, rz: 0 },
      spine: { rx: -0.012, ry: 0, rz: 0 },
      leftShoulder: { rx: 0, ry: 0, rz: 0.016 },
      rightShoulder: { rx: 0, ry: 0, rz: -0.014 },
      lua: { rx: 0, ry: 0.018, rz: 0.024 },
      rua: { rx: 0, ry: -0.016, rz: -0.02 },
    },
  } satisfies GestureClipDef,

  thinking: {
    id: 'thinking',
    durationSec: 2.4,
    easing: 'easeInOut' as const,
    bones: {
      neck: { rx: -0.018, ry: -0.026, rz: 0.012 },
      head: { rx: -0.038, ry: -0.032, rz: 0.022 },
      chest: { rx: 0.01, ry: 0, rz: 0 },
      lua: { rx: 0.022, ry: 0, rz: 0.018 },
      rua: { rx: 0.014, ry: -0.01, rz: -0.012 },
    },
  } satisfies GestureClipDef,

  listening: {
    id: 'listening',
    durationSec: 1.9,
    easing: 'sineBell' as const,
    bones: {
      neck: { rx: 0.012, ry: 0.018, rz: 0 },
      head: { rx: 0.022, ry: 0.024, rz: 0 },
      spine: { rx: 0.014, ry: 0, rz: 0 },
      chest: { rx: 0.01, ry: 0, rz: 0 },
      lua: { rx: -0.01, ry: 0.012, rz: 0.014 },
      rua: { rx: -0.01, ry: -0.012, rz: -0.014 },
    },
  } satisfies GestureClipDef,

  emphasis: {
    id: 'emphasis',
    durationSec: 1.25,
    easing: 'easeInOut' as const,
    bones: {
      neck: { rx: 0.018, ry: 0, rz: 0 },
      head: { rx: 0.024, ry: 0.01, rz: 0 },
      chest: { rx: -0.016, ry: 0, rz: 0 },
      spine: { rx: -0.011, ry: 0, rz: 0 },
      leftShoulder: { rx: 0, ry: 0, rz: 0.014 },
      rightShoulder: { rx: 0, ry: 0, rz: -0.013 },
      lua: { rx: 0, ry: 0.014, rz: 0.02 },
      rua: { rx: 0, ry: -0.013, rz: -0.018 },
    },
  } satisfies GestureClipDef,
} as const;
