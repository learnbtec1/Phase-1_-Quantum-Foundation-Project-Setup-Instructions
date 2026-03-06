// File: frontend/src/avatar/useProceduralBones.ts
import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { VRM } from '@pixiv/three-vrm';

export const useProceduralBones = (vrm: VRM | null) => {
  const bonesRef = useRef<{ head: THREE.Bone; spine: THREE.Bone; jaw: THREE.Bone }>({
    head: null!,
    spine: null!,
    jaw: null!,
  });

  useEffect(() => {
    if (!vrm) return;

    bonesRef.current.head = vrm.humanoid.getBoneNode('head') as THREE.Bone;
    bonesRef.current.spine = vrm.humanoid.getBoneNode('spine') as THREE.Bone;
    bonesRef.current.jaw = vrm.humanoid.getBoneNode('jaw') as THREE.Bone;
  }, [vrm]);

  return bonesRef;
};