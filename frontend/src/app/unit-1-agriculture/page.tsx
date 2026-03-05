'use client';

import React, { useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky, ContactShadows, Float } from '@react-three/drei';
import Link from 'next/link';
import * as THREE from 'three';

// ─── Tree component ──────────────────────────────────────────────────────────

function Tree({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {/* Trunk */}
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.2, 1.4, 8]} />
        <meshStandardMaterial color="#7B4F2E" roughness={0.9} />
      </mesh>
      {/* Lower foliage */}
      <mesh position={[0, 1.9, 0]} castShadow>
        <coneGeometry args={[1.0, 2.4, 9]} />
        <meshStandardMaterial color="#2A7D38" roughness={0.8} />
      </mesh>
      {/* Mid foliage */}
      <mesh position={[0, 2.9, 0]} castShadow>
        <coneGeometry args={[0.72, 1.9, 9]} />
        <meshStandardMaterial color="#34943F" roughness={0.75} />
      </mesh>
      {/* Top foliage */}
      <mesh position={[0, 3.65, 0]} castShadow>
        <coneGeometry args={[0.45, 1.4, 9]} />
        <meshStandardMaterial color="#3DAA47" roughness={0.7} />
      </mesh>
    </group>
  );
}

// ─── Animated wheat stalk ────────────────────────────────────────────────────

function WheatStalk({ x, z, seedOffset = 0 }: { x: number; z: number; seedOffset?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.2 + x * 3 + seedOffset) * 0.06;
    }
  });
  return (
    <group position={[x, 0, z]}>
      {/* Stalk */}
      <mesh ref={ref} position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.025, 0.03, 0.44, 5]} />
        <meshStandardMaterial color="#8BC34A" roughness={0.8} />
      </mesh>
      {/* Grain head */}
      <mesh position={[0, 0.52, 0]}>
        <sphereGeometry args={[0.06, 6, 6]} />
        <meshStandardMaterial color="#D4A017" roughness={0.7} />
      </mesh>
    </group>
  );
}

// ─── Crop bed row ────────────────────────────────────────────────────────────

function CropBed({ z }: { z: number }) {
  const cols = 14;
  return (
    <group>
      {/* Soil */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, z]} receiveShadow>
        <planeGeometry args={[10, 0.9]} />
        <meshStandardMaterial color="#6B4226" roughness={0.95} />
      </mesh>
      {/* Wheat */}
      {Array.from({ length: cols }).map((_, i) => {
        const x = -4.5 + i * (9 / (cols - 1));
        return <WheatStalk key={i} x={x} z={z} seedOffset={i * 0.7} />;
      })}
    </group>
  );
}

// ─── Simple barn ────────────────────────────────────────────────────────────

function Barn({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Walls */}
      <mesh position={[0, 1.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 2.4, 5]} />
        <meshStandardMaterial color="#C0392B" roughness={0.85} />
      </mesh>
      {/* Roof ridge */}
      <mesh position={[0, 2.8, 0]} rotation={[0, 0, 0]} castShadow>
        <coneGeometry args={[2.8, 1.4, 4]} />
        <meshStandardMaterial color="#8B2A1E" roughness={0.9} />
      </mesh>
      {/* Door */}
      <mesh position={[0, 0.7, 2.56]}>
        <boxGeometry args={[1.0, 1.4, 0.05]} />
        <meshStandardMaterial color="#5D3A1A" roughness={0.8} />
      </mesh>
    </group>
  );
}

// ─── Wooden fence post ──────────────────────────────────────────────────────

function FenceSection({ x, z, rotY = 0 }: { x: number; z: number; rotY?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.12, 1.0, 0.12]} />
        <meshStandardMaterial color="#A0784E" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.72, 0.35]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.08, 0.08, 0.7]} />
        <meshStandardMaterial color="#A0784E" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.42, 0.35]}>
        <boxGeometry args={[0.08, 0.08, 0.7]} />
        <meshStandardMaterial color="#A0784E" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ─── Water trough ───────────────────────────────────────────────────────────

function WaterTrough({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[1.6, 0.45, 0.55]} />
        <meshStandardMaterial color="#795548" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[1.3, 0.1, 0.3]} />
        <meshPhysicalMaterial color="#4dd0e1" transparent opacity={0.7} roughness={0.05} metalness={0.1} />
      </mesh>
    </group>
  );
}

// ─── Floating info card ──────────────────────────────────────────────────────

function InfoFloat({ position, label }: { position: [number, number, number]; label: string }) {
  return (
    <Float floatIntensity={0.4} speed={2} rotationIntensity={0.1}>
      <group position={position}>
        <mesh>
          <boxGeometry args={[1.6, 0.5, 0.04]} />
          <meshStandardMaterial color="#0f3460" emissive="#0f3460" emissiveIntensity={0.5} transparent opacity={0.85} />
        </mesh>
      </group>
    </Float>
  );
}

