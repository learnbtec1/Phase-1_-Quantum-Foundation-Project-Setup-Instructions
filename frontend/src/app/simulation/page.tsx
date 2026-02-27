'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Sky, Float } from '@react-three/drei';
import { Wallet, Users, Building2 } from 'lucide-react';
import * as THREE from 'three';

// Simulation gating: check environment variable (default: disabled)
const SIMULATION_ENABLED =
  process.env.NEXT_PUBLIC_SIMULATION_ENABLED === 'true';

// --- 1. هيكل الغرفة (ثابت لا يتغير) ---
function RoomShell() {
  const wallColor = "#f1f5f9";
  const floorColor = "#3f2e26";

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 10]} />
        <meshStandardMaterial color={floorColor} roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 4.5, 0]}>
        <planeGeometry args={[14, 10]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0, 2.25, 5]}><boxGeometry args={[14, 4.5, 0.2]} /><meshStandardMaterial color={wallColor} /></mesh>
      <mesh position={[-7, 2.25, 0]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[10, 4.5, 0.2]} /><meshStandardMaterial color={wallColor} /></mesh>
      <mesh position={[7, 2.25, 0]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[10, 4.5, 0.2]} /><meshStandardMaterial color={wallColor} /></mesh>
      <group position={[0, 0, -5]}>
        <mesh position={[0, 0.5, 0]}><boxGeometry args={[14, 1, 0.5]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[0, 2.75, 0]}>
          <planeGeometry args={[13.5, 3.5]} />
          <meshPhysicalMaterial color="#a5f3fc" transparent opacity={0.2} metalness={1} roughness={0} clearcoat={1} reflectivity={1}/>
        </mesh>
        <mesh position={[3.5, 2.75, 0]}><boxGeometry args={[0.2, 3.5, 0.2]} /><meshStandardMaterial color="#334155" /></mesh>
        <mesh position={[-3.5, 2.75, 0]}><boxGeometry args={[0.2, 3.5, 0.2]} /><meshStandardMaterial color="#334155" /></mesh>
      </group>
    </group>
  );
}

