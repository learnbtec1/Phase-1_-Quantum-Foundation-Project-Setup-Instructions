/**
 * useArmPose.ts
 *
 * Low-level arm bone animator for VRM / Mixamo rigs.
 * Matches bones via the BoneAliases list and maintains per-bone Quaternion
 * targets in a ref.  Call applyFinal(alpha) once per frame (priority +2) to
 * slerp the rig toward the targets.
 *
 * Wave mode runs an independent time-based oscillator; all other gestures
 * write target Euler values via setTargetForBone / setTargetForSide.
 */

import { useRef, useCallback, useEffect } from 'react';
import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { BoneAliases } from '@/constants/avatar/BoneAliases';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArmSide = 'left' | 'right';

/** The 6 arm bones we control per side */
export type ArmBoneKey =
  | 'leftUpperArm'     | 'rightUpperArm'
  | 'leftLowerArm'     | 'rightLowerArm'
  | 'leftHand'         | 'rightHand';

type BoneTargets = Partial<Record<ArmBoneKey, THREE.Quaternion>>;

interface WaveState {
  side: ArmSide;
  startMs: number;
  durationMs: number;
}

const WAVE_DECAY_MS = 1200;

// Pre-allocated quaternions to avoid GC pressure in animation loop
const _tmpQ   = new THREE.Quaternion();
const _deltaQ = new THREE.Quaternion();
const _euler  = new THREE.Euler();

// ─── Bone discovery helper ────────────────────────────────────────────────────

