'use client';

/**
 * Fixed-directional office matte (`office_final.png`) as a full-view billboard plane — not an equirect sphere.
 * World-units plane size follows camera FOV + viewport aspect vs texture aspect using CSS-like **cover**
 * (no stretch; edges cropped by oversized quad vs frustum cross-section).
 *
 * Physics / ROOM_BOUNDS untouched — purely visual backdrop behind scene depth.
 */

import * as THREE from 'three';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';

/** Browser-safe URL under `frontend/public/` */
export const OFFICE_FINAL_BACKDROP_PUBLIC_URL =
  '/models/environments/office_final.png' as const;

/** Known dimensions of shipped asset — fallback until texture.image loads */
export const OFFICE_FINAL_BACKDROP_PIXEL_SIZE = { w: 2122, h: 1848 } as const;

export type OfficeBackdropCoverProps = {
  enabled?: boolean;
  /** Metres along camera forward ray — far enough to sit behind avatar + GLB room */
  distance?: number;
  textureUrl?: string;
};

const _dir = new THREE.Vector3();

export function OfficeBackdropCover({
  enabled = true,
  distance = 52,
  textureUrl = OFFICE_FINAL_BACKDROP_PUBLIC_URL,
}: OfficeBackdropCoverProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, size } = useThree();

  const tex = useLoader(THREE.TextureLoader, textureUrl);

  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;
  }, [tex]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !enabled) return;

    const cam = camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(_dir);

    mesh.position.copy(cam.position).addScaledVector(_dir, distance);
    mesh.quaternion.copy(cam.quaternion);

    const iw = tex.image?.width ?? OFFICE_FINAL_BACKDROP_PIXEL_SIZE.w;
    const ih = tex.image?.height ?? OFFICE_FINAL_BACKDROP_PIXEL_SIZE.h;
    const ai = iw > 0 && ih > 0 ? iw / ih : 16 / 9;

    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const viewH = 2 * Math.tan(vFov / 2) * distance;
    const viewW = viewH * (size.width / Math.max(1, size.height));

    const planeW = Math.max(viewW, viewH * ai);
    const planeH = planeW / ai;

    mesh.scale.set(planeW, planeH, 1);
  });

  if (!enabled) return null;

  return (
    <mesh ref={meshRef} renderOrder={-4000} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} toneMapped={false} depthWrite={false} depthTest />
    </mesh>
  );
}
