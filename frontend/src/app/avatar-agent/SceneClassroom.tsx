'use client';
/**
 * SceneClassroom.tsx — Self-contained classroom scene.
 *
 * Composes:
 *   RoomShell      — room envelope with bookcases (from RoomWithShelves)
 *   OfficeDeskPro  — procedural desk + chair (snaps to DeskAnchor)
 *   LogoAIEDUCAT   — brand logo on back glass wall
 *   ClassroomHUD   — DOM overlay (physics / HDRI toggles + DeskAnchor position)
 *
 * Physics (Rapier) code is preserved in comments.
 * Set initialPhysics={true} + install @react-three/rapier to activate.
 *
 * Usage (Next.js page):
 * ─────────────────────
 *   import SceneClassroom from '@/app/avatar-agent/SceneClassroom';
 *   export default function Page() {
 *     return <div style={{ width:'100vw', height:'100vh' }}><SceneClassroom /></div>;
 *   }
 */
import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { Vector3 } from 'three';
import * as THREE from 'three';
// import { Physics } from '@react-three/rapier';

import { RoomShell } from './scene/RoomWithShelves';
import { LogoAIEDUCAT } from './brand/LogoAIEDUCAT';
import ClassroomHUD from './debug/ClassroomHUD';

// ── Office desk loaded from GLB ───────────────────────────────────────────────
function DeskModel() {
  const { scene } = useGLTF('/models/office/office_desk.glb');
  return (
    <primitive
      object={scene.clone()}
      position={[0, -1, 0.9]}
      scale={0.8}
      rotation={[0, Math.PI / 2, 0]}
    />
  );
}

// ── Video screen on the side wall ─────────────────────────────────────────
function VideoScreen() {
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);

  useEffect(() => {
    const video = document.createElement('video');
    video.src = '/models/office/نص فقرتك.mp4';
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(e => console.warn('[VideoScreen] autoplay blocked:', e));
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    setVideoTexture(texture);
    return () => {
      video.pause();
      video.src = '';
      texture.dispose();
    };
  }, []);

  if (!videoTexture) return null;
  return (
    <mesh position={[-3.4, 0.5, -1.5]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[3, 2]} />
      <meshBasicMaterial map={videoTexture} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Bridge: reads DeskAnchor world-position every ~60 frames and calls back ───
// Must live inside <Canvas> so it can call useThree() + useFrame().
const _trackVec = new Vector3(); // module-level to avoid allocation per frame

function DeskAnchorTracker({ onUpdate }: { onUpdate: (pos: string) => void }) {
  const { scene }   = useThree();
  const lastRef     = useRef('');
  const frameRef    = useRef(0);

  useFrame(() => {
    // Poll every 60 frames (~1 s @ 60 fps) to avoid flooding React setState
    if (++frameRef.current < 60) return;
    frameRef.current = 0;

    const anchor = scene.getObjectByName('DeskAnchor');
    if (!anchor) return;

    anchor.getWorldPosition(_trackVec);
    const next = `X:${_trackVec.x.toFixed(2)} Y:${_trackVec.y.toFixed(2)} Z:${_trackVec.z.toFixed(2)}`;
    if (next !== lastRef.current) {
      lastRef.current = next;
      onUpdate(next);
    }
  });

  return null;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface SceneClassroomProps {
  initialPhysics?: boolean;
  initialHDRI?:    boolean;
  showLogo?:       boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
const SceneClassroom: React.FC<SceneClassroomProps> = ({
  initialPhysics = false,
  initialHDRI    = true,
  showLogo       = true,
}) => {
  const [usePhysics,    setUsePhysics]    = useState(initialPhysics);
  const [useHDRI,       setUseHDRI]       = useState(initialHDRI);
  const [deskAnchorPos, setDeskAnchorPos] = useState('N/A');

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas shadows>
        {/* Single authoritative camera — no duplicate camera={} on <Canvas> */}
        <PerspectiveCamera makeDefault fov={32} near={0.05} far={50} position={[0, 2, 8]} />

        {/* {usePhysics && (
          <Physics>
            <RoomShell ... />
            <OfficeDeskPro ... />
          </Physics>
        )} */}

        <RoomShell
          width={7}
          depth={5}
          height={3}
          useHDRI={useHDRI}
          usePhysics={usePhysics}
          theme={{
            walls:     '#f0f0f0',
            floor:     '#4a4a4a',
            trims:     '#888888',
            shelfWood: '#8B4513',
            glassTint: '#a0c0d0',
          }}
        />

        <DeskModel />
        <VideoScreen />

        {showLogo && <LogoAIEDUCAT mount="wall" useText3D />}

        {/* Bridge that polls DeskAnchor position and surfaces it to the HUD */}
        <DeskAnchorTracker onUpdate={setDeskAnchorPos} />

        <OrbitControls />
      </Canvas>

      {/* DOM overlay — rendered outside Canvas, receives data via state */}
      <ClassroomHUD
        onTogglePhysics={() => setUsePhysics(p => !p)}
        onToggleHDRI={()    => setUseHDRI(p    => !p)}
        isPhysicsEnabled={usePhysics}
        isHDRIEnabled={useHDRI}
        deskAnchorPos={deskAnchorPos}
      />
    </div>
  );
};

export default SceneClassroom;
