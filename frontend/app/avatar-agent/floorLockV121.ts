/**
 * V121 foot–floor lock — world floor only (`getWorldFloorY()`).
 * Vertical correction applies ONLY to `liftNode.position.y` (not avatar root XZ).
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { getWorldFloorY } from '@/app/avatar-agent/floor/worldFloor';
import { DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';

function getFootNodes(vrm: VRM): { left: THREE.Object3D; right: THREE.Object3D } | null {
  const h = vrm.humanoid as {
    getNormalizedBoneNode?: (n: string) => THREE.Object3D | undefined;
    getRawBoneNode?: (n: string) => THREE.Object3D | undefined;
  };
  const get = (name: string) =>
    h.getNormalizedBoneNode?.(name) ?? h.getRawBoneNode?.(name);
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
 * Snap soles to world floor Y = `getWorldFloorY()` (no model / rug / ROOM_BOUNDS floor probe).
 */
export function applyFootFloorCalib({
  vrm,
  liftNode,
  group,
  force: _force = false,
}: {
  vrm: VRM;
  liftNode: THREE.Group;
  group: THREE.Group;
  carpetName?: string;
  gap?: number;
  force?: boolean;
}): void {
  void _force;
  if (!vrm.humanoid || !liftNode.parent) return;

  const targetFloorY = getWorldFloorY();
  const avgFeetY = getAvgFeetWorldY(vrm, group, liftNode);
  if (avgFeetY === null) return;

  const correction = targetFloorY - avgFeetY;

  if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR && Math.abs(correction) > 2) {
    console.warn('[V121] applyFootFloorCalib: large correction — check avatar root / rig scale', {
      correction: correction.toFixed(4),
      targetFloorY,
    });
  }

  if (Math.abs(correction) > 0.0001) {
    liftNode.position.y += correction;
    if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR) {
      const feet = getFootNodes(vrm);
      const lf = new THREE.Vector3();
      const rf = new THREE.Vector3();
      feet?.left.getWorldPosition(lf);
      feet?.right.getWorldPosition(rf);
      console.log('%c[V121] applyFootFloorCalib', 'color:#a78bfa;font-weight:bold', {
        leftFootY: lf.y.toFixed(4),
        rightFootY: rf.y.toFixed(4),
        avgFeetY: avgFeetY.toFixed(4),
        targetFloorY,
        correction: correction.toFixed(4),
        liftNode_y_after: liftNode.position.y.toFixed(4),
      });
    }
  }
}

/** Each frame: if feet drift below world floor, lift only (never push down here). */
export function runWorldFloorAntiDriftFrame(
  vrm: VRM,
  liftNode: THREE.Group,
  group: THREE.Group,
): void {
  if (!vrm.humanoid || !liftNode.parent) return;
  const floorY = getWorldFloorY();
  const avg = getAvgFeetWorldY(vrm, group, liftNode);
  if (avg === null) return;
  if (avg < floorY - 1e-6) {
    liftNode.position.y += floorY - avg;
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
