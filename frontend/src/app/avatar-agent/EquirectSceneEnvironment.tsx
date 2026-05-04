'use client';

/**
 * Full-sphere studio backdrop: equirectangular texture (2:1, e.g. 8192×4096) as scene.background
 * plus PMREM-derived env map for MeshStandard / VRM materials (turquoise sign affects clothing).
 * Do not use a flat HTML/CSS image for the WebGL frustum — orbit would show black without this.
 */
import { useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useLoader, useThree } from '@react-three/fiber';

export type EquirectSceneEnvironmentProps = {
  url?: string;
};

export function EquirectSceneEnvironment({
  url = '/models/images/new_env.png',
}: EquirectSceneEnvironmentProps): null {
  const texture = useLoader(THREE.TextureLoader, url);
  const { gl, scene } = useThree();

  useLayoutEffect(() => {
    const prevBg = scene.background;
    const prevEnv = scene.environment;

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    scene.background = texture;

    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromEquirectangular(texture);
    scene.environment = rt.texture;
    scene.environmentIntensity = 1.05;
    pmrem.dispose();

    return () => {
      scene.background = prevBg;
      scene.environment = prevEnv;
      scene.environmentIntensity = 1;
      rt.dispose();
    };
  }, [gl, scene, texture]);

  return null;
}
