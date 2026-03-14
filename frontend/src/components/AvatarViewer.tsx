'use client';

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useState,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRM,
  VRMUtils,
  VRMLoaderPlugin,
  VRMExpressionPresetName,
} from '@pixiv/three-vrm';

// ─── دوال مساعدة ───────────────────────────────────────────────────────────────
const clamp  = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const damp   = (cur: number, tgt: number, a: number) => cur + (tgt - cur) * clamp(a);
const randBetween = (a: number, b: number) => a + Math.random() * (b - a);

// ─── أنواع البيانات ────────────────────────────────────────────────────────────
export type UltraEmotion =
  | 'happy' | 'curious' | 'encouraging' | 'thinking'
  | 'surprised' | 'sad' | 'relaxed' | 'neutral';

export type UltraGesture =
  | 'wave' | 'openHands' | 'point' | 'think' | 'teaching';

export interface AvatarUltraHandle {
  playAudioAndAnalyze : (audioUrl: string) => Promise<void>;
  stopAudio           : () => void;
  setEmotion          : (e: UltraEmotion, intensity?: number, durationMs?: number) => void;
  triggerGesture      : (g: UltraGesture, intensity?: number, durationMs?: number) => void;
  setLipSync          : (data: Partial<Record<'aa'|'ee'|'oh'|'ih'|'ou', number>> & { amplitude?: number }) => void;
}

export interface AvatarUltraProps { url: string }

// ─── خريطة المشاعر إلى blendshapes VRM ────────────────────────────────────────
type BlendMap = Partial<Record<VRMExpressionPresetName, number>>;
const EMOTION_MAP: Record<UltraEmotion, BlendMap> = {
  happy:       { happy: 1.0 },
  curious:     { relaxed: 0.7, surprised: 0.3 },
  encouraging: { happy: 0.8, relaxed: 0.2 },
  thinking:    { relaxed: 0.5, sad: 0.2 },
  surprised:   { surprised: 1.0 },
  sad:         { sad: 1.0 },
  relaxed:     { relaxed: 1.0 },
  neutral:     {},
};

// ─── خريطة الأحداث الخارجية إلى أسماء المشاعر الداخلية ──────────────────────
const EMAP: Record<string, UltraEmotion> = {
  happy:'happy',       joy:'happy',         السعيد:'happy',
  sad:'sad',           sorrow:'sad',         الحزين:'sad',
  angry:'sad',
  surprised:'surprised', المندهش:'surprised',  excited:'surprised',
  relaxed:'relaxed',   calm:'relaxed',       الهادئ:'relaxed',
  curious:'curious',   thinking:'thinking',
  encouraging:'encouraging',
  neutral:'neutral',
};

// ─── حالة الرمشة ──────────────────────────────────────────────────────────────
interface BlinkState {
  phase      : 'idle' | 'closing' | 'holding' | 'opening';
  t          : number;   // ثانية داخل المرحلة الحالية
  nextBlink  : number;   // وقت الرمشة القادمة (ثانية من بداية الساعة)
  doDouble   : boolean;  // هل ترمش مرتين؟
  doubleWait : number;   // وقت انتظار الرمشة الثانية
  weight     : number;   // قيمة blendshape الحالية 0..1
  isSpeaking : boolean;  // لزيادة معدل الرمش عند الكلام
}

// ─── حالة المشاعر ─────────────────────────────────────────────────────────────
interface EmotionState {
  name      : UltraEmotion;
  target    : BlendMap;
  current   : Partial<Record<VRMExpressionPresetName, number>>;
  phase     : 'fadein' | 'hold' | 'fadeout' | 'idle';
  elapsed   : number;
  fadeIn    : number;  // ثانية
  hold      : number;  // ثانية
  fadeOut   : number;  // ثانية
  intensity : number;
}

// ─── حالة الإيماءة ────────────────────────────────────────────────────────────
interface GestureState {
  name      : UltraGesture;
  active    : boolean;
  t         : number;
  duration  : number;
  intensity : number;
}

// ─── حالة lip-sync ────────────────────────────────────────────────────────────
interface LipState {
  aa: number; ee: number; oh: number; ih: number; ou: number;
  lastManualMs: number;  // آخر وقت تم فيه تحديث يدوي
}

