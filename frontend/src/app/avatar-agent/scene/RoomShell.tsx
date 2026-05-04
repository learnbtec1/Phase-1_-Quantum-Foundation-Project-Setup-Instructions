'use client';
/**
 * RoomShell.tsx â€” Three walls (back, left, right) + floor.
 *
 * Coordinate system (matches AvatarCanvas):
 *   Y-up, camera ~z=-2.5 looks toward +Z (typical VRM faces +Z).
 *   Floor at y = floorY (-1.0 by default = AVATAR_BASE_Y).
 *
 * Props:
 *   width    â€” x span (meters)     default 6
 *   depth    â€” total z span        default 8  (zFar=-5 to zNear=+3)
 *   height   â€” room height above floor default 4
 *   thickness â€” mesh thickness      default 0.05
 *   floorY   â€” world y of floor     default -1.0
 *   zNear    â€” front z edge        default +3.0
 *   zFar     â€” back z edge         default -5.0
 *   showFloor / showBackWall / showSideWalls â€” toggle parts (e.g. side walls only when GLB supplies floor/back).
 *
 * Ù„Ø¶Ø¨Ø· Ø­Ø¬Ù… Ø§Ù„ØºØ±ÙØ© Ù…Ø¹ Ø§Ù„ÙÙŠØ²ÙŠØ§Ø¡: Ù…Ø±Ù‘Ø± Ø§Ù„Ø£Ø¨Ø¹Ø§Ø¯ Ù…Ù† `ROOM_BOUNDS` ÙƒÙ…Ø§ ÙÙŠ AvatarCanvas
 * (width = maxX−minX, z-span = maxZ−minZ, height = ceilY−floorY = ROOM_INTERIOR_HEIGHT_M).
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { readFloorBaselineOffsetEnv } from '@/config/avatar';
import { getWorldFloorY } from '@/app/avatar-agent/floor/worldFloor';
import { ROOM_PALETTE, getRoomMaterial, getNoiseNormalMap } from './BackdropTheme';

// â”€â”€ Warm wood parquet (square tiles, canvas-generated â€” no external image) â”€
const PARQUET_TEX_GEN = 3;
let _parquetTex: THREE.CanvasTexture | null = null;
let _parquetTexGen = 0;

function makeParquetTexture(): THREE.CanvasTexture {
  if (_parquetTex && _parquetTexGen === PARQUET_TEX_GEN) return _parquetTex;
  if (_parquetTex) {
    _parquetTex.dispose();
    _parquetTex = null;
  }

  const SIZE = 512;
  /** Ø¹Ø¯Ø¯ Ø§Ù„Ù…Ø±Ø¨Ø¹Ø§Øª ÙÙŠ ÙƒÙ„ Ø§ØªØ¬Ø§Ù‡ Ø¯Ø§Ø®Ù„ Ù†Ø³ÙŠØ¬ ÙˆØ§Ø­Ø¯ (1Ã—1 Ù…ØªØ± ØªÙ‚Ø±ÙŠØ¨Ø§Ù‹ Ø¹Ù†Ø¯ repeat) */
  const TILES_PER_SIDE = 8;
  const cell = SIZE / TILES_PER_SIDE;
  const GROUT = 2; // ÙÙˆØ§ØµÙ„ Ø¨Ù†ÙŠØ© Ø¨ÙŠÙ† Ø§Ù„Ù…Ø±Ø¨Ø¹Ø§Øª
  /** Ø£Ù„ÙˆØ§Ù† Ø®Ø´Ø¨ Ø¨Ø§Ø±ÙƒÙŠÙ‡ Ø¯Ø§ÙØ¦Ø© (Ø¨Ù„ÙˆØ· / Ø¬ÙˆØ²) */
  const WOODS = [
    '#C4A574', '#B8956A', '#A67C52', '#9A7B5C', '#8B6914', '#7D5A3C',
    '#6B4E3D', '#A0826D', '#BFA78F', '#D4C4A8', '#8F6F4F',
  ];
  const GROUT_C = '#3D2E22';
  const grain = (r: number, c: number, g: number) =>
    Math.sin(r * 19.1 + c * 13.3 + g * 7.2) * 3;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = GROUT_C;
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let row = 0; row < TILES_PER_SIDE; row++) {
    for (let col = 0; col < TILES_PER_SIDE; col++) {
      const x = col * cell;
      const y = row * cell;
      const ci = (row * 5 + col * 7 + (row * col) % 3) % WOODS.length;
      const inset = GROUT / 2;

      ctx.fillStyle = WOODS[ci]!;
      ctx.fillRect(x + inset, y + inset, cell - GROUT, cell - GROUT);

      // Ø­Ø¨ÙŠØ¨Ø§Øª Ø®Ø´Ø¨ Ø®ÙÙŠÙØ© Ø¯Ø§Ø®Ù„ Ø§Ù„Ù…Ø±Ø¨Ø¹
      ctx.strokeStyle = 'rgba(45, 32, 20, 0.22)';
      ctx.lineWidth = 1;
      for (let g = 1; g < 4; g++) {
        const gy = y + inset + ((cell - GROUT) * g) / 4;
        ctx.beginPath();
        ctx.moveTo(x + inset + 4, gy + grain(row, col, g));
        ctx.lineTo(x + cell - inset - 4, gy + grain(row, col, g + 5));
        ctx.stroke();
      }

      // Ù„Ù…Ø¹Ø§Ù† Ø®ÙÙŠÙ Ø¹Ù„Ù‰ Ø­Ø§ÙØ©
      ctx.strokeStyle = 'rgba(255, 248, 230, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + inset + 4, y + inset + 4);
      ctx.lineTo(x + cell - inset - 4, y + inset + 4);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  _parquetTex = tex;
  _parquetTexGen = PARQUET_TEX_GEN;
  return tex;
}

export interface RoomShellProps {
  width?:     number;
  depth?:     number;
  height?:    number;
  thickness?: number;
  floorY?:    number;
  zNear?:     number;
  zFar?:      number;
  noiseNormals?: boolean;
  /** When false, skip floor mesh (use ParquetFloor / GLB floor instead). */
  showFloor?: boolean;
  /** When false, skip back wall (backdrop / office GLB / hologram). */
  showBackWall?: boolean;
  /** When false, skip left & right walls. */
  showSideWalls?: boolean;
}

export function RoomShell({
  width         = 6,
  height        = 4,
  thickness     = 0.05,
  floorY        = -1.0,
  zNear         = 3.0,
  zFar          = -5.0,
  noiseNormals  = true,
  showFloor     = true,
  showBackWall  = true,
  showSideWalls = true,
}: RoomShellProps) {
  const zLen    = Math.abs(zNear - zFar);
  const zCenter = (zNear + zFar) / 2;
  const wallY   = floorY + height / 2;

  const noiseMap = useMemo(() => (noiseNormals ? getNoiseNormalMap() : null), [noiseNormals]);

  const floorMat = useMemo(() => {
    const tex = makeParquetTexture();
    // Repeat so each 1 mÂ² shows one canvas tile
    tex.repeat.set(width, zLen);
    tex.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map:       tex,
      roughness: 0.42,
      metalness: 0.04,
      envMapIntensity: 0.65,
    });
  }, [width, zLen]);

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
    if (!showFloor) return null;
    const g = new (require('three').PlaneGeometry)(width, zLen, 1, 1);
    return g;
  }, [width, zLen, showFloor]);

  return (
    <group name="RoomShell">
      {/* â”€â”€ Floor â”€â”€ */}
      {showFloor && floorMat && (
        <mesh
          name="RoomFloor"
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, floorY, zCenter]}
          material={floorMat}
          geometry={floorGeo}
        />
      )}

      {/* â”€â”€ Back wall (z = zFar) â”€â”€ */}
      {showBackWall && (
        <mesh
          name="BackWall"
          receiveShadow
          position={[0, wallY, zFar]}
          material={backMat}
        >
          <planeGeometry args={[width, height]} />
        </mesh>
      )}

      {/* â”€â”€ Left wall (x = -width/2), faces +x â”€â”€ */}
      {showSideWalls && (
        <mesh
          name="LeftWall"
          receiveShadow
          rotation={[0, Math.PI / 2, 0]}
          position={[-width / 2, wallY, zCenter]}
          material={sideMat}
        >
          <planeGeometry args={[zLen, height]} />
        </mesh>
      )}

      {/* â”€â”€ Right wall (x = +width/2), faces -x â”€â”€ */}
      {showSideWalls && (
        <mesh
          name="RightWall"
          receiveShadow
          rotation={[0, -Math.PI / 2, 0]}
          position={[width / 2, wallY, zCenter]}
          material={sideMat}
        >
          <planeGeometry args={[zLen, height]} />
        </mesh>
      )}
    </group>
  );
}

