'use client';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║         Human-Pro-Max-Plus-Arabic.tsx                                   ║
 * ║  Full-stack Arabic-speaking VRM Avatar — single-file edition            ║
 * ║                                                                          ║
 * ║  Systems included:                                                       ║
 * ║   1. Arabic Neural TTS  (/api/voice-arabic)                             ║
 * ║   2. Realistic LipSync  (A/I/U/E/O blendshapes + smoothing)            ║
 * ║   3. Auto-Blink         (random 2-5 s, smooth 0→1→0)                  ║
 * ║   4. Facial Expressions (Joy / Surprised / Angry / Sorrow, cycled)     ║
 * ║   5. Micro Body Motion  (breathing, shoulder sway, head idle)          ║
 * ║   6. Head Tracking      (mouse follow with soft lerp)                  ║
 * ║   7. WebGPU-safe        (No SSR, dynamic import, Next.js App Router)   ║
 * ║   8. Chat → Speak       (/api/chat-arabic  →  TTS pipeline)           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

// ─── React ────────────────────────────────────────────────────────────────────
import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';

// ─── Styles ───────────────────────────────────────────────────────────────────
import styles from './Human-Pro-Max-Plus-Arabic.module.css';

// ─── R3F ──────────────────────────────────────────────────────────────────────
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';

// ─── Three.js ─────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ─── VRM ──────────────────────────────────────────────────────────────────────
import {
  VRM,
  VRMUtils,
  VRMLoaderPlugin,
  VRMExpressionPresetName,
} from '@pixiv/three-vrm';

// ══════════════════════════════════════════════════════════════════════════════
//  §1  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Clamp a number to [lo, hi] */
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** Linear interpolation */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Damped lerp using a speed factor (frame-rate independent) */
const damp = (cur: number, tgt: number, speed: number) =>
  cur + (tgt - cur) * clamp(speed);

/** Random float in [a, b) */
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ══════════════════════════════════════════════════════════════════════════════
//  §2  TYPES & CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

export interface AvatarHandle {
  /** Speak `text` using Arabic TTS */
  speakArabic: (text: string) => Promise<void>;
  /** Stop current audio */
  stopSpeaking: () => void;
}

interface AvatarProps {
  /** Path to .vrm model (relative to /public) */
  vrmUrl?: string;
}

interface LipSmooth {
  aa: number; ii: number; uu: number; ee: number; oh: number;
}

interface BlinkState {
  weight: number;
  phase: 'idle' | 'closing' | 'holding' | 'opening';
  t: number;
  nextAt: number; // clock seconds
}

interface ExprState {
  name: VRMExpressionPresetName;
  weight: number;
  phase: 'fadein' | 'hold' | 'fadeout' | 'idle';
  t: number;
  nextAt: number; // clock seconds
}

// Expression cycle order
const EXPRESSION_CYCLE: VRMExpressionPresetName[] = [
  'happy', 'surprised', 'angry', 'sad',
] as VRMExpressionPresetName[];

// VRM bone names (lowercase string literals — required for VRM 0.x)
const BONE = {
  head:           'head',
  neck:           'neck',
  chest:          'chest',
  spine:          'spine',
  hips:           'hips',
  rightUpperArm:  'rightUpperArm',
  leftUpperArm:   'leftUpperArm',
  rightLowerArm:  'rightLowerArm',
  leftLowerArm:   'leftLowerArm',
  rightHand:      'rightHand',
  leftHand:       'leftHand',
} as const;

// ══════════════════════════════════════════════════════════════════════════════
//  §3  ARABIC TTS  —  base64 audio decoder + player
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Call the backend TTS route and return a playable AudioBuffer.
 * Route contract:  POST /api/voice-arabic  { text: string }  → { audio: string (base64 WAV/MP3) }
 */
