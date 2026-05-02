/**
 * BackdropTheme.ts — Dark navy palette + PBR material factory.
 * No external assets required; optional procedural roughness variation.
 */
import * as THREE from 'three';

// ── Palette — بني دافئ يقترب من خشب/جدران مكتب (مثل صورة Eduverse) ────────────
export const ROOM_PALETTE = {
  backWall:  '#6B5344',
  leftWall:  '#5C4336',
  rightWall: '#5C4336',
  floor:     '#121A26',
  trims:     '#3D2E26',
  ceiling:   '#4A3A32',
} as const;

export type RoomPalette = typeof ROOM_PALETTE;
export type PaletteKey  = keyof RoomPalette;

// ── Material cache (avoid per-render allocation) ──────────────────────────────
const _cache = new Map<string, THREE.MeshStandardMaterial>();

export function getRoomMaterial(
  hex: string,
  roughness = 0.88,
  metalness = 0.04,
): THREE.MeshStandardMaterial {
  const key = `${hex}|${roughness}|${metalness}`;
  if (!_cache.has(key)) {
    _cache.set(
      key,
      new THREE.MeshStandardMaterial({
        color:     new THREE.Color().setStyle(hex),
        roughness,
        metalness,
        side: THREE.FrontSide,
      }),
    );
  }
  return _cache.get(key)!;
}

/**
 * Procedural noise normal map (64×64) — subtle surface variation, no downloads.
 * Returns a cached DataTexture. Call dispose() yourself when scene tears down.
 */
let _noiseNormal: THREE.DataTexture | null = null;
export function getNoiseNormalMap(): THREE.DataTexture {
  if (_noiseNormal) return _noiseNormal;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    // Approximate noise: XOR hash to get pseudo-random tiny bumps
    const x = i % size;
    const y = Math.floor(i / size);
    const n = ((x * 1619 + y * 31337) ^ (x * y * 6271)) & 0xff;
    const bump = ((n / 255) * 2 - 1) * 12; // small bump ±12/255
    data[i * 4 + 0] = 128 + bump; // r → tangent X
    data[i * 4 + 1] = 128 + bump; // g → tangent Y
    data[i * 4 + 2] = 255;        // b → normal Z (always points up)
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.needsUpdate = true;
  _noiseNormal = tex;
  return tex;
}

/** Apply a named room role's material to an array of meshes. */
export function applyTheme(
  meshes: THREE.Mesh[],
  role: 'backWall' | 'sideWall' | 'floor' | 'trims',
): void {
  const hex   = role === 'floor'   ? ROOM_PALETTE.floor
              : role === 'trims'   ? ROOM_PALETTE.trims
              : role === 'backWall'? ROOM_PALETTE.backWall
              : ROOM_PALETTE.leftWall;
  const rough = role === 'floor' ? 0.92 : 0.86;
  const mat   = getRoomMaterial(hex, rough);
  meshes.forEach(m => { m.material = mat; });
}

export function disposeCachedMaterials(): void {
  _cache.forEach(m => m.dispose());
  _cache.clear();
  _noiseNormal?.dispose();
  _noiseNormal = null;
}
