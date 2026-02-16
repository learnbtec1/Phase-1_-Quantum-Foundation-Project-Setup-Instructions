"use client";

import React, { Suspense, useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr } from "@react-three/drei";
import * as THREE from "three";

export default function NexusHero3D() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        shadows={false}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color("#020617"), 1);
        }}
      >
        <Suspense fallback={null}>
          <Scene />
          <AdaptiveDpr pixelated />
        </Suspense>
      </Canvas>
    </div>
  );
}

function Scene() {
  const geom = useMemo(() => new THREE.IcosahedronGeometry(1.1, 2), []);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x06b6d4, metalness: 0.15, roughness: 0.9 }),
    []
  );
  const light = useMemo(() => new THREE.AmbientLight(0xffffff, 0.7), []);

  useEffect(() => {
    return () => {
      geom.dispose();
      mat.dispose();
    };
  }, [geom, mat]);

  return (
    <>
      <primitive object={light} />
      <mesh geometry={geom} material={mat} position={[0, 0, -2]} />
    </>
  );
}