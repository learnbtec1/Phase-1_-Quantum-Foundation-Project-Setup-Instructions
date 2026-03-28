'use client';
/**
 * CabinetLoader.tsx
 *
 * Loads 3d_tv_white_cabinet_with_decoration.glb and repaints every material
 * to navy blue (#112255), positioning the unit against the back-right wall.
 *
 * Native GLB size  ≈  2.16 m W × 3.0 m H × 2.13 m D.
 * We scale it to CAB_H = 1.8 m tall and place the bottom on the floor.
 */
import { useEffect } from 'react';
import {
  Box3, Color, DoubleSide, Group, Mesh,
  MeshStandardMaterial, Object3D, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { useThree } from '@react-three/fiber';
import { ROOM_BOUNDS } from './RoomShell';

// ── Constants ────────────────────────────────────────────────────────────────
const FLOOR_Y = ROOM_BOUNDS.floorY;

/** Target height in world-units (metres) */
const CAB_H = 1.8;

/** Wooden brown — applied to every material slot */
const NAVY = new Color('#A0522D');

/** Slightly lighter wood for accent pieces (books, decorations) */
const NAVY_ACCENT = new Color('#C68642');

/** Dark walnut for very dark original materials (CRNA = black in Serbian) */
const NAVY_DARK = new Color('#5C3317');

type CabinetLoaderProps = {
  url?:       string;
  /** World X centre — default: 2.3 (right side, near right wall) */
  posX?:      number;
  /** World Y of cabinet bottom — default: FLOOR_Y (on the floor) */
  posY?:      number;
  /** World Z centre — default: -4.2 (near back wall) */
  posZ?:      number;
  /** Y-axis rotation in radians — default: 0 (faces toward camera) */
  rotY?:      number;
  debug?:     boolean;
};

export function CabinetLoader({
  url    = '/assets/3d_tv_white_cabinet_with_decoration.glb',
  posX   = 2.3,
  posY   = FLOOR_Y,
  posZ   = -4.2,
  rotY   = 0,
  debug  = false,
}: CabinetLoaderProps) {
  const { scene } = useThree();

  useEffect(() => {
    let cancelled = false;
    const loader  = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const root  = gltf.scene as Group;
        root.name   = 'NavyCabinet';

        // ── Re-paint all materials to navy ─────────────────────────────
        root.traverse((o: Object3D) => {
          if (!(o as Mesh).isMesh) return;
          const mesh = o as Mesh;
          mesh.castShadow    = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;

          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const repainted = mats.map((m: any) => {
            const navyMat = new MeshStandardMaterial({
              side: DoubleSide,
              roughness:  0.45,
              metalness:  0.12,
              transparent: false,
              opacity:     1.0,
            });

            // Choose navy shade based on original material name
            const name = (m?.name ?? '').toUpperCase();
            if (name.includes('CRNA') || name.includes('BLACK')) {
              navyMat.color.copy(NAVY_DARK);
              navyMat.roughness = 0.30;
              navyMat.metalness = 0.25;
            } else if (name.includes('KNJIGA') || name.includes('CASOPIS') || name.includes('SLIKA')) {
              // Books / magazines / pictures → slightly lighter navy accent
              navyMat.color.copy(NAVY_ACCENT);
              navyMat.roughness = 0.55;
            } else if (name.includes('SIVA') || name.includes('GREY') || name.includes('GRAY')) {
              // Grey elements → metallic navy
              navyMat.color.copy(NAVY);
              navyMat.roughness = 0.25;
              navyMat.metalness = 0.50;
            } else {
              // Default: main body white → standard navy
              navyMat.color.copy(NAVY);
            }

            navyMat.needsUpdate = true;
            // Inherit normal / roughness maps from original for PBR detail
            if (m?.normalMap)    { navyMat.normalMap = m.normalMap; navyMat.normalScale.copy(m.normalScale); }
            if (m?.roughnessMap) navyMat.roughnessMap = m.roughnessMap;
            if (m?.aoMap)        navyMat.aoMap = m.aoMap;

            try { if (m?.dispose) m.dispose(); } catch (_) {}
            return navyMat;
          });

          mesh.material = Array.isArray(mesh.material) ? repainted : repainted[0];
        });

        // ── Scale to target height ─────────────────────────────────────
        const bbox1 = new Box3().setFromObject(root);
        const size1 = new Vector3();
        bbox1.getSize(size1);
        if (size1.y > 0) {
          const s = CAB_H / size1.y;
          root.scale.set(s, s, s);
        }

        // ── Place bottom on floor, at requested X/Z ───────────────────
        const bbox2   = new Box3().setFromObject(root);
        const center2 = new Vector3();
        bbox2.getCenter(center2);

        root.position.set(
          posX  - center2.x,
          posY  - bbox2.min.y,
          posZ  - center2.z,
        );

        root.rotation.y = rotY;

        scene.add(root);

        if (debug) {
          const b = new Box3().setFromObject(root);
          const s = new Vector3();
          b.getSize(s);
          console.info('[CabinetLoader] ✅ loaded navy cabinet', {
            size:     s.toArray().map((v: number) => +v.toFixed(2)),
            position: root.position.toArray().map((v: number) => +v.toFixed(3)),
          });
        }
      },
      undefined,
      (err) => {
        if (!cancelled)
          console.warn('[CabinetLoader] ⚠ load error:', (err as ErrorEvent).message ?? err);
      },
    );

    return () => {
      cancelled = true;
      const existing = scene.getObjectByName('NavyCabinet');
      if (existing) scene.remove(existing);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, url, posX, posZ, rotY, debug]);

  return null;
}
