'use client';

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

/**
 * Sets `scene.background` to a static equirectangular-friendly image (PNG/JPEG).
 * No mesh — avoids z-fighting with the VRM. Uses sRGB for VRM 1.0–aligned colour.
 */
export function SceneBackgroundTexture({ url }: { url: string }) {
  const { scene } = useThree();

  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        if (!alive) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        const prev = scene.background;
        scene.background = texture;
        if (prev instanceof THREE.Texture && prev !== texture) {
          prev.dispose();
        }
      },
      undefined,
      () => {
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn('[SceneBackgroundTexture] failed to load', url);
        }
      },
    );
    return () => {
      alive = false;
      const bg = scene.background;
      if (bg instanceof THREE.Texture) {
        bg.dispose();
      }
      scene.background = null;
    };
  }, [scene, url]);

  return null;
}