async function fetchArabicAudio(
  text: string,
  audioCtx: AudioContext,
): Promise<AudioBuffer> {
  const res = await fetch('/api/voice-arabic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`TTS error ${res.status}`);
  const { audio } = await res.json() as { audio: string };

  // base64 → ArrayBuffer
  const binary = atob(audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return audioCtx.decodeAudioData(bytes.buffer);
}

// ══════════════════════════════════════════════════════════════════════════════
//  §4  CORE AVATAR COMPONENT  (runs inside <Canvas>)
// ══════════════════════════════════════════════════════════════════════════════

const AvatarCore = forwardRef<AvatarHandle, AvatarProps>(
  function AvatarCore({ vrmUrl = '/models/teach.vrm' }, ref) {

    const { scene } = useThree();

    // ── VRM refs ─────────────────────────────────────────────────────────────
    const vrmRef       = useRef<VRM | null>(null);
    const [vrmScene, setVrmScene] = useState<THREE.Object3D | null>(null);

    // ── Audio refs ────────────────────────────────────────────────────────────
    const audioCtxRef  = useRef<AudioContext | null>(null);
    const sourceRef    = useRef<AudioBufferSourceNode | null>(null);
    const analyserRef  = useRef<AnalyserNode | null>(null);
    const fftRef       = useRef<Float32Array<ArrayBuffer> | null>(null);
    const isSpeaking   = useRef(false);

    // ── LipSync smoothed values ───────────────────────────────────────────────
    const lip = useRef<LipSmooth>({ aa: 0, ii: 0, uu: 0, ee: 0, oh: 0 });

    // ── Blink state ───────────────────────────────────────────────────────────
    const blinkRef = useRef<BlinkState>({
      weight: 0,
      phase: 'idle',
      t: 0,
      nextAt: rand(2, 5),
    });

    // ── Facial expression state ───────────────────────────────────────────────
    const exprRef = useRef<ExprState>({
      name: 'happy' as VRMExpressionPresetName,
      weight: 0,
      phase: 'idle',
      t: 0,
      nextAt: rand(8, 12),
    });
    const exprIndexRef = useRef(0);

    // ── LookAt target for head tracking ──────────────────────────────────────
    const lookTargetRef = useRef(new THREE.Object3D());

    // ══════════════════════════════════════════════════════════════════════════
    //  §4.1  Audio helpers (stop + play)
    // ══════════════════════════════════════════════════════════════════════════

    const stopSpeaking = useCallback(() => {
      try {
        sourceRef.current?.stop();
        sourceRef.current?.disconnect();
        analyserRef.current?.disconnect();
      } catch { /* already stopped */ }
      sourceRef.current  = null;
      analyserRef.current = null;
      fftRef.current      = null;
      isSpeaking.current  = false;
    }, []);

    const speakArabic = useCallback(async (text: string) => {
      stopSpeaking();

      if (!audioCtxRef.current) {
        audioCtxRef.current = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        )();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const buffer = await fetchArabicAudio(text, ctx);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      src.start();

      sourceRef.current   = src;
      analyserRef.current = analyser;
      fftRef.current      = new Float32Array(analyser.frequencyBinCount);
      isSpeaking.current  = true;

      src.onended = () => stopSpeaking();
    }, [stopSpeaking]);

    // ── Expose imperative handle ───────────────────────────────────────────────
    useImperativeHandle(ref, () => ({ speakArabic, stopSpeaking }));

    // ══════════════════════════════════════════════════════════════════════════
    //  §4.2  Load VRM
    // ══════════════════════════════════════════════════════════════════════════

    useEffect(() => {
      scene.add(lookTargetRef.current);

      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      loader.load(
        vrmUrl,
        (gltf) => {
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.removeUnnecessaryJoints(gltf.scene);

          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) { console.error('[VRM] userData.vrm not found'); return; }

          // Prevent frustum culling hiding the avatar
          vrm.scene.traverse((o) => { o.frustumCulled = false; });

          // Attach lookAt target for eye tracking
          if (vrm.lookAt) vrm.lookAt.target = lookTargetRef.current;

          vrmRef.current = vrm;
          setVrmScene(vrm.scene);
          console.info('[VRM] ✅ loaded:', vrmUrl);
        },
        undefined,
        (e) => console.error('[VRM] load error:', e),
      );

      return () => {
        stopSpeaking();
        scene.remove(lookTargetRef.current);
        const vrm = vrmRef.current;
        if (vrm) {
          vrm.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.geometry?.dispose();
              (Array.isArray(m.material) ? m.material : [m.material]).forEach(
                (mat) => mat?.dispose(),
              );
            }
          });
          vrmRef.current = null;
          setVrmScene(null);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vrmUrl]);

    // ══════════════════════════════════════════════════════════════════════════
    //  §4.3  useFrame — main animation loop
    // ══════════════════════════════════════════════════════════════════════════

    useFrame((state, delta) => {
      const vrm = vrmRef.current;
      if (!vrm) return;

      const t  = state.clock.elapsedTime;
      const em = vrm.expressionManager;
      const hm = vrm.humanoid;

      // --------------- bone shortcuts ----------------------------------------
      const head   = hm?.getNormalizedBoneNode(BONE.head);
      const neck   = hm?.getNormalizedBoneNode(BONE.neck);
      const chest  = hm?.getNormalizedBoneNode(BONE.chest);
      const spine  = hm?.getNormalizedBoneNode(BONE.spine);
      const hips   = hm?.getNormalizedBoneNode(BONE.hips);
      const rua    = hm?.getNormalizedBoneNode(BONE.rightUpperArm);
      const lua    = hm?.getNormalizedBoneNode(BONE.leftUpperArm);
      const rla    = hm?.getNormalizedBoneNode(BONE.rightLowerArm);
      const lla    = hm?.getNormalizedBoneNode(BONE.leftLowerArm);
      const rh     = hm?.getNormalizedBoneNode(BONE.rightHand);
      const lh     = hm?.getNormalizedBoneNode(BONE.leftHand);

      // ═══════════════════════════════════════════════════════════════════════
      //  A) MICRO BODY MOTION
      // ═══════════════════════════════════════════════════════════════════════

      // -- Breathing (chest + spine + hips) -----------------------------------
      const breathAmp  = 0.022;
      const breathFreq = 1.4;
      const breathWave = Math.sin(t * breathFreq);
      if (chest) chest.rotation.x = breathWave * breathAmp;
      if (spine) {
        spine.rotation.x = breathWave * breathAmp * 0.6;
        // Shoulder sway
        spine.rotation.z = damp(spine.rotation.z, Math.sin(t * 0.35) * 0.02, delta * 2);
        spine.rotation.y = damp(spine.rotation.y, Math.sin(t * 0.55) * 0.014, delta * 2);
      }
      if (hips) hips.rotation.z = damp(hips.rotation.z, Math.sin(t * 0.35 + 0.5) * 0.009, delta * 2);

      // -- Arm idle pose -------------------------------------------------------
      // Arms hang naturally / speaking micro-gesture
      if (rua) rua.rotation.z = damp(rua.rotation.z, isSpeaking.current ? Math.sin(t * 10) * 0.1 : 0, delta * 3);
      if (lua) lua.rotation.z = damp(lua.rotation.z, isSpeaking.current ? Math.cos(t * 8) * 0.1  : 0, delta * 3);
      if (rla) rla.rotation.x = damp(rla.rotation.x, 0, delta * 3);
      if (lla) lla.rotation.x = damp(lla.rotation.x, 0, delta * 3);

      // -- Hand micro-gestures (only while speaking) ---------------------------
      if (rh) rh.rotation.x = isSpeaking.current ? Math.sin(t * 10) * 0.1 : 0;
      if (lh) lh.rotation.y = isSpeaking.current ? Math.sin(t * 6)  * 0.1 : 0;

      // ═══════════════════════════════════════════════════════════════════════
      //  B) HEAD TRACKING  —  follows mouse via state.pointer
      // ═══════════════════════════════════════════════════════════════════════

      const ptr = state.pointer; // R3F normalized pointer: x,y ∈ [-1,1]

      const lookX = ptr.x * 3;
      const lookY = ptr.y * 2 + 1.6;
      lookTargetRef.current.position.set(lookX, lookY, 2);

      // Head + neck rotation
      const neckTargX = ptr.y * -0.20;
      const neckTargY = ptr.x *  0.30;
      if (neck) {
        neck.rotation.x = lerp(neck.rotation.x, neckTargX, 0.10);
        neck.rotation.y = lerp(neck.rotation.y, neckTargY, 0.10);
      }
      if (head) {
        head.rotation.x = lerp(head.rotation.x, ptr.y * -0.25, 0.12);
        head.rotation.y = lerp(head.rotation.y, ptr.x *  0.40, 0.12);
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  C) AUTO-BLINK
      // ═══════════════════════════════════════════════════════════════════════

      if (em) {
        const b = blinkRef.current;
        b.t += delta;

        switch (b.phase) {
          case 'idle':
            b.weight = 0;
            if (t >= b.nextAt) { b.phase = 'closing'; b.t = 0; }
            break;
          case 'closing':
            b.weight = clamp(b.t / 0.08);
            if (b.t >= 0.08) { b.phase = 'holding'; b.t = 0; }
            break;
          case 'holding':
            b.weight = 1;
            if (b.t >= 0.04) { b.phase = 'opening'; b.t = 0; }
            break;
          case 'opening':
            b.weight = clamp(1 - b.t / 0.10);
            if (b.t >= 0.10) {
              b.weight = 0;
              b.phase  = 'idle';
              b.nextAt = t + rand(2, 5);
              b.t      = 0;
            }
            break;
        }

        // Apply blink — VRM 0.x uses 'blink'; VRM 1.x splits to blinkLeft/Right
        const bv = clamp(b.weight);
        try { em.setValue('blink' as VRMExpressionPresetName, bv); }
        catch {
          try {
            em.setValue('blinkLeft'  as VRMExpressionPresetName, bv);
            em.setValue('blinkRight' as VRMExpressionPresetName, bv);
          } catch { /* no blink blendshape */ }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  D) AUTO FACIAL EXPRESSIONS  (cycle every 8-12 s)
      // ═══════════════════════════════════════════════════════════════════════

      if (em) {
        const ex = exprRef.current;
        ex.t += delta;

        const FADE_DUR = 0.4;
        const HOLD_DUR = 2.5;

        switch (ex.phase) {
          case 'idle':
            if (t >= ex.nextAt) {
              // Pick next expression from cycle
              exprIndexRef.current = (exprIndexRef.current + 1) % EXPRESSION_CYCLE.length;
              ex.name  = EXPRESSION_CYCLE[exprIndexRef.current];
              ex.phase = 'fadein';
              ex.t     = 0;
            }
            break;
          case 'fadein':
            ex.weight = clamp(ex.t / FADE_DUR);
            if (ex.t >= FADE_DUR) { ex.phase = 'hold'; ex.t = 0; }
            break;
          case 'hold':
            ex.weight = 1;
            if (ex.t >= HOLD_DUR) { ex.phase = 'fadeout'; ex.t = 0; }
            break;
          case 'fadeout':
            ex.weight = clamp(1 - ex.t / FADE_DUR);
            if (ex.t >= FADE_DUR) {
              ex.weight = 0;
              ex.phase  = 'idle';
              ex.nextAt = t + rand(8, 12);
              ex.t      = 0;
            }
            break;
        }

        // Clear all expression presets first, then apply current
        const ALL_EXPR: VRMExpressionPresetName[] = [
          'happy', 'surprised', 'angry', 'sad', 'relaxed',
        ] as VRMExpressionPresetName[];
        for (const p of ALL_EXPR) {
          try { em.setValue(p, 0); } catch { /* skip */ }
        }
        if (ex.phase !== 'idle') {
          try { em.setValue(ex.name, clamp(ex.weight)); } catch { /* skip */ }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  E) LIPSYNC — audio analyser → blendshapes (A/I/U/E/O)
      //     Smoothing:  value = value * 0.65 + newValue * 0.35
      // ═══════════════════════════════════════════════════════════════════════

      if (em) {
        const l = lip.current;

        if (analyserRef.current && fftRef.current && isSpeaking.current) {
          analyserRef.current.getFloatFrequencyData(fftRef.current);
          const fft = fftRef.current;
          const n   = fft.length;

          // Normalise dB values (-∞..0) to [0..1]
          const norm = (db: number) => clamp((db + 80) / 80);

          // Frequency band energy sums
          let bass = 0, low = 0, mid = 0, high = 0, top = 0;
          const q = Math.floor(n / 5);
          for (let i = 0; i < n; i++) {
            const v = norm(fft[i]);
            if      (i < q)     bass += v;
            else if (i < q * 2) low  += v;
            else if (i < q * 3) mid  += v;
            else if (i < q * 4) high += v;
            else                top  += v;
          }
          // Normalise by band size
          const B = clamp(bass / q);
          const L = clamp(low  / q);
          const M = clamp(mid  / q);
          const H = clamp(high / q);
          const T = clamp(top  / q);

          // Rapid variation (for "E" shape)
          const rapid = Math.abs(M - l.ee);

          // §2 rules:  A=high vol, I=mid, U=low, E=rapid, O=deep bass
          const newAA = clamp(L * 1.4);
          const newII = clamp(M * 1.2);
          const newUU = clamp(H * 0.9);
          const newEE = clamp(rapid * 3.0);
          const newOH = clamp(B * 1.3);

          // Smooth
          l.aa = l.aa * 0.65 + newAA * 0.35;
          l.ii = l.ii * 0.65 + newII * 0.35;
          l.uu = l.uu * 0.65 + newUU * 0.35;
          l.ee = l.ee * 0.65 + newEE * 0.35;
          l.oh = l.oh * 0.65 + newOH * 0.35;
        } else {
          // No audio — close mouth gradually
          l.aa = l.aa * 0.65;
          l.ii = l.ii * 0.65;
          l.uu = l.uu * 0.65;
          l.ee = l.ee * 0.65;
          l.oh = l.oh * 0.65;
        }

        // Apply viseme blendshapes
        try { em.setValue('aa' as VRMExpressionPresetName, clamp(l.aa)); } catch { /* skip */ }
        try { em.setValue('ih' as VRMExpressionPresetName, clamp(l.ii)); } catch { /* skip */ }
        try { em.setValue('ou' as VRMExpressionPresetName, clamp(l.uu)); } catch { /* skip */ }
        try { em.setValue('ee' as VRMExpressionPresetName, clamp(l.ee)); } catch { /* skip */ }
        try { em.setValue('oh' as VRMExpressionPresetName, clamp(l.oh)); } catch { /* skip */ }
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  F) VRM update (must be last)
      // ═══════════════════════════════════════════════════════════════════════
      vrm.update(delta);
    });

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <group position={[0, 0.0, 0]}>
        {vrmScene && <primitive object={vrmScene} />}
      </group>
    );
  },
);

// ══════════════════════════════════════════════════════════════════════════════
//  §5  CHAT PANEL  —  Arabic chat → backend → TTS
// ══════════════════════════════════════════════════════════════════════════════

type ChatMsg = { role: 'user' | 'avatar'; text: string };

interface ChatPanelProps {
  avatarRef: React.RefObject<AvatarHandle | null>;
}

function ChatPanel({ avatarRef }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setBusy(true);

    try {
      // Step 1: get reply text from chat backend
      const chatRes = await fetch('/api/chat-arabic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!chatRes.ok) throw new Error('chat error');
      const { reply } = await chatRes.json() as { reply: string };

      setMessages((m) => [...m, { role: 'avatar', text: reply }]);

      // Step 2: pass reply to TTS → avatar speaks
      await avatarRef.current?.speakArabic(reply);
    } catch (e) {
      setMessages((m) => [...m, { role: 'avatar', text: 'عذراً، حدث خطأ في الاتصال.' }]);
      console.error('[ChatPanel]', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.chatPanel}>
      {/* Message history */}
      <div ref={scrollRef} className={styles.messageList}>
        {messages.length === 0 && (
          <p className={styles.emptyHint}>
            ابدأ محادثة مع الأفاتار عبر الكتابة أدناه...
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === 'user' ? styles.messageRowUser : styles.messageRowAvatar}
          >
            <span className={m.role === 'user' ? styles.bubbleUser : styles.bubbleAvatar}>
              {m.text}
            </span>
          </div>
        ))}
        {busy && (
          <div className={styles.typingIndicator}>
            جاري التحدّث...
          </div>
        )}
      </div>

      {/* Input row */}
      <div className={styles.inputRow}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          disabled={busy}
          placeholder="اكتب رسالتك بالعربية..."
          className={styles.textInput}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className={busy ? styles.sendButtonBusy : styles.sendButton}
        >
          إرسال
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  §6  ROOT COMPONENT — Canvas + Lighting + UI  (default export)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Drop-in component.  Usage:
 *
 *   import dynamic from 'next/dynamic';
 *   const AvatarChat = dynamic(() => import('@/components/Human-Pro-Max-Plus-Arabic'), { ssr: false });
 *   // then: <AvatarChat vrmUrl="/models/teach.vrm" height="600px" />
 */
export interface HumanProMaxPlusArabicProps {
  /** Path to .vrm model  (default: /models/teach.vrm) */
  vrmUrl   ?: string;
  /** Canvas height  (default: 520px) */
  height   ?: string | number;
  /** Show chat panel — defaults to true */
  showChat ?: boolean;
}

export default function HumanProMaxPlusArabic({
  vrmUrl   = '/models/teach.vrm',
  height   = '520px',
  showChat = true,
}: HumanProMaxPlusArabicProps) {
  const avatarRef = useRef<AvatarHandle>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (canvasWrapperRef.current) {
      const h = typeof height === 'number' ? `${height}px` : height;
      canvasWrapperRef.current.style.setProperty('--canvas-height', h);
    }
  }, [height]);

  return (
    <div className={styles.root}>
      {/* ── 3D Canvas ── */}
      <div ref={canvasWrapperRef} className={styles.canvasWrapper}>
        <Canvas
          gl={{
            antialias: true,
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          onCreated={({ gl, scene }) => {
            gl.setClearColor(0x000000, 0);
            scene.background = null;
          }}
          shadows={false}
        >
          {/* Camera */}
          <PerspectiveCamera makeDefault position={[0, 1.35, 2.8]} fov={38} near={0.01} far={100} />

          {/* Orbit controls */}
          <OrbitControls
            target={[0, 1.2, 0]}
            enableZoom={true}
            minDistance={1.0}
            maxDistance={5}
            enablePan={false}
            rotateSpeed={0.45}
            maxPolarAngle={Math.PI * 0.65}
            minPolarAngle={0.15}
          />

          {/* Lighting rig */}
          <ambientLight intensity={3.0} />
          <directionalLight position={[1.5, 4, 3]}   intensity={3.5} color="#ffffff" />
          <directionalLight position={[-2, 1.5, -1]}  intensity={1.8} color="#b0c8ff" />
          <pointLight       position={[0, 2.5, 1.5]}  intensity={1.0} color="#d0efff" />

          {/* Avatar */}
          <AvatarCore ref={avatarRef} vrmUrl={vrmUrl} />
        </Canvas>
      </div>

      {/* ── Chat panel ── */}
      {showChat && <ChatPanel avatarRef={avatarRef} />}
    </div>
  );
}
