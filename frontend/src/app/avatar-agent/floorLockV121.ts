/**
 * V121 foot–floor lock — default target `getWorldFloorY()`; optional `footTargetWorldY`
 * for bounded-room alignment to `ROOM_BOUNDS.floorY` (+ sole gap).
 * Vertical correction applies ONLY to `liftNode.position.y` (not avatar root XZ).
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { getWorldFloorY } from '@/app/avatar-agent/floor/worldFloor';
import { DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';

/**
 * Returns RAW foot bones (the bones that drive the rendered skin).
 * Falls back to normalized only if raw is unavailable — but raw is preferred
 * because the renderer reads raw, and only raw reflects post-vrm.update() state.
 */
function getFootNodes(vrm: VRM): { left: THREE.Object3D; right: THREE.Object3D } | null {
  const h = vrm.humanoid as {
    getNormalizedBoneNode?: (n: string) => THREE.Object3D | undefined;
    getRawBoneNode?: (n: string) => THREE.Object3D | undefined;
  };
  // RAW first — this is what the renderer actually uses. Normalized is the
  // intermediate representation that vrm.humanoid.update() propagates onto raw.
  const get = (name: string) =>
    h.getRawBoneNode?.(name) ?? h.getNormalizedBoneNode?.(name);
  const leftFoot = get('leftFoot');
  const rightFoot = get('rightFoot');
  if (!leftFoot || !rightFoot) return null;
  return { left: leftFoot, right: rightFoot };
}

/** World-space average Y of left/right foot bones (after current world matrices). */
export function getAvgFeetWorldY(vrm: VRM, group: THREE.Group, liftNode: THREE.Group): number | null {
  group.updateMatrixWorld(true);
  liftNode.updateMatrixWorld(true);
  const feet = getFootNodes(vrm);
  if (!feet) return null;
  const lf = new THREE.Vector3();
  const rf = new THREE.Vector3();
  feet.left.getWorldPosition(lf);
  feet.right.getWorldPosition(rf);
  return (lf.y + rf.y) * 0.5;
}

/** @deprecated No-op — floor calibration no longer waits on office GLB alignment. */
export function setOfficeGlbAlignmentDone(_value?: boolean): void {}

/** @deprecated No-op — retained for tests that imported the symbol. */
export function resetOfficeGlbAlignmentDoneForTests(): void {}

/**
 * V121 — Create LIFT_NODE: isolates vertical floor correction from navigation.
 */
export function createLiftNode(vrm: VRM): THREE.Group {
  const lift = new THREE.Group();
  lift.name = 'LIFT_NODE_V121';
  vrm.scene.parent?.remove(vrm.scene);
  lift.add(vrm.scene);
  vrm.scene.position.set(0, 0, 0);
  vrm.scene.quaternion.identity();
  return lift;
}

/**
 * Snap averaged foot-bone world Y toward `footTargetWorldY`, or else `getWorldFloorY()`.
 *
 * Fallback chain:
 *   1. Average left+right foot bone world Y  → primary calibration source
 *   2. Box3 of vrm.scene (if foot bones invalid / produce zero correction) → mesh-based fallback
 *
 * Always emits `[FOOT_CALIB_DEBUG]` so a stuck-floating avatar can be diagnosed
 * from a single console line at runtime.
 */
