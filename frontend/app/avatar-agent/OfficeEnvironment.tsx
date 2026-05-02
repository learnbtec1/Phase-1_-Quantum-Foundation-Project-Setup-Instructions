'use client';

import { useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AVATAR_OFFICE_SCENE_DEFAULTS } from '@/config/avatar';

type OfficeEnvironmentProps = {
  url: string;
  position?: [number, number, number];
  scale?: number;
};

/**
 * خلفية المكتب (office.glb) داخل نفس الـ Canvas مع الأفاتار.
 * يُحمّل عبر useLoader داخل سياق R3F فقط.
 */
export function OfficeEnvironment({
  url,
  position = [...AVATAR_OFFICE_SCENE_DEFAULTS.officePosition],
  scale = AVATAR_OFFICE_SCENE_DEFAULTS.officeScale,
}: OfficeEnvironmentProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    // حزمة npm لـ three لا ترفع draco_decoder.wasm؛ نستخدم فك glTF عبر JS فقط.
    dracoLoader.setDecoderConfig({ type: 'js' });
    loader.setDRACOLoader(dracoLoader);
  });

  useLayoutEffect(() => {
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            m.needsUpdate = true;
          });
        }
      }
    });
  }, [gltf]);

  // No Y compensation — the original avatarPosition.Y (-0.14) was calibrated
  // to match the visible floor of this GLB at scale=0.52.
  return <primitive object={gltf.scene} position={position} scale={scale} />;
}
