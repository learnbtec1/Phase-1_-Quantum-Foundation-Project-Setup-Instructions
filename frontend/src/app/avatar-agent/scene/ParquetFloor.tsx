'use client';
/**
 * ParquetFloor.tsx
 *
 * Renders a canvas-generated dark walnut hardwood floor plane directly over
 * the office.glb floor (RoomShell is disabled).
 * Matches the rich dark-walnut library style of the reference image.
 *
 * Placed at FLOOR_Y + 0.002 to avoid Z-fighting with the GLB floor.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { ROOM_BOUNDS } from './RoomShell';

const W  = 40;   // oversize to cover entire GLB room floor regardless of actual bounds
const D  = 40;
const CX = 0;
const CZ = -2;   // centred at desk Z so coverage is symmetric front-to-back
const Y  = ROOM_BOUNDS.floorY + 0.002;             // just above GLB floor

// ── Canvas texture: dark walnut hardwood planks ───────────────────────────
function makeParquetTex(): THREE.CanvasTexture {
  const SIZE    = 1024;
  const PLANK_L = 512;   // long plank
  const PLANK_W = 96;    // narrow board — more realistic hardwood proportions
  const GAP     = 3;     // subtle dark grout line between boards

  // Dark professional gray-brown parquet
  const PLANK_COLORS = [
    '#2E2B28', '#332F2B', '#38342F', '#2B2825', '#352F2C',
    '#3A3530', '#2D2A27', '#363029', '#302D2A', '#3C3731',
  ];

  const noise = (a: number, b: number, c: number) =>
    Math.sin(a * 17.3 + b * 11.7 + c * 5.9) * 4;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx    = canvas.getContext('2d')!;

  // Dark gray grout/gap base
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const ROWS = Math.ceil(SIZE / PLANK_W) + 2;
  for (let row = 0; row < ROWS; row++) {
    const y      = row * PLANK_W;
    const offset = (row % 2) * (PLANK_L / 2);
    const COLS   = Math.ceil((SIZE + PLANK_L) / PLANK_L) + 2;

    for (let col = -1; col < COLS; col++) {
      const x     = col * PLANK_L - offset;
      const cIdx  = ((row * 3 + col * 7) & 0xff) % PLANK_COLORS.length;

      // Plank body
      ctx.fillStyle = PLANK_COLORS[cIdx];
      ctx.fillRect(x + GAP, y + GAP, PLANK_L - GAP * 2, PLANK_W - GAP * 2);

      // Natural wood grain lines
      ctx.strokeStyle = 'rgba(10,5,2,0.45)';
      ctx.lineWidth   = 1;
      for (let g = 1; g < 8; g++) {
        const gy = y + GAP + (PLANK_W - GAP * 2) * g / 8;
        ctx.beginPath();
        ctx.moveTo(x + GAP,           gy + noise(row, col, g));
        ctx.lineTo(x + PLANK_L - GAP, gy + noise(row, col, g + 10));
        ctx.stroke();
      }

      // Warm specular highlight (lacquer sheen)
      const grad = ctx.createLinearGradient(x + GAP, y + GAP, x + GAP, y + PLANK_W - GAP);
      grad.addColorStop(0,   'rgba(180,120,60,0.10)');
      grad.addColorStop(0.3, 'rgba(180,120,60,0.04)');
      grad.addColorStop(1,   'rgba(0,0,0,0.08)');
      ctx.fillStyle = grad;
      ctx.fillRect(x + GAP, y + GAP, PLANK_L - GAP * 2, PLANK_W - GAP * 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.anisotropy = 16;
  return tex;
}

export function ParquetFloor() {
  const material = useMemo(() => {
    const tex = makeParquetTex();
    return new THREE.MeshStandardMaterial({
      map:       tex,
      roughness: 0.92,   // very matte — no env reflection bleed = sharp, clean floor
      metalness: 0.0,
    });
  }, []);

  return (
    <mesh
      name="ParquetFloor"
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      position={[CX, Y, CZ]}
      material={material}
    >
      <planeGeometry args={[W, D]} />
    </mesh>
  );
}