// ─── حالة حركة العيون (saccades) ─────────────────────────────────────────────
interface SaccadeState {
  offsetX   : number;
  offsetY   : number;
  targetX   : number;
  targetY   : number;
  nextChange: number;  // ثانية من الساعة
}

// ─── حالة الكلام (body language) ─────────────────────────────────────────────
interface SpeakState {
  active      : boolean;
  nodPhase    : number;  // 0..2π
  nodTimer    : number;  // عداد للنودة التالية
  spineTarget : number;  // إمالة طفيفة للأمام
}

// ══════════════════════════════════════════════════════════════════════════════
//  المكوّن الداخلي — يعمل داخل <Canvas>
// ══════════════════════════════════════════════════════════════════════════════
export const AvatarHumanProUltra = forwardRef<AvatarUltraHandle, AvatarUltraProps>(
  function AvatarHumanProUltra({ url }, ref) {

    const groupRef = useRef<THREE.Group>(null);
    const vrmRef   = useRef<VRM | null>(null);
    const [vrmScene, setVrmScene] = useState<THREE.Object3D | null>(null);
    const { scene } = useThree();

    // ── هدف نظرة الأفاتار ──────────────────────────────────────────────────
    const lookRef = useRef(new THREE.Object3D());

    // ── حالات الرمش والمشاعر والإيماءات ───────────────────────────────────
    const blinkRef = useRef<BlinkState>({
      phase: 'idle', t: 0,
      nextBlink: randBetween(2.5, 5),
      doDouble: false, doubleWait: 0,
      weight: 0, isSpeaking: false,
    });

    const emoRef = useRef<EmotionState>({
      name: 'neutral', target: {}, current: {},
      phase: 'idle', elapsed: 0,
      fadeIn: 0.35, hold: 1.6, fadeOut: 0.6, intensity: 1,
    });

    const gestureRef = useRef<GestureState>({
      name: 'wave', active: false, t: 0, duration: 1.2, intensity: 1,
    });

    const lipRef = useRef<LipState>({
      aa: 0, ee: 0, oh: 0, ih: 0, ou: 0, lastManualMs: 0,
    });

    const saccadeRef = useRef<SaccadeState>({
      offsetX: 0, offsetY: 0,
      targetX: 0, targetY: 0,
      nextChange: randBetween(1.5, 3),
    });

    const speakRef = useRef<SpeakState>({
      active: false, nodPhase: 0, nodTimer: 0, spineTarget: 0,
    });

    // ── مراجع للتحليل الصوتي ──────────────────────────────────────────────
    const audioCtxRef  = useRef<AudioContext | null>(null);
    const audioElRef   = useRef<HTMLAudioElement | null>(null);
    const sourceRef    = useRef<MediaElementAudioSourceNode | null>(null);
    const analyserRef  = useRef<AnalyserNode | null>(null);
    const fftRef       = useRef<Uint8Array | null>(null);

    // ── ذاكرة مؤقتة لقيم رمشة ليّنة ──────────────────────────────────────
    const smoothLipRef = useRef({ aa: 0, ee: 0, oh: 0 });

    // ══════════════════════════════════════════════════════════════════════
    //  الواجهة الخارجية (imperative handle)
    // ══════════════════════════════════════════════════════════════════════
    useImperativeHandle(ref, () => ({

      // ── تشغيل ملف صوتي مع تحليل فوري للحركة الشفهية ──────────────────
      async playAudioAndAnalyze(audioUrl: string) {
        // Skip self audio when server TTS is active (prevents echo)
        if (typeof window !== 'undefined' && (window as typeof window & { __SERVER_TTS_ACTIVE__?: boolean }).__SERVER_TTS_ACTIVE__) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Viewer] playAudioAndAnalyze skipped (__SERVER_TTS_ACTIVE__)');
          }
          return;
        }

        stopAudio();

        if (!audioCtxRef.current) {
          audioCtxRef.current = new (
            window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          )();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        const el = new Audio();
        el.src = audioUrl;
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        audioElRef.current = el;

        const src = ctx.createMediaElementSource(el);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.75;

        src.connect(analyser);
        analyser.connect(ctx.destination);
        sourceRef.current  = src;
        analyserRef.current = analyser;
        fftRef.current      = new Uint8Array(analyser.frequencyBinCount);

        const onEnded = () => stopAudio();
        el.addEventListener('ended', onEnded, { once: true });

        speakRef.current.active      = true;
        speakRef.current.spineTarget = 0.015;
        blinkRef.current.isSpeaking  = true;

        await el.play().catch((e) => {
          console.error('[AvatarViewer] تعذّر تشغيل الصوت:', e);
          stopAudio();
        });
      },

      // ── إيقاف الصوت وتنظيف العقد ──────────────────────────────────────
      stopAudio,

      // ── ضبط مشاعر الأفاتار مع fade ───────────────────────────────────
      setEmotion(name: UltraEmotion, intensity = 1, durationMs = 1800) {
        const e = emoRef.current;
        e.name      = name;
        e.target    = EMOTION_MAP[name] ?? {};
        e.phase     = 'fadein';
        e.elapsed   = 0;
        e.hold      = durationMs / 1000;
        e.intensity = clamp(intensity);
        // ابدأ من القيم الحالية للانتقال السلس
        if (!e.current) e.current = {};
      },

      // ── تشغيل إيماءة قصيرة ────────────────────────────────────────────
      triggerGesture(name: UltraGesture, intensity = 1, durationMs = 900) {
        const g = gestureRef.current;
        g.name      = name;
        g.active    = true;
        g.t         = 0;
        g.duration  = Math.max(0.4, durationMs / 1000);
        g.intensity = clamp(intensity);
      },

      // ── تحديث قيم lip-sync يدوياً ─────────────────────────────────────
      setLipSync(data) {
        const l = lipRef.current;
        l.lastManualMs = performance.now();

        if (data.amplitude !== undefined && !data.aa && !data.oh) {
          // وضع: فقط amplitude متوفر
          const amp = clamp(data.amplitude);
          const mod = Math.sin(performance.now() * 0.006) * 0.3 + 0.7;
          l.aa = clamp(amp * 1.3 * mod);
          l.oh = clamp(amp * 0.7);
        } else {
          if (data.aa !== undefined) l.aa = clamp(data.aa);
          if (data.ee !== undefined) l.ee = clamp(data.ee);
          if (data.oh !== undefined) l.oh = clamp(data.oh);
          if (data.ih !== undefined) l.ih = clamp(data.ih);
          if (data.ou !== undefined) l.ou = clamp(data.ou);
        }
      },
    }));

    // ══════════════════════════════════════════════════════════════════════
    //  إيقاف الصوت وتنظيف Web Audio nodes
    // ══════════════════════════════════════════════════════════════════════
    function stopAudio() {
      try {
        audioElRef.current?.pause();
        sourceRef.current?.disconnect();
        analyserRef.current?.disconnect();
      } catch { /* تجاهل الأخطاء */ }
      audioElRef.current  = null;
      sourceRef.current   = null;
      analyserRef.current = null;
      fftRef.current      = null;

      speakRef.current.active      = false;
      speakRef.current.spineTarget = 0;
      blinkRef.current.isSpeaking  = false;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  تحميل ملف VRM
    // ══════════════════════════════════════════════════════════════════════
    useEffect(() => {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      // أضف lookRef إلى المشهد أولاً حتى يعمل vrm.lookAt
      scene.add(lookRef.current);

      loader.load(
        url,
        (gltf) => {
          // تحسين الأداء
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.removeUnnecessaryJoints(gltf.scene);

          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) {
            console.error('[AvatarViewer] ❌ لم يُعثر على VRM في gltf.userData');
            return;
          }

          // منع اختفاء الأفاتار عند خروجه من مخروط الرؤية
          vrm.scene.traverse((obj) => { obj.frustumCulled = false; });

          // ربط نقطة نظر العيون
          if (vrm.lookAt) {
            vrm.lookAt.target = lookRef.current;
          }

          vrmRef.current = vrm;
          setVrmScene(vrm.scene);  // ← R3F يتولى الإضافة عبر <primitive>

          console.log('[AvatarViewer] ✅ VRM محمّل:', url);
        },
        undefined,
        (e) => console.error('[AvatarViewer] خطأ في تحميل VRM:', e)
      );

      return () => {
        stopAudio();
        scene.remove(lookRef.current);
        const vrm = vrmRef.current;
        if (vrm) {
          vrm.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.geometry?.dispose();
              if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
              else m.material?.dispose();
            }
          });
          try { (vrm as unknown as { dispose?: () => void }).dispose?.(); } catch { /* VRM 0.x لا يملك dispose */ }
          vrmRef.current = null;
          setVrmScene(null);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url, scene]);

    // ══════════════════════════════════════════════════════════════════════
    //  حلقة الإطارات — قلب الأفاتار الحي
    // ══════════════════════════════════════════════════════════════════════
    useFrame((state, delta) => {
      const vrm = vrmRef.current;
      if (!vrm) return;

      const t  = state.clock.elapsedTime;
      const em = vrm.expressionManager;
      const humanoid = vrm.humanoid;

      // ── مراجع العظام (مع null-check) ───────────────────────────────────
      const chest = humanoid?.getNormalizedBoneNode('chest');
      const spine = humanoid?.getNormalizedBoneNode('spine');
      const hips  = humanoid?.getNormalizedBoneNode('hips');
      const neck  = humanoid?.getNormalizedBoneNode('neck');
      const head  = humanoid?.getNormalizedBoneNode('head');
      const RU    = humanoid?.getNormalizedBoneNode('rightUpperArm');
      const RL    = humanoid?.getNormalizedBoneNode('rightLowerArm');
      const LU    = humanoid?.getNormalizedBoneNode('leftUpperArm');
      const LL    = humanoid?.getNormalizedBoneNode('leftLowerArm');

      // ══════════════════════════════════════════════════════════════════
      //  1) التنفس (دائم)
      // ══════════════════════════════════════════════════════════════════
      const breathFreq  = 1.4;
      const breathBase  = Math.sin(t * breathFreq);
      const breathNoise = Math.sin(t * 0.3) * 0.004;  // تفاوت طبيعي

      if (chest) chest.rotation.x = breathBase * 0.028 + breathNoise;
      if (spine) {
        spine.rotation.x = breathBase * 0.016 + breathNoise * 0.5;
      }
      if (hips) {
        hips.position.y = breathBase * 0.003;
      }

      // ══════════════════════════════════════════════════════════════════
      //  2) التأرجح الخامل (دائم)
      // ══════════════════════════════════════════════════════════════════
      if (spine) {
        // تأرجح جانبي
        spine.rotation.z = damp(
          spine.rotation.z,
          Math.sin(t * 0.38) * 0.018,
          delta * 2
        );
        // دوران خفيف
        spine.rotation.y = damp(
          spine.rotation.y,
          Math.sin(t * 0.55) * 0.012,
          delta * 2
        );
      }
      if (hips) {
        hips.rotation.z = damp(
          hips.rotation.z,
          Math.sin(t * 0.38 + 0.5) * 0.008,
          delta * 2
        );
      }

      // ══════════════════════════════════════════════════════════════════
      //  3) حركات العيون العشوائية (saccades)
      // ══════════════════════════════════════════════════════════════════
      const sac = saccadeRef.current;
      if (t >= sac.nextChange) {
        sac.targetX   = randBetween(-0.08, 0.08);
        sac.targetY   = randBetween(-0.06, 0.06);
        sac.nextChange = t + randBetween(1.5, 3.0);
      }
      // انتقال سلس نحو الهدف
      const sacSpeed = delta * 5;
      sac.offsetX = damp(sac.offsetX, sac.targetX, sacSpeed);
      sac.offsetY = damp(sac.offsetY, sac.targetY, sacSpeed);

      // ══════════════════════════════════════════════════════════════════
      //  4) تتبع الرأس للمؤشر + تحديث lookRef
      // ══════════════════════════════════════════════════════════════════
      const ptr = state.pointer;
      const jx  = Math.sin(t * 2.1) * 0.018;
      const jy  = Math.sin(t * 1.7) * 0.013;

      lookRef.current.position.set(
        ptr.x * 2 + jx + sac.offsetX,
        ptr.y * 2 + 1.85 + jy + sac.offsetY,
        2
      );

      const neckTargetX = ptr.y * -0.22;
      const neckTargetY = ptr.x * 0.35;
      const headTargetX = ptr.y * -0.28;
      const headTargetY = ptr.x * 0.40;

      // إضافة حركة رأس خلال الكلام
      const spk = speakRef.current;
      let nodOffset = 0;
      if (spk.active) {
        spk.nodTimer += delta;
        if (spk.nodTimer >= 0.8) {
          spk.nodTimer = 0;
          spk.nodPhase = spk.nodPhase > 0 ? 0 : 1;
        }
        nodOffset = spk.nodPhase * 0.04 * Math.sin(t * 3.5);
        // إمالة خفيفة للأمام عند الكلام
        if (spine) {
          spine.rotation.x = damp(spine.rotation.x, spk.spineTarget, delta * 3);
        }
      } else {
        if (spine) {
          spine.rotation.x = damp(spine.rotation.x, 0, delta * 2);
        }
      }

      if (neck) {
        neck.rotation.x = damp(neck.rotation.x, neckTargetX + nodOffset, 0.10);
        neck.rotation.y = damp(neck.rotation.y, neckTargetY, 0.10);
      }
      if (head) {
        head.rotation.x = damp(head.rotation.x, headTargetX + nodOffset * 0.5, 0.12);
        head.rotation.y = damp(head.rotation.y, headTargetY, 0.12);
      }

      // ══════════════════════════════════════════════════════════════════
      //  5) الرمش الإجرائي
      // ══════════════════════════════════════════════════════════════════
      if (em) {
        const b   = blinkRef.current;
        const blinkRate = b.isSpeaking ? 1.3 : 1.0;  // زيادة معدل الرمش عند الكلام
        b.t += delta;

        switch (b.phase) {
          case 'idle':
            b.weight = 0;
            if (t >= b.nextBlink) {
              b.phase = 'closing';
              b.t     = 0;
              // 15% احتمالية رمشة مزدوجة
              b.doDouble   = Math.random() < 0.15;
              b.doubleWait = 0.4;
            }
            break;

          case 'closing':
            // 80ms للإغلاق
            b.weight = clamp(b.t / 0.08);
            if (b.t >= 0.08) { b.phase = 'holding'; b.t = 0; }
            break;

          case 'holding':
            b.weight = 1;
            // 40ms ثبات
            if (b.t >= 0.04) { b.phase = 'opening'; b.t = 0; }
            break;

          case 'opening':
            // 100ms للفتح
            b.weight = clamp(1 - b.t / 0.10);
            if (b.t >= 0.10) {
              b.weight = 0;
              if (b.doDouble) {
                // انتظر قبل الرمشة الثانية
                b.doDouble   = false;
                b.phase      = 'idle';
                b.nextBlink  = t + b.doubleWait;
              } else {
                b.phase     = 'idle';
                b.nextBlink = t + randBetween(2.5 / blinkRate, 6.0 / blinkRate);
              }
              b.t = 0;
            }
            break;
        }

        // تطبيق الرمشة على بلندشيبس VRM (يدعم VRM0 و VRM1)
        const bv = clamp(b.weight);
        try { em.setValue('blink' as VRMExpressionPresetName, bv); }
        catch {
          try {
            em.setValue('blinkLeft'  as VRMExpressionPresetName, bv);
            em.setValue('blinkRight' as VRMExpressionPresetName, bv);
          } catch { /* VRM لا يدعم الرمش */ }
        }
      }

      // ══════════════════════════════════════════════════════════════════
      //  6) lip-sync (وضع A: تحليل صوتي)
      // ══════════════════════════════════════════════════════════════════
      if (em) {
        const sl = smoothLipRef.current;

        if (analyserRef.current && fftRef.current) {
          // تحليل الطيف الصوتي في الوقت الفعلي
          analyserRef.current.getByteFrequencyData(fftRef.current as Uint8Array<ArrayBuffer>);
          const arr = fftRef.current;
          const n   = arr.length;

          let low = 0, mid = 0, high = 0;
          const third = n / 3;
          for (let i = 0; i < n; i++) {
            if      (i < third)       low  += arr[i];
            else if (i < third * 2)   mid  += arr[i];
            else                      high += arr[i];
          }
          const norm = 255 * third;

          // تمهيد: قيمة جديدة = prev*0.6 + new*0.4
          sl.aa = sl.aa * 0.6 + (low  / norm) * 0.4;
          sl.ee = sl.ee * 0.6 + (high / norm) * 0.4;
          sl.oh = sl.oh * 0.6 + (mid  / norm) * 0.4;

        } else {
          // وضع B: قيم يدوية من setLipSync
          const l = lipRef.current;
          const ageMs = performance.now() - l.lastManualMs;

          if (ageMs < 200) {
            // استخدم القيم اليدوية مباشرة
            sl.aa = damp(sl.aa, l.aa, delta * 12);
            sl.ee = damp(sl.ee, l.ee, delta * 12);
            sl.oh = damp(sl.oh, l.oh, delta * 12);
          } else {
            // لا بيانات منذ 200ms — أغلق الفم تدريجياً
            sl.aa = damp(sl.aa, 0, delta * 8);
            sl.ee = damp(sl.ee, 0, delta * 8);
            sl.oh = damp(sl.oh, 0, delta * 8);
          }
        }

        // تطبيق visemes على الأفاتار
        try { em.setValue('aa' as VRMExpressionPresetName, clamp(sl.aa)); } catch { /* تجاهل */ }
        try { em.setValue('ee' as VRMExpressionPresetName, clamp(sl.ee)); } catch { /* تجاهل */ }
        try { em.setValue('oh' as VRMExpressionPresetName, clamp(sl.oh)); } catch { /* تجاهل */ }
        // ih و ou من القيم اليدوية فقط
        try { em.setValue('ih' as VRMExpressionPresetName, clamp(lipRef.current.ih)); } catch { /* تجاهل */ }
        try { em.setValue('ou' as VRMExpressionPresetName, clamp(lipRef.current.ou)); } catch { /* تجاهل */ }

        // ══════════════════════════════════════════════════════════════
        //  7) دمج المشاعر (fade-in → hold → fade-out)
        // ══════════════════════════════════════════════════════════════
        const emo = emoRef.current;
        if (emo.phase !== 'idle') {
          emo.elapsed += delta;
          let weight = 0;

          if (emo.phase === 'fadein') {
            weight = clamp(emo.elapsed / emo.fadeIn);
            if (emo.elapsed >= emo.fadeIn) {
              emo.phase   = 'hold';
              emo.elapsed = 0;
            }
          } else if (emo.phase === 'hold') {
            weight = 1;
            if (emo.elapsed >= emo.hold) {
              emo.phase   = 'fadeout';
              emo.elapsed = 0;
            }
          } else if (emo.phase === 'fadeout') {
            weight = clamp(1 - emo.elapsed / emo.fadeOut);
            if (emo.elapsed >= emo.fadeOut) {
              emo.phase = 'idle';
              weight    = 0;
            }
          }

          const finalW = weight * emo.intensity;

          // صفّر كل blendshapes أولاً ثم طبّق الهدف
          const ALL_PRESETS: VRMExpressionPresetName[] = [
            'happy', 'angry', 'sad', 'surprised', 'relaxed',
          ] as VRMExpressionPresetName[];

          for (const p of ALL_PRESETS) {
            const tgt  = (emo.target[p] ?? 0) * finalW;
            const prev = emo.current[p] ?? 0;
            const next = damp(prev, tgt, delta * 6);
            emo.current[p] = next;
            try { em.setValue(p, clamp(next)); } catch { /* تجاهل */ }
          }
        }

        // lookUp خفيف عند الكلام (رفع الحواجب)
        if (spk.active) {
          try { em.setValue('lookUp' as VRMExpressionPresetName, 0.15); } catch { /* تجاهل */ }
        } else {
          try { em.setValue('lookUp' as VRMExpressionPresetName, 0); } catch { /* تجاهل */ }
        }
      }

      // ══════════════════════════════════════════════════════════════════
      //  8) إيماءات الأذرع (event-driven)
      // ══════════════════════════════════════════════════════════════════
      if (humanoid) {
        const g = gestureRef.current;

        // إعادة ضبط طفيف للعظام نحو الوضع الطبيعي
        const RESET_SPEED = delta * 2.5;
        [RU, RL, LU, LL].forEach((b) => {
          if (!b) return;
          b.rotation.x = damp(b.rotation.x, 0, RESET_SPEED);
          b.rotation.y = damp(b.rotation.y, 0, RESET_SPEED);
          b.rotation.z = damp(b.rotation.z, 0, RESET_SPEED);
        });

        if (g.active) {
          g.t += delta;
          const k    = clamp(g.t / g.duration);
          // منحنى ease-in-out
          const ease = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
          const w    = ease * g.intensity;

          switch (g.name) {
            case 'wave':
              // 3 تذبذبات للذراع الأيمن
              if (RU) RU.rotation.z += Math.sin(g.t * Math.PI * 3) * 0.9 * w * delta * 2;
              if (RL) RL.rotation.z += Math.sin(g.t * Math.PI * 3) * 0.6 * w * delta * 2;
              break;

            case 'openHands':
              if (LU) LU.rotation.x = damp(LU.rotation.x, -0.5 * w, delta * 5);
              if (RU) RU.rotation.x = damp(RU.rotation.x, -0.5 * w, delta * 5);
              break;

            case 'point':
              if (RU) RU.rotation.x = damp(RU.rotation.x, -0.7 * w, delta * 6);
              if (RL) RL.rotation.x = damp(RL.rotation.x, -0.4 * w, delta * 6);
              break;

            case 'think':
              // ذراع يسار عبر الجسم + إمالة رأس
              if (LU) {
                LU.rotation.x = damp(LU.rotation.x, 0.3 * w, delta * 4);
                LU.rotation.z = damp(LU.rotation.z,  0.6 * w, delta * 4);
              }
              if (head) {
                head.rotation.z = damp(head.rotation.z, 0.08 * w, delta * 4);
              }
              break;

            case 'teaching':
              // ذراع يمين مفتوح للأمام + إمالة طفيفة للعمود
              if (RU) RU.rotation.x = damp(RU.rotation.x, -0.40 * w, delta * 5);
              if (RL) RL.rotation.x = damp(RL.rotation.x, -0.25 * w, delta * 5);
              if (spine) {
                spine.rotation.x = damp(spine.rotation.x, 0.03 * w, delta * 3);
              }
              break;
          }

          if (g.t >= g.duration) g.active = false;
        }
      }

      // ══════════════════════════════════════════════════════════════════
      //  9) تحديث VRM (يجب أن يكون آخر شيء)
      // ══════════════════════════════════════════════════════════════════
      vrm.update(delta);
    });

    return (
      <group position={[0, 0.55, 0]}>
        {vrmScene && <primitive object={vrmScene} />}
      </group>
    );
  }
);

