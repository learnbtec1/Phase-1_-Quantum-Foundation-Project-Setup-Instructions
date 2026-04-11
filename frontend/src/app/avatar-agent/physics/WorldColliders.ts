/**
 * WorldColliders.ts — Box3 collision + optional Rapier character controller.
 *
 * Fallback path (no Rapier world): pure Box3 separation for desk / walls / floor.
 * When `initRapierWorld()` succeeds, AvatarCanvas uses Rapier `resolveIfEnabled(world, …)`.
 *
 * Hand–hand separation during clap/wave is handled procedurally in `AvatarCanvas.tsx`
 * (additive arm roll during clap/cheer VRMA). Full Rapier hand capsules would duplicate
 * avatar motion and are not enabled here.
 *
 * Legacy Box3/Raycaster collision system that:
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
import type { VRM } from '@pixiv/three-vrm';
import { PHYSICS_CONFIG } from '@/config/avatar';
import { ROOM_BOUNDS } from '../scene/RoomShell';
import { resolveRapierFrame, resetRapierAvatarState } from './rapierColliders';

export { initRapierWorld, resetRapierAvatarState } from './rapierColliders';

/**
 * V30 — hook for future Rapier palm sensors (disabled: kinematic–kinematic rarely solves penetration).
 * Procedural separation in AvatarCanvas handles clap/cheer; call this to reserve API for tools/tests.
 */
export function setGesturePalmCollidersEnabled(_enabled: boolean): void {
  /* reserved — keep no-op to avoid regressions */
}

/** V30 — optional pulse flag consumers can read (e.g. telemetry). Separation is procedural in AvatarCanvas. */
let _handSeparationPulseUntil = 0;

export function pulseHandSeparationWindow(durationMs: number = 520): void {
  _handSeparationPulseUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + durationMs;
}

export function isHandSeparationPulseActive(): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return now < _handSeparationPulseUntil;
}

// ── Avatar capsule approximation (aligned with PHYSICS_CONFIG when present) ──
const CAPSULE_RADIUS = PHYSICS_CONFIG.avatar.capsuleRadius;
const CAPSULE_HEIGHT = Math.max(1.4, PHYSICS_CONFIG.avatar.capsuleHeight); // overlap AABB height

// Pre-allocated temporaries (zero allocations per frame)
const _deskBox   = new THREE.Box3();
const _meshBox   = new THREE.Box3();
const _avatarBox = new THREE.Box3();
const _tmpVec    = new THREE.Vector3();
const _center    = new THREE.Vector3();
const _size      = new THREE.Vector3();

/** World-space AABBs: room walls (first 4) + per-mesh colliders from the office GLB. */
const _envColliderBoxes: THREE.Box3[] = [];
const _wallBoxes: [THREE.Box3, THREE.Box3, THREE.Box3, THREE.Box3] = [
  new THREE.Box3(),
  new THREE.Box3(),
  new THREE.Box3(),
  new THREE.Box3(),
];
const _meshColliderBoxPool: THREE.Box3[] = [];

const WALL_THICKNESS = 0.08;
const MIN_MESH_EXTENT = 0.028;
const IGNORE_MESH_NAME =
  /^(RoomShell|Backdrop|ParquetFloor|Sky|Sun|Light|Camera|Helper|grid|Axes|FloorClick)/i;

function appendRoomWallBoxes(out: THREE.Box3[]): void {
  const rb = ROOM_BOUNDS;
  const t = WALL_THICKNESS;
  _wallBoxes[0]!.set(
    new THREE.Vector3(rb.minX, rb.floorY, rb.minZ),
    new THREE.Vector3(rb.minX + t, rb.ceilY, rb.maxZ),
  );
  _wallBoxes[1]!.set(
    new THREE.Vector3(rb.maxX - t, rb.floorY, rb.minZ),
    new THREE.Vector3(rb.maxX, rb.ceilY, rb.maxZ),
  );
  _wallBoxes[2]!.set(
    new THREE.Vector3(rb.minX, rb.floorY, rb.minZ),
    new THREE.Vector3(rb.maxX, rb.ceilY, rb.minZ + t),
  );
  _wallBoxes[3]!.set(
    new THREE.Vector3(rb.minX, rb.floorY, rb.maxZ - t),
    new THREE.Vector3(rb.maxX, rb.ceilY, rb.maxZ),
  );
  out.push(_wallBoxes[0]!, _wallBoxes[1]!, _wallBoxes[2]!, _wallBoxes[3]!);
}

