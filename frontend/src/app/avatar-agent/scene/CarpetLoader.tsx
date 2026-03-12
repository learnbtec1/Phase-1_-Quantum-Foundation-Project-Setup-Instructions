'use client';
/**
 * CarpetLoader.tsx
 *
 * Loads iranian_wool_carpet.glb and places it flat under the avatar + desk.
 *
 * KEY FINDING: The GLB node "Sketchfab_model" contains a baked -90° X rotation
 * matrix = [1,0,0,0, 0,~0,-1,0, 0,1,~0,0, 0,0,0,1].
 * This already converts the XY-plane geometry to lie flat in XZ.
 * → Apply NO additional rotation. Scale + position only.
 */
import { useEffect } from 'react';
import { Box3, DoubleSide, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useThree } from '@react-three/fiber';
import { ROOM_BOUNDS } from './RoomShell';

const FLOOR_Y  = ROOM_BOUNDS.floorY;
// ParquetFloor sits at FLOOR_Y + 0.002 (2 mm above GLB floor).
// Place carpet 2 mm above the parquet so it renders on top.
const CARPET_Y = FLOOR_Y + 0.004;
const DESK_Z   = -2.0;
const CARPET_W = 8.1;   // target width  in X (metres)  — 5.4 × 1.5
const CARPET_D = 9.9;   // target depth  in Z (metres)  — 6.6 × 1.5

type CarpetLoaderProps = {
  url?:   string;
  debug?: boolean;
};

export function CarpetLoader({
  url   = '/assets/iranian_wool_carpet.glb',
  debug = false,
}: CarpetLoaderProps) {
  const { scene } = useThree();

  useEffect(() => {
    let cancelled = false;
    const loader  = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const root = gltf.scene as Group;
        root.name  = 'IranianWoolCarpet';

        // ── Fix materials ─────────────────────────────────────────────────────
        root.traverse((o: Object3D) => {
          if (!(o as Mesh).isMesh) return;
          const mesh = o as Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            if (m instanceof MeshStandardMaterial) {
              m.side        = DoubleSide;
              m.transparent = false;
              m.opacity     = 1.0;
              m.roughness   = Math.max(m.roughness ?? 0.8, 0.72);
              m.needsUpdate = true;
            }
          });
          mesh.receiveShadow = true;
          mesh.castShadow    = false;
          mesh.frustumCulled = false;
        });

        // ── Scale to fit target width × depth (preserve aspect ratio) ────────
        // Force world matrix computation BEFORE Box3 — baked node matrix
        // (Sketchfab_model −90°X) must be reflected in the bbox measurement.
        root.updateMatrixWorld(true);
        const bbox1 = new Box3().setFromObject(root);
        const size  = new Vector3();
        bbox1.getSize(size);
        // Carpet is flat in XZ plane (baked node matrix already applied):
        //   size.x = carpet width, size.z = carpet depth
        const sw = size.x > 0 ? CARPET_W / size.x : 1;
        const sd = size.z > 0 ? CARPET_D / size.z : 1;
        const s  = Math.min(sw, sd);
        root.scale.set(s, s, s);

        // ── Position: flat on floor, centred under avatar + desk ─────────────
        root.updateMatrixWorld(true);
        const bbox2  = new Box3().setFromObject(root);
        const center = new Vector3();
        bbox2.getCenter(center);

        root.position.set(
          -center.x,               // centred on X axis
          CARPET_Y - bbox2.min.y,  // 4 mm above GLB floor, on top of parquet
          DESK_Z  - center.z,      // centred on desk depth
        );

        scene.add(root);

        if (debug) {
          const b  = new Box3().setFromObject(root);
          const sz = new Vector3();
          b.getSize(sz);
          console.info('[CarpetLoader] ✅ loaded', {
            nativeSize: size.toArray().map((v: number) => +v.toFixed(2)),
            finalSize:  sz.toArray().map((v: number) => +v.toFixed(2)),
            position:   root.position.toArray().map((v: number) => +v.toFixed(3)),
            scale:      s.toFixed(4),
          });
        }
      },
      undefined,
      (err) => {
        if (!cancelled) {
          console.warn('[CarpetLoader] ⚠ load error:', (err as ErrorEvent).message ?? err);
        }
      },
    );

    return () => {
      cancelled = true;
      const existing = scene.getObjectByName('IranianWoolCarpet');
      if (existing) scene.remove(existing);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, url, debug]);

  return null;
}
