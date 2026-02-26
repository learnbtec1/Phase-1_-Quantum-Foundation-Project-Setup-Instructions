'use client';

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';

export interface VRMAvatarRef {
  speakText: (text: string) => void;
}

interface VRMAvatarProps {
  vrmUrl: string;
  onLoad?: () => void;
  onError?: (err: string) => void;
}

function VRMModel({
  vrmUrl,
  onLoad,
  onError,
}: {
  vrmUrl: string;
  onLoad?: () => void;
  onError?: (err: string) => void;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never));
    loader.load(
      vrmUrl,
      (gltf) => {
        const vrmModel = gltf.userData.vrm as VRM;
        setVrm(vrmModel);
        onLoad?.();
        const clips = (vrmModel as unknown as { animations?: THREE.AnimationClip[] }).animations;
        if (clips?.length) {
          const mixer = new THREE.AnimationMixer(vrmModel.scene);
          mixerRef.current = mixer;
          mixer.clipAction(clips[0]).play();
        }
      },
      undefined,
      (error) => {
        const msg = (error as Error)?.message || 'فشل تحميل الملف';
        onError?.(msg);
      }
    );
  }, [vrmUrl, onLoad, onError]);

  useFrame((_, delta) => {
    if (mixerRef.current) mixerRef.current.update(delta);
    if (vrm) vrm.update(delta);
  });

  return vrm ? (
    <group position={[0, -0.8, 0]}>
      <primitive object={vrm.scene} />
    </group>
  ) : null;
}

// Company-style background: gradient texture (office / meeting room feel)
function useCompanyBackground() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const grd = ctx.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#0f172a');
    grd.addColorStop(0.4, '#1e293b');
    grd.addColorStop(0.7, '#1e3a5f');
    grd.addColorStop(1, '#0f172a');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 512, 512);
    // subtle vignette
    const vig = ctx.createRadialGradient(256, 256, 0, 256, 256, 400);
    vig.addColorStop(0, 'transparent');
    vig.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    scene.background = tex;
    gl.setClearColor(0x0f172a, 1);
    return () => {
      tex.dispose();
      scene.background = new THREE.Color(0x0f172a);
    };
  }, [scene, gl]);
  return null;
}

function SceneCompanyBackground() {
  useCompanyBackground();
  return null;
}

// Floor plane — company meeting room floor
function CompanyFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.81, 0]} receiveShadow>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial
        color="#1e293b"
        metalness={0.15}
        roughness={0.85}
        envMapIntensity={0.3}
      />
    </mesh>
  );
}

// Subtle grid on floor for "office" look
function FloorGrid() {
  const gridConfig = { size: 20, divisions: 32, colorCenter: 0x334155, colorGrid: 0x1e293b };
  return (
    <gridHelper
      args={[gridConfig.size, gridConfig.divisions, gridConfig.colorCenter, gridConfig.colorGrid]}
      position={[0, -0.805, 0]}
    />
  );
}

// جدران الغرفة — قاعة شركة (خلفية + يمين + يسار)
const WALL_COLOR = '#1a2234';
const WALL_DARK = '#0f172a';

function CompanyWalls() {
  const mat = { color: WALL_COLOR, metalness: 0.05, roughness: 0.9 };
  const backMat = { color: WALL_DARK, metalness: 0.05, roughness: 0.92 };
  return (
    <group>
      {/* الجدار الخلفي */}
      <mesh position={[0, 3.2, -8]} receiveShadow>
        <planeGeometry args={[22, 10]} />
        <meshStandardMaterial {...backMat} />
      </mesh>
      {/* الجدار الأيسر (يسار المشهد) */}
      <mesh position={[-10.5, 3.2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* الجدار الأيمن */}
      <mesh position={[10.5, 3.2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial {...mat} />
      </mesh>
    </group>
  );
}

const VRMAvatar = forwardRef<VRMAvatarRef, VRMAvatarProps>(function VRMAvatar(
  { vrmUrl, onLoad, onError },
  ref
) {
  const [loadError, setLoadError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    speakText(text: string) {
      if (typeof window === 'undefined' || !window.speechSynthesis || !text?.trim()) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ar-SA';
      u.rate = 1;
      const voices = window.speechSynthesis.getVoices();
      const ar = voices.find((v) => v.lang.startsWith('ar'));
      if (ar) u.voice = ar;
      window.speechSynthesis.speak(u);
    },
  }));

  if (!vrmUrl) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[400px] bg-gray-800 text-gray-400 p-6 text-center">
        رابط VRM غير موجود.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] bg-gray-800 text-gray-300 p-8 text-center rounded-xl">
        <p className="font-semibold mb-2">لم يتم تحميل الشخصية</p>
        <p className="text-sm text-gray-400 mb-4">
          ضع ملف <code className="bg-gray-700 px-2 py-1 rounded">Furina.vrm</code> في المجلد:
        </p>
        <p className="text-sm text-amber-400 font-mono">frontend/public/models/Furina.vrm</p>
      </div>
    );
  }

  const COMPANY_BG = '#0f172a';
  return (
    <div className="w-full h-full min-h-0" style={{ backgroundColor: COMPANY_BG }}>
      <Canvas
        camera={{ position: [0, 1.2, 4], fov: 32 }}
        style={{
          width: '100%',
          height: '100%',
          minHeight: '400px',
          display: 'block',
          backgroundColor: COMPANY_BG,
          background: COMPANY_BG,
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(0x0f172a, 1);
          scene.background = new THREE.Color(0x0f172a);
        }}
      >
        <SceneCompanyBackground />
        <ambientLight intensity={1.4} />
        <directionalLight position={[4, 6, 5]} intensity={1.2} castShadow />
        <CompanyFloor />
        <FloorGrid />
        <CompanyWalls />
        <VRMModel vrmUrl={vrmUrl} onLoad={onLoad} onError={setLoadError} />
        <OrbitControls enableZoom enablePan enableRotate />
      </Canvas>
    </div>
  );
});

VRMAvatar.displayName = 'VRMAvatar';
export default VRMAvatar;