// ══════════════════════════════════════════════════════════════════════════════
//  خريطة الأحداث الخارجية ← المكوّن الخارجي
// ══════════════════════════════════════════════════════════════════════════════
export interface AvatarViewerProps {
  vrmUrl    ?: string;
  height    ?: string | number;
  avatarRef ?: React.Ref<AvatarUltraHandle>;
}

// ══════════════════════════════════════════════════════════════════════════════
//  المكوّن الخارجي — يحمل <Canvas> + <AvatarHumanProUltra>
// ══════════════════════════════════════════════════════════════════════════════
export default function AvatarViewer({
  vrmUrl   = '/models/teach.vrm',
  height   = '520px',
  avatarRef,
}: AvatarViewerProps) {
  // ── Feature flag: only mount when NEXT_PUBLIC_ENABLE_ULTRA_VIEWER=1 AND no canonical renderer ──
  if (typeof window !== 'undefined') {
    const w = window as typeof window & { __ENABLE_ULTRA_VIEWER__?: boolean; __AVATAR_CANONICAL__?: string };
    const enabled = w.__ENABLE_ULTRA_VIEWER__ === true || process.env.NEXT_PUBLIC_ENABLE_ULTRA_VIEWER === '1';
    if (!enabled || w.__AVATAR_CANONICAL__) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Viewer] Disabled (flag off) or canonical renderer present:', w.__AVATAR_CANONICAL__);
      }
      return null as unknown as React.ReactElement;
    }
  }

  const innerRef    = useRef<AvatarUltraHandle>(null);
  const resolvedRef = (avatarRef ?? innerRef) as React.RefObject<AvatarUltraHandle>;

  // ── الاستماع لأحداث window وتوجيهها للأفاتار ──────────────────────────────
  useEffect(() => {
    // حدث الكلام
    const onSpeak = (e: Event) => {
      const d    = (e as CustomEvent).detail;
      // detail can be a plain string (legacy Chat.tsx dispatch) or an object with .text (tts.ts)
      const textStr = typeof d === 'string' ? d : String((d as Record<string, unknown>)?.text ?? '');
      const duration = Math.max(1800, Math.min(10000, textStr.length * 80));
      // Trigger a teaching gesture correlated to speech length.
      // Emotion is NOT set here — it is already dispatched by Chat.tsx via dispatchEmotion()
      // before the speak, so we must not override it with a generic 'encouraging'.
      resolvedRef.current?.triggerGesture('teaching', 0.7, duration);
    };

    // نود طفيف عند استقبال رد
    const onReceived = () => {
      resolvedRef.current?.triggerGesture('wave', 0.5, 700);
    };

    // تحديث المشاعر من أي مصدر
    const onEmotion = (e: Event) => {
      const d = (e as CustomEvent).detail;
      let name: UltraEmotion = 'neutral';
      let intensity = 0.85;

      if (typeof d === 'string') {
        name = EMAP[d.toLowerCase()] ?? 'neutral';
      } else if (d && typeof d === 'object') {
        const raw = d as Record<string, unknown>;
        const key = String(raw.emotion ?? raw.tone ?? '').toLowerCase();
        name      = EMAP[key] ?? 'neutral';
        intensity = Number(raw.intensity ?? intensity);
      }
      resolvedRef.current?.setEmotion(name, intensity, 4000);
    };

    window.addEventListener('avatar:speak',    onSpeak);
    window.addEventListener('chat:received',   onReceived);
    window.addEventListener('avatar:emotion',  onEmotion);
    window.addEventListener('dispatchEmotion', onEmotion);

    return () => {
      window.removeEventListener('avatar:speak',    onSpeak);
      window.removeEventListener('chat:received',   onReceived);
      window.removeEventListener('avatar:emotion',  onEmotion);
      window.removeEventListener('dispatchEmotion', onEmotion);
    };
  }, [resolvedRef]);

  return (
    <div
      style={{
        width: '100%',
        height: typeof height === 'number' ? `${height}px` : height,
        position: 'relative',
        background: 'transparent',
      }}
    >
      <Canvas
        frameloop="always"
        gl={{
          antialias     : true,
          alpha         : true,
          toneMapping   : THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        camera={{ position: [0, -0.15, 1.8], fov: 56, near: 0.01, far: 100 }}
        style={{ width: '100%', height: '100%' }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(0x000000, 0);
          scene.background = null;
        }}
      >
        {/* ── الإضاءة ── */}
        <ambientLight intensity={3.5} />
        <directionalLight position={[1.5, 4, 3]}   intensity={3.5} />
        <directionalLight position={[-2, 1.5, -1]}  intensity={1.8} />
        <pointLight
          position={[0, 2.5, 1.5]}
          intensity={1.0}
          color="#d0efff"
        />

        {/* ── التحكم بالكاميرا ── */}
        <OrbitControls
          target={[0, 1.4, 0]}
          enableZoom
          enablePan={false}
          minDistance={0.8}
          maxDistance={5}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI * 0.72}
        />

        {/* ── الأفاتار البشري ── */}
        <AvatarHumanProUltra ref={resolvedRef} url={vrmUrl} />
      </Canvas>
    </div>
  );
}