// ─── Main farm scene ─────────────────────────────────────────────────────────

function FarmScene3D() {
  return (
    <>
      <Sky sunPosition={[80, 40, 80]} turbidity={0.4} rayleigh={0.6} mieCoefficient={0.005} mieDirectionalG={0.8} />
      <ambientLight intensity={0.75} color="#fff9e6" />
      <directionalLight
        position={[12, 20, 8]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={60}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <pointLight position={[-8, 5, 8]} intensity={0.4} color="#ffe082" />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#4CAF50" roughness={0.95} />
      </mesh>

      {/* Farm path */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 2]} receiveShadow>
        <planeGeometry args={[1.4, 18]} />
        <meshStandardMaterial color="#8D6E63" roughness={0.98} />
      </mesh>

      {/* Crop beds */}
      <CropBed z={-4.5} />
      <CropBed z={-2.8} />
      <CropBed z={-1.1} />
      <CropBed z={0.6} />

      {/* Trees — perimeter */}
      <Tree position={[-10, 0, -10]} scale={1.1} />
      <Tree position={[-7, 0, -12]} />
      <Tree position={[10, 0, -10]} scale={1.2} />
      <Tree position={[7, 0, -12]} scale={0.9} />
      <Tree position={[-11, 0, 3]} />
      <Tree position={[11, 0, 3]} scale={1.05} />
      <Tree position={[-9, 0, 9]} scale={0.95} />
      <Tree position={[9, 0, 9]} />
      <Tree position={[0, 0, 13]} scale={1.15} />

      {/* Barn */}
      <Barn position={[-10, 0, 2]} />

      {/* Water trough */}
      <WaterTrough position={[-8, 0.22, -1.5]} />

      {/* Fence along path */}
      {[-8, -6, -4, -2, 0, 2, 4, 6, 8].map((x) => (
        <FenceSection key={`f-left-${x}`} x={-5.5} z={x} rotY={0} />
      ))}
      {[-8, -6, -4, -2, 0, 2, 4, 6, 8].map((x) => (
        <FenceSection key={`f-right-${x}`} x={5.5} z={x} rotY={0} />
      ))}

      <ContactShadows position={[0, 0.002, 0]} opacity={0.35} scale={30} blur={2.5} far={5} />

      <OrbitControls
        autoRotate
        autoRotateSpeed={0.4}
        maxPolarAngle={Math.PI / 2.05}
        minPolarAngle={0.25}
        minDistance={7}
        maxDistance={28}
        enableDamping
        dampingFactor={0.06}
      />
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Unit1AgriculturePage() {
  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#87ceeb]" dir="rtl">
      {/* 3D Canvas */}
      <Canvas
        shadows
        camera={{ position: [0, 10, 18], fov: 52 }}
        gl={{ antialias: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Suspense fallback={null}>
          <FarmScene3D />
        </Suspense>
      </Canvas>

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/50 to-transparent pointer-events-none">
        <div className="w-28" />
        <div className="text-center pointer-events-none">
          <h1 className="text-2xl md:text-4xl font-black text-white drop-shadow-2xl tracking-tight">
            🌾 الوحدة 1 — الزراعة
          </h1>
          <p className="text-white/70 text-sm mt-1 font-medium">
            BTEC Unit 1 · Agriculture · Virtual Reality Environment
          </p>
        </div>
        <Link
          href="/"
          className="pointer-events-auto px-4 py-2 rounded-xl bg-white/15 backdrop-blur-md text-white border border-white/25 hover:bg-white/25 transition-all text-sm font-bold shadow-lg"
        >
          ← الرئيسية
        </Link>
      </div>

      {/* Stats bar */}
      <div className="absolute top-24 right-6 z-20 flex flex-col gap-2 pointer-events-none">
        {[
          { label: 'أصناف المحاصيل', value: '4 أصناف', color: 'text-green-400' },
          { label: 'مساحة المزرعة', value: '2 هكتار', color: 'text-yellow-400' },
          { label: 'العمال النشطون', value: '3 عمال', color: 'text-cyan-400' },
        ].map((s) => (
          <div key={s.label} className="bg-black/50 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2">
            <p className="text-[10px] text-white/50 uppercase tracking-wider font-bold">{s.label}</p>
            <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-black/50 backdrop-blur-xl border border-white/10 rounded-full px-8 py-3 flex items-center gap-3 pointer-events-none">
        <span className="text-white/80 text-sm font-medium">🖱 اسحب للدوران · انقر المحاذير للتكبير</span>
      </div>
    </div>
  );
}

