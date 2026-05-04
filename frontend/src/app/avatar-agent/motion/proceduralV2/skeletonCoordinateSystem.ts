/**
 * VRM normalized bones — local Euler order **YXZ** (see `kinematicStandards.ts`).
 * Anatomical pitch / yaw / roll are mapped explicitly onto euler components with per-bone signs.
 */
'use client';

export type EulerAxis = 'x' | 'y' | 'z';

/** Per-bone mapping: where anatomical pitch/yaw/roll apply on the (rx, ry, rz) YXZ triplet. */
export type BoneCoordinateSystem = {
  bone: string;
  pitchAxis: EulerAxis;
  yawAxis: EulerAxis;
  rollAxis: EulerAxis;
  /** Signs for anatomical pitch, yaw, roll when written to the axes above (+1 = positive euler). */
  inversionMultiplier: { pitch: number; yaw: number; roll: number };
};

export const PROCEDURAL_V2_BONE_AXES: Readonly<Record<string, BoneCoordinateSystem>> = {
  head: {
    bone:      'head',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    inversionMultiplier: { pitch: 1, yaw: 1, roll: 1 },
  },
  neck: {
    bone:      'neck',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    inversionMultiplier: { pitch: 1, yaw: 1, roll: 1 },
  },
  spine: {
    bone:      'spine',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    inversionMultiplier: { pitch: 1, yaw: 0.85, roll: 1 },
  },
  chest: {
    bone:      'chest',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    inversionMultiplier: { pitch: 1, yaw: 0.85, roll: 1 },
  },
  leftShoulder: {
    bone:      'leftShoulder',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    inversionMultiplier: { pitch: 1, yaw: 1, roll: 1 },
  },
  rightShoulder: {
    bone:      'rightShoulder',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    inversionMultiplier: { pitch: 1, yaw: -0.96, roll: -1 },
  },
  /** Normalized short keys used in {@link BonePoseMap} */
  lua: {
    bone:      'lua',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    inversionMultiplier: { pitch: 1, yaw: 1, roll: 1 },
  },
  rua: {
    bone:      'rua',
    pitchAxis: 'x',
    yawAxis:   'y',
    rollAxis:  'z',
    /** Mirror upper-arm sway vs left (see `kinematicStandards` — reach −X on right). */
    inversionMultiplier: { pitch: -1, yaw: 1, roll: -1 },
  },
};
