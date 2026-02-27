"use client";
import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial, Text } from "@react-three/drei";
import * as THREE from "three";

export default function ProgressTower({ score }: { score: number }) {
  const liquidRef = useRef<THREE.Mesh>(null);
  const targetHeight = (score / 100) * 3;

  useFrame((state, delta) => {
    if (liquidRef.current) {
      liquidRef.current.scale.y = THREE.MathUtils.lerp(liquidRef.current.scale.y, Math.max(0.1, targetHeight), delta * 2);
      liquidRef.current.rotation.y += delta * 0.5;
    }
  });

  const glowColor = score > 50 ? "#10b981" : "#ef4444";

  return (
    <group position={[0, -1.5, 0]}>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[1, 1, 3.2, 32]} />
        <MeshTransmissionMaterial backside samples={4} thickness={0.5} color={"#ccecee"} />
      </mesh>
      <mesh ref={liquidRef} position={[0, 0.5, 0]} scale={[0.8, 0.1, 0.8]}>
        <cylinderGeometry args={[0.85, 0.85, 1, 32]} />
        <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={2} transparent opacity={0.8} />
      </mesh>
      <Text position={[0, 3.8, 0]} fontSize={0.6} color="white">{score}%</Text>
    </group>
  );
}