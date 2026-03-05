/**
 * useArmGestureRig.ts
 *
 * High-level gesture queue that translates GestureNames into arm-bone Euler
 * curves and delegates the actual bone writes to useArmPose.
 *
 * Up to MAX_CONC=3 gestures can be active simultaneously.  Each slot
 * accumulates additive Euler deltas in step(), then flushes via
 * armPose.setTargetForSide() before the frame is committed.
 *
 * Call step() inside useFrame at priority +2 (same as applyFinal).
 * Order: step() → applyFinal(alpha).
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { GestureNames } from '@/constants/avatar';
import { useArmPose, type ArmSide, type UseArmPoseReturn } from './useArmPose';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CONC = 3; // max simultaneous gestures

// ─── Helpers ──────────────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Mirror Z angle for the right arm (flip sign) */
function flipForSide(euler: THREE.Euler, side: ArmSide): THREE.Euler {
  return side === 'right' ? new THREE.Euler(euler.x, euler.y, -euler.z) : euler.clone();
}

// ─── Types ────────────────────────────────────────────────────────────────────

type GestureName = (typeof GestureNames)[keyof typeof GestureNames];

interface GestureInstance {
  id: number;
  name: GestureName;
  side: ArmSide;
  strength: number;    // 0-1 multiplier
  durationMs: number;
  holdMs: number;      // pause at peak before ramp-out
  startMs: number;
}

interface CurveFrame {
  upper?: THREE.Euler;
  lower?: THREE.Euler;
  hand?: THREE.Euler;
}

// ─── Euler curve library (all defined for left side; flipForSide mirrors) ────

function getCurve(name: GestureName, t: number, S: number, _side: ArmSide): CurveFrame {
  const e = easeInOut(t);
  const o = easeOut(t);

  switch (name) {

    case GestureNames.WAVE:
      // Handled entirely by useArmPose.startWave — no euler output needed here
      return {};

    case GestureNames.POINT:
      return {
        upper: new THREE.Euler( 0.05, 0,  0.40 * e * S, 'XYZ'),
        lower: new THREE.Euler(-0.20 * e * S, 0, 0),
        hand:  new THREE.Euler( 0, 0, -0.15 * e * S),
      };

    case GestureNames.OPEN:
    case GestureNames.OPEN_HAND:
      return {
        upper: new THREE.Euler(0.10 * e * S, 0,  0.55 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.30 * e * S, 0,  0),
        hand:  new THREE.Euler(0, 0, 0),
      };

    case GestureNames.AFFIRM:
      // Slow nod with palm forward — ramp to slight forward raise
      return {
        upper: new THREE.Euler(0.35 * e * S, 0,  0.30 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.45 * o * S, 0,  0),
        hand:  new THREE.Euler(-0.10 * e * S, 0, 0),
      };

    case GestureNames.STOP:
      // Palm out, arm raised
      return {
        upper: new THREE.Euler(0.15 * e * S, 0,  0.80 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.90 * o * S, 0,  0),
        hand:  new THREE.Euler(-0.30 * e * S, 0, 0),
      };

    case GestureNames.BECKON:
      return {
        upper: new THREE.Euler(0.10 * e * S, 0,  0.50 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.60 + 0.25 * Math.sin(t * Math.PI * 2), 0, 0),
        hand:  new THREE.Euler(0, 0, 0.20 * e * S),
      };

    case GestureNames.PRESENT:
      return {
        upper: new THREE.Euler(0.05 * e * S, 0,  0.60 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.70 * o * S, 0,  0),
        hand:  new THREE.Euler(-0.10 * e * S, 0, 0),
      };

    case GestureNames.SHRUG:
      return {
        upper: new THREE.Euler(0, 0,  0.70 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.20 * e * S, 0, 0),
        hand:  new THREE.Euler(0, 0, 0),
      };

    case GestureNames.CLAP: {
      // Both arms swing toward centre; side sign handled by flipForSide
      const swing = Math.abs(Math.sin(t * Math.PI * 3)) * e * S;
      return {
        upper: new THREE.Euler(0.20 * e * S, 0,  0.45 + swing * 0.25, 'XYZ'),
        lower: new THREE.Euler(0.60 * e * S, 0,  0),
        hand:  new THREE.Euler(0, 0, 0),
      };
    }

    case GestureNames.THINK:
      return {
        upper: new THREE.Euler(0.40 * e * S, 0,  0.35 * e * S, 'XYZ'),
        lower: new THREE.Euler(1.10 * o * S, 0,  0),
        hand:  new THREE.Euler(0, 0, 0.10 * e * S),
      };

    case GestureNames.BEAT:
      return {
        upper: new THREE.Euler(0.10 * e * S, 0,  0.40 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.50 + 0.30 * Math.sin(t * Math.PI * 4), 0, 0),
        hand:  new THREE.Euler(0, 0, 0),
      };

    case GestureNames.EMPHASIS:
      return {
        upper: new THREE.Euler(0.20 * e * S, 0,  0.55 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.80 * o * S + 0.20 * Math.sin(t * Math.PI * 2), 0, 0),
        hand:  new THREE.Euler(-0.15 * e * S, 0, 0),
      };

    case GestureNames.OK:
      return {
        upper: new THREE.Euler(0.10 * e * S, 0,  0.45 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.70 * o * S, 0,  0),
        hand:  new THREE.Euler(0, 0.10 * e * S, 0),
      };

    case GestureNames.THUMBS_UP:
      return {
        upper: new THREE.Euler(0.05 * e * S, 0,  0.50 * e * S, 'XYZ'),
        lower: new THREE.Euler(0.60 * o * S, 0,  0),
        hand:  new THREE.Euler(0, -0.20 * e * S, 0),
      };

    default:
      return {};
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseArmGestureRigReturn {
  armPose: UseArmPoseReturn;
  /** Trigger a named gesture. Returns an id that can be passed to cancel(). */
  trigger(
    name: GestureName,
    side?: ArmSide,
    strength?: number,
    durationMs?: number,
    holdMs?: number
  ): number;
  /** Cancel a specific gesture by id. */
  cancel(id: number): void;
  /** Cancel all active gestures and relax arm pose. */
  cancelAll(): void;
  /**
   * Advance all active gestures one frame.
   * Call inside useFrame BEFORE armPose.applyFinal().
   */
  step(): void;
}

let _nextId = 1;

export function useArmGestureRig(vrm: VRM | null): UseArmGestureRigReturn {
  const armPose = useArmPose(vrm);
  const queueRef = useRef<GestureInstance[]>([]);

  // ── trigger ────────────────────────────────────────────────────────────────
  const trigger = useCallback((
    name: GestureName,
    side: ArmSide = 'right',
    strength = 1,
    durationMs = 1800,
    holdMs = 200,
  ): number => {
    const id = _nextId++;

    // Wave delegates straight to armPose
    if (name === GestureNames.WAVE) {
      armPose.startWave(side, durationMs);
      return id;
    }

    // Prune oldest if queue is at capacity
    if (queueRef.current.length >= MAX_CONC) {
      queueRef.current.shift();
    }

    queueRef.current.push({ id, name, side, strength, durationMs, holdMs, startMs: performance.now() });
    return id;
  }, [armPose]);

  // ── cancel ─────────────────────────────────────────────────────────────────
  const cancel = useCallback((id: number) => {
    queueRef.current = queueRef.current.filter((g) => g.id !== id);
  }, []);

  const cancelAll = useCallback(() => {
    queueRef.current = [];
    armPose.stopWave();
    armPose.resetTargets();
  }, [armPose]);

  // ── step ───────────────────────────────────────────────────────────────────
  const step = useCallback(() => {
    const now = performance.now();

    // Accumulate additive euler offsets per side
    const accUpper: Record<ArmSide, THREE.Euler> = {
      left:  new THREE.Euler(0, 0, 0),
      right: new THREE.Euler(0, 0, 0),
    };
    const accLower: Record<ArmSide, THREE.Euler> = {
      left:  new THREE.Euler(0, 0, 0),
      right: new THREE.Euler(0, 0, 0),
    };
    const accHand: Record<ArmSide, THREE.Euler> = {
      left:  new THREE.Euler(0, 0, 0),
      right: new THREE.Euler(0, 0, 0),
    };

    const alive: GestureInstance[] = [];

    for (const g of queueRef.current) {
      const elapsed = now - g.startMs;
      const total   = g.durationMs + g.holdMs;
      if (elapsed >= total) continue; // expired

      alive.push(g);

      const t = Math.min(elapsed / g.durationMs, 1);
      const frame = getCurve(g.name, t, g.strength, g.side);

      const { side } = g;
      if (frame.upper) {
        const f = flipForSide(frame.upper, side);
        accUpper[side].x += f.x;
        accUpper[side].y += f.y;
        accUpper[side].z += f.z;
      }
      if (frame.lower) {
        const f = flipForSide(frame.lower, side);
        accLower[side].x += f.x;
        accLower[side].y += f.y;
        accLower[side].z += f.z;
      }
      if (frame.hand) {
        const f = flipForSide(frame.hand, side);
        accHand[side].x += f.x;
        accHand[side].y += f.y;
        accHand[side].z += f.z;
      }
    }

    queueRef.current = alive;

    // Flush accumulated offsets to armPose
    for (const side of ['left', 'right'] as ArmSide[]) {
      armPose.setTargetForSide(side, {
        upper: accUpper[side],
        lower: accLower[side],
        hand:  accHand[side],
      });
    }
  }, [armPose]);

  return { armPose, trigger, cancel, cancelAll, step };
}