// â”€â”€ RoomBounds type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type RoomBounds = {
  floorY: number; ceilY: number;
  minX: number; maxX: number;
  minZ: number; maxZ: number;
};

/** Clear interior height (BoundedMiniRoom + ceiling colliders). Matches product spec (4 m ceiling). */
export const ROOM_INTERIOR_HEIGHT_M = 4;

/** Immutable snapshot â€” never changes at runtime (reset / default target). */
export const ROOM_BOUNDS_DEFAULT = {
  /**
   * World Y of the rigid floor — `getWorldFloorY()` plus optional `NEXT_PUBLIC_FLOOR_Y_OFFSET`
   * (`readFloorBaselineOffsetEnv`). Never derived from GLB Box3.
   */
  floorY: getWorldFloorY(),
  ceilY:  getWorldFloorY() + ROOM_INTERIOR_HEIGHT_M,
  minX:   -3.0,  maxX:  3.0,
  minZ:   -3.0,  maxZ:  3.0,
} as const;

/** Mutable live bounds — floor + ceil track env offset (`AvatarCanvas` may re-sync after load). */
export const ROOM_BOUNDS: RoomBounds = (() => {
  const fy = ROOM_BOUNDS_DEFAULT.floorY + readFloorBaselineOffsetEnv();
  return {
    floorY: fy,
    ceilY: fy + ROOM_INTERIOR_HEIGHT_M,
    minX: -3.0,
    maxX: 3.0,
    minZ: -3.0,
    maxZ: 3.0,
  };
})();

/** Default avatar XZ standing position. */
export function getDefaultStandXZ(bounds: RoomBounds = ROOM_BOUNDS): { x: number; z: number } {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: bounds.minZ + (bounds.maxZ - bounds.minZ) * 0.38,
  };
}

/** @deprecated غير مستخدم في المشهد الحالي — موضع الكاميرا الفعلي في `AvatarCanvas` (`CAMERA_POS_Z` ≈ −2.5). */
export function getCameraPosZ(bounds: RoomBounds = ROOM_BOUNDS): number {
  return bounds.maxZ;
}

/** Room centre Z. */
export function getRoomZCenter(bounds: RoomBounds = ROOM_BOUNDS): number {
  return (bounds.minZ + bounds.maxZ) / 2;
}

/** 4-corner patrol waypoints inside the playable area. */
export function buildPatrolWaypoints(bounds: RoomBounds = ROOM_BOUNDS): [number, number][] {
  const m = 0.8;
  return [
    [bounds.minX + m, bounds.minZ + m],
    [bounds.maxX - m, bounds.minZ + m],
    [bounds.maxX - m, bounds.maxZ - m],
    [bounds.minX + m, bounds.maxZ - m],
  ];
}

