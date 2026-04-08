"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Float } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

export default function EduverseHero3D() {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 32, 32), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#06b6d4",
        roughness: 0.85,
        metalness: 0.15,
      }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      shadows={false}
      camera={{ position: [0, 0, 5], fov: 45 }}
    >
      <ambientLight intensity={0.6} />
      <Float speed={2} rotationIntensity={1} floatIntensity={1}>
        <mesh
          ref={meshRef}
          position={[0, 0, 0]}
          scale={1.8}
          geometry={geometry}
          material={material}
        />
      </Float>
    </Canvas>
  );
}