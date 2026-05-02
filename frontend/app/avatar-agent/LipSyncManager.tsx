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
import { AVATAR_BEHAVIOR_SINGLE_CONTROLLER } from '@/config/avatar';
import {
  blendVisemeWithExpression,
  getCognitiveMouthOverlay,
  type MouthShape,
} from '@/app/avatar-agent/motion/facialExpressionBlend';
import { isObservabilityEnabled } from '@/lib/observability/config';
import { reportLipSyncDriftMs } from '@/lib/observability/audioLipSyncMonitor';
import {
  cogniMetricsRecordMorphDelta,
  cogniMetricsResetMorphWindow,
} from '@/lib/observability/cogniMetrics';
import {
  installAudioPerfWindowBridge,
  LIPSYNC_TIMING_SMOOTH_WINDOW_SEC,
  recordFrameTickForPerf,
} from '@/lib/performance/audioPerformance';
import {
  getSpeechEmotionSnapshot,
  patchSpeechEmotionEnergy,
} from '@/ai/voice/speechEmotionBridge';
import { installUserGestureAudioUnlock } from '@/lib/audio/avatarAudioContext';
import { nowMs as masterClockNowMs, sessionElapsedSec } from '@/lib/avatar/masterClock';
import {
  getActiveAudioElement,
  getDriftOffsetSec,
  getPlaybackTimeSec,
  getTimelineSource,
  getUtteranceGeneration,
  getVisemeCues,
  healDriftTowardZero,
  resetDriftOffset,
  syncPlaybackClockForLip,
} from '@/lib/avatar/audioTimeline';
import {
  getCorrectedTime,
  getDynamicLatencyOffsetMs,
  getDynamicLatencyOffsetSec,
} from '@/lib/audio/audioLatencySync';

/** DevTools / automation: lip-sync vital signs — check after TTS playback. `morphFingerprint` Δ proves morph output. */
export type CogniLipSyncProbe = {
  ts: number;
  phase: 'idle' | 'active';
  talking: boolean;
  utteranceGeneration: number;
  timelineSource: ReturnType<typeof getTimelineSource>;
  visemeCount: number;
  timelineCueStoreCount: number;
  audioPaused: boolean | null;
  audioReady: boolean;
  /** playhead binding: timeline module owns element when WS/HTTP path bound */
  hasTimelineAudio: boolean;
  /** last applied RMS damping (1 = cues at full strength) */
  visemePowerApplied: number;
  morphFingerprint: number;
  morphFingerprintDelta: number;
  lipRms: number;
  audioCurrentTime: number | null;
  /** cues + advancing playhead ⇒ RMS/freq overlay bypass */
  playbackDominant: boolean;
};

/** Closed-loop probe: latency + drift + energy alignment (`window.__cogniLipSyncAdvancedProbe`). */
export type CogniLipSyncAdvancedProbe = {
  ts: number;
  /** Seconds: `audio.currentTime` + dynamic latency offset (`getCorrectedTime`). */
  correctedTimeSec: number;
  /** Alias for tooling: same as {@link CogniLipSyncAdvancedProbe.correctedTimeSec}. */
  correctedTime: number;
  driftAppliedMs: number;
  /** Alias for {@link CogniLipSyncAdvancedProbe.driftAppliedMs}. */
  driftApplied: number;
  latencyOffsetMs: number;
  /** Alias for {@link CogniLipSyncAdvancedProbe.latencyOffsetMs}. */
  latencyOffset: number;
  morphDelta: number;
  visemeShiftAppliedMs: number;
  /** Alias for {@link CogniLipSyncAdvancedProbe.visemeShiftAppliedMs}. */
  visemeShiftApplied: number;
  playbackDominant: boolean;
  rawAudioTimeSec: number | null;
};

const TAB_SAFE_MAX_DELTA = 1 / 58;

/** Keep cue playhead within ~±30ms of element clock during timeline-bound speech (plus preattack headroom). */
const LIP_MEDIA_LOCK_SEC = 0.03;
/** Production viseme shape blend — micro-smoothing without mushy lag. */
const VISEME_PRODUCTION_LERP = 0.25;
/** Ignore sub-threshold target hops to reduce mouth flicker. */
const MORPH_IGNORE_EPS = 0.012;

/** Prefer HAVE_CURRENT_DATA; when a viseme timeline exists and playback has started, HAVE_METADATA is enough — avoids frozen mouth while the element ramps. */
const AUDIO_READY_MIN = 2;
const AUDIO_READY_FALLBACK = 1;

/**
 * Lip-sync / face sync (ms): prefer NEXT_PUBLIC_FACE_* when set, else NEXT_PUBLIC_TTS_* (same playhead).
 * Positive offset delays lip vs audio (e.g. 80–120). Pre-attack advances cue lookup (~50 ms).
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
 * Pre-attack (ms): advance viseme lookup vs `audio.currentTime` so the mouth leads
 * the acoustic peak slightly (~50 ms default). Env overrides; set to 0 to disable.
 */
function readPreattackMsPreferFace(): number {
  const DEFAULT_MS = 50;
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

/** RMS → viseme strength (power damping); tune with lip level in browser. */
const LIP_RMS_SILENCE = 0.0026;
const LIP_RMS_SENS = 5.6;

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
  const visemeUnitCheckedRef = useRef(false);
  const visemeIsMs = useRef(false);

  const lastVisemeIdRef = useRef<number>(-2);
  const lastActiveCueTRef = useRef(0);
  const lastDebugLogAtRef = useRef(0);
  const lastLipDriftConsoleAtRef = useRef(0);
  const lastFaceSyncLogAtRef = useRef(0);
  const speechEmphasisRef = useRef(0);
  const lipObsFrameRef = useRef(0);
  const utteranceGenTrackedRef = useRef(-1);
  /** Prior frame summed mouth weights — validates morph output is updating. */
  const morphFingerprintPrevRef = useRef(0);
  /** Smoothed viseme playhead (sec) — damps `currentTime`/decode jitter vs cue grid. */
  const playheadSmoothRef = useRef(0);
  /** ±30 ms extra smoothing baseline (adapted live for speech tempo). */
  const playheadExtraSmoothRef = useRef(0);
  const lipRmsPrevPeakRef = useRef(0);
  /** Audio-energy alignment vs cues (bounded ±20 ms applied to cue lookup clock). */
  const visemePeakAlignAccumRef = useRef(0);
  const playheadSmoothGenRef = useRef(-1);
  /** Prior-frame raw viseme targets — deadband / stability. */
  const mouthTgtPrevRef = useRef({ ...ZERO_MOUTH });
  /** Throttled speech-time micro gesture (blink / gaze). */
  const speechMicroAccRef = useRef(0);
  const speechMicroNextRef = useRef(2.1 + Math.random() * 0.8);
  /** Micro-smoothed viseme targets (`lerp` layer before blendChannel). */
  const visemeProductionSmoothRef = useRef({ ...ZERO_MOUTH });

  useEffect(() => {
    installUserGestureAudioUnlock();
    installAudioPerfWindowBridge();
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
      visemeUnitCheckedRef.current = false;
      smoothNarrowWeightRef.current = 0.5;
      visemePeakAlignAccumRef.current = 0;
      lipRmsPrevPeakRef.current = 0;
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
    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);
    recordFrameTickForPerf(safeDelta);

    const em = vrm?.expressionManager;
    if (!em) return;

    const ug = getUtteranceGeneration();
    if (ug !== utteranceGenTrackedRef.current) {
      utteranceGenTrackedRef.current = ug;
      visemeUnitCheckedRef.current = false;
      visemeIsMs.current = false;
      playheadSmoothGenRef.current = -1;
      playheadExtraSmoothRef.current = 0;
      visemePeakAlignAccumRef.current = 0;
      lipRmsPrevPeakRef.current = 0;
      cogniMetricsResetMorphWindow();
      mouthTgtPrevRef.current = { ...ZERO_MOUTH };
      visemeProductionSmoothRef.current = { ...ZERO_MOUTH };
      speechMicroAccRef.current = 0;
    }

    const talking = isTalkingRef.current;
    const tc = getVisemeCues();
    const timelineAudio = getActiveAudioElement();
    const audioProbe = timelineAudio ?? audioElementRef.current;
    const qProbe = tc.length > 0 ? tc : visemeCueQueueRef.current;

    const writeProbeIdle = (): void => {
      if (typeof window === 'undefined') return;
      const prevFp = morphFingerprintPrevRef.current;
      const sm = smoothRef.current;
      const idleFp =
        Math.round(((sm.aa + sm.ih + sm.oh + sm.ou + sm.ee) || 0) * 10000);
      morphFingerprintPrevRef.current = idleFp;
      (
        window as Window & {
          __cogniLipSyncProbe?: CogniLipSyncProbe;
        }
      ).__cogniLipSyncProbe = {
        ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        phase: 'idle',
        talking,
        utteranceGeneration: getUtteranceGeneration(),
        timelineSource: getTimelineSource(),
        visemeCount: qProbe.length,
        timelineCueStoreCount: tc.length,
        audioPaused: audioProbe ? audioProbe.paused : null,
        audioReady:
          !!(audioProbe && audioProbe.readyState >= AUDIO_READY_FALLBACK && !Number.isNaN(audioProbe.currentTime)),
        hasTimelineAudio: !!timelineAudio,
        visemePowerApplied: 1,
        morphFingerprint: idleFp,
        morphFingerprintDelta: Math.abs(idleFp - prevFp),
        lipRms: 0,
        audioCurrentTime:
          audioProbe && !Number.isNaN(audioProbe.currentTime)
            ? audioProbe.currentTime
            : null,
        playbackDominant: false,
      };
    };

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
      writeProbeIdle();
      return;
    }
    prevTalkingRef.current = true;

    const audio = timelineAudio ?? audioElementRef.current;
    const queue = tc.length > 0 ? tc : visemeCueQueueRef.current;
    const analyser = analyserRef?.current ?? null;

    if (queue.length > 0 && !visemeUnitCheckedRef.current) {
      visemeUnitCheckedRef.current = true;
      const maxT = queue.reduce((m, c) => Math.max(m, c.t), 0);
      visemeIsMs.current = maxT > 300;
      if (visemeIsMs.current && process.env.NODE_ENV === 'development') {
        console.warn('[LipSyncManager] Viseme cues appear to be in ms — auto-converting to seconds');
      }
    }
    if (queue.length === 0) {
      visemeUnitCheckedRef.current = false;
      visemeIsMs.current = false;
    }
    const cueTSec = (c: { t: number }) => (visemeIsMs.current ? c.t / 1000 : c.t);

    const audioReady =
      !!audio &&
      !Number.isNaN(audio.currentTime) &&
      audio.currentTime >= 0 &&
      (audio.readyState >= AUDIO_READY_MIN ||
        (queue.length > 0 && !audio.paused && audio.readyState >= AUDIO_READY_FALLBACK));

    /** Feed closed-loop latency engine before reading timeline playhead (seconds-domain). */
    syncPlaybackClockForLip(analyser?.context as AudioContext | undefined);

    /** HTTP/WS cue paths: playback + cues ⇒ full cue strength (skip RMS attenuation & analyser-blend takeover). */
    const playbackDominant =
      !!(audio && !audio.paused && queue.length > 0 && audioReady);

    /** Broader gate: freeze / RMS must not mute timeline when `talking` + cues + element is advancing. */
    const authoritativeCuePlayback =
      playbackDominant ||
      !!(talking && queue.length > 0 && audio && !audio.paused && String(audio.src || '').length > 8);

    let lipRms = 0;
    let ampMul = 0;
    let freqBlend: MouthShape | null = null;
    let lipRmsPeak = 0;
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
      lipRmsPeak = rms;
      lipRms = authoritativeCuePlayback ? 0 : rms;
      patchSpeechEmotionEnergy(Math.min(1, lipRmsPeak * 4.5));

      if (!authoritativeCuePlayback) {
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
    }

    let tgtAa = 0;
    let tgtIh = 0;
    let tgtOh = 0;
    let tgtOu = 0;
    let tgtEe = 0;

    let tSec = 0;
    let advancedProbeForWindow: CogniLipSyncAdvancedProbe | null = null;
    const VISEME_ANTICIPATION_SEC = 0;

    if (audioReady && audio) {
      const decodeSec = timelineAudio
        ? getPlaybackTimeSec()
        : Math.max(
            0,
            audio.currentTime + getDriftOffsetSec() + getDynamicLatencyOffsetSec(),
          );

      const syncSecBase = Math.max(
        0,
        decodeSec -
          VISEME_ANTICIPATION_SEC +
          TTS_SYNC_OFFSET_SEC +
          TTS_PREATTACK_SEC -
          TTS_OUTPUT_LATENCY_SEC,
      );

      let durClamp = Infinity;
      if (audio.duration != null && Number.isFinite(audio.duration)) {
        durClamp = Math.max(0.01, audio.duration + 0.06);
      } else if (queue.length > 0) {
        const cueMax = queue.reduce((m, c) => Math.max(m, cueTSec(c)), 0);
        if (Number.isFinite(cueMax)) durClamp = Math.max(cueMax + 0.25, durClamp);
      }

      let adaptiveBaseTauSec = 0.054;
      let adaptiveExtraTauSec = Math.max(0.012, LIPSYNC_TIMING_SMOOTH_WINDOW_SEC);
      if (queue.length >= 4) {
        const gaps: number[] = [];
        const cap = Math.min(queue.length - 1, 44);
        for (let gi = 1; gi <= cap; gi++) {
          gaps.push(
            Math.max(1e-4, cueTSec(queue[gi]!) - cueTSec(queue[gi - 1]!)),
          );
        }
        gaps.sort((a, b) => a - b);
        const medGap = gaps[Math.floor(gaps.length / 2)] ?? 0.068;
        const fastSpeech = medGap < 0.058;
        adaptiveBaseTauSec = fastSpeech ? 0.026 : 0.064;
        adaptiveExtraTauSec = fastSpeech ? 0.007 : Math.max(0.015, LIPSYNC_TIMING_SMOOTH_WINDOW_SEC);
      }
      if (authoritativeCuePlayback) {
        adaptiveBaseTauSec = Math.min(adaptiveBaseTauSec, 0.02);
        adaptiveExtraTauSec = Math.min(adaptiveExtraTauSec, 0.011);
      }

      if (
        authoritativeCuePlayback &&
        queue.length >= 2 &&
        analyser
      ) {
        let nextBoundary = Infinity;
        for (let zi = 0; zi < queue.length; zi++) {
          const ct = cueTSec(queue[zi]!);
          if (ct > syncSecBase + 0.004) {
            nextBoundary = ct;
            break;
          }
        }
        const dist = nextBoundary - syncSecBase;
        if (Number.isFinite(dist) && dist > -0.05 && dist < 0.1) {
          const dv = lipRmsPeak - lipRmsPrevPeakRef.current;
          lipRmsPrevPeakRef.current = lipRmsPeak;
          if (dv > 0.004 && lipRmsPeak > LIP_RMS_SILENCE * 2) {
            visemePeakAlignAccumRef.current -= 0.0032;
          } else if (dv < -0.0035 && dist > 0 && dist < 0.03) {
            visemePeakAlignAccumRef.current += 0.0032;
          }
        } else {
          lipRmsPrevPeakRef.current = lipRmsPeak;
        }
        visemePeakAlignAccumRef.current = THREE.MathUtils.clamp(
          visemePeakAlignAccumRef.current,
          -0.02,
          0.02,
        );
        if (Math.abs(visemePeakAlignAccumRef.current) > 0.006) {
          healDriftTowardZero(visemePeakAlignAccumRef.current * 0.12);
        }
      } else if (!authoritativeCuePlayback) {
        lipRmsPrevPeakRef.current = lipRmsPeak;
      }

      const syncSec = THREE.MathUtils.clamp(
        syncSecBase + visemePeakAlignAccumRef.current,
        0,
        durClamp,
      );
      const anchorPlayheadSec = syncSec;

      let rawPlayhead = THREE.MathUtils.clamp(syncSec, 0, durClamp);

      if (playheadSmoothGenRef.current !== ug) {
        playheadSmoothGenRef.current = ug;
        playheadSmoothRef.current = rawPlayhead;
        playheadExtraSmoothRef.current = rawPlayhead;
      } else {
        let prevSm = playheadSmoothRef.current;
        const drift = rawPlayhead - prevSm;
        const maxStep = Math.max(0.0012, safeDelta * 4.8);
        const maxBack = Math.max(0.0018, safeDelta * 3.9);
        if (drift > maxStep) rawPlayhead = prevSm + maxStep;
        else if (drift < -maxBack) rawPlayhead = prevSm - maxBack;
        prevSm = THREE.MathUtils.lerp(
          prevSm,
          rawPlayhead,
          Math.min(1, 1 - Math.exp(-safeDelta / adaptiveBaseTauSec)),
        );
        playheadSmoothRef.current = THREE.MathUtils.clamp(prevSm, 0, durClamp);
      }
      const basePlayhead = playheadSmoothRef.current;
      playheadExtraSmoothRef.current = THREE.MathUtils.lerp(
        playheadExtraSmoothRef.current,
        basePlayhead,
        Math.min(1, 1 - Math.exp(-safeDelta / adaptiveExtraTauSec)),
      );
      tSec = playheadExtraSmoothRef.current;
      if (
        authoritativeCuePlayback
        && queue.length > 0
        && audio
      ) {
        tSec = THREE.MathUtils.clamp(
          tSec,
          anchorPlayheadSec - LIP_MEDIA_LOCK_SEC,
          anchorPlayheadSec + LIP_MEDIA_LOCK_SEC,
        );
      }

      const ct = getCorrectedTime(audio);
      const driftMs = getDriftOffsetSec() * 1000;
      const latMs = getDynamicLatencyOffsetMs();
      const shiftMs = visemePeakAlignAccumRef.current * 1000;
      advancedProbeForWindow = {
        ts:
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now(),
        correctedTimeSec: ct,
        correctedTime: ct,
        driftAppliedMs: driftMs,
        driftApplied: driftMs,
        latencyOffsetMs: latMs,
        latencyOffset: latMs,
        morphDelta: 0,
        visemeShiftAppliedMs: shiftMs,
        visemeShiftApplied: shiftMs,
        playbackDominant,
        rawAudioTimeSec: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
      };
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

    /** During playback + cues RMS must not attenuate timelines; edge cases keep analyser damping. */
    let visemePowerApplied = 1;
    if (authoritativeCuePlayback) {
      visemePowerApplied = 1;
    } else if (analyser && queue.length > 0 && audioReady) {
      let visemePower =
        lipRms < LIP_RMS_SILENCE ? 0 : Math.min(1, lipRms * LIP_RMS_SENS);
      if (AVATAR_BEHAVIOR_SINGLE_CONTROLLER) {
        const abIntent = useBrainStore.getState().avatarBehavior.intent;
        const speakingLike = abIntent === 'explaining' || abIntent === 'emphasizing';
        if (!speakingLike) visemePower *= 0.3;
      }
      visemePowerApplied = visemePower;
      tgtAa *= visemePower;
      tgtIh *= visemePower;
      tgtOh *= visemePower;
      tgtOu *= visemePower;
      tgtEe *= visemePower;
    }

    /** Analyser-wideband blend can zero-out cue-driven shapes when RMS is low — bypass during authoritative playback. */
    if (freqBlend && audioReady && !authoritativeCuePlayback) {
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

    if (
      authoritativeCuePlayback
      && queue.length > 0
      && audioReady
    ) {
      const deadPrev = mouthTgtPrevRef.current;
      const db = (p: number, n: number) =>
        Math.abs(n - p) < MORPH_IGNORE_EPS ? p : n;
      let aa = db(deadPrev.aa, tgtAa);
      let ih = db(deadPrev.ih, tgtIh);
      let oh = db(deadPrev.oh, tgtOh);
      let ou = db(deadPrev.ou, tgtOu);
      let ee = db(deadPrev.ee, tgtEe);
      mouthTgtPrevRef.current = { aa, ih, oh, ou, ee };
      const vs = visemeProductionSmoothRef.current;
      aa = THREE.MathUtils.lerp(vs.aa, aa, VISEME_PRODUCTION_LERP);
      ih = THREE.MathUtils.lerp(vs.ih, ih, VISEME_PRODUCTION_LERP);
      oh = THREE.MathUtils.lerp(vs.oh, oh, VISEME_PRODUCTION_LERP);
      ou = THREE.MathUtils.lerp(vs.ou, ou, VISEME_PRODUCTION_LERP);
      ee = THREE.MathUtils.lerp(vs.ee, ee, VISEME_PRODUCTION_LERP);
      visemeProductionSmoothRef.current = { aa, ih, oh, ou, ee };
      tgtAa = aa;
      tgtIh = ih;
      tgtOh = oh;
      tgtOu = ou;
      tgtEe = ee;
    }

    /**
     * Exponential smoothing toward targets (time constants in seconds) so blend rate matches `delta`,
     * not a fixed per-frame fraction — stable across 30/60/120 Hz and tab throttling.
     */
    const blendChannel = (cur: number, tgt: number) => {
      const releasing = tgt < cur * 0.88 && cur > 0.18;
      let tauSec = tgt >= cur ? 0.042 : releasing ? 0.068 : 0.055;
      if (authoritativeCuePlayback && queue.length > 0 && audioReady) {
        tauSec = tgt >= cur ? 0.03 : releasing ? 0.052 : 0.038;
      }
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

    const fingerprint = Math.round(
      ((out.aa + out.ih + out.oh + out.ou + out.ee) || 0) * 10000,
    );
    const prevFpActive = morphFingerprintPrevRef.current;
    morphFingerprintPrevRef.current = fingerprint;
    const morphDelta = Math.abs(fingerprint - prevFpActive);
    cogniMetricsRecordMorphDelta(morphDelta);
    if (typeof window !== 'undefined') {
      (
        window as Window & {
          __cogniLipSyncProbe?: CogniLipSyncProbe;
        }
      ).__cogniLipSyncProbe = {
        ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        phase: 'active',
        talking: true,
        utteranceGeneration: ug,
        timelineSource: getTimelineSource(),
        visemeCount: queue.length,
        timelineCueStoreCount: tc.length,
        audioPaused: audio ? audio.paused : null,
        audioReady,
        hasTimelineAudio: !!timelineAudio,
        visemePowerApplied,
        morphFingerprint: fingerprint,
        morphFingerprintDelta: morphDelta,
        lipRms: lipRms,
        audioCurrentTime:
          audio && !Number.isNaN(audio.currentTime) ? audio.currentTime : null,
        playbackDominant: authoritativeCuePlayback,
      };
      if (advancedProbeForWindow) {
        (
          window as Window & {
            __cogniLipSyncAdvancedProbe?: CogniLipSyncAdvancedProbe;
          }
        ).__cogniLipSyncAdvancedProbe = {
          ...advancedProbeForWindow,
          morphDelta,
        };
      }
    }

    /** Light speech-time gaze + blink pulses — throttled so they do not dominate behavior systems. */
    if (
      typeof window !== 'undefined'
      && talking
      && audioReady
      && authoritativeCuePlayback
      && queue.length > 0
    ) {
      speechMicroAccRef.current += safeDelta;
      if (speechMicroAccRef.current >= speechMicroNextRef.current) {
        speechMicroAccRef.current = 0;
        speechMicroNextRef.current = 1.85 + Math.random() * 1.35;
        const yaw = (Math.random() > 0.5 ? 1 : -1) * (0.035 + Math.random() * 0.048);
        const pitch = -0.018 + Math.random() * 0.055;
        window.dispatchEvent(
          new CustomEvent('avatar:gaze', {
            detail: { yaw, pitch, durationMs: 640 + Math.random() * 420 },
          }),
        );
        if (Math.random() < 0.5) {
          window.dispatchEvent(
            new CustomEvent('avatar:blink', { detail: { style: 'normal' as const } }),
          );
        }
      }
    }

    if (DEBUG_AVATAR && audio && audioReady && nowMs - lastDebugLogAtRef.current > 1500) {
      lastDebugLogAtRef.current = nowMs;
      const cueT = lastActiveCueTRef.current;
      const visemeTime = tSec;
      const driftMs =
        queue.length > 0 && cueT >= 0 ? Math.round((visemeTime - cueT) * 1000) : 0;
      avatarDebug('[LipSync]', {
        audioTime: Number(audio.currentTime.toFixed(4)),
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
      const driftSec =
        queue.length > 0 && cueT >= 0 ? Math.abs(audio.currentTime - cueT) : 0;
      // eslint-disable-next-line no-console
      console.log({
        audio: Number(audio.currentTime.toFixed(4)),
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
        /** Same smoothed playhead used for cue lookup (avoids double latency vs `getPlaybackTimeSec`). */
        reportLipSyncDriftMs(Math.abs(tSec - cueT) * 1000);
      }
    }

    /** Viseme / jaw targets are independent of torso or arm pose — no skeleton layer clamps mouth weights. */
    setMouthKeys(em, out.aa, out.ih, out.oh, out.ou, out.ee, 1);
    const jawProxy = Math.max(out.aa, out.oh * 0.92, out.ih * 0.45, out.ee * 0.38);
    applyRmsToMouthOpen(
      em,
      playbackDominant ? 0 : lipRms,
      jawProxy,
      playbackDominant ? 0 : 0.26,
    );
  }, -1);

  return null;
}
