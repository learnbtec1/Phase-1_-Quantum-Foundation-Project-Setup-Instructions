/**
 * Forensic motion pipeline logging — opt-in via NEXT_PUBLIC_MOTION_PIPELINE_DEBUG=true.
 * Does not run in production unless explicitly enabled.
 */
'use client';

import * as THREE from 'three';

export const MOTION_PIPELINE_DEBUG =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_MOTION_PIPELINE_DEBUG === 'true';

const LOG_INTERVAL_MS = 220;

let lastLogAt = 0;
let lastCinematicLogAt = 0;

/** Throttled JSON line — proves which layer inputs are live each frame window. */
export function logMotionPipelineFrame(snapshot: Record<string, unknown>): void {
  if (!MOTION_PIPELINE_DEBUG || typeof performance === 'undefined') return;
  const now = performance.now();
  if (now - lastLogAt < LOG_INTERVAL_MS) return;
  lastLogAt = now;
  // eslint-disable-next-line no-console -- intentional forensic channel
  console.log('[MotionPipeline]', JSON.stringify(snapshot));
}

/** Sample cinematic layer inputs + computed head delta magnitude (rad). */
export function logCinematicMicroProbe(params: {
  speaking: boolean;
  energy: number;
  syllablePulse: number;
  headYawRad: number;
  headPitchRad: number;
  scaleS: number;
}): void {
  if (!MOTION_PIPELINE_DEBUG || typeof performance === 'undefined') return;
  const now = performance.now();
  if (now - lastCinematicLogAt < 400) return;
  lastCinematicLogAt = now;
  // eslint-disable-next-line no-console -- intentional forensic channel
  console.log(
    '[MotionPipeline][cinematicMicro]',
    JSON.stringify({
      speaking: params.speaking,
      energy: Number(params.energy.toFixed(4)),
      syllablePulse: Number(params.syllablePulse.toFixed(4)),
      scaleS: Number(params.scaleS.toFixed(4)),
      headYawRad: Number(params.headYawRad.toFixed(6)),
      headPitchRad: Number(params.headPitchRad.toFixed(6)),
    }),
  );
}

let eventsAttached = false;

/** One-time: proves cogni:pre_speech / avatar:speak / audio element events fire. */
export function attachMotionPipelineEventProbes(): void {
  if (!MOTION_PIPELINE_DEBUG || typeof window === 'undefined' || eventsAttached) return;
  eventsAttached = true;
  const tag = '[MotionPipeline][event]';
  const on = (name: string, extra?: () => Record<string, unknown>) => {
    window.addEventListener(name, ((e: Event) => {
      const d = e instanceof CustomEvent ? (e.detail as Record<string, unknown> | undefined) : undefined;
      // eslint-disable-next-line no-console -- intentional forensic channel
      console.log(tag, name, d ?? extra?.() ?? {});
    }) as EventListener);
  };
  on('cogni:pre_speech');
  on('avatar:speak:start');
  on('avatar:speak:end');
  on('avatar:audio:element');
  on('avatar:speak');
}

/** Read stabilizeMix from AnimationController (set each frame when debug on). */
export function readStabilizeMixFromWindow(): number | null {
  if (typeof window === 'undefined') return null;
  const v = (window as Window & { __cogniStabilizeMix?: number }).__cogniStabilizeMix;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export type LipSyncProbeWin = {
  talking: boolean;
  visemeCount: number;
  audioCurrentTime: number | null;
};

/** Updated every frame from LipSyncManager (viseme queue + audio playhead). */
export function readLipSyncProbeFromWindow(): LipSyncProbeWin | null {
  if (typeof window === 'undefined') return null;
  const p = (window as Window & { __cogniLipSyncProbe?: LipSyncProbeWin }).__cogniLipSyncProbe;
  return p ?? null;
}

let lastFinalPoseLogAt = 0;

/** Confirms applyFinalPoseToVrm receives a non-empty map for body bones (throttled). */
export function logFinalPoseApplyProbe(finalPose: Map<string, THREE.Quaternion>, delta: number): void {
  if (!MOTION_PIPELINE_DEBUG || typeof performance === 'undefined') return;
  const now = performance.now();
  if (now - lastFinalPoseLogAt < 480) return;
  lastFinalPoseLogAt = now;
  const keys = [...finalPose.keys()];
  // eslint-disable-next-line no-console -- intentional forensic channel
  console.log(
    '[MotionPipeline][applyFinalPoseToVrm]',
    JSON.stringify({
      keyCount: keys.length,
      hasNeck: finalPose.has('neck'),
      hasHead: finalPose.has('head'),
      delta: Number(delta.toFixed(4)),
      sampleKeys: keys.slice(0, 14),
    }),
  );
}

/**
 * Forensic notes (static analysis — confirm with logs above):
 *
 * - motionSource !== 'VRMA' → applyCinematicMicroLayer / microHuman / idleMicroPresence (VRMA branch) do not run;
 *   procedural idle uses the large block gated by motionSource !== 'VRMA'.
 * - vrmaLayerW === 0 with empty vrmaForBlend → blend stack may collapse toward bind; check vrmaForBlendKeys.
 * - enforceAvatarRootStability: resets scene transform + hip position; hip quaternion is **normalize()** only
 *   (does not zero rotation) — unlikely to erase head/neck motion.
 * - applyFinalPoseToVrm: only mutates bones present in finalPose Map; missing neck/head keys → those bones never slerp.
 */
