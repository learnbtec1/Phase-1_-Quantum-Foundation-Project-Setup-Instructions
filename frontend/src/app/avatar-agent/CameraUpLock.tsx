'use client';

import { useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Keeps camera.up = +Y so OrbitControls + lookAt cannot leave the view upside-down.
 */
export function CameraUpLock() {
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.up.set(0, 1, 0);
  }, [camera]);
  useFrame(() => {
    if (camera.up.y < 0.5) {
      camera.up.set(0, 1, 0);
    }
  });
  return null;
}
