'use client';
/**
 * GlobeLoader — loads a GLB decoration and places it on the desk surface.
 * Scales the model to a target height and positions it at the given world coords.
 */
import { useEffect } from 'react';
import { Box3, Group, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { useThree } from '@react-three/fiber';
import { ROOM_BOUNDS } from './RoomShell';

/** Desk surface Y in world space — office GLB is scaled 1.5× so desk local 0.76 m → 1.14 m */
const DESK_Y = ROOM_BOUNDS.floorY + 1.14;

/** Target height of the decoration in metres */
const TARGET_H = 0.28;

type GlobeLoaderProps = {
  url: string;
  /** World X position — default: 0.45 (right of desk centre) */
  posX?: number;
  /** World Y of globe bottom — default: placed on desk surface */
  posY?: number;
  /** World Z position — default: -2.1 (desk depth) */
  posZ?: number;
  debug?: boolean;
};

export function GlobeLoader({
  url,
  posX = 0.45,
  posY,
  posZ = -2.1,
  debug = false,
}: GlobeLoaderProps) {
  const { scene } = useThree();

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const root = gltf.scene as Group;
        root.name  = 'GlobeDecoration';

        root.traverse((o: Object3D) => {
          const m = o as any;
          if (!m.isMesh) return;
          m.castShadow    = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
        });

        // Scale to TARGET_H
        root.updateMatrixWorld(true);
        const bbox1 = new Box3().setFromObject(root);
        const size1 = new Vector3();
        bbox1.getSize(size1);
        if (size1.y > 0) {
          const s = TARGET_H / size1.y;
          root.scale.set(s, s, s);
        }

        // Place bottom on desk surface
        root.updateMatrixWorld(true);
        const bbox2   = new Box3().setFromObject(root);
        const center2 = new Vector3();
        bbox2.getCenter(center2);

        const bottomY = posY !== undefined ? posY : DESK_Y;
        root.position.set(
          posX - center2.x,
          bottomY - bbox2.min.y,
          posZ  - center2.z,
        );

        scene.add(root);
        if (debug) console.info('[GlobeLoader] placed at', root.position);
      },
      undefined,
      (err) => { if (debug) console.error('[GlobeLoader] load error', err); },
    );

    return () => {
      cancelled = true;
      const existing = scene.getObjectByName('GlobeDecoration');
      if (existing) scene.remove(existing);
    };
  }, [scene, url, posX, posY, posZ, debug]);

  return null;
}
