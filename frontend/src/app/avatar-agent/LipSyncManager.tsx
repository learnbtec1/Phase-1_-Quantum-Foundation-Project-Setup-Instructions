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
import { avatarDebug, DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';
import { waitAudioReady as waitForAudioReady } from '@/lib/audio/waitAudioReady';
import { useBrainStore } from '@/store/useBrainStore';
import {
  blendVisemeWithExpression,
  getCognitiveMouthOverlay,
  type MouthShape,
} from '@/app/avatar-agent/motion/facialExpressionBlend';
import { isObservabilityEnabled } from '@/lib/observability/config';
import { reportLipSyncDriftMs } from '@/lib/observability/audioLipSyncMonitor';
import {
  getSpeechEmotionSnapshot,
  patchSpeechEmotionEnergy,
} from '@/ai/voice/speechEmotionBridge';
import { installUserGestureAudioUnlock } from '@/lib/audio/avatarAudioContext';
import { nowMs as masterClockNowMs, sessionElapsedSec } from '@/lib/avatar/masterClock';
import {
  getActiveAudioElement,
  getPlaybackTimeSec,
  getVisemeCues,
  resetDriftOffset,
} from '@/lib/avatar/audioTimeline';

const TAB_SAFE_MAX_DELTA = 0.1;

/** HAVE_CURRENT_DATA — enough data to read currentTime reliably for sync */
const AUDIO_READY_MIN = 2;

/**
 * Azure viseme id → VRM mouth morph weights.
 * Index = Azure viseme ID (0–21).
 */
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
  const visemeUnitCheckedRef = useRef(false);
  const visemeIsMs = useRef(false);

  const lastVisemeIdRef = useRef<number>(-2);
  const lastActiveCueTRef = useRef(0);
  const lastDebugLogAtRef = useRef(0);
  const lastLipDriftConsoleAtRef = useRef(0);
  const speechEmphasisRef = useRef(0);
  const lipObsFrameRef = useRef(0);

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
      visemeUnitCheckedRef.current = false;
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

    const talking = isTalkingRef.current;
    const tc = getVisemeCues();
    const timelineAudio = getActiveAudioElement();
    const audioProbe = timelineAudio ?? audioElementRef.current;
    const qProbe = tc.length > 0 ? tc : visemeCueQueueRef.current;
    if (typeof window !== 'undefined') {
      (window as Window & {
        __cogniLipSyncProbe?: {
          talking: boolean;
          visemeCount: number;
          audioCurrentTime: number | null;
        };
      }).__cogniLipSyncProbe = {
        talking,
        visemeCount: qProbe.length,
        audioCurrentTime:
          audioProbe && !Number.isNaN(audioProbe.currentTime) ? audioProbe.currentTime : null,
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
      setMouthKeys(em, sm.aa, sm.ih, sm.oh, sm.ou, sm.ee, 1);
      return;
    }
    prevTalkingRef.current = true;

    const audio = timelineAudio ?? audioElementRef.current;
    const queue = tc.length > 0 ? tc : visemeCueQueueRef.current;
    const analyser = analyserRef?.current ?? null;

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
      patchSpeechEmotionEnergy(Math.min(1, rms * 4.5));
    }

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
      audio.readyState >= AUDIO_READY_MIN;

    /** Lip sync playhead = `audio.currentTime` only (no artificial anticipation offset). */
    const VISEME_ANTICIPATION_SEC = 0;

    let tgtAa = 0;
    let tgtIh = 0;
    let tgtOh = 0;
    let tgtOu = 0;
    let tgtEe = 0;

    let tSec = 0;
    if (audioReady) {
      tSec = timelineAudio
        ? Math.max(0, getPlaybackTimeSec() - VISEME_ANTICIPATION_SEC)
        : Math.max(0, audio!.currentTime - VISEME_ANTICIPATION_SEC);
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
              const uBlend = u * 0.38;
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

          const COART_WINDOW = 0.08;
          if (nextVisemeId >= 0 && nextVisemeT < Infinity) {
            const gap = nextVisemeT - tSec;
            if (gap < COART_WINDOW && gap >= 0) {
              const coartBlend = 1 - gap / COART_WINDOW;
              const nextId = Math.max(0, Math.min(AZURE_VISEME_TO_BLEND.length - 1, nextVisemeId));
              const next = AZURE_VISEME_TO_BLEND[nextId];
              if (next) {
                const k = coartBlend * 0.42;
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

    const blendChannel = (cur: number, tgt: number) => {
      const blendUp = 0.4;
      const releasing = tgt < cur * 0.88 && cur > 0.18;
      const blendDown = releasing ? 0.13 : 0.24;
      const b = tgt >= cur ? blendUp : blendDown;
      return THREE.MathUtils.lerp(cur, tgt, b);
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

    if (isObservabilityEnabled() && talking && audio && audioReady && queue.length > 0) {
      lipObsFrameRef.current += 1;
      if (lipObsFrameRef.current % 14 === 0) {
        const cueT = lastActiveCueTRef.current;
        const playhead = timelineAudio
          ? getPlaybackTimeSec() - VISEME_ANTICIPATION_SEC
          : audio.currentTime - VISEME_ANTICIPATION_SEC;
        reportLipSyncDriftMs(Math.abs(playhead - cueT) * 1000);
      }
    }

    setMouthKeys(em, out.aa, out.ih, out.oh, out.ou, out.ee, 1);
  }, -1);

  return null;
}
