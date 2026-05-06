'use client';

/**
 * Lip-sync and viseme application on the VRM. Reads **read-only** snapshots from
 * {@link useBrainStore#getState} (e.g. `interactionIntent`) each frame for cognitive mouth / sync context;
 * intent updates are driven elsewhere by `processFrame` + `tickIntentBrain` (see useBrainStore module doc).
 */

import React, {
  type MutableRefObject,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { avatarDebug, DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';
import { waitAudioReady as waitForAudioReady } from '@/lib/audio/waitAudioReady';
import { useBrainStore } from '@/store/useBrainStore';
import {
  blendVisemeWithExpression,
  getCognitiveMouthOverlay,
  type MouthShape,
} from '@/app/avatar-agent/motion/facialExpressionBlend';
import { pushVisemeFrame, resetSpeechFusion } from '@/app/avatar-agent/motion/__speechFusion';
import { isObservabilityEnabled } from '@/lib/observability/config';
import { reportLipSyncDriftMs } from '@/lib/observability/audioLipSyncMonitor';
import { getSpeechEmotionSnapshot } from '@/ai/voice/speechEmotionBridge';
import { installUserGestureAudioUnlock } from '@/lib/audio/avatarAudioContext';
import { nowMs as masterClockNowMs, sessionElapsedSec } from '@/lib/avatar/masterClock';
import {
  getActiveAudioElement,
  getPlaybackTimeSec,
  getRawPlaybackTimeSec,
  getUtteranceGeneration,
  getVisemeCues,
  isPlaybackAnchored,
  isWebSpeechLipTimelineActive,
  resetDriftOffset,
} from '@/lib/avatar/audioTimeline';

const TAB_SAFE_MAX_DELTA = 0.1;

/** Prefer HAVE_CURRENT_DATA; when a viseme timeline exists and playback has started, HAVE_METADATA is enough — avoids frozen mouth while the element ramps. */
const AUDIO_READY_MIN = 2;
const AUDIO_READY_FALLBACK = 1;

/**
 * Lip-sync / face sync (ms): prefer NEXT_PUBLIC_FACE_* when set, else NEXT_PUBLIC_TTS_* (same playhead).
 * Positive offset adjusts lip-vs-acoustic framing (Calibration). Defaults: pre-attack 0 (clock-driven sync).
 */
function readEnvOffsetMsPreferFace(): number {
  if (typeof process === 'undefined') return 0;
  const face = process.env.NEXT_PUBLIC_FACE_SYNC_OFFSET_MS;
  if (face !== undefined && face !== '') {
    const n = Number(face);
    if (Number.isFinite(n)) return n;
  }
  const tts = process.env.NEXT_PUBLIC_TTS_SYNC_OFFSET_MS;
  if (tts !== undefined && tts !== '') {
    const n = Number(tts);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Pre-attack was disabled by default: lip timing follows AudioContext-anchored playhead,
 * not a fixed mouth lead (`NEXT_PUBLIC_FACE_PREATTACK_MS` restores optional lead ms).
 */
function readPreattackMsPreferFace(): number {
  const DEFAULT_MS = 0;
  if (typeof process === 'undefined') return DEFAULT_MS;
  const face = process.env.NEXT_PUBLIC_FACE_PREATTACK_MS;
  if (face !== undefined && face !== '') {
    const n = Number(face);
    if (Number.isFinite(n) && n >= 0) return Math.min(150, n);
  }
  const tts = process.env.NEXT_PUBLIC_TTS_MOUTH_PREATTACK_MS;
  if (tts !== undefined && tts !== '') {
    const n = Number(tts);
    if (Number.isFinite(n) && n >= 0) return Math.min(150, n);
  }
  return DEFAULT_MS;
}

/**
 * Optional output/device latency (ms): positive = sound reaches the ear later than
 * `currentTime` suggests — subtract from playhead so lips stay aligned with what is heard.
 */
function readOutputLatencyMsPreferFace(): number {
  if (typeof process === 'undefined') return 0;
  const face = process.env.NEXT_PUBLIC_FACE_OUTPUT_LATENCY_MS;
  if (face !== undefined && face !== '') {
    const n = Number(face);
    if (Number.isFinite(n) && n >= 0) return Math.min(220, n);
  }
  const lip = process.env.NEXT_PUBLIC_LIP_AUDIO_OUTPUT_LATENCY_MS;
  if (lip !== undefined && lip !== '') {
    const n = Number(lip);
    if (Number.isFinite(n) && n >= 0) return Math.min(220, n);
  }
  return 0;
}

const TTS_SYNC_OFFSET_SEC = readEnvOffsetMsPreferFace() / 1000;
const TTS_PREATTACK_SEC = readPreattackMsPreferFace() / 1000;
const TTS_OUTPUT_LATENCY_SEC = readOutputLatencyMsPreferFace() / 1000;

// Effective viseme calibration (the single number applied to audio.currentTime each frame).
// Surfaced on window so devs can verify which env vars are active and tune at runtime.
const EFFECTIVE_VISEME_OFFSET_SEC =
  TTS_SYNC_OFFSET_SEC + TTS_PREATTACK_SEC - TTS_OUTPUT_LATENCY_SEC;
if (typeof window !== 'undefined') {
  (window as Window & {
    __lipSyncCalibration?: {
      syncOffsetMs: number;
      preattackMs: number;
      outputLatencyMs: number;
      effectiveOffsetMs: number;
    };
  }).__lipSyncCalibration = {
    syncOffsetMs: TTS_SYNC_OFFSET_SEC * 1000,
    preattackMs: TTS_PREATTACK_SEC * 1000,
    outputLatencyMs: TTS_OUTPUT_LATENCY_SEC * 1000,
    effectiveOffsetMs: EFFECTIVE_VISEME_OFFSET_SEC * 1000,
  };
}

/**
 * Azure viseme id → VRM mouth morph weights (index 0–21).
 * Frequency bands (analyser) modulate narrow vs rounded blend shapes below.
 */
/** Sibilants / high-frequency energy → narrow (spread front, teeth) */
const SHAPE_NARROW: MouthShape = {
  aa: 0.2,
  ih: 0.55,
  ee: 0.62,
  oh: 0.08,
  ou: 0.05,
};

/** Vowel back / low-frequency emphasis → rounded (O / U) */
const SHAPE_ROUNDED: MouthShape = {
  aa: 0.28,
  ih: 0.12,
  oh: 0.58,
  ou: 0.55,
  ee: 0.1,
};

function lerpMouth(a: MouthShape, b: MouthShape, t: number): MouthShape {
  const u = THREE.MathUtils.clamp(t, 0, 1);
  return {
    aa: THREE.MathUtils.lerp(a.aa, b.aa, u),
    ih: THREE.MathUtils.lerp(a.ih, b.ih, u),
    oh: THREE.MathUtils.lerp(a.oh, b.oh, u),
    ou: THREE.MathUtils.lerp(a.ou, b.ou, u),
    ee: THREE.MathUtils.lerp(a.ee, b.ee, u),
  };
}

function scaleMouth(m: MouthShape, s: number): MouthShape {
  return {
    aa: m.aa * s,
    ih: m.ih * s,
    oh: m.oh * s,
    ou: m.ou * s,
    ee: m.ee * s,
  };
}

/**
 * Map high vs low band energy to [0,1] where 1 ≈ narrow (S/T/Z), 0 ≈ rounded (O/U).
 */
function narrowWeightFromBandEnergies(high: number, low: number): number {
  const sum = high + low + 1e-5;
  const ratio = high / sum;
  return THREE.MathUtils.clamp((ratio - 0.42) * 2.2 + 0.5, 0, 1);
}

function sumByteFrequencyBand(
  buf: Uint8Array,
  hzPerBin: number,
  hzLo: number,
  hzHi: number,
): { sum: number; count: number } {
  const n = buf.length;
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(hzLo / hzPerBin)));
  const i1 = Math.max(0, Math.min(n - 1, Math.ceil(hzHi / hzPerBin)));
  let sum = 0;
  let count = 0;
  for (let i = i0; i <= i1; i++) {
    sum += buf[i];
    count += 1;
  }
  return { sum, count: Math.max(1, count) };
}

const AZURE_VISEME_TO_BLEND: ReadonlyArray<Partial<{ aa: number; ih: number; oh: number; ou: number; ee: number }>> = [
  {},
  { aa: 0.55, oh: 0.15 },
  { aa: 0.90 },
  { aa: 0.40, oh: 0.55 },
  { ee: 0.55, ih: 0.25 },
  { ee: 0.65, ih: 0.15 },
  { ih: 0.45, oh: 0.20 },
  { ih: 0.75 },
  { ee: 0.85, ih: 0.10 },
  { ou: 0.90 },
  { ou: 0.60, oh: 0.30 },
  { aa: 0.45, ou: 0.40 },
  { oh: 0.40, ih: 0.35 },
  { aa: 0.55, ih: 0.30 },
  { aa: 0.12 },
  { ih: 0.30, oh: 0.15 },
  { ih: 0.20, ee: 0.15 },
  { ih: 0.18, aa: 0.08 },
  { ih: 0.12 },
  { aa: 0.10, ih: 0.08 },
  { aa: 0.20, oh: 0.10 },
  {},
];

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

/** VRM / Vroid-style jaw opening — driven by viseme jaw + live audio RMS for believable speech. */
const MOUTH_OPEN_ALIASES = [
  'mouthOpen',
  'mouth',
  'MouthOpen',
  'jawOpen',
  'JawOpen',
] as const;

function applyRmsToMouthOpen(
  em: NonNullable<VRM['expressionManager']>,
  lipRms: number,
  jawVisemeProxy: number,
  blend: number,
): void {
  const rmsTerm = THREE.MathUtils.clamp(lipRms * 12.5, 0, 0.92);
  const jawTerm = THREE.MathUtils.clamp(jawVisemeProxy * 0.55, 0, 0.88);
  const tgt = THREE.MathUtils.clamp(jawTerm * 0.5 + rmsTerm * 0.55, 0, 0.96);
  for (const name of MOUTH_OPEN_ALIASES) {
    const cur = exprGet(em, name);
    exprSet(em, name, THREE.MathUtils.lerp(cur, tgt, blend));
  }
}

function decayMouthOpen(em: NonNullable<VRM['expressionManager']>, spd: number): void {
  for (const name of MOUTH_OPEN_ALIASES) {
    const cur = exprGet(em, name);
    if (cur > 0.002) {
      exprSet(em, name, THREE.MathUtils.lerp(cur, 0, spd));
    }
  }
}

export type VisemeCue = { t: number; id: number };

export type LipSyncManagerProps = {
  vrm: VRM | null;
  isTalkingRef: MutableRefObject<boolean>;
  visemeCueQueueRef: MutableRefObject<VisemeCue[]>;
  audioElementRef: RefObject<HTMLAudioElement | null>;
  analyserRef?: MutableRefObject<AnalyserNode | null>;
};

const ZERO_MOUTH: MouthShape = { aa: 0, ih: 0, oh: 0, ou: 0, ee: 0 };

export default function LipSyncManager({
  vrm,
  isTalkingRef,
  visemeCueQueueRef,
  audioElementRef,
  analyserRef,
}: LipSyncManagerProps): null {
  const timeDomainBufRef = useRef<Float32Array | null>(null);
  const audioBoundRef = useRef<HTMLAudioElement | null>(null);
  const audioEndedHandlerRef = useRef<(() => void) | null>(null);
  const prevTalkingRef = useRef(false);
  const mouthCooldownUntilRef = useRef(0);
  const smoothRef = useRef({ ...ZERO_MOUTH });
  const freqByteBufRef = useRef<Uint8Array | null>(null);
  /** Smoothed 0 = rounded (O/U), 1 = narrow (S/T/Z); lerped each frame to avoid choppy jumps */
  const smoothNarrowWeightRef = useRef(0.5);

  const lastVisemeIdRef = useRef<number>(-2);
  const lastActiveCueTRef = useRef(0);
  const lastDebugLogAtRef = useRef(0);
  const lastLipDriftConsoleAtRef = useRef(0);
  const lastFaceSyncLogAtRef = useRef(0);
  const lastSyncTraceLogAtRef = useRef(0);
  const speechEmphasisRef = useRef(0);
  const lipObsFrameRef = useRef(0);
  const utteranceGenTrackedRef = useRef(-1);

  useEffect(() => {
    installUserGestureAudioUnlock();
  }, []);

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

    const onSpeakStart = async () => {
      try {
        const ctx = analyserRef?.current?.context as AudioContext | undefined;
        if (ctx && ctx.state === 'suspended') await ctx.resume();
      } catch {
        /* */
      }
      const a = audioElementRef.current;
      if (a) {
        await waitForAudioReady(a);
        bindEnded(a);
      }
      resetDriftOffset();
      lastVisemeIdRef.current = -2;
      lastActiveCueTRef.current = 0;
    };

    const onEmphasis = () => {
      speechEmphasisRef.current = Math.min(1, speechEmphasisRef.current + 0.45);
    };

    const initial = audioElementRef.current;
    if (initial) bindEnded(initial);

    const onSpeakEnd = (): void => {
      resetDriftOffset();
      lastVisemeIdRef.current = -2;
      smoothNarrowWeightRef.current = 0.5;
      resetSpeechFusion();
    };

    window.addEventListener('avatar:speak:start', onSpeakStart);
    window.addEventListener('avatar:speak:end', onSpeakEnd);
    window.addEventListener('avatar:speech:emphasis', onEmphasis as EventListener);
    window.addEventListener('avatar:micro:gesture', onEmphasis as EventListener);
    return () => {
      window.removeEventListener('avatar:speak:start', onSpeakStart);
      window.removeEventListener('avatar:speak:end', onSpeakEnd);
      window.removeEventListener('avatar:speech:emphasis', onEmphasis as EventListener);
      window.removeEventListener('avatar:micro:gesture', onEmphasis as EventListener);
      const au = audioBoundRef.current;
      const h = audioEndedHandlerRef.current;
      if (au && h) au.removeEventListener('ended', h);
      audioBoundRef.current = null;
      audioEndedHandlerRef.current = null;
    };
  }, [audioElementRef, isTalkingRef, visemeCueQueueRef, analyserRef]);

  useFrame((_, delta) => {
    const em = vrm?.expressionManager;
    if (!em) return;

    const ug = getUtteranceGeneration();
    if (ug !== utteranceGenTrackedRef.current) {
      utteranceGenTrackedRef.current = ug;
    }

    const talking = isTalkingRef.current;
    const queue = getVisemeCues();
    const webSpeechSynthetic = isWebSpeechLipTimelineActive();
    const timelineAudio = getActiveAudioElement();
    const audioProbe = timelineAudio ?? audioElementRef.current;
    const elementPlayheadProbe = timelineAudio
      ? getRawPlaybackTimeSec()
      : audioProbe && !Number.isNaN(audioProbe.currentTime)
        ? audioProbe.currentTime
        : null;
    if (typeof window !== 'undefined') {
      const playheadProbe =
        webSpeechSynthetic || timelineAudio !== null
          ? getPlaybackTimeSec()
          : elementPlayheadProbe;
      (window as Window & {
        __cogniLipSyncProbe?: {
          talking: boolean;
          visemeCount: number;
          audioCurrentTime: number | null;
          playbackPlayheadSec: number | null;
          playbackAnchored: boolean;
        };
      }).__cogniLipSyncProbe = {
        talking,
        visemeCount: queue.length,
        audioCurrentTime: elementPlayheadProbe,
        playbackPlayheadSec:
          typeof playheadProbe === 'number' && Number.isFinite(playheadProbe) ? playheadProbe : null,
        playbackAnchored: Boolean(timelineAudio && isPlaybackAnchored()),
      };
    }

    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);
    const closeSpd = Math.min(1, safeDelta * 10);

    const nowMs = masterClockNowMs();
    const sm = smoothRef.current;

    const webCtx = analyserRef?.current?.context as AudioContext | undefined;
    if (webCtx?.state === 'suspended') {
      void webCtx.resume();
    }

    speechEmphasisRef.current *= Math.exp(-safeDelta * 4.2);

    if (!talking) {
      if (prevTalkingRef.current) {
        mouthCooldownUntilRef.current = nowMs + 220;
      }
      prevTalkingRef.current = false;

      const inCooldown = nowMs < mouthCooldownUntilRef.current;
      const spd = inCooldown ? closeSpd : Math.min(1, safeDelta * 28);
      sm.aa = THREE.MathUtils.lerp(sm.aa, 0, spd);
      sm.ih = THREE.MathUtils.lerp(sm.ih, 0, spd);
      sm.oh = THREE.MathUtils.lerp(sm.oh, 0, spd);
      sm.ou = THREE.MathUtils.lerp(sm.ou, 0, spd);
      sm.ee = THREE.MathUtils.lerp(sm.ee, 0, spd);
      smoothNarrowWeightRef.current = THREE.MathUtils.lerp(
        smoothNarrowWeightRef.current,
        0.5,
        Math.min(1, safeDelta * 14),
      );
      setMouthKeys(em, sm.aa, sm.ih, sm.oh, sm.ou, sm.ee, 1);
      decayMouthOpen(em, Math.min(1, safeDelta * 16));
      return;
    }
    prevTalkingRef.current = true;

    const audio = timelineAudio ?? audioElementRef.current;
    /** Web Speech path has no decoded media element — ignore mic/RMS analyser tied to stale `<audio>`. */
    const analyser = webSpeechSynthetic ? null : analyserRef?.current ?? null;

    let lipRms = 0;
    let ampMul = 0;
    let freqBlend: MouthShape | null = null;
    if (analyser) {
      const n = analyser.fftSize;
      let td = timeDomainBufRef.current;
      if (!td || td.length !== n) {
        td = new Float32Array(n);
        timeDomainBufRef.current = td;
      }
      analyser.getFloatTimeDomainData(
        td as Parameters<AnalyserNode['getFloatTimeDomainData']>[0],
      );
      let sum = 0;
      for (let i = 0; i < n; i++) sum += td[i] * td[i];
      const rms = Math.sqrt(sum / n);
      lipRms = rms;

      const sr = analyser.context.sampleRate;
      const hzPerBin = sr / analyser.fftSize;
      const fc = analyser.frequencyBinCount;
      if (!freqByteBufRef.current || freqByteBufRef.current.length !== fc) {
        freqByteBufRef.current = new Uint8Array(fc);
      }
      analyser.getByteFrequencyData(
        freqByteBufRef.current as unknown as Uint8Array<ArrayBuffer>,
      );
      const fbuf = freqByteBufRef.current;
      const lowBand = sumByteFrequencyBand(fbuf, hzPerBin, 160, 2400);
      const highBand = sumByteFrequencyBand(fbuf, hzPerBin, 3600, 14000);
      const lowNorm = lowBand.sum / lowBand.count / 255;
      const highNorm = highBand.sum / highBand.count / 255;
      const targetNW = narrowWeightFromBandEnergies(highNorm, lowNorm);
      smoothNarrowWeightRef.current = THREE.MathUtils.lerp(
        smoothNarrowWeightRef.current,
        targetNW,
        Math.min(1, safeDelta * 17),
      );
      ampMul = Math.min(1, lipRms * 5.2);
      freqBlend = scaleMouth(
        lerpMouth(SHAPE_ROUNDED, SHAPE_NARROW, smoothNarrowWeightRef.current),
        ampMul,
      );
    }

    /** All cue times are **seconds** (API contract); no LipSync-side unit heuristic. */
    const cueTSec = (c: { t: number }) => c.t;

    const audioReady =
      (webSpeechSynthetic && queue.length > 0) ||
      (!webSpeechSynthetic &&
        !!audio &&
        !Number.isNaN(audio.currentTime) &&
        audio.currentTime >= 0 &&
        (audio.readyState >= AUDIO_READY_MIN ||
          (queue.length > 0 && !audio.paused && audio.readyState >= AUDIO_READY_FALLBACK)));

    /** Lip sync playhead = audio time + sync offset + optional pre-attack (cue lookup). */
    const VISEME_ANTICIPATION_SEC = 0;

    let tgtAa = 0;
    let tgtIh = 0;
    let tgtOh = 0;
    let tgtOu = 0;
    let tgtEe = 0;

    let tSec = 0;
    if (audioReady) {
      const decodeSec = webSpeechSynthetic
        ? getPlaybackTimeSec()
        : timelineAudio !== null
          ? getPlaybackTimeSec()
          : (audio!.currentTime ?? 0);
      tSec = Math.max(
        0,
        decodeSec -
          VISEME_ANTICIPATION_SEC +
          TTS_SYNC_OFFSET_SEC +
          TTS_PREATTACK_SEC -
          TTS_OUTPUT_LATENCY_SEC,
      );
    }

    /** Viseme timeline is authoritative: no analyser / fake mouth before audio is ready. */
    if (queue.length > 0 && !audioReady) {
      tgtAa = 0;
      tgtIh = 0;
      tgtOh = 0;
      tgtOu = 0;
      tgtEe = 0;
    } else if (queue.length > 0 && audioReady) {
      let visemeId = -1;
      let nextVisemeId = -1;
      let nextVisemeT = Infinity;
      let activeCueIndex = -1;

      for (let i = queue.length - 1; i >= 0; i--) {
        const cue = queue[i];
        const ct = cueTSec(cue);
        if (ct <= tSec) {
          visemeId = cue.id;
          activeCueIndex = i;
          break;
        }
        if (ct < nextVisemeT) {
          nextVisemeT = ct;
          nextVisemeId = cue.id;
        }
      }

      if (visemeId >= 0 && activeCueIndex >= 0) {
        if (visemeId !== lastVisemeIdRef.current) {
          lastVisemeIdRef.current = visemeId;
        }
      }

      if (activeCueIndex >= 0) {
        lastActiveCueTRef.current = cueTSec(queue[activeCueIndex]);
      }

      if (visemeId < 0) {
        const warmupRatio = Math.min(1, tSec / Math.max(0.01, nextVisemeT));
        tgtAa = warmupRatio * 0.12;
      } else {
        const safeId = Math.max(0, Math.min(AZURE_VISEME_TO_BLEND.length - 1, visemeId));
        const row = AZURE_VISEME_TO_BLEND[safeId];
        if (row && Object.keys(row).length > 0) {
          tgtAa = row.aa ?? 0;
          tgtIh = row.ih ?? 0;
          tgtOh = row.oh ?? 0;
          tgtOu = row.ou ?? 0;
          tgtEe = row.ee ?? 0;

          /* Ease toward next viseme in-window — reduces stepped transitions (Azure cues are discrete). */
          if (activeCueIndex + 1 < queue.length) {
            const nextC = queue[activeCueIndex + 1];
            const curT = cueTSec(queue[activeCueIndex]);
            const nextT = cueTSec(nextC);
            if (nextT > curT + 1e-4 && tSec >= curT && tSec < nextT) {
              const span = nextT - curT;
              let u = (tSec - curT) / span;
              u = u * u * (3 - 2 * u);
              const uBlend = u * 0.42;
              const nid = Math.max(0, Math.min(AZURE_VISEME_TO_BLEND.length - 1, nextC.id));
              const nr = AZURE_VISEME_TO_BLEND[nid];
              if (nr) {
                tgtAa = THREE.MathUtils.lerp(tgtAa, nr.aa ?? 0, uBlend);
                tgtIh = THREE.MathUtils.lerp(tgtIh, nr.ih ?? 0, uBlend);
                tgtOh = THREE.MathUtils.lerp(tgtOh, nr.oh ?? 0, uBlend);
                tgtOu = THREE.MathUtils.lerp(tgtOu, nr.ou ?? 0, uBlend);
                tgtEe = THREE.MathUtils.lerp(tgtEe, nr.ee ?? 0, uBlend);
              }
            }
          }

          const COART_WINDOW = 0.11;
          if (nextVisemeId >= 0 && nextVisemeT < Infinity) {
            const gap = nextVisemeT - tSec;
            if (gap < COART_WINDOW && gap >= 0) {
              const coartBlend = 1 - gap / COART_WINDOW;
              const nextId = Math.max(0, Math.min(AZURE_VISEME_TO_BLEND.length - 1, nextVisemeId));
              const next = AZURE_VISEME_TO_BLEND[nextId];
              if (next) {
                const k = coartBlend * 0.46;
                tgtAa = THREE.MathUtils.lerp(tgtAa, next.aa ?? 0, k);
                tgtIh = THREE.MathUtils.lerp(tgtIh, next.ih ?? 0, k);
                tgtOh = THREE.MathUtils.lerp(tgtOh, next.oh ?? 0, k);
                tgtOu = THREE.MathUtils.lerp(tgtOu, next.ou ?? 0, k);
                tgtEe = THREE.MathUtils.lerp(tgtEe, next.ee ?? 0, k);
              }
            }
          }
        } else {
          tgtAa = 0.02;
        }
      }
    } else {
      tgtAa = 0;
      tgtIh = 0;
      tgtOh = 0;
      tgtOu = 0;
      tgtEe = 0;
    }

    /** Blend viseme-driven mouth with frequency-weighted narrow/rounded shape (smooth lerp, no single-axis jaw). */
    if (freqBlend && audioReady) {
      const maxCueT =
        queue.length > 0 ? queue.reduce((m, c) => Math.max(m, cueTSec(c)), 0) : 0;
      const tailPastCue = queue.length > 0 && tSec > maxCueT + 0.04;
      let accent: number;
      if (queue.length === 0) {
        accent = lipRms > 0.002 ? 1 : 0;
      } else if (tailPastCue) {
        accent = lipRms > 0.001 ? 0.9 : 0.2;
      } else {
        accent = 0.11 + 0.29 * ampMul;
      }
      if (accent > 0) {
        const vis: MouthShape = {
          aa: tgtAa,
          ih: tgtIh,
          oh: tgtOh,
          ou: tgtOu,
          ee: tgtEe,
        };
        const merged = lerpMouth(vis, freqBlend, accent);
        tgtAa = merged.aa;
        tgtIh = merged.ih;
        tgtOh = merged.oh;
        tgtOu = merged.ou;
        tgtEe = merged.ee;
      }
    }

    /**
     * Exponential smoothing toward targets (time constants in seconds) so blend rate matches `delta`,
     * not a fixed per-frame fraction — stable across 30/60/120 Hz and tab throttling.
     */
    const blendChannel = (cur: number, tgt: number) => {
      const releasing = tgt < cur * 0.88 && cur > 0.18;
      const tauSec = tgt >= cur ? 0.042 : releasing ? 0.068 : 0.055;
      const k = 1 - Math.exp(-safeDelta / tauSec);
      return THREE.MathUtils.lerp(cur, tgt, Math.min(1, k));
    };

    sm.aa = blendChannel(sm.aa, tgtAa);
    sm.ih = blendChannel(sm.ih, tgtIh);
    sm.oh = blendChannel(sm.oh, tgtOh);
    sm.ou = blendChannel(sm.ou, tgtOu);
    sm.ee = blendChannel(sm.ee, tgtEe);

    const brain = useBrainStore.getState();
    const pad = brain.pad;
    const speechSnap = getSpeechEmotionSnapshot();
    const emotionForOverlay = speechSnap
      ? String(speechSnap.emotion)
      : String(brain.emotionLabel ?? 'neutral');
    const emotionIntensity = speechSnap
      ? THREE.MathUtils.clamp(speechSnap.intensity, 0.28, 1)
      : THREE.MathUtils.clamp(0.42 + (pad?.arousal ?? 0) * 0.35, 0.25, 1);
    const vis: MouthShape = { aa: sm.aa, ih: sm.ih, oh: sm.oh, ou: sm.ou, ee: sm.ee };
    const expr = getCognitiveMouthOverlay({
      interactionIntent: brain.interactionIntent,
      emotion: emotionForOverlay,
      emotionIntensity,
      speechEmphasis: speechEmphasisRef.current,
    });
    const blended = blendVisemeWithExpression(vis, expr);
    const lipStyle = brain.intentBrain.speechStyle.expressiveness;
    const lipInt = brain.cognitiveAvatarBrain.speechStyle.intensity;
    const styleMul = THREE.MathUtils.clamp(
      0.78 + 0.28 * lipStyle * (0.82 + 0.22 * lipInt),
      0.72,
      1.14,
    );
    const out = {
      aa: blended.aa * styleMul,
      ih: blended.ih * styleMul,
      oh: blended.oh * styleMul,
      ou: blended.ou * styleMul,
      ee: blended.ee * styleMul,
    };

    if (DEBUG_AVATAR && audio && audioReady && nowMs - lastDebugLogAtRef.current > 1500) {
      lastDebugLogAtRef.current = nowMs;
      const cueT = lastActiveCueTRef.current;
      const visemeTime = tSec;
      const driftMs =
        queue.length > 0 && cueT >= 0 ? Math.round((visemeTime - cueT) * 1000) : 0;
      avatarDebug('[LipSync]', {
        audioContextPlayheadSec: Number(
          (timelineAudio ? getPlaybackTimeSec() : 0).toFixed(4),
        ),
        elementMediaTimeSec: Number(
          (timelineAudio !== null ? getRawPlaybackTimeSec() : audio!.currentTime).toFixed(4),
        ),
        visemeTime: Number(visemeTime.toFixed(4)),
        motionTime: Number(sessionElapsedSec().toFixed(4)),
        driftMs,
        intentState: useBrainStore.getState().interactionIntent,
      });
    }

    if (
      process.env.NEXT_PUBLIC_DEBUG_LIP_DRIFT === 'true'
      && audio
      && audioReady
      && talking
      && nowMs - lastLipDriftConsoleAtRef.current > 400
    ) {
      lastLipDriftConsoleAtRef.current = nowMs;
      const cueT = lastActiveCueTRef.current;
      const decodeForDrift =
        timelineAudio !== null ? getPlaybackTimeSec() : (audio!.currentTime ?? 0);
      const calibratedPlayheadSec =
        Math.max(
          0,
          decodeForDrift + TTS_SYNC_OFFSET_SEC + TTS_PREATTACK_SEC - TTS_OUTPUT_LATENCY_SEC,
        );
      const driftSec =
        queue.length > 0 && cueT >= 0 ? Math.abs(calibratedPlayheadSec - cueT) : 0;
      // eslint-disable-next-line no-console
      console.log({
        calibratedPlayheadSec: Number(calibratedPlayheadSec.toFixed(4)),
        elementMediaSec: Number(
          (timelineAudio !== null ? getRawPlaybackTimeSec() : audio!.currentTime).toFixed(4),
        ),
        visemeCueT: Number(cueT.toFixed(4)),
        driftMs: Math.round(driftSec * 1000),
      });
    }

    if (
      process.env.NEXT_PUBLIC_DEBUG_FACE_SYNC === 'true'
      && talking
      && audio
      && audioReady
      && nowMs - lastFaceSyncLogAtRef.current > 2000
    ) {
      lastFaceSyncLogAtRef.current = nowMs;
      const cueT = lastActiveCueTRef.current;
      const driftMs =
        queue.length > 0 && cueT >= 0 ? Math.round((tSec - cueT) * 1000) : null;
      // eslint-disable-next-line no-console
      console.log('[Face-Sync]', {
        playheadSec: Number(tSec.toFixed(3)),
        cues: queue.length,
        lipRms: Number(lipRms.toFixed(4)),
        driftMs,
      });
    }

    if (isObservabilityEnabled() && talking && audio && audioReady && queue.length > 0) {
      lipObsFrameRef.current += 1;
      if (lipObsFrameRef.current % 14 === 0) {
        const cueT = lastActiveCueTRef.current;
        reportLipSyncDriftMs(Math.abs(tSec - cueT) * 1000);
      }
    }

    // ── [SYNC_TRACE] — explicit audio↔viseme correlation log ──────────────
    // Throttled to 500ms; gated by DEBUG_AVATAR or NEXT_PUBLIC_DEBUG_LIP_DRIFT
    // so production console stays quiet unless the user opts in.
    const syncTraceEnabled =
      DEBUG_AVATAR || process.env.NEXT_PUBLIC_DEBUG_LIP_DRIFT === 'true';
    if (
      syncTraceEnabled &&
      talking &&
      audioReady &&
      queue.length > 0 &&
      nowMs - lastSyncTraceLogAtRef.current > 500
    ) {
      lastSyncTraceLogAtRef.current = nowMs;
      const audioCt = timelineAudio !== null
        ? getRawPlaybackTimeSec()
        : (audio?.currentTime ?? 0);
      const cueT = lastActiveCueTRef.current;
      const driftMs = cueT >= 0 ? Math.round((tSec - cueT) * 1000) : null;
      // eslint-disable-next-line no-console
      console.log('[SYNC_TRACE]', {
        audioTime:     +audioCt.toFixed(3),
        visemeTime:    +tSec.toFixed(3),
        activeViseme:  lastVisemeIdRef.current,
        cueTime:       +cueT.toFixed(3),
        driftMs,
        offsetMs:      Math.round(EFFECTIVE_VISEME_OFFSET_SEC * 1000),
        cuesRemaining: queue.length,
      });
    }

    /** Viseme / jaw targets are independent of torso or arm pose — no skeleton layer clamps mouth weights. */
    setMouthKeys(em, out.aa, out.ih, out.oh, out.ou, out.ee, 1);
    const jawProxy = Math.max(out.aa, out.oh * 0.92, out.ih * 0.45, out.ee * 0.38);
    applyRmsToMouthOpen(em, lipRms, jawProxy, 0.26);

    // ── Push the per-frame viseme magnitude into the speech-fusion bus ───
    // The fusion layer (in VRMSkeletonManager, after the merge) reads the
    // smoothed energy and applies additive head/gesture deltas. Sending the
    // max-of-shapes value mirrors how `jawProxy` represents mouth openness.
    const visemeMag = Math.max(out.aa, out.ih, out.oh, out.ou, out.ee);
    pushVisemeFrame(visemeMag, nowMs);
  }, -1);

  return null;
}
