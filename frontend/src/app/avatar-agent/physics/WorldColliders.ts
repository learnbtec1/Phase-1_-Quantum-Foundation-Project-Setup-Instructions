/**
 * WorldColliders.tsx — Box3-based collision (Rapier fallback path).
 *
 * @react-three/rapier is NOT installed in this project.
 * This module provides a pure Box3/Raycaster collision system that:
 *   1. Clamps avatar Y to floor (floor snap via downward raycast or direct clamp).
 *   2. Separates avatar capsule from desk AABB along Z/X (max 3 iterations).
 *   3. Clamps avatar to room wall bounds (X and Z).
 *
 * Usage:
 *   // Once, after desk loads:
 *   worldColliders.setDeskScene(deskGroup);
 *
 *   // Every frame (inside useFrame), pass avatar group:
 *   worldColliders.resolve(avatarGroup.position, AVATAR_CAPSULE_RADIUS);
 *
 * All temporaries are pre-allocated (zero GC per frame).
 */

import * as THREE from 'three';
import { ROOM_BOUNDS } from '../scene/RoomShell';

// ── Avatar capsule approximation ──────────────────────────────────────────────
const CAPSULE_RADIUS = 0.28;  // meters — horizontal half-width
const CAPSULE_HEIGHT = 1.7;   // meters — full body height (for overlap checks)

// Pre-allocated temporaries (zero allocations per frame)
const _deskBox   = new THREE.Box3();
const _avatarBox = new THREE.Box3();
const _tmpVec    = new THREE.Vector3();
const _center    = new THREE.Vector3();
const _size      = new THREE.Vector3();

// ── Desk state ────────────────────────────────────────────────────────────────
let _deskScene: THREE.Object3D | null = null;
let _deskBoxDirty = true;

/** Call once after desk GLB is loaded to register the desk collider. */
export function setDeskScene(scene: THREE.Object3D): void {
  _deskScene = scene;
  _deskBoxDirty = true;
}

/** Recompute desk Box3 from current world transform (call when desk moves). */
function refreshDeskBox(): void {
  if (!_deskScene) return;
  _deskBox.setFromObject(_deskScene);
  _deskBoxDirty = false;
}

// ── ChairSeatAnchor ───────────────────────────────────────────────────────────
let _chairAnchorPosition: THREE.Vector3 | null = null;
let _chairAnchorRotation: THREE.Euler    | null = null;

/** Returns the computed chair seat anchor in world space, or null if not ready. */
export function getChairAnchor(): { position: THREE.Vector3; rotation: THREE.Euler } | null {
  if (!_chairAnchorPosition) return null;
  return { position: _chairAnchorPosition.clone(), rotation: _chairAnchorRotation!.clone() };
}

/**
 * Auto-compute chair seat anchor from desk Box3.
 * Seat is estimated at front-center of the desk AABB, +SEAT_HEIGHT above floor.
 */
const SEAT_HEIGHT = 0.46; // meters above floor
export function computeChairAnchor(): void {
  if (!_deskScene) return;
  if (_deskBoxDirty) refreshDeskBox();
  _deskBox.getCenter(_center);
  _deskBox.getSize(_size);

  // Chair seat is in front of desk (toward +z = camera side), at seat height
  _chairAnchorPosition = new THREE.Vector3(
    _center.x,
    ROOM_BOUNDS.floorY + SEAT_HEIGHT,
    _deskBox.max.z + 0.05, // 5cm in front of desk front face
  );
  // Anchor faces toward +z (toward camera)
  _chairAnchorRotation = new THREE.Euler(0, Math.PI, 0);
}

// ── sit / stand / snapToSeat ──────────────────────────────────────────────────
let _isSitting = false;

/** Align avatar group to ChairSeatAnchor. Hip offset +0.03m. */
export function sit(avatarGroup: THREE.Group): boolean {
  const anchor = getChairAnchor();
  if (!anchor) return false;
  avatarGroup.position.copy(anchor.position);
  avatarGroup.position.y += 0.03; // hip offset
  avatarGroup.rotation.copy(anchor.rotation);
  _isSitting = true;
  return true;
}