function shouldSkipMeshCollider(mesh: THREE.Mesh, worldBox: THREE.Box3, floorY: number): boolean {
  if (mesh.userData?.ignorePhysics === true) return true;
  if (IGNORE_MESH_NAME.test(mesh.name || '')) return true;
  if (worldBox.isEmpty()) return true;
  worldBox.getSize(_size);
  if (Math.min(_size.x, _size.y, _size.z) < MIN_MESH_EXTENT) return true;

  const horiz = _size.x * _size.z;
  const bottomNearFloor = worldBox.min.y < floorY + 0.22 && worldBox.max.y < floorY + 0.38;
  if (_size.y < 0.14 && horiz > 14 && bottomNearFloor) return true;

  const ceilingSlab = worldBox.min.y > floorY + 2.4 && _size.y < 0.2 && horiz > 10;
  if (ceilingSlab) return true;

  return false;
}

function acquireMeshColliderBox(): THREE.Box3 {
  return _meshColliderBoxPool.pop() ?? new THREE.Box3();
}

function releaseAllPooledMeshBoxes(): void {
  for (let i = 4; i < _envColliderBoxes.length; i++) {
    _meshColliderBoxPool.push(_envColliderBoxes[i]!);
  }
}

/** Rebuild `_envColliderBoxes` from `ROOM_BOUNDS` + office mesh world AABBs. */
function rebuildEnvironmentColliderBoxes(): void {
  releaseAllPooledMeshBoxes();
  _envColliderBoxes.length = 0;
  appendRoomWallBoxes(_envColliderBoxes);

  if (!_deskScene) return;

  _deskScene.updateMatrixWorld(true);
  _deskScene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    _meshBox.setFromObject(mesh);
    if (shouldSkipMeshCollider(mesh, _meshBox, ROOM_BOUNDS.floorY)) return;
    const box = acquireMeshColliderBox();
    box.copy(_meshBox);
    _envColliderBoxes.push(box);
  });
}

/** After office transforms or layout JSON, mark caches stale and drop Rapier statics so they rebuild. */
export function markDeskSceneTransformDirty(): void {
  _deskBoxDirty = true;
  resetRapierAvatarState();
}

function ensureEnvironmentColliderBoxes(): void {
  if (_deskBoxDirty) {
    if (_deskScene) {
      refreshDeskBox();
    } else {
      _deskBox.makeEmpty();
      _deskBoxDirty = false;
      rebuildEnvironmentColliderBoxes();
    }
  } else if (_envColliderBoxes.length === 0) {
    rebuildEnvironmentColliderBoxes();
  }
}

/** Walls + furniture AABBs used by Rapier registration and Box3 resolve. */
export function getEnvironmentColliderBoxes(): readonly THREE.Box3[] {
  ensureEnvironmentColliderBoxes();
  return _envColliderBoxes;
}

// ── Desk state ────────────────────────────────────────────────────────────────
let _deskScene: THREE.Object3D | null = null;
let _deskBoxDirty = true;

/** Call once after desk GLB is loaded to register the desk collider. */
export function setDeskScene(scene: THREE.Object3D): void {
  _deskScene = scene;
  _deskBoxDirty = true;
}

/** Clear desk collider + chair anchor (e.g. when office GLB is removed from the scene). */
export function clearDeskScene(): void {
  releaseAllPooledMeshBoxes();
  _envColliderBoxes.length = 0;
  _deskScene = null;
  _deskBoxDirty = true;
  _chairAnchorPosition = null;
  _chairAnchorRotation = null;
  resetRapierAvatarState();
}

/** Recompute desk Box3 from current world transform (call when desk moves). */
function refreshDeskBox(): void {
  if (!_deskScene) return;
  _deskBox.setFromObject(_deskScene);
  _deskBoxDirty = false;
  rebuildEnvironmentColliderBoxes();
}

// ── ChairSeatAnchor ───────────────────────────────────────────────────────────
let _chairAnchorPosition: THREE.Vector3 | null = null;
let _chairAnchorRotation: THREE.Euler    | null = null;

/** Returns the computed chair seat anchor in world space, or null if not ready. */
export function getChairAnchor(): { position: THREE.Vector3; rotation: THREE.Euler } | null {
  if (!_chairAnchorPosition) return null;
  return { position: _chairAnchorPosition.clone(), rotation: _chairAnchorRotation!.clone() };
}

/** Chair seat world position for physics / seating (clone — safe to mutate). */
export function getChairAnchorVector3(): THREE.Vector3 | null {
  if (!_chairAnchorPosition) return null;
  return _chairAnchorPosition.clone();
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

  // Chair seat is behind desk center (teacher side, toward back wall).
  // Uses desk center Z minus half-depth minus 40 cm — avoids using min.z
  // which for full-room GLBs equals the entire room's back wall.
  const deskHalfDepth = Math.min(_size.z * 0.5, 1.2); // cap at 1.2 m — room GLBs are huge
  _chairAnchorPosition = new THREE.Vector3(
    _center.x,
    ROOM_BOUNDS.floorY + SEAT_HEIGHT,
    _center.z - deskHalfDepth - 0.40,
  );
  // Anchor faces toward +z (toward camera — teacher faces students)
  _chairAnchorRotation = new THREE.Euler(0, 0, 0);
}

