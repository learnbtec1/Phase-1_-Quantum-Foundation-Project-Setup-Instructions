'use client';

import React, {
  type MutableRefObject,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

const TAB_SAFE_MAX_DELTA = 0.1;

/**
 * Azure viseme id → VRM mouth morph weights.
 * Index = Azure viseme ID (0–21).
 * Improved mapping: ou/ee now written directly (not folded into oh).
 *
 * Azure viseme reference:
 *  0  = silence        9  = uw (boot)    17 = θ/ð (that)
 *  1  = ae/ax/ah       10 = ow (go)      18 = f/v
 *  2  = aa (father)    11 = aw (found)   19 = d/t/n/l
 *  3  = ao (ought)     12 = oy (boy)     20 = k/g/ng
 *  4  = ey (say)       13 = ay (fly)     21 = p/b/m (bilabial — mouth closed)
 *  5  = eh (red)       14 = h
 *  6  = er (butter)    15 = r
 *  7  = ih (it)        16 = s/z
 *  8  = iy (feel)
 */
const AZURE_VISEME_TO_BLEND: ReadonlyArray<Partial<{ aa: number; ih: number; oh: number; ou: number; ee: number }>> = [
  // 0  silence
  {},
  // 1  ae/ax/ah — open, slightly back
  { aa: 0.55, oh: 0.15 },
  // 2  aa — wide open /a/
  { aa: 0.90 },
  // 3  ao — rounded open /ɔ/
  { aa: 0.40, oh: 0.55 },
  // 4  ey — mid-front /eɪ/
  { ee: 0.55, ih: 0.25 },
  // 5  eh — mid /ɛ/
  { ee: 0.65, ih: 0.15 },
  // 6  er — central rhoticised
  { ih: 0.45, oh: 0.20 },
  // 7  ih — near-close /ɪ/
  { ih: 0.75 },
  // 8  iy — close front /iː/
  { ee: 0.85, ih: 0.10 },
  // 9  uw — close back rounded /uː/
  { ou: 0.90 },
  // 10 ow — mid-back /oʊ/
  { ou: 0.60, oh: 0.30 },
  // 11 aw — open-back rounded /aʊ/ — transition a→u
  { aa: 0.45, ou: 0.40 },
  // 12 oy — open-back → front /ɔɪ/
  { oh: 0.40, ih: 0.35 },
  // 13 ay — open → front /aɪ/
  { aa: 0.55, ih: 0.30 },
  // 14 h — very slight opening
  { aa: 0.12 },
  // 15 r — retroflex, semi-closed
  { ih: 0.30, oh: 0.15 },
  // 16 s/z — teeth together, minimal opening
  { ih: 0.20, ee: 0.15 },
  // 17 θ/ð — tongue between teeth
  { ih: 0.18, aa: 0.08 },
  // 18 f/v — labiodental
  { ih: 0.12 },
  // 19 d/t/n/l — alveolar, slight opening
  { aa: 0.10, ih: 0.08 },
  // 20 k/g/ng — velar, mouth partially open
  { aa: 0.20, oh: 0.10 },
  // 21 p/b/m — bilabial closure, mouth closed
  {},
];

type FreqBufRef = MutableRefObject<Uint8Array | null>;

/**
 * Read mouth energy from Web Audio analyser.
 * With fftSize=512 (set in wireAnalyser), bins[0..31] = 0–250Hz (voiced speech fundamentals).
 * We weight lower bins more heavily to track lip-open better.
 */
function readAnalyserMouth(analyser: AnalyserNode, freqBufRef: FreqBufRef): { aa: number; oh: number; ih: number } {
  const n = analyser.frequencyBinCount;
  let buf = freqBufRef.current;
  if (!buf || buf.length !== n) {
    buf = new Uint8Array(n);
    freqBufRef.current = buf;
  }
  analyser.getByteFrequencyData(buf as Parameters<AnalyserNode['getByteFrequencyData']>[0]);

  // Use first 20 bins (0–~1kHz) with weighted emphasis on voiced speech range
  let lowEnergy = 0;
  let midEnergy = 0;
  const totalBins = Math.min(n, 40);
  for (let i = 0; i < totalBins; i++) {
    const v = buf[i] ?? 0;
    const weight = i < 10 ? 1.8 : i < 20 ? 1.2 : 0.6;
    if (i < 20) lowEnergy += v * weight;
    else midEnergy += v;
  }
  const normLow = Math.min(1, lowEnergy / (20 * 255 * 1.2));
  const normMid = Math.min(1, midEnergy / (20 * 255));

  // Mouth open (aa), rounded (oh), smile-like narrow (ih)
  return {
    aa: normLow * 0.72,
    oh: normMid * 0.28,
    ih: normLow * normMid * 0.18,
  };
}

function exprGet(em: VRM['expressionManager'], name: string): number {
  if (!em) return 0;
  try {
    const g = (em as { getValue?: (n: string) => number }).getValue;
    if (typeof g === 'function') return g.call(em, name) ?? 0;
  } catch {
    /* */
  }
  return 0;
}

function exprSet(em: NonNullable<VRM['expressionManager']>, name: string, v: number) {
  try {
    em.setValue(name as never, v);
  } catch {
    /* */
  }
}

function setMouthKeys(
  em: NonNullable<VRM['expressionManager']>,
  aa: number,
  ih: number,
  oh: number,
  ou: number,
  ee: number,
  lipSpd: number,
) {
  const pairs: [readonly string[], number][] = [
    [['aa', 'A'] as const, aa],
    [['ih', 'I'] as const, ih],
    [['oh', 'O'] as const, oh],
    [['ou', 'U'] as const, ou],
    [['ee', 'E'] as const, ee],
  ];
  for (const [keys, tgt] of pairs) {
    for (const k of keys) {
      const c = exprGet(em, k);
      exprSet(em, k, THREE.MathUtils.lerp(c, tgt, lipSpd));
    }
  }
}

export type VisemeCue = { t: number; id: number };

export type LipSyncManagerProps = {
  vrm: VRM | null;
  isTalkingRef: MutableRefObject<boolean>;
  /** Cues with `t` in seconds from utterance start (align with audio.currentTime when using audio). */
  visemeCueQueueRef: MutableRefObject<VisemeCue[]>;
  audioElementRef: RefObject<HTMLAudioElement | null>;
  /** Optional Web Audio analyser (e.g. destination → analyser); drives mouth from band energy when no viseme match. */
  analyserRef?: MutableRefObject<AnalyserNode | null>;
};

/**
 * شفاه من viseme queue و/أو AnalyserNode — بدون sin وهمي.
 * يعمل قبل vrm.update (useFrame -1) لضبط التعبيرات؛ الهيكل يحدّث لاحقاً عند 0.
 */
export default function LipSyncManager({
  vrm,
  isTalkingRef,
  visemeCueQueueRef,
  audioElementRef,
  analyserRef,
}: LipSyncManagerProps): null {
  const speakAnchorMsRef = useRef(0);
  const freqBufRef = useRef<Uint8Array | null>(null);
  const audioBoundRef = useRef<HTMLAudioElement | null>(null);
  const audioEndedHandlerRef = useRef<(() => void) | null>(null);
  const prevTalkingRef = useRef(false);
  const mouthCooldownUntilRef = useRef(0);
  /** Smoothed current mouth weights — prevents snap when viseme changes quickly */
  const smoothRef = useRef({ aa: 0, ih: 0, oh: 0, ou: 0, ee: 0 });
  /**
   * Unit guard: auto-detect if viseme cue `t` values are in ms (> 300 = impossible seconds).
   * Caches result per utterance to avoid per-frame branching.
   */
  const visemeUnitCheckedRef = useRef(false);
  const visemeIsMs = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bindEnded = (audio: HTMLAudioElement) => {
      const prev = audioBoundRef.current;
      const prevH = audioEndedHandlerRef.current;
      if (prev && prevH) {
        prev.removeEventListener('ended', prevH);
      }
      const onEnded = () => {
        isTalkingRef.current = false;
        visemeCueQueueRef.current = [];
      };
      audioBoundRef.current = audio;
      audioEndedHandlerRef.current = onEnded;
      audio.addEventListener('ended', onEnded);
    };

    const onSpeakStart = () => {
      speakAnchorMsRef.current = performance.now();
      const a = audioElementRef.current;
      if (a) bindEnded(a);
    };

    const initial = audioElementRef.current;
    if (initial) bindEnded(initial);

    window.addEventListener('avatar:speak:start', onSpeakStart);
    return () => {
      window.removeEventListener('avatar:speak:start', onSpeakStart);
      const a = audioBoundRef.current;
      const h = audioEndedHandlerRef.current;
      if (a && h) a.removeEventListener('ended', h);
      audioBoundRef.current = null;
      audioEndedHandlerRef.current = null;
    };
  }, [audioElementRef, isTalkingRef, visemeCueQueueRef]);

  useFrame((_, delta) => {
    const em = vrm?.expressionManager;
    if (!em) return;

    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);
    // Two speeds: fast approach (16 steps/s) for viseme snapping, slow decay for smooth closing
    const lipSpd  = Math.min(1, safeDelta * 16);
    const closeSpd = Math.min(1, safeDelta * 10); // ~100ms fade to closed

    const talking = isTalkingRef.current;
    const nowMs = performance.now();
    const sm = smoothRef.current;

    // ── Mouth closing: smooth fade when not speaking ───────────────────────
    if (!talking) {
      if (prevTalkingRef.current) {
        // Just stopped talking: start cooldown window for smooth fade-out
        mouthCooldownUntilRef.current = nowMs + 220;
      }
      prevTalkingRef.current = false;

      const inCooldown = nowMs < mouthCooldownUntilRef.current;
      const spd = inCooldown ? closeSpd : Math.min(1, safeDelta * 28); // slower during cooldown
      sm.aa = THREE.MathUtils.lerp(sm.aa, 0, spd);
      sm.ih = THREE.MathUtils.lerp(sm.ih, 0, spd);
      sm.oh = THREE.MathUtils.lerp(sm.oh, 0, spd);
      sm.ou = THREE.MathUtils.lerp(sm.ou, 0, spd);
      sm.ee = THREE.MathUtils.lerp(sm.ee, 0, spd);
      setMouthKeys(em, sm.aa, sm.ih, sm.oh, sm.ou, sm.ee, 1);
      return;
    }
    prevTalkingRef.current = true;

    const audio = audioElementRef.current;
    const queue = visemeCueQueueRef.current;
    const analyser = analyserRef?.current ?? null;

    // ── Auto-detect viseme time unit once per utterance ──────────────────────
    if (queue.length > 0 && !visemeUnitCheckedRef.current) {
      visemeUnitCheckedRef.current = true;
      const maxT = queue.reduce((m, c) => Math.max(m, c.t), 0);
      // If any t > 300, they must be in ms (a 300-second utterance is absurd)
      visemeIsMs.current = maxT > 300;
      if (visemeIsMs.current && process.env.NODE_ENV === 'development') {
        console.warn('[LipSyncManager] ⚠ Viseme cues appear to be in ms — auto-converting to seconds');
      }
    }
    if (queue.length === 0) {
      visemeUnitCheckedRef.current = false;
      visemeIsMs.current = false;
    }
    /** Convert cue time to seconds for comparison with audio.currentTime */
    const cueTSec = (c: { t: number }) => visemeIsMs.current ? c.t / 1000 : c.t;

    let tgtAa = 0;
    let tgtIh = 0;
    let tgtOh = 0;
    let tgtOu = 0;
    let tgtEe = 0;

    // ── Determine audio playhead ────────────────────────────────────────────
    let tSec = 0;
    if (audio && !Number.isNaN(audio.currentTime) && audio.currentTime > 0) {
      tSec = audio.currentTime;
    } else {
      tSec = (nowMs - speakAnchorMsRef.current) / 1000;
    }

    // ── Viseme lookup: find last cue at or before playhead, with next-cue coarticulation ──
    if (queue.length > 0) {
      let visemeId = -1;
      let nextVisemeId = -1;
      let nextVisemeT = Infinity;

      for (let i = queue.length - 1; i >= 0; i--) {
        const cue = queue[i];
        const ct = cueTSec(cue);
        if (ct <= tSec) {
          visemeId = cue.id;
          break;
        }
        if (ct < nextVisemeT) {
          nextVisemeT = ct;
          nextVisemeId = cue.id;
        }
      }

      if (visemeId < 0) {
        // Before first cue: ease open gently toward first viseme
        const warmupRatio = Math.min(1, tSec / Math.max(0.01, nextVisemeT));
        tgtAa = warmupRatio * 0.15;
      } else {
        const safeId = Math.max(0, Math.min(AZURE_VISEME_TO_BLEND.length - 1, visemeId));
        const row = AZURE_VISEME_TO_BLEND[safeId];
        if (row && Object.keys(row).length > 0) {
          tgtAa = row.aa ?? 0;
          tgtIh = row.ih ?? 0;
          tgtOh = row.oh ?? 0;
          tgtOu = row.ou ?? 0;
          tgtEe = row.ee ?? 0;

          // ── Coarticulation: blend toward next viseme in a 80ms anticipation window ──
          const COART_WINDOW = 0.08;
          if (nextVisemeId >= 0 && nextVisemeT < Infinity) {
            const gap = nextVisemeT - tSec;
            if (gap < COART_WINDOW && gap >= 0) {
              const coartBlend = 1 - gap / COART_WINDOW;
              const nextId = Math.max(0, Math.min(AZURE_VISEME_TO_BLEND.length - 1, nextVisemeId));
              const next = AZURE_VISEME_TO_BLEND[nextId];
              if (next) {
                tgtAa = THREE.MathUtils.lerp(tgtAa, next.aa ?? 0, coartBlend * 0.45);
                tgtIh = THREE.MathUtils.lerp(tgtIh, next.ih ?? 0, coartBlend * 0.45);
                tgtOh = THREE.MathUtils.lerp(tgtOh, next.oh ?? 0, coartBlend * 0.45);
                tgtOu = THREE.MathUtils.lerp(tgtOu, next.ou ?? 0, coartBlend * 0.45);
                tgtEe = THREE.MathUtils.lerp(tgtEe, next.ee ?? 0, coartBlend * 0.45);
              }
            }
          }
        } else if (analyser) {
          // Silence viseme (0, 21) — use analyser as gentle life signal
          const mOut = readAnalyserMouth(analyser, freqBufRef);
          tgtAa = mOut.aa * 0.30; // dampen — silence = mostly closed
          tgtIh = mOut.ih * 0.15;
        } else {
          // Silence viseme, no analyser — very small baseline to avoid frozen look
          tgtAa = 0.05;
        }
      }
    } else if (analyser) {
      // No viseme queue — drive from audio energy (analyser path)
      const mOut = readAnalyserMouth(analyser, freqBufRef);
      tgtAa = mOut.aa;
      tgtOh = mOut.oh;
      tgtIh = mOut.ih;
    } else {
      // Absolute fallback: visible baseline motion when nothing else is available.
      // Use a subtle sine modulation so mouth doesn't look completely frozen.
      const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      tgtAa = 0.08 + Math.sin(nowSec * 6.5) * 0.04; // 6.5 Hz ≈ natural speech rate
      tgtIh = 0.04 + Math.abs(Math.sin(nowSec * 5.1)) * 0.03;
    }

    // ── Smooth toward targets (prevents hard snapping between visemes) ──────
    sm.aa = THREE.MathUtils.lerp(sm.aa, tgtAa, lipSpd);
    sm.ih = THREE.MathUtils.lerp(sm.ih, tgtIh, lipSpd);
    sm.oh = THREE.MathUtils.lerp(sm.oh, tgtOh, lipSpd);
    sm.ou = THREE.MathUtils.lerp(sm.ou, tgtOu, lipSpd);
    sm.ee = THREE.MathUtils.lerp(sm.ee, tgtEe, lipSpd);

    setMouthKeys(em, sm.aa, sm.ih, sm.oh, sm.ou, sm.ee, 1);
  }, -1);

  return null;
}