function findBoneObject(vrm: VRM, key: ArmBoneKey): THREE.Object3D | null {
  // Try VRM humanoid first
  try {
    const humanBone = (vrm.humanoid as any)?.getRawBoneNode?.(key);
    if (humanBone) return humanBone;
  } catch { /* skip */ }

  // Alias fallback — walk scene
  const aliases = (BoneAliases as Record<string, string[]>)[key] ?? [];
  let found: THREE.Object3D | null = null;
  vrm.scene.traverse((obj) => {
    if (found) return;
    const lower = obj.name.toLowerCase();
    if (aliases.some((a) => lower === a.toLowerCase() || lower.includes(a.toLowerCase()))) {
      found = obj;
    }
  });
  return found;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseArmPoseReturn {
  /** Slerp all arm bones toward their current targets. Call once per useFrame at +2. */
  applyFinal(alpha: number): void;
  /** Start wave oscillation on `side` for `durationMs` ms. */
  startWave(side: ArmSide, durationMs?: number): void;
  /** Cancel any active wave. */
  stopWave(): void;
  /** Directly set a quaternion target for a named bone. */
  setTargetForBone(key: ArmBoneKey, quat: THREE.Quaternion): void;
  /**
   * Set Euler-based targets for a whole side.
   * offsets: { upper?, lower?, hand? } — Euler angles in radians.
   */
  setTargetForSide(side: ArmSide, offsets: { upper?: THREE.Euler; lower?: THREE.Euler; hand?: THREE.Euler }): void;
  /** Zero all targets (relax pose). */
  resetTargets(): void;
}

export function useArmPose(vrm: VRM | null): UseArmPoseReturn {
  // Map bone key → resolved Object3D (populated once per VRM change)
  const bonesRef = useRef<Partial<Record<ArmBoneKey, THREE.Object3D>>>({});
  // Rest quaternions captured immediately after resolve
  const restRef  = useRef<Partial<Record<ArmBoneKey, THREE.Quaternion>>>({});
  // Target quaternions (additive delta from rest)
  const targetRef = useRef<BoneTargets>({});
  // Wave state
  const waveRef = useRef<WaveState | null>(null);

  // ── Resolve bones whenever VRM changes ─────────────────────────────────────
  useEffect(() => {
    bonesRef.current  = {};
    restRef.current   = {};
    targetRef.current = {};
    waveRef.current   = null;

    if (!vrm) return;

    const keys: ArmBoneKey[] = [
      'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightUpperArm', 'rightLowerArm', 'rightHand',
    ];
    let resolved = 0;
    for (const key of keys) {
      const obj = findBoneObject(vrm, key);
      if (obj) {
        bonesRef.current[key]  = obj;
        restRef.current[key]   = obj.quaternion.clone();
        resolved++;
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[useArmPose] resolved ${resolved}/6 arm bones`);
    }
  }, [vrm]);

  // ── applyFinal ─────────────────────────────────────────────────────────────
  const applyFinal = useCallback((alpha: number) => {
    const now = performance.now();
    const wave = waveRef.current;

    // === Wave oscillator ===
    if (wave) {
      const elapsed = now - wave.startMs;
      const t = Math.min(elapsed / wave.durationMs, 1);

      // Envelope: ramp-in 200 ms, hold, ramp-out WAVE_DECAY_MS
      const rampIn  = Math.min(elapsed / 200, 1);
      const rampOut = t > 0.8 ? 1 - (elapsed - wave.durationMs * 0.8) / (wave.durationMs * 0.2 + WAVE_DECAY_MS) : 1;
      const envelope = Math.max(0, rampIn * rampOut);

      const osc   = Math.sin(elapsed * 0.006) * envelope;
      const bend  = Math.cos(elapsed * 0.006) * 0.18 * envelope;

      const upKey:   ArmBoneKey = wave.side === 'left' ? 'leftUpperArm'  : 'rightUpperArm';
      const loKey:   ArmBoneKey = wave.side === 'left' ? 'leftLowerArm'  : 'rightLowerArm';
      const handKey: ArmBoneKey = wave.side === 'left' ? 'leftHand'      : 'rightHand';

      const sign = wave.side === 'left' ? 1 : -1;

      for (const [key, angleZ, angleX] of [
        [upKey,   sign * (0.9 + osc * 0.2),     0.12 + bend],
        [loKey,   sign * 0.25,                   0.28 + bend * 0.5],
        [handKey, sign * (osc * 0.3),            0],
      ] as [ArmBoneKey, number, number][]) {
        const obj  = bonesRef.current[key];
        const rest = restRef.current[key];
        if (!obj || !rest) continue;
        _euler.set(angleX, 0, angleZ, 'XYZ');
        _tmpQ.setFromEuler(_euler);
        _deltaQ.slerpQuaternions(rest, _tmpQ, alpha);
        obj.quaternion.copy(_deltaQ);
      }

      if (t >= 1) waveRef.current = null;
      return; // Wave mode = exclusive
    }

    // === Generic target mode ===
    const targets = targetRef.current;
    for (const _key of Object.keys(targets) as ArmBoneKey[]) {
      const obj    = bonesRef.current[_key];
      const rest   = restRef.current[_key];
      const target = targets[_key];
      if (!obj || !rest || !target) continue;
      _deltaQ.slerpQuaternions(rest, target, alpha);
      obj.quaternion.copy(_deltaQ);
    }
  }, []);

  // ── startWave ──────────────────────────────────────────────────────────────
  const startWave = useCallback((side: ArmSide, durationMs = 2000) => {
    waveRef.current = { side, startMs: performance.now(), durationMs };
  }, []);

  const stopWave = useCallback(() => { waveRef.current = null; }, []);

  // ── setTargetForBone ───────────────────────────────────────────────────────
  const setTargetForBone = useCallback((key: ArmBoneKey, quat: THREE.Quaternion) => {
    targetRef.current[key] = quat.clone();
  }, []);

  // ── setTargetForSide ───────────────────────────────────────────────────────
  const setTargetForSide = useCallback((
    side: ArmSide,
    offsets: { upper?: THREE.Euler; lower?: THREE.Euler; hand?: THREE.Euler }
  ) => {
    const prefix = side === 'left' ? 'left' : 'right';
    const pairs: [keyof typeof offsets, ArmBoneKey][] = [
      ['upper', `${prefix}UpperArm` as ArmBoneKey],
      ['lower', `${prefix}LowerArm` as ArmBoneKey],
      ['hand',  `${prefix}Hand`     as ArmBoneKey],
    ];
    for (const [offsetKey, boneKey] of pairs) {
      const euler = offsets[offsetKey];
      if (!euler) continue;
      targetRef.current[boneKey] = new THREE.Quaternion().setFromEuler(euler);
    }
  }, []);

  // ── resetTargets ───────────────────────────────────────────────────────────
  const resetTargets = useCallback(() => {
    targetRef.current = {};
    waveRef.current   = null;
  }, []);

  return { applyFinal, startWave, stopWave, setTargetForBone, setTargetForSide, resetTargets };
}