// --- 2. الأثاث والموظفون (الجزء المعدل للحركة) ---
function OfficeFurniture() {
  // مكون فرعي للموظف المتحرك
  const AnimatedEmployee = ({ user, color }: { user: string; color: string }) => {
    const groupRef = useRef<THREE.Group>(null);
    const leftArmRef = useRef<THREE.Mesh>(null);
    const rightArmRef = useRef<THREE.Mesh>(null);
    const headRef = useRef<THREE.Mesh>(null);
    const isInteractingRef = useRef(false);
    const [interacting, setInteracting] = useState(false);

    useEffect(() => {
      return () => { document.body.style.cursor = 'auto'; };
    }, []);

    useFrame((state) => {
      if (!groupRef.current || !leftArmRef.current || !rightArmRef.current || !headRef.current) return;
      const t = state.clock.getElapsedTime();

      groupRef.current.position.y = 0.6 + Math.sin(t * 1.5) * 0.02;
      headRef.current.rotation.z = Math.sin(t * 1) * 0.05;
      headRef.current.rotation.x = Math.sin(t * 0.8) * 0.05;

      leftArmRef.current.position.y = 0.3 + Math.abs(Math.sin(t * 10)) * 0.03;
      leftArmRef.current.position.z = 0.2 + Math.cos(t * 12) * 0.02;
      
      rightArmRef.current.position.y = 0.3 + Math.abs(Math.cos(t * 10)) * 0.03;
      rightArmRef.current.position.z = 0.2 + Math.sin(t * 12) * 0.02;

      if (isInteractingRef.current) {
        groupRef.current.rotation.y += 0.2;
        if (groupRef.current.rotation.y > Math.PI * 2) {
          groupRef.current.rotation.y = 0;
          isInteractingRef.current = false;
          setInteracting(false);
        }
      }
    });

    return (
      <group 
        ref={groupRef} 
        position={[0, 0.6, -0.6]} 
        onClick={(e) => { e.stopPropagation(); isInteractingRef.current = true; setInteracting(true); }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        {/* الرأس */}
        <mesh ref={headRef} position={[0, 0.4, 0]}>
            <sphereGeometry args={[0.25]} />
            <meshStandardMaterial color="#fca5a5" />
        </mesh>
        {/* الجسم */}
        <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.25, 0.6]} />
            <meshStandardMaterial color={color} />
        </mesh>
        {/* الذراع اليسرى (للطباعة) */}
        <mesh ref={leftArmRef} position={[-0.25, 0.3, 0.2]} rotation={[0.5, 0, -0.2]}>
            <boxGeometry args={[0.1, 0.3, 0.1]} />
            <meshStandardMaterial color={color} />
        </mesh>
         {/* الذراع اليمنى (للطباعة) */}
         <mesh ref={rightArmRef} position={[0.25, 0.3, 0.2]} rotation={[0.5, 0, 0.2]}>
            <boxGeometry args={[0.1, 0.3, 0.1]} />
            <meshStandardMaterial color={color} />
        </mesh>

        {/* بطاقة الاسم (تظهر وتختفي عند التفاعل) */}
        <Html position={[0, 0.8, 0]} center transform sprite>
            <div className={`${interacting ? 'bg-green-500 scale-110' : 'bg-black/80'} text-white px-2 py-0.5 rounded text-[10px] whitespace-nowrap border border-white/20 transition-all select-none`}>
              {interacting ? "Hey there! 👋" : user}
            </div>
        </Html>
      </group>
    );
  }

  const Desk = ({ x, z, rotate = 0, user, color = "#2563eb" }: { x: number; z: number; rotate?: number; user?: string; color?: string }) => (
    <group position={[x, 0, z]} rotation={[0, rotate, 0]}>
      {/* هيكل المكتب الثابت */}
      <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[2, 0.1, 1]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
      <mesh position={[-0.95, 0.3, 0.4]}><boxGeometry args={[0.1, 0.6, 0.1]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <mesh position={[0.95, 0.3, 0.4]}><boxGeometry args={[0.1, 0.6, 0.1]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <mesh position={[-0.95, 0.3, -0.4]}><boxGeometry args={[0.1, 0.6, 0.1]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <mesh position={[0.95, 0.3, -0.4]}><boxGeometry args={[0.1, 0.6, 0.1]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <group position={[0, 0.7, 0.2]}>
        <mesh rotation={[-0.1, 0, 0]}><boxGeometry args={[0.8, 0.5, 0.05]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[0, 0, 0.03]} rotation={[-0.1, 0, 0]}><planeGeometry args={[0.75, 0.45]} /><meshBasicMaterial color="#0ea5e9" toneMapped={false} /></mesh>
      </group>
      <mesh position={[0, 0.4, -0.6]}><boxGeometry args={[0.6, 0.8, 0.1]} /><meshStandardMaterial color="#475569" /></mesh>
      <mesh position={[0, 0.2, -0.6]}><cylinderGeometry args={[0.05, 0.05, 0.4]} /><meshStandardMaterial color="#94a3b8" /></mesh>

      {/* الموظف المتحرك */}
      {user && <AnimatedEmployee user={user} color={color} />}
    </group>
  );

  return (
    <group>
      <Desk x={3.5} z={-1} rotate={-0.2} user="Sarah (Dev)" color="#3b82f6" />
      <Desk x={-3.5} z={-1} rotate={0.2} user="Mike (Sales)" color="#ef4444" />
      <Desk x={-3.5} z={3} rotate={0.1} user="Ali (Manager)" color="#10b981" />
      <Desk x={3.5} z={3} rotate={-0.1} />
      <mesh position={[6, 0.5, 4]}><cylinderGeometry args={[0.5, 0.6, 1]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[6, 1.5, 4]}><dodecahedronGeometry args={[0.8]} /><meshStandardMaterial color="#166534" /></mesh>
    </group>
  );
}

// --- 3. المنظر الخارجي والإضاءة (ثابت) ---
function HighRiseView() {
  return (
    <group>
       <group position={[0, 0, -10]}>
          <Float speed={1} rotationIntensity={0} floatIntensity={1}>
             <mesh position={[-5, 2, 0]}><sphereGeometry args={[1.5, 16, 16]} /><meshStandardMaterial color="white" transparent opacity={0.8} /></mesh>
             <mesh position={[6, 1, 2]}><sphereGeometry args={[2, 16, 16]} /><meshStandardMaterial color="white" transparent opacity={0.8} /></mesh>
          </Float>
       </group>
     <group position={[0, 0, -20]}>
       <mesh position={[-8, 9, 0]}><boxGeometry args={[5, 18, 5]} /><meshStandardMaterial color="#1e293b" /></mesh>
       <mesh position={[-8, 17.5, 0]}><sphereGeometry args={[0.2]} /><meshBasicMaterial color="red" /></mesh>
       <mesh position={[0, 7, 4]}><boxGeometry args={[6, 14, 6]} /><meshStandardMaterial color="#334155" /></mesh>
       <mesh position={[0, 13.5, 4]}><sphereGeometry args={[0.2]} /><meshBasicMaterial color="red" /></mesh>
       <mesh position={[8, 8, -3]}><boxGeometry args={[4, 16, 4]} /><meshStandardMaterial color="#0f172a" /></mesh>
       <mesh position={[8, 15.5, -3]}><sphereGeometry args={[0.2]} /><meshBasicMaterial color="red" /></mesh>
     </group>
       <Sky sunPosition={[10, 5, -10]} turbidity={8} rayleigh={0.5} />
       <directionalLight position={[5, 5, -10]} intensity={2} castShadow shadow-bias={-0.0001} color="#fff7ed"/>
       <ambientLight intensity={0.6} />
    </group>
  );
}

// --- Simulation disabled placeholder ---
function SimulationDisabledMessage() {
  return (
    <div className="w-full h-screen bg-slate-900 flex flex-col items-center justify-center text-slate-300 px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="text-6xl opacity-50">🏢</div>
        <h1 className="text-xl font-bold text-white">محاكاة الشركات</h1>
        <p className="text-sm text-slate-400">
          المحاكاة معطلة حاليًا. لتفعيلها، أضف{' '}
          <code className="bg-slate-800 px-2 py-0.5 rounded text-cyan-400">
            NEXT_PUBLIC_SIMULATION_ENABLED=true
          </code>{' '}
          إلى ملف <code className="bg-slate-800 px-2 py-0.5 rounded">.env.local</code> وأعد تشغيل الخادم.
        </p>
      </div>
    </div>
  );
}

// --- المكون الرئيسي ---
export default function SimulationPage() {
  if (!SIMULATION_ENABLED) {
    return <SimulationDisabledMessage />;
  }

  return (
    <div className="w-full h-screen bg-slate-900 relative">
      <Canvas shadows camera={{ position: [0, 6, 10], fov: 50 }}>
        <RoomShell />
        <OfficeFurniture />
        <HighRiseView />
        <OrbitControls minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} minDistance={5} maxDistance={15} />
      </Canvas>
      <div className="absolute top-6 left-6 flex flex-col gap-4 pointer-events-none select-none">
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 text-white shadow-xl flex items-center gap-4">
          <div className="bg-green-500/20 p-2 rounded-lg"><Wallet className="w-6 h-6 text-green-400" /></div>
          <div><div className="text-xs text-gray-300 uppercase font-bold">Total Capital</div><div className="text-2xl font-bold">$1,250,000</div></div>
        </div>
        <div className="flex gap-2">
           <div className="bg-black/50 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-white flex items-center gap-2"><Building2 size={16} className="text-blue-400"/><span className="text-sm font-bold">Floor 20</span></div>
           <div className="bg-black/50 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-white flex items-center gap-2"><Users size={16} className="text-purple-400"/><span className="text-sm font-bold">3/4 Staff Working</span></div>
        </div>
      </div>
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/50 text-sm pointer-events-none animate-pulse">
        Try clicking on the employees!
      </div>
    </div>
  );
}