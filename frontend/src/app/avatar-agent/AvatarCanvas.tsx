'use client';

/**
 * AvatarAgent — full autonomous avatar agent component.
 *
 * Renders VRMAvatar inside a Three.js Canvas and wires it to the
 * useAvatarAgent hook (VAD → WS → STT/LLM/TTS pipeline).
 *
 * All avatar animation / emotion / lipsync is driven by existing custom
 * window events that VRMAvatar.tsx already handles.
 */

import React, { Suspense, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import VRMAvatar from '@/components/avatar/VRMAvatar';
import { useAvatarAgent } from '@/hooks/useAvatarAgent';
import type { AvatarAgentOptions } from '@/hooks/useAvatarAgent';

// ── ZoomController (مأخوذ من صفحة /evaluate) ───────────────────────────────
function ZoomController() {
  const { camera, gl } = useThree();
  const zRef = useRef((camera as THREE.PerspectiveCamera).position.z);

  useEffect(() => {
    const canvas = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zRef.current = Math.min(5.5, Math.max(1.2, zRef.current + e.deltaY * 0.018));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [gl]);

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.z += (zRef.current - cam.position.z) * 0.12;
  });

  return null;
}

// ── Status dot ───────────────────────────────────────────────────────────────
function StatusDot({ connected, processing }: { connected: boolean; processing: boolean }) {
  const color = !connected
    ? 'bg-red-500'
    : processing
    ? 'bg-yellow-400 animate-pulse'
    : 'bg-emerald-400';
  const label = !connected ? 'غير متصل' : processing ? 'يفكر...' : 'جاهز';
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AvatarAgent({
  vrmUrl = '/models/teach.vrm', // تأكد من وجود الملف في المسار الصحيح
  showDebug = false,
  wsUrl,
  autoReconnect,
  lang = 'ar-SA',
}: AvatarAgentOptions & { vrmUrl?: string; showDebug?: boolean }) {
  const [textInput, setTextInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    isListening,
    isConnected,
    isProcessing,
    lastTranscript,
    lastDialogue,
    emotion,
    error,
    toggleListening,
    sendText,
    clearHistory,
  } = useAvatarAgent({ wsUrl, autoReconnect, lang });

  const handleTextSend = () => {
    if (!textInput.trim()) return;
    sendText(textInput.trim());
    setTextInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleTextSend();
  };

  return (
    <div className="relative flex flex-col w-full h-full min-h-screen bg-[#0a0a12]" dir="rtl">
      {/* ── 3D Canvas ───────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <Canvas
          dpr={[1, 2]}
          shadows={false}
          camera={{ position: [0, 0.0, 3.2], fov: 50, near: 0.01, far: 100 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x0c1222, 1); // نفس لون خلفية صفحة /evaluate
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          {/* إضاءة مطابقة لصفحة /evaluate */}
          <ambientLight intensity={2.5} />
          <directionalLight position={[1, 3, 2]} intensity={2.5} />

          {/* إضاءة نقطية إضافية (موجودة في /evaluate) */}
          <pointLight position={[-2, 2, 2]} intensity={0.4} color="#8ecfff" />

          <Suspense fallback={null}>
            {/* نمرر vrmUrl مع scale=1 كما في /evaluate */}
            <VRMAvatar vrmUrl={vrmUrl} scale={1} />
          </Suspense>

          <ZoomController />
        </Canvas>

        {/* ── Status overlay ─────────────────────────────────────────────── */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
          <StatusDot connected={isConnected} processing={isProcessing} />
          {error && (
            <span className="text-xs text-red-400 bg-black/60 rounded px-2 py-0.5 max-w-xs text-right">
              {error}
            </span>
          )}
        </div>

        {/* ── Listening indicator ─────────────────────────────────────────── */}
        {isListening && (
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 flex gap-1 items-center bg-black/50 rounded-full px-4 py-2">
            <span className="inline-block w-1.5 h-3 bg-cyan-400 rounded-full animate-bounce delay-0" />
            <span className="inline-block w-1.5 h-4 bg-cyan-400 rounded-full animate-bounce delay-150" />
            <span className="inline-block w-1.5 h-5 bg-cyan-400 rounded-full animate-bounce delay-300" />
            <span className="text-xs text-cyan-300 mr-2">أنا أستمع...</span>
          </div>
        )}
      </div>

      {/* ── Debug panel ───────────────────────────────────────────────────── */}
      {showDebug && (lastTranscript || lastDialogue) && (
        <div className="mx-4 mb-2 p-3 bg-black/70 rounded-xl text-sm text-right text-gray-300 space-y-1">
          {lastTranscript && (
            <p>
              <span className="text-cyan-400 font-semibold">أنت: </span>
              {lastTranscript}
            </p>
          )}
          {lastDialogue && (
            <p>
              <span className="text-purple-400 font-semibold">دكتور حمزة: </span>
              {lastDialogue}
            </p>
          )}
          <p className="text-gray-500 text-xs">مشاعر: {emotion}</p>
        </div>
      )}

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 pb-6 pt-2">
        <button
          onClick={toggleListening}
          disabled={!isConnected || (isProcessing && !isListening)}
          aria-label={isListening ? 'إيقاف التسجيل وإرسال' : 'بدء التسجيل'}
          className={`
            flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center
            text-2xl transition-all duration-200 shadow-lg
            ${!isConnected || (isProcessing && !isListening) ? 'opacity-40 cursor-not-allowed' : ''}
            ${isListening
              ? 'bg-red-500 scale-110 shadow-red-500/40 animate-pulse'
              : 'bg-cyan-600 hover:bg-cyan-500 active:scale-95'
            }
          `}
        >
          {isListening ? '⏹' : '🎤'}
        </button>

        <input
          ref={inputRef}
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="اكتب رسالة..."
          disabled={!isConnected || isProcessing}
          className="flex-1 bg-white/10 text-white placeholder-gray-500 rounded-full
                     px-4 py-3 text-sm outline-none border border-white/10
                     focus:border-cyan-500 disabled:opacity-40 text-right"
          dir="rtl"
        />

        <button
          onClick={handleTextSend}
          disabled={!isConnected || !textInput.trim() || isProcessing}
          aria-label="إرسال"
          className="flex-shrink-0 w-11 h-11 rounded-full bg-violet-600 hover:bg-violet-500
                     flex items-center justify-center text-lg transition-all
                     active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ➤
        </button>

        <button
          onClick={clearHistory}
          disabled={!isConnected}
          title="مسح سجل المحادثة"
          aria-label="مسح السجل"
          className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-700 hover:bg-gray-600
                     flex items-center justify-center text-sm transition-all
                     active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🗑
        </button>
      </div>
    </div>
  );
}