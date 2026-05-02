'use client';
/**
 * OfficeDeskPro.tsx — Procedural desk + chair with optional Rapier physics.
 *
 * On mount the desk group snaps to a "DeskAnchor" object3D in the scene
 * (created by RoomWithShelves / RoomShell).  If no DeskAnchor is found the
 * group stays at its default React position ([0, 0, 0]).
 *
 * Public API (attached to the group via the component):
 *   sit(avatar)       — moves avatar to the ChairSeatAnchor
 *   stand(avatar)     — lifts avatar 0.5 m above ChairSeatAnchor
 *   snapToSeat(avatar)— alias for sit()
 *
 * Utility exports (module-level):
 *   snapYWithRay(obj)             — snap object to floorY via raycasting
 *   separateBoxZ(avatar,obstacle) — push avatar out of obstacle along Z
 *   DeskChairAPI                  — placeholder stub (use component API for
 *                                   real sit/stand logic)
 *
 * Physics: Rapier RigidBody snippets are preserved in comments.
 * Set usePhysics={true} + install @react-three/rapier to activate them.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
// import { RigidBody } from '@react-three/rapier';

// ── Module-level physics-fallback helpers ─────────────────────────────────────
export const snapYWithRay = (object3D: THREE.Object3D, floorY = 0): void => {
  const raycaster = new THREE.Raycaster();
  const origin    = new THREE.Vector3();
  object3D.getWorldPosition(origin);
  origin.y += 0.5;
  raycaster.set(origin, new THREE.Vector3(0, -1, 0));
  // In a real scene, check raycaster.intersectObjects(scene.children, true)
  // and use the first hit point. Here we snap to the provided floorY.
  object3D.position.y =
    floorY + ((object3D.userData.height as number | undefined) ?? 0) / 2;
  console.log(`[OfficeDeskPro] snapYWithRay → ${object3D.name} y=${object3D.position.y}`);
};

export const separateBoxZ = (
  avatar:   THREE.Object3D,
  obstacle: THREE.Object3D,
): void => {
  const avatarBox   = new THREE.Box3().setFromObject(avatar);
  const obstacleBox = new THREE.Box3().setFromObject(obstacle);
  if (avatarBox.intersectsBox(obstacleBox)) {
    const intersection = avatarBox.clone().intersect(obstacleBox);
    const penetration  = intersection.max.z - intersection.min.z;
    const direction    = avatar.position.z > obstacle.position.z ? 1 : -1;
    avatar.position.z += penetration * direction;
    console.log(`[OfficeDeskPro] separateBoxZ ${avatar.name} ↔ ${obstacle.name}`);
  }
};

// ── Types ─────────────────────────────────────────────────────────────────────
type OfficeDeskProProps = {
  deskWidth?:       number;
  deskDepth?:       number;
  deskHeight?:      number;
  chairSeatHeight?: number;
  woodColor?:       string;
  metalColor?:      string;
  usePhysics?:      boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────
export const OfficeDeskPro = ({
  deskWidth       = 1.4,
  deskDepth       = 0.6,
  deskHeight      = 0.76,
  chairSeatHeight = 0.46,
  woodColor       = '#8B4513',
  metalColor      = '#555555',
  usePhysics      = false, // eslint-disable-line @typescript-eslint/no-unused-vars
}: OfficeDeskProProps) => {
  const deskRef  = useRef<THREE.Group>(null);
  const chairRef = useRef<THREE.Group>(null);
  const { scene } = useThree();

  // Snap desk group to DeskAnchor when scene is ready
  useEffect(() => {
    if (!deskRef.current) return;
    const anchor = scene.getObjectByName('DeskAnchor');
    if (anchor) {
      deskRef.current.position.copy(anchor.position);
      deskRef.current.quaternion.copy(anchor.quaternion);
      deskRef.current.updateMatrixWorld(true);
      console.log('[OfficeDeskPro] Desk snapped to DeskAnchor.', anchor.position.toArray());
    } else {
      console.warn('[OfficeDeskPro] DeskAnchor not found — desk at default position.');
    }
  }, [scene]);

  // Memoised materials — recreated only when colour props change
  const woodMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: new THREE.Color(woodColor) }),
    [woodColor],
  );
  const metalMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color:     new THREE.Color(metalColor),
      metalness: 0.8,
      roughness: 0.3,
    }),
    [metalColor],
  );

  // ── Component-scoped API ──────────────────────────────────────────
  const sit = (avatar: THREE.Object3D): void => {
    const anchor = chairRef.current?.getObjectByName('ChairSeatAnchor');
    if (anchor) {
      const wp = new THREE.Vector3();
      anchor.getWorldPosition(wp);
      avatar.position.copy(wp);
      avatar.position.y -= 0.1;
      console.log('[OfficeDeskPro] avatar sat on chair.');
    } else {
      console.warn('[OfficeDeskPro] ChairSeatAnchor not found.');
    }
  };

  const stand = (avatar: THREE.Object3D): void => {
    const anchor = chairRef.current?.getObjectByName('ChairSeatAnchor');
    if (anchor) {
      const wp = new THREE.Vector3();
      anchor.getWorldPosition(wp);
      avatar.position.copy(wp);
      avatar.position.y += 0.5;
      console.log('[OfficeDeskPro] avatar stood up.');
    }
  };

  const snapToSeat = (avatar: THREE.Object3D): void => sit(avatar);

  // Expose API on the group's userData for external callers
  useEffect(() => {
    if (deskRef.current) {
      deskRef.current.userData.deskAPI = { sit, stand, snapToSeat };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desk leg positions (relative to desk centre)
  const legPositions: [number, number, number][] = [
    [-(deskWidth / 2 - 0.05),  deskHeight / 2 - 0.38, -(deskDepth / 2 - 0.05)],
    [ (deskWidth / 2 - 0.05),  deskHeight / 2 - 0.38, -(deskDepth / 2 - 0.05)],
    [-(deskWidth / 2 - 0.05),  deskHeight / 2 - 0.38,  (deskDepth / 2 - 0.05)],
    [ (deskWidth / 2 - 0.05),  deskHeight / 2 - 0.38,  (deskDepth / 2 - 0.05)],
  ];

  // Chair leg positions (relative to chair centre)
  const chairLegPositions: [number, number, number][] = [
    [-0.18, chairSeatHeight / 2 - 0.25, -0.18],
    [ 0.18, chairSeatHeight / 2 - 0.25, -0.18],
    [-0.18, chairSeatHeight / 2 - 0.25,  0.18],
    [ 0.18, chairSeatHeight / 2 - 0.25,  0.18],
  ];

  return (
    <group>
      {/* ── Desk ───────────────────────────────────────────────────── */}
      <group ref={deskRef} name="OfficeDesk">
        {/* Physics (Rapier) block — uncomment when @react-three/rapier is installed:
        {usePhysics ? (
          <RigidBody type="fixed" colliders="cuboid">
            <mesh material={woodMat} position={[0, deskHeight / 2, 0]}>
              <boxGeometry args={[deskWidth, deskHeight, deskDepth]} />
            </mesh>
          </RigidBody>
        ) : ( */}
        <mesh material={woodMat} position={[0, deskHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[deskWidth, deskHeight, deskDepth]} />
        </mesh>
        {/* )} */}

        {/* Desk legs */}
        {legPositions.map(([x, y, z], i) => (
          <mesh key={i} material={metalMat} position={[x, y, z]} castShadow>
            <boxGeometry args={[0.05, deskHeight - 0.02, 0.05]} />
          </mesh>
        ))}
      </group>

      {/* ── Chair ─────────────────────────────────────────────────── */}
      {/* position=[0,0,-0.5]: chair sits behind the desk (away from camera) */}
      <group ref={chairRef} name="OfficeChair" position={[0, 0, -0.5]}>
        {/* Physics (Rapier) block — uncomment when @react-three/rapier is installed:
        {usePhysics ? (
          <RigidBody type="fixed" colliders="cuboid">
            <mesh material={woodMat} position={[0, chairSeatHeight / 2, 0]}>
              <boxGeometry args={[0.5, 0.05, 0.5]} />
            </mesh>
            <mesh material={woodMat} position={[0, chairSeatHeight + 0.2, -0.2]} rotation={[-Math.PI / 10, 0, 0]}>
              <boxGeometry args={[0.5, 0.5, 0.05]} />
            </mesh>
          </RigidBody>
        ) : ( */}
        {/* Seat */}
        <mesh material={woodMat} position={[0, chairSeatHeight / 2, 0]} castShadow>
          <boxGeometry args={[0.5, 0.05, 0.5]} />
        </mesh>
        {/* Backrest */}
        <mesh
          material={woodMat}
          position={[0, chairSeatHeight + 0.2, -0.2]}
          rotation={[-Math.PI / 10, 0, 0]}
          castShadow
        >
          <boxGeometry args={[0.5, 0.5, 0.05]} />
        </mesh>
        {/* )} */}

        {/* Chair legs */}
        {chairLegPositions.map(([x, y, z], i) => (
          <mesh key={i} material={metalMat} position={[x, y, z]} castShadow>
            <boxGeometry args={[0.03, chairSeatHeight - 0.05, 0.03]} />
          </mesh>
        ))}

        {/* Anchor for sit() / stand() */}
        <object3D name="ChairSeatAnchor" position={[0, chairSeatHeight + 0.03, 0]} />
      </group>
    </group>
  );
};

// ── Module-level API stub ─────────────────────────────────────────────────────
// For full sit/stand behaviour, use the component's internal API available via
// deskRef.current.userData.deskAPI after mount.
export const DeskChairAPI = {
  sit: (_avatar: THREE.Object3D): void => {
    console.warn('[DeskChairAPI] Use deskRef.current.userData.deskAPI.sit() for real logic.');
  },
  stand: (_avatar: THREE.Object3D): void => {
    console.warn('[DeskChairAPI] Use deskRef.current.userData.deskAPI.stand() for real logic.');
  },
  snapToSeat: (_avatar: THREE.Object3D): void => {
    console.warn('[DeskChairAPI] Use deskRef.current.userData.deskAPI.snapToSeat() for real logic.');
  },
};