export function applyFootFloorCalib({
  vrm,
  liftNode,
  group,
  force: _force = false,
  footTargetWorldY,
}: {
  vrm: VRM;
  liftNode: THREE.Group;
  group: THREE.Group;
  carpetName?: string;
  gap?: number;
  force?: boolean;
  /** When set (e.g. ROOM_BOUNDS.floorY + sole gap), overrides `getWorldFloorY()` for bounded room. */
  footTargetWorldY?: number;
}): void {
  void _force;
  if (!vrm.humanoid || !liftNode.parent) return;

  const targetFloorY =
    typeof footTargetWorldY === 'number' && Number.isFinite(footTargetWorldY)
      ? footTargetWorldY
      : getWorldFloorY();
  const avgFeetY = getAvgFeetWorldY(vrm, group, liftNode);

  // ── Primary path: foot-bone-driven correction ──────────────────────────────
  let correction = 0;
  let source: 'foot_bones' | 'box3_fallback' | 'failed' = 'failed';

  if (typeof avgFeetY === 'number' && Number.isFinite(avgFeetY) && Math.abs(avgFeetY) > 1e-7) {
    correction = targetFloorY - avgFeetY;
    source = 'foot_bones';
  }

  // ── Fallback: Box3.setFromObject(vrm.scene) when foot bones unusable ──────
  // Triggers on:
  //   • avgFeetY === null (foot bones missing)
  //   • avgFeetY NaN / Infinity
  //   • avgFeetY ≈ 0 AND target ≈ 0  (correction would be 0 — bones not yet world-positioned)
  if (source === 'failed' || (Math.abs(correction) < 1e-6 && Math.abs(avgFeetY ?? 0) < 1e-6)) {
    try {
      group.updateMatrixWorld(true);
      liftNode.updateMatrixWorld(true);
      vrm.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(vrm.scene);
      if (Number.isFinite(box.min.y)) {
        // Mesh's bottom currently sits at box.min.y in world. Move liftNode so
        // box.min.y lands on targetFloorY: shift by (targetFloorY - box.min.y).
        const fallbackCorrection = targetFloorY - box.min.y;
        if (Math.abs(fallbackCorrection) > 1e-6 && Math.abs(fallbackCorrection) < 5) {
          correction = fallbackCorrection;
          source = 'box3_fallback';
          console.warn('[FOOT_CALIB_FALLBACK]', {
            box_min_y: +box.min.y.toFixed(4),
            box_max_y: +box.max.y.toFixed(4),
            fallbackCorrection: +fallbackCorrection.toFixed(4),
            targetFloorY,
            reason: avgFeetY === null ? 'foot_bones_missing' : 'foot_bones_zero_position',
          });
        }
      }
    } catch (e) {
      console.warn('[FOOT_CALIB_FALLBACK] Box3 failed:', e);
    }
  }

  // ── Always-on debug — single line per call, helps diagnose floating avatars ─
  const feet = getFootNodes(vrm);
  const lf = new THREE.Vector3();
  const rf = new THREE.Vector3();
  if (feet) {
    feet.left.getWorldPosition(lf);
    feet.right.getWorldPosition(rf);
  }
  console.log('[FOOT_CALIB_DEBUG]', {
    leftFootY: feet ? +lf.y.toFixed(4) : null,
    rightFootY: feet ? +rf.y.toFixed(4) : null,
    avgFeetY: avgFeetY === null ? null : +avgFeetY.toFixed(4),
    targetFloorY,
    correction: +correction.toFixed(4),
    source,
    liftNode_y_before: +liftNode.position.y.toFixed(4),
  });

  // Sanity: large correction = bad rig scale or mis-parented liftNode.
  if (Math.abs(correction) > 5) {
    console.warn('[V121] applyFootFloorCalib: SUSPICIOUS large correction (>5m)', {
      correction: correction.toFixed(4),
      targetFloorY,
      hint: 'Check liftNode parent and vrm rig scale.',
    });
    return;
  }

  if (Math.abs(correction) > 0.0001) {
    liftNode.position.y += correction;
    if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR) {
      console.log('%c[V121] applyFootFloorCalib applied', 'color:#a78bfa;font-weight:bold', {
        source,
        correction: +correction.toFixed(4),
        liftNode_y_after: +liftNode.position.y.toFixed(4),
      });
    }
  }
}

/**
 * Per-frame hard floor clamp:
 *   • If feet drift BELOW floor → lift up immediately (always)
 *   • If feet drift ABOVE floor by more than tolerance → snap down (anti-floating)
 *
 * The anti-floating branch is gated by `_FLOAT_TOLERANCE_M` so micro motion
 * (breathing, weight shift) doesn't get clamped every frame.
 */
const _FLOAT_TOLERANCE_M = 0.025; // 2.5 cm — allow natural micro-movement
export function runWorldFloorAntiDriftFrame(
  vrm: VRM,
  liftNode: THREE.Group,
  group: THREE.Group,
  footTargetWorldY?: number,
): void {
  if (!vrm.humanoid || !liftNode.parent) return;
  const floorY =
    typeof footTargetWorldY === 'number' && Number.isFinite(footTargetWorldY)
      ? footTargetWorldY
      : getWorldFloorY();
  const avg = getAvgFeetWorldY(vrm, group, liftNode);
  if (avg === null || !Number.isFinite(avg)) return;

  // Below floor → always lift (sinking is never acceptable)
  if (avg < floorY - 1e-6) {
    liftNode.position.y += floorY - avg;
    return;
  }
  // Above floor by more than tolerance → snap down (prevents permanent floating)
  if (avg > floorY + _FLOAT_TOLERANCE_M) {
    liftNode.position.y -= (avg - floorY);
  }
}

/**
 * @deprecated Watchdog / room listeners removed — returns a no-op disposer for API compatibility.
 */
export function armCalibWatchdog(
  _vrm: VRM,
  _liftNode: THREE.Group,
  _group: THREE.Group,
  _scene: THREE.Scene,
): () => void {
  return () => {};
}

/** @deprecated Dedup state removed with world-only floor. */
export function resetFootFloorCalibDedupForTests(): void {}
