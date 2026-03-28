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
 *   showFloor / showBackWall / showSideWalls — toggle parts (e.g. side walls only when GLB supplies floor/back).
 *
 * لضبط حجم الغرفة مع الفيزياء: مرّر الأبعاد من `ROOM_BOUNDS` كما في AvatarCanvas
 * (width = maxX−minX، zNear/maxZ، zFar/minZ، height = ceilY−floorY).
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { readRugWalkSurfaceYExtraEnv } from '@/config/avatar';
import { ROOM_PALETTE, getRoomMaterial, getNoiseNormalMap } from './BackdropTheme';

// ── Warm wood parquet (square tiles, canvas-generated — no external image) ─
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
  /** عدد المربعات في كل اتجاه داخل نسيج واحد (1×1 متر تقريباً عند repeat) */
  const TILES_PER_SIDE = 8;
  const cell = SIZE / TILES_PER_SIDE;
  const GROUT = 2; // فواصل بنية بين المربعات
  /** ألوان خشب باركيه دافئة (بلوط / جوز) */
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

      // حبيبات خشب خفيفة داخل المربع
      ctx.strokeStyle = 'rgba(45, 32, 20, 0.22)';
      ctx.lineWidth = 1;
      for (let g = 1; g < 4; g++) {
        const gy = y + inset + ((cell - GROUT) * g) / 4;
        ctx.beginPath();
        ctx.moveTo(x + inset + 4, gy + grain(row, col, g));
        ctx.lineTo(x + cell - inset - 4, gy + grain(row, col, g + 5));
        ctx.stroke();
      }

      // لمعان خفيف على حافة
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
    // Repeat so each 1 m² shows one canvas tile
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
      {/* ── Floor ── */}
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

      {/* ── Back wall (z = zFar) ── */}
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

      {/* ── Left wall (x = -width/2), faces +x ── */}
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

      {/* ── Right wall (x = +width/2), faces -x ── */}
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

/** Default snapshot (reset / docs). Mutable `ROOM_BOUNDS` starts as a copy. */
export const ROOM_BOUNDS_DEFAULT = {
  floorY: -2.95,
  ceilY:  5.0,
  minX:  -3.0,
  maxX:   3.0,
  minZ:  -5.0,
  maxZ:   3.0,
};

export type RoomBounds = typeof ROOM_BOUNDS_DEFAULT;

/**
 * World bounds — mutable so V55 can align floor + playable XZ to the carpet mesh AABB.
 * Physics, clamping, and foot–floor calibration read this object.
 */
export const ROOM_BOUNDS: RoomBounds = { ...ROOM_BOUNDS_DEFAULT };

/**
 * Apply carpet / floor mesh world-space AABB: walking surface at max.y, playable XZ from min/max.
 *
 * **Walk surface (COGNI / `__COGNI_SUB_FLOOR_FIX_REPORT__.md`):**
 * `ROOM_BOUNDS.floorY = carpetWorldBox.max.y + readRugWalkSurfaceYExtraEnv()` (default extra **0.10** m).
 *
 * Prefer {@link applyCarpetFloorYFromWorldBox} for gameplay XZ-default path; `AvatarCanvas` uses GroundLock
 * `tryApplyFloorY` with the same `max.y + extra` formula via `RUG_WALK_SURFACE_Y_EXTRA`.
 */
export function applyRoomBoundsFromCarpetWorldBox(
  worldBox: THREE.Box3,
  opts?: { ceilY?: number; xzMargin?: number },
): void {
  if (worldBox.isEmpty()) return;
  const m = opts?.xzMargin ?? 0.08;
  let minX = worldBox.min.x + m;
  let maxX = worldBox.max.x - m;
  let minZ = worldBox.min.z + m;
  let maxZ = worldBox.max.z - m;
  if (maxX - minX < 0.2) {
    const c = (worldBox.min.x + worldBox.max.x) / 2;
    minX = c - 0.1;
    maxX = c + 0.1;
  }
  if (maxZ - minZ < 0.2) {
    const c = (worldBox.min.z + worldBox.max.z) / 2;
    minZ = c - 0.1;
    maxZ = c + 0.1;
  }
  ROOM_BOUNDS.floorY = worldBox.max.y + readRugWalkSurfaceYExtraEnv();
  ROOM_BOUNDS.minX = minX;
  ROOM_BOUNDS.maxX = maxX;
  ROOM_BOUNDS.minZ = minZ;
  ROOM_BOUNDS.maxZ = maxZ;
  if (opts?.ceilY !== undefined) {
    ROOM_BOUNDS.ceilY = opts.ceilY;
  }
}

/** V56 — ignore sub-centimeter AABB noise so `floorY` cannot drift frame-to-frame. */
export const CARPET_FLOOR_Y_TRIVIAL_DELTA = 0.05;

/**
 * Align rug walk height to the carpet mesh without changing playable XZ — keeps the full default room
 * footprint for clamps, physics, and backdrop sizing (avoids carpet↔state remeasure loops).
 *
 * @returns `true` if `ROOM_BOUNDS` was updated; `false` if the proposed floor matches the current
 *   value within {@link CARPET_FLOOR_Y_TRIVIAL_DELTA} (prevents micro-creep).
 */
export function applyCarpetFloorYFromWorldBox(worldBox: THREE.Box3): boolean {
  if (worldBox.isEmpty()) return false;
  const proposed = worldBox.max.y + readRugWalkSurfaceYExtraEnv();
  if (Math.abs(proposed - ROOM_BOUNDS.floorY) < CARPET_FLOOR_Y_TRIVIAL_DELTA) {
    return false;
  }
  ROOM_BOUNDS.floorY = proposed;
  ROOM_BOUNDS.minX = ROOM_BOUNDS_DEFAULT.minX;
  ROOM_BOUNDS.maxX = ROOM_BOUNDS_DEFAULT.maxX;
  ROOM_BOUNDS.minZ = ROOM_BOUNDS_DEFAULT.minZ;
  ROOM_BOUNDS.maxZ = ROOM_BOUNDS_DEFAULT.maxZ;
  return true;
}

export function getRoomZCenter(b?: RoomBounds): number {
  const r = b ?? ROOM_BOUNDS;
  return (r.maxZ + r.minZ) / 2;
}

/** V54/V55 — stand near room center, slightly toward −Z (desk / glass), clamped to carpet. */
export function getDefaultStandXZ(b?: RoomBounds, margin = 0.35): { x: number; z: number } {
  const r = b ?? ROOM_BOUNDS;
  const zc = (r.minZ + r.maxZ) / 2;
  const xc = (r.minX + r.maxX) / 2;
  const z = THREE.MathUtils.clamp(zc - 1.0, r.minZ + margin, r.maxZ - margin);
  const x = THREE.MathUtils.clamp(xc, r.minX + margin, r.maxX - margin);
  return { x, z };
}

export function getCameraPosZ(b?: RoomBounds, offset = 3.2): number {
  return (b ?? ROOM_BOUNDS).maxZ + offset;
}

/** Patrol loop: small rectangle around default stand, clamped to playable bounds. */
export function buildPatrolWaypoints(b?: RoomBounds): [number, number][] {
  const r = b ?? ROOM_BOUNDS;
  const { x, z } = getDefaultStandXZ(r);
  const margin = 0.35;
  const maxDx = Math.max(0.15, Math.min(1.2, (r.maxX - r.minX) / 2 - margin));
  const maxDz = Math.max(0.12, Math.min(0.45, (r.maxZ - r.minZ) / 2 - margin));
  return [
    [x - maxDx, z - maxDz],
    [x + maxDx, z - maxDz],
    [x + maxDx, z + maxDz],
    [x - maxDx, z + maxDz],
  ];
}