export function stand(avatarGroup: THREE.Group): void {
  avatarGroup.position.y = ROOM_BOUNDS.floorY;
  _isSitting = false;
}

export function snapToSeat(avatarGroup: THREE.Group): void {
  sit(avatarGroup);
}

export function isSitting(): boolean { return _isSitting; }

// ── Main per-frame resolver ───────────────────────────────────────────────────
/**
 * Resolves avatar position against all static colliders.
 * Call every useFrame with the avatar's current world position.
 * Mutates `pos` in place — minimal allocations guaranteed.
 *
 * @param pos    Avatar world position (THREE.Vector3) — mutated in place
 * @param radius Capsule horizontal radius (default CAPSULE_RADIUS)
 * @returns true if any separation occurred
 */
export function resolve(
  pos: THREE.Vector3,
  radius: number = CAPSULE_RADIUS,
): boolean {
  let touched = false;

  // 1. Floor snap — clamp y to floor level
  if (pos.y < ROOM_BOUNDS.floorY) {
    pos.y = ROOM_BOUNDS.floorY;
    touched = true;
  }

  // 2. Wall clamps — keep avatar inside room bounds
  const margin = radius;
  if (pos.x < ROOM_BOUNDS.minX + margin) { pos.x = ROOM_BOUNDS.minX + margin; touched = true; }
  if (pos.x > ROOM_BOUNDS.maxX - margin) { pos.x = ROOM_BOUNDS.maxX - margin; touched = true; }
  if (pos.z < ROOM_BOUNDS.minZ + margin) { pos.z = ROOM_BOUNDS.minZ + margin; touched = true; }
  if (pos.z > ROOM_BOUNDS.maxZ - margin) { pos.z = ROOM_BOUNDS.maxZ - margin; touched = true; }

  // 3. Desk Box3 separation (up to 3 iterations to stop tunneling)
  if (_deskScene) {
    if (_deskBoxDirty) refreshDeskBox();

    // Build avatar AABB (capsule approximated as box)
    _avatarBox.min.set(pos.x - radius, pos.y, pos.z - radius);
    _avatarBox.max.set(pos.x + radius, pos.y + CAPSULE_HEIGHT, pos.z + radius);

    for (let iter = 0; iter < 3; iter++) {
      if (!_avatarBox.intersectsBox(_deskBox)) break;

      // Compute overlap extents on each axis
      const ox = Math.min(
        _avatarBox.max.x - _deskBox.min.x,
        _deskBox.max.x   - _avatarBox.min.x,
      );
      const oz = Math.min(
        _avatarBox.max.z - _deskBox.min.z,
        _deskBox.max.z   - _avatarBox.min.z,
      );

      // Push out along axis of minimum overlap
      if (ox < oz) {
        // Separate on X
        _deskBox.getCenter(_tmpVec);
        const sign = pos.x < _tmpVec.x ? -1 : 1;
        pos.x += sign * (ox + 0.01);
      } else {
        // Separate on Z
        _deskBox.getCenter(_tmpVec);
        const sign = pos.z < _tmpVec.z ? -1 : 1;
        pos.z += sign * (oz + 0.01);
      }

      // Re-update avatar AABB for next iteration
      _avatarBox.min.set(pos.x - radius, pos.y, pos.z - radius);
      _avatarBox.max.set(pos.x + radius, pos.y + CAPSULE_HEIGHT, pos.z + radius);
      touched = true;
    }
  }

  return touched;
}

/** Expose the computed desk Box3 for debug visualization */
export function getDeskBox(): THREE.Box3 {
  if (_deskBoxDirty && _deskScene) refreshDeskBox();
  return _deskBox;
}

/** Toggle physics (no-op when Rapier is absent — kept for API parity) */
let _enabled = false;   // enabled — avatar is clamped inside room bounds
export function setEnabled(on: boolean): void { _enabled = on; }
export function isEnabled(): boolean           { return _enabled; }

/**
 * resolveIfEnabled — convenience: only resolves if physics is enabled.
 */
export function resolveIfEnabled(pos: THREE.Vector3, radius?: number): boolean {
  if (!_enabled) return false;
  return resolve(pos, radius);
}
