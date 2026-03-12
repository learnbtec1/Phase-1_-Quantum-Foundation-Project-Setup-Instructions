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
import * as THREE from 'three';
import { ROOM_PALETTE, getRoomMaterial, getNoiseNormalMap } from './BackdropTheme';

// ── Black-gold parquet texture (canvas-generated, no external image) ─────────
let _parquetTex: THREE.CanvasTexture | null = null;

function makeParquetTexture(): THREE.CanvasTexture {
  if (_parquetTex) return _parquetTex;

  const SIZE    = 512;          // canvas px  (= 1 m² tile when repeat matches room size)
  const PLANK_L = 256;          // plank length px
  const PLANK_W = 64;           // plank width px
  const GAP     = 3;            // gold gap px

  // Deterministic grain offset — no Math.random() so texture is stable
  const grain = (r: number, c: number, g: number) =>
    Math.sin(r * 17.3 + c * 11.7 + g * 5.9) * 5;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx    = canvas.getContext('2d')!;

  // Gold base (fills separator gaps)
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Dark plank colour variants
  const planks = ['#0C0A06', '#100D08', '#0E0C07', '#130F09', '#0A0805'];

  const ROWS = Math.ceil(SIZE / PLANK_W) + 1;
  for (let row = 0; row < ROWS; row++) {
    const y      = row * PLANK_W;
    const offset = (row % 2) * (PLANK_L / 2);   // brick offset
    const COLS   = Math.ceil((SIZE + PLANK_L) / PLANK_L) + 1;

    for (let col = -1; col < COLS; col++) {
      const x  = col * PLANK_L - offset;
      const ci = ((row * 3 + col * 7) & 0xffff) % planks.length;

      // Plank body
      ctx.fillStyle = planks[ci];
      ctx.fillRect(x + GAP, y + GAP, PLANK_L - GAP * 2, PLANK_W - GAP * 2);

      // Wood grain lines (dark, subtle)
      ctx.strokeStyle = 'rgba(20,14,4,0.45)';
      ctx.lineWidth   = 1;
      for (let g = 1; g < 4; g++) {
        const gy = y + GAP + (PLANK_W - GAP * 2) * g / 4;
        ctx.beginPath();
        ctx.moveTo(x + GAP,            gy + grain(row, col, g));
        ctx.lineTo(x + PLANK_L - GAP,  gy + grain(row, col, g + 10));
        ctx.stroke();
      }

      // Subtle gold highlight on top edge of each plank
      ctx.strokeStyle = 'rgba(212,175,55,0.18)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + GAP,           y + GAP + 1);
      ctx.lineTo(x + PLANK_L - GAP, y + GAP + 1);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  _parquetTex = tex;
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
    const tex = makeParquetTexture();
    // Repeat so each 1 m² shows one canvas tile
    tex.repeat.set(width, zLen);
    tex.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map:       tex,
      roughness: 0.18,   // polished parquet
      metalness: 0.06,
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
