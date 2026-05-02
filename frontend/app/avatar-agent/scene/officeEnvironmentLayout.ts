/**
 * Office GLB environment layout: hard-reset corrupt transforms, re-apply authored
 * defaults from JSON, and optional world-space sanity passes.
 * Avatar / VRM is never touched — only `gltf.scene` from the office loader.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OFFICE_BACKGROUND_MESH_NAME } from '@/config/avatar';
import { markDeskSceneTransformDirty } from '@/app/avatar-agent/physics/WorldColliders';

/** Wrapped by `<group name={ENV_ROOT_NAME}>` in AvatarCanvas — environment only, never the avatar. */
export const ENV_ROOT_NAME = 'CogniEnvironmentRoot' as const;

export type OfficeSceneObjectSnapshot = {
  uuid: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

export type OfficeSceneFileV1 = {
  version: 1;
  glbUrl: string;
  officePosition: [number, number, number];
  officeScale: number;
  objects: OfficeSceneObjectSnapshot[];
};

export type EnvironmentResetReport = {
  glbSceneRootReset: boolean;
  meshLocalTransformsReset: number;
  jsonMeshesApplied: number;
  roomContentEditGroupEnsured: boolean;
};

export function snapshotFromObject(obj: THREE.Object3D): OfficeSceneObjectSnapshot {
  const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
  return {
    uuid: obj.uuid,
    name: obj.name || '(unnamed)',
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [e.x, e.y, e.z],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
  };
}

export function collectOfficeMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

export function buildOfficeSceneJson(
  gltf: GLTF,
  glbUrl: string,
  officePosition: [number, number, number],
  officeScale: number,
): OfficeSceneFileV1 {
  const objects = collectOfficeMeshes(gltf.scene).map(snapshotFromObject);
  return {
    version: 1,
    glbUrl,
    officePosition: [...officePosition],
    officeScale,
    objects,
  };
}

export function applyOfficeSceneJson(gltf: GLTF, data: OfficeSceneFileV1): void {
  const byUuid = new Map(data.objects.map((o) => [o.uuid, o]));
  const byName = new Map<string, OfficeSceneObjectSnapshot[]>();
  for (const o of data.objects) {
    const arr = byName.get(o.name) ?? [];
    arr.push(o);
    byName.set(o.name, arr);
  }
  collectOfficeMeshes(gltf.scene).forEach((mesh) => {
    let snap = byUuid.get(mesh.uuid);
    if (!snap) {
      const arr = byName.get(mesh.name || '(unnamed)');
      snap = arr?.shift();
    }
    if (!snap) return;
    mesh.position.set(...snap.position);
    mesh.rotation.set(snap.rotation[0], snap.rotation[1], snap.rotation[2], 'YXZ');
    mesh.scale.set(...snap.scale);
    mesh.updateMatrixWorld(true);
  });
  markDeskSceneTransformDirty();
}

/** Lifts background to scene root and groups editable room content — required by the scene editor. */
export function ensureRoomContentEditGroup(scene: THREE.Object3D): THREE.Group {
  const existing = scene.userData.roomContentEditGroup as THREE.Group | undefined;
  if (existing) return existing;

  const bgName = OFFICE_BACKGROUND_MESH_NAME;
  const bg = scene.getObjectByName(bgName) as THREE.Object3D | undefined;
  if (bg) scene.attach(bg);

  const roomGroup = new THREE.Group();
  roomGroup.name = 'RoomContentEdit';
  scene.add(roomGroup);

  for (const child of [...scene.children]) {
    if (child === roomGroup || child === bg) continue;
    roomGroup.attach(child);
  }

  scene.userData.roomContentEditGroup = roomGroup;
  return roomGroup;
}

export type ResetGltfEnvironmentOptions = {
  /** Default true — identity each mesh locally before JSON re-application. */
  resetMeshLocalTransforms?: boolean;
};

/**
 * Phase 2–4: identity `gltf.scene` root, optionally identity all meshes, re-apply JSON,
 * ensure RoomContentEdit group. Does not set world room position (React effect does).
 */
export function resetGltfEnvironmentAndReapplyDefaults(
  gltf: GLTF,
  data: OfficeSceneFileV1,
  opts?: ResetGltfEnvironmentOptions,
): EnvironmentResetReport {
  const scene = gltf.scene;
  const resetMeshes = opts?.resetMeshLocalTransforms !== false;

  scene.position.set(0, 0, 0);
  scene.rotation.set(0, 0, 0);
  scene.quaternion.set(0, 0, 0, 1);
  scene.scale.set(1, 1, 1);
  scene.updateMatrix();
  scene.updateMatrixWorld(true);

  let meshLocalTransformsReset = 0;
  if (resetMeshes) {
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.set(1, 1, 1);
        mesh.updateMatrix();
        meshLocalTransformsReset++;
      }
    });
  }

  applyOfficeSceneJson(gltf, data);
  ensureRoomContentEditGroup(scene);

  const jsonMeshesApplied = data.objects.length;

  scene.updateMatrixWorld(true);
  markDeskSceneTransformDirty();

  return {
    glbSceneRootReset: true,
    meshLocalTransformsReset,
    jsonMeshesApplied,
    roomContentEditGroupEnsured: true,
  };
}

export type FarCullReport = {
  hiddenCount: number;
  restoredVisibleCount: number;
};

const _worldPos = new THREE.Vector3();

/**
 * After room root world transform is applied: hide meshes whose world origin is absurdly
 * far from the scene origin (broken instances / duplicated props), and show others.
 */
export function cullFarEnvironmentMeshes(
  root: THREE.Object3D,
  worldRadius: number,
): FarCullReport {
  let hiddenCount = 0;
  let restoredVisibleCount = 0;
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.getWorldPosition(_worldPos);
    const far = _worldPos.length() > worldRadius;
    if (far) {
      if (mesh.visible) hiddenCount++;
      mesh.visible = false;
    } else {
      if (!mesh.visible) restoredVisibleCount++;
      mesh.visible = true;
    }
  });
  return { hiddenCount, restoredVisibleCount };
}
