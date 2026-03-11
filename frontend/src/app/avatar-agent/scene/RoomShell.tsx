'use client';
/**
 * RoomShell.tsx — Three walls (back, left, right) + floor.
 *
 * Coordinate system (matches AvatarCanvas):
 *   Y-up, camera at z≈+3.2 looking toward -z.
 *   Floor at y = floorY (-1.0 by default = AVATAR_BASE_Y).
 *
 * Props:
 *   width    — x span (meters)     default 6
 *   depth    — total z span        default 8  (zFar=-5 to zNear=+3)
 *   height   — room height above floor default 4
 *   thickness — mesh thickness      default 0.05
 *   floorY   — world y of floor     default -1.0
 *   zNear    — front z edge        default +3.0
 *   zFar     — back z edge         default -5.0
 */
import React, { useMemo } from 'react';
import { ROOM_PALETTE, getRoomMaterial, getNoiseNormalMap } from './BackdropTheme';

export interface RoomShellProps {
  width?:     number;
  depth?:     number;
  height?:    number;
  thickness?: number;
  floorY?:    number;
  zNear?:     number;
  zFar?:      number;
  noiseNormals?: boolean;
}

export function RoomShell({
  width         = 6,
  height        = 4,
  thickness     = 0.05,
  floorY        = -1.0,
  zNear         = 3.0,
  zFar          = -5.0,
  noiseNormals  = true,
}: RoomShellProps) {
  const zLen    = Math.abs(zNear - zFar);
  const zCenter = (zNear + zFar) / 2;
  const wallY   = floorY + height / 2;

  const noiseMap = useMemo(() => (noiseNormals ? getNoiseNormalMap() : null), [noiseNormals]);

  const floorMat = useMemo(() => {
    const m = getRoomMaterial(ROOM_PALETTE.floor, 0.92, 0.03);
    if (noiseMap) { m.normalMap = noiseMap; m.normalScale.set(0.15, 0.15); }
    return m;
  }, [noiseMap]);

  const backMat = useMemo(() => {
    const m = getRoomMaterial(ROOM_PALETTE.backWall, 0.86, 0.04);
    if (noiseMap) { m.normalMap = noiseMap; m.normalScale.set(0.08, 0.08); }
    return m;
  }, [noiseMap]);

  const sideMat = useMemo(() => {
    const m = getRoomMaterial(ROOM_PALETTE.leftWall, 0.84, 0.04);
    if (noiseMap) { m.normalMap = noiseMap; m.normalScale.set(0.08, 0.08); }
    return m;
  }, [noiseMap]);

  // Floor repeat UVs: 1 tile per meter
  const floorGeo = useMemo(() => {
    const g = new (require('three').PlaneGeometry)(width, zLen, 1, 1);
    return g;
  }, [width, zLen]);

  return (
    <group name="RoomShell">
      {/* ── Floor ── */}
      <mesh
        name="RoomFloor"
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, floorY, zCenter]}
        material={floorMat}
        geometry={floorGeo}
      />

      {/* ── Back wall (z = zFar) ── */}
      <mesh
        name="BackWall"
        receiveShadow
        position={[0, wallY, zFar]}
        material={backMat}
      >
        <planeGeometry args={[width, height]} />
      </mesh>

      {/* ── Left wall (x = -width/2), faces +x ── */}
      <mesh
        name="LeftWall"
        receiveShadow
        rotation={[0, Math.PI / 2, 0]}
        position={[-width / 2, wallY, zCenter]}
        material={sideMat}
      >
        <planeGeometry args={[zLen, height]} />
      </mesh>

      {/* ── Right wall (x = +width/2), faces -x ── */}
      <mesh
        name="RightWall"
        receiveShadow
        rotation={[0, -Math.PI / 2, 0]}
        position={[width / 2, wallY, zCenter]}
        material={sideMat}
      >
        <planeGeometry args={[zLen, height]} />
      </mesh>
    </group>
  );
}

/** Static world bounds used by physics system */
export const ROOM_BOUNDS = {
  floorY:    -1.0,
  ceilY:      4.0,
  minX:      -3.0,
  maxX:       3.0,
  minZ:      -5.0,
  maxZ:       3.0,
} as const;
