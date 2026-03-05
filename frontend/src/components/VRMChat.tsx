'use client';

import React, { useRef, useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';

import AvatarHumanProUltra, {
  type AvatarUltraRef,
  type UltraEmotion,
} from './avatar/AvatarHumanProUltra';

type Msg = { role: 'user' | 'assistant'; text: string };

const COOLDOWN_MS = 1600;

export default function VRMChat() {
  const avatarRef = useRef<AvatarUltraRef>(null);
  const lastSendRef = useRef(0);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const backend = useMemo(
    () => (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    []
  );

  function pickEmotionFromText(s: string): UltraEmotion {
    const t = s.toLowerCase();
    if (/أحسنت|great|excellent|nice/.test(t)) return 'encouraging';
    if (/\?|فكر|think|consider/.test(t)) return 'curious';
    if (/confus|غير واضح|صعب/.test(t)) return 'thinking';
    if (/sad|حزين/.test(t)) return 'sad';
    if (/surpris|مندهش/.test(t)) return 'surprised';
    return 'relaxed';
  }

  async function send() {
    const msg = text.trim();
    if (!msg || loading) return;

    // cooldown
    const now = Date.now();
    const wait = lastSendRef.current + COOLDOWN_MS - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSendRef.current = Date.now();

    setText('');
    setMessages((m) => [...m, { role: 'user', text: msg }]);
    setLoading(true);

    try {
      const r = await fetch(`${backend}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const { text: reply, audioUrl } = await r.json();

      setMessages((m) => [...m, { role: 'assistant', text: reply }]);

      const emotion = pickEmotionFromText(reply);
      avatarRef.current?.setEmotion(emotion, 0.9, 2500);
      avatarRef.current?.triggerGesture('openHands', 0.9, 1300);

      if (audioUrl) {
        const full = audioUrl.startsWith('http') ? audioUrl : `${backend}${audioUrl}`;
        await avatarRef.current?.playAudioAndAnalyze(full);
        avatarRef.current?.setEmotion('neutral', 1, 800);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: 'تعذر الاتصال بالباكند.' }]);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="w-full flex flex-col gap-4">
      {/* === Scene === */}
      <div
        style={{
          width: '100%',
          height: 520,
          position: 'relative',
        }}
      >
        <Canvas
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl, scene }) => {
            gl.setClearColor(0x000000, 0);
            scene.background = null;
          }}
        >
          <PerspectiveCamera makeDefault position={[0, 1.3, 3.4]} fov={40} />

          <OrbitControls
            target={[0, 1.25, 0]}
            enableZoom={false}
            enablePan={false}
            enableRotate={true}
            rotateSpeed={0.5}
            maxPolarAngle={Math.PI * 0.6}
            minPolarAngle={0.2}
          />

          <ambientLight intensity={0.9} />
          <directionalLight position={[2, 3, 4]} intensity={2.2} color="#ffffff" />
          <directionalLight position={[-2, 1, 3]} intensity={1.0} color="#b0d0ff" />
          <directionalLight position={[0, 3, -3]} intensity={1.4} color="#88bbff" />

          <AvatarHumanProUltra ref={avatarRef} url="/avatar.vrm" />
        </Canvas>
      </div>

      {/* === Chat UI === */}
      <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-4">
        <div className="space-y-3">
          <div className="max-h-48 overflow-y-auto space-y-1 text-sm">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'text-cyan-300' : 'text-slate-100'}
              >
                <span className="font-semibold mr-1">
                  {m.role === 'user' ? 'You:' : 'Tutor:'}
                </span>
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="text-cyan-400/80 text-sm">...</div>
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              className="flex-1 rounded bg-slate-800 border border-slate-600 px-3 py-2 text-white"
              placeholder="اكتب رسالتك..."
            />
            <button
              onClick={send}
              disabled={loading}
              className="px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>

          <div className="text-xs text-slate-400">
            Backend: {backend}
          </div>
        </div>
      </div>
    </div>
  );
}