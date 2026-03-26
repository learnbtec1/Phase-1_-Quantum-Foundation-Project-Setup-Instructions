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

/** Static world bounds used by physics system */
export const ROOM_BOUNDS = {
  /**
   * أرض المشهد (متر). تُضبط لمحاذاة أرضية الباركيه/الشبكة مع أرضية غرفة صورة Eduverse.
   * (قيمة سالبة = خفض المشهد 3D ليتطابق مع منظور الصورة.)
   */
  /** محاذاة مع أرضية صورة Eduverse — خفّض القيمة إذا بقي المشهد “عالياً” عن الخلفية */
  floorY:     -2.95,
  ceilY:      5.0,
  minX:      -3.0,
  maxX:       3.0,
  minZ:      -5.0,
  maxZ:       3.0,
} as const;
