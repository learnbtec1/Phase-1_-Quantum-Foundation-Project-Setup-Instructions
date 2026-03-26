/**
 * Rapier 3D — character controller + static environment (desk, chair, floor).
 * Desired motion comes from AvatarCanvas; computeColliderMovement corrects for obstacles.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { PHYSICS_CONFIG } from '@/config/avatar';
import { ROOM_BOUNDS } from '../scene/RoomShell';

let _staticsRegistered = false;
let _charController: ReturnType<RAPIER.World['createCharacterController']> | null = null;
let _avatarBody: ReturnType<RAPIER.World['createRigidBody']> | null = null;
let _avatarCollider: ReturnType<RAPIER.World['createCollider']> | null = null;

function buildFloor(world: RAPIER.World): void {
  const hw = (ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX) / 2;
  const hd = (ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ) / 2;
  const cx = (ROOM_BOUNDS.minX + ROOM_BOUNDS.maxX) / 2;
  const cz = (ROOM_BOUNDS.minZ + ROOM_BOUNDS.maxZ) / 2;
  const floorY = ROOM_BOUNDS.floorY - 0.06;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, floorY, cz));
  const desc = RAPIER.ColliderDesc.cuboid(hw, 0.08, hd)
    .setFriction(PHYSICS_CONFIG.environment.friction)
    .setRestitution(PHYSICS_CONFIG.environment.restitution);
  world.createCollider(desc, body);
}

function buildDesk(world: RAPIER.World, box: THREE.Box3): void {
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  box.getCenter(c);
  box.getSize(s);
  const hx = Math.max(s.x / 2, 0.05);
  const hy = Math.max(s.y / 2, 0.05);
  const hz = Math.max(s.z / 2, 0.05);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z));
  const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setFriction(PHYSICS_CONFIG.environment.friction)
    .setRestitution(PHYSICS_CONFIG.environment.restitution);
  world.createCollider(desc, body);
}

function buildChair(world: RAPIER.World, seatWorld: THREE.Vector3): void {
  const hx = 0.42;
  const hy = 0.14;
  const hz = 0.42;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(seatWorld.x, seatWorld.y + hy * 0.5, seatWorld.z),
  );
  const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setFriction(PHYSICS_CONFIG.environment.friction)
    .setRestitution(PHYSICS_CONFIG.environment.restitution);
  world.createCollider(desc, body);
}

/** Floor + optional desk/chair (from WorldColliders / scene). */
export function ensureRapierStatics(
  world: RAPIER.World,
  deskBox: THREE.Box3,
  chairSeat: THREE.Vector3 | null,
): void {
  if (_staticsRegistered) return;
  buildFloor(world);
  if (!deskBox.isEmpty()) {
    buildDesk(world, deskBox);
  }
  if (chairSeat) {
    buildChair(world, chairSeat);
  }
  _staticsRegistered = true;
}

export async function initRapierWorld(): Promise<RAPIER.World | null> {
  try {
    await RAPIER.init();
    const g = PHYSICS_CONFIG.gravity;
    return new RAPIER.World({ x: g[0], y: g[1], z: g[2] });
  } catch {
    return null;
  }
}

/**
 * Single capsule approximates full body (config: capsuleHeight / capsuleRadius).
 * boneDir reserved for future multi-volume rig matching.
 */
export function resolveRapierFrame(
  world: RAPIER.World,
  vrm: VRM | null,
  group: THREE.Group,
  dt: number,
  deskBox: THREE.Box3,
  chairSeat: THREE.Vector3 | null,
  _boneDir?: Map<string, THREE.Bone> | null,
): void {
  if (!vrm) return;

  ensureRapierStatics(world, deskBox, chairSeat);

  if (!_charController) {
    const cc = world.createCharacterController(0.02);
    cc.setSlideEnabled(true);
    cc.setMaxSlopeClimbAngle(50 * (Math.PI / 180));
    cc.setMinSlopeSlideAngle(30 * (Math.PI / 180));
    _charController = cc;
  }

  const r = PHYSICS_CONFIG.avatar.capsuleRadius;
  const totalH = PHYSICS_CONFIG.avatar.capsuleHeight;
  const segment = Math.max(0.15, totalH - 2 * r);
  const halfH = segment * 0.5;

  if (!_avatarBody || !_avatarCollider) {
    const tr = group.position;
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(tr.x, tr.y, tr.z),
    );
    const colDesc = RAPIER.ColliderDesc.capsule(halfH, r)
      .setTranslation(0, halfH + r, 0)
      .setFriction(PHYSICS_CONFIG.avatar.friction)
      .setRestitution(PHYSICS_CONFIG.avatar.restitution);
    const col = world.createCollider(colDesc, rb);
    _avatarBody = rb;
    _avatarCollider = col;
  }

  const body = _avatarBody;
  const collider = _avatarCollider;
  const controller = _charController;
  if (!body || !collider || !controller) return;

  world.timestep = Math.max(1 / 240, Math.min(dt, 0.1));

  const old = body.translation();
  const desired = group.position;
  const desiredTranslation = {
    x: desired.x - old.x,
    y: desired.y - old.y,
    z: desired.z - old.z,
  };

  controller.computeColliderMovement(collider, desiredTranslation);
  const m = controller.computedMovement();
  const nx = old.x + m.x;
  const ny = old.y + m.y;
  const nz = old.z + m.z;
  group.position.set(nx, ny, nz);
  body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
  world.step();
}

export function resetRapierAvatarState(): void {
  _charController = null;
  _avatarBody = null;
  _avatarCollider = null;
  _staticsRegistered = false;
}