// ── sit / stand / snapToSeat ──────────────────────────────────────────────────
let _isSitting = false;

/** Align avatar group to ChairSeatAnchor. Hip offset +0.03m. */
export function sit(avatarGroup: THREE.Group): boolean {
  const anchor = getChairAnchor();
  if (!anchor) return false;

  const targetPosition = anchor.position.clone().add(new THREE.Vector3(0, 0.03, 0)); // Add hip offset
  const targetRotation = anchor.rotation.clone();

  // Interpolate position and rotation
  avatarGroup.position.lerp(targetPosition, 0.1); // Smooth position transition
  avatarGroup.quaternion.slerp(new THREE.Quaternion().setFromEuler(targetRotation), 0.1); // Smooth rotation transition

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

  // 3. Environment Box3 separation (walls + every eligible office mesh)
  ensureEnvironmentColliderBoxes();

  _avatarBox.min.set(pos.x - radius, pos.y, pos.z - radius);
  _avatarBox.max.set(pos.x + radius, pos.y + CAPSULE_HEIGHT, pos.z + radius);

  for (let iter = 0; iter < 6; iter++) {
    let hit = false;
    for (let b = 0; b < _envColliderBoxes.length; b++) {
      const staticBox = _envColliderBoxes[b]!;
      if (!_avatarBox.intersectsBox(staticBox)) continue;

      const ox = Math.min(
        _avatarBox.max.x - staticBox.min.x,
        staticBox.max.x   - _avatarBox.min.x,
      );
      const oz = Math.min(
        _avatarBox.max.z - staticBox.min.z,
        staticBox.max.z   - _avatarBox.min.z,
      );

      if (ox < oz) {
        staticBox.getCenter(_tmpVec);
        const sign = pos.x < _tmpVec.x ? -1 : 1;
        pos.x += sign * (ox + 0.01);
      } else {
        staticBox.getCenter(_tmpVec);
        const sign = pos.z < _tmpVec.z ? -1 : 1;
        pos.z += sign * (oz + 0.01);
      }

      _avatarBox.min.set(pos.x - radius, pos.y, pos.z - radius);
      _avatarBox.max.set(pos.x + radius, pos.y + CAPSULE_HEIGHT, pos.z + radius);
      touched = true;
      hit = true;
    }
    if (!hit) break;
  }

  return touched;
}

/** Expose the computed desk Box3 for debug visualization */
export function getDeskBox(): THREE.Box3 {
  if (_deskBoxDirty) {
    if (_deskScene) refreshDeskBox();
    else {
      _deskBox.makeEmpty();
      _deskBoxDirty = false;
      rebuildEnvironmentColliderBoxes();
    }
  }
  return _deskBox;
}

/** Toggle physics (no-op when Rapier is absent — kept for API parity) */
let _enabled = true;    // enabled by default — avatar is clamped inside room bounds
export function setEnabled(on: boolean): void { _enabled = on; }
export function isEnabled(): boolean           { return _enabled; }

function isRapierWorld(w: unknown): w is import('@dimforge/rapier3d-compat').World {
  return typeof w === 'object' && w !== null && 'step' in w && typeof (w as { step: unknown }).step === 'function';
}

/**
 * Box3-only resolve — convenience when Rapier world is unavailable.
 */
export function resolveIfEnabled(pos: THREE.Vector3, radius?: number): boolean;
/**
 * Rapier character-controller resolve — call after desired `group.position` is set.
 * `boneDir` optional map (reserved); bones are read from `vrm.humanoid` when needed later.
 */
export function resolveIfEnabled(
  world: import('@dimforge/rapier3d-compat').World,
  vrm: VRM | null,
  boneDir: Map<string, THREE.Bone> | null | undefined,
  group: THREE.Group,
  dt: number,
): void;
export function resolveIfEnabled(
  worldOrPos: THREE.Vector3 | import('@dimforge/rapier3d-compat').World,
  vrmOrRadius?: VRM | number | null,
  boneDir?: Map<string, THREE.Bone> | null,
  group?: THREE.Group,
  dt?: number,
): boolean | void {
  if (worldOrPos instanceof THREE.Vector3) {
    if (!_enabled) return false;
    return resolve(worldOrPos, vrmOrRadius as number | undefined);
  }
  if (!_enabled) return;
  if (!isRapierWorld(worldOrPos)) return;
  resolveRapierFrame(
    worldOrPos,
    vrmOrRadius as VRM | null,
    group!,
    dt!,
    getEnvironmentColliderBoxes(),
    getChairAnchorVector3(),
    boneDir,
  );
}
