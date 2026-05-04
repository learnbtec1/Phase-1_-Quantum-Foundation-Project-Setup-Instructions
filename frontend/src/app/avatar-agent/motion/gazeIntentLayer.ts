'use client';
/**
 * Gaze Intent Layer
 * Provides intent-aware eye direction, micro-saccades, and blink system.
 * Writes small additive deltas onto 'head' and 'neck' bones in finalPose,
 * and drives VRM expressionManager blink.
 */

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

function mulBone(pose: BonePoseMap, key: string, rx: number, ry: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = pose.get(key);
  if (!q) return;
  _e.set(rx, ry, 0, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  pose.set(key, _qOut.clone());
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ─── Persistent gaze state ────────────────────────────────────────────────────
const _gaze = {
  yaw:   0, pitch: 0,
  tgtYaw: 0, tgtPitch: 0,
  nextSaccadeMs: 0,
  nextBlinkMs:   0,
  blinkEndMs:    0,
  blinkActive:   false,
  doublePending: false,
  // Eye follows head by ~30 ms — short ring buffer of recent head saccade targets.
  headYawHistory: [] as { t: number; yaw: number; pitch: number }[],
};

const EYE_FOLLOW_DELAY_MS = 30;
const HEAD_HISTORY_MAX = 12;

// ─── Intent target table (radians) ───────────────────────────────────────────
const INTENT_GAZE: Record<string, { yawRange: number; pitchRange: number; eyeContact: boolean }> = {
  explaining:  { yawRange: 0.04, pitchRange: 0.02, eyeContact: true  },
  confirming:  { yawRange: 0.03, pitchRange: 0.02, eyeContact: true  },
  thinking:    { yawRange: 0.14, pitchRange: 0.06, eyeContact: false },
  questioning: { yawRange: 0.08, pitchRange: 0.04, eyeContact: false },
  listening:   { yawRange: 0.05, pitchRange: 0.03, eyeContact: true  },
};

let _loggedOnce = false;

type VrmRef = { expressionManager?: { setValue?: (n: string, v: number) => void } | null } | null;

export function applyGazeIntentLayer(
  pose: BonePoseMap,
  intent: string,
  deltaSec: number,
  vrm?: VrmRef,
): void {
  const t = nowMs();
  const cfg = INTENT_GAZE[intent?.toLowerCase?.() ?? ''] ?? { yawRange: 0.07, pitchRange: 0.035, eyeContact: false };

  // Saccade: new random target every 1–3 s
  if (t >= _gaze.nextSaccadeMs) {
    _gaze.nextSaccadeMs = t + 1000 + Math.random() * 2000;
    if (cfg.eyeContact) {
      // Near-centre — maintain eye contact
      _gaze.tgtYaw   = (Math.random() - 0.5) * cfg.yawRange;
      _gaze.tgtPitch = (Math.random() - 0.5) * cfg.pitchRange;
    } else {
      // Look slightly away (thinking/questioning)
      _gaze.tgtYaw   = (Math.random() < 0.5 ? -1 : 1) * (cfg.yawRange * 0.5 + Math.random() * cfg.yawRange * 0.5);
      _gaze.tgtPitch = cfg.pitchRange * 0.3 + Math.random() * cfg.pitchRange * 0.4;
    }
  }

  // Smooth lerp toward saccade target (HEAD moves first)
  const k = 1 - Math.exp(-deltaSec * 5);
  _gaze.yaw   = THREE.MathUtils.lerp(_gaze.yaw,   _gaze.tgtYaw,   k);
  _gaze.pitch = THREE.MathUtils.lerp(_gaze.pitch, _gaze.tgtPitch, k);

  // Push to history so eyes can follow with a short delay.
  _gaze.headYawHistory.push({ t, yaw: _gaze.yaw, pitch: _gaze.pitch });
  if (_gaze.headYawHistory.length > HEAD_HISTORY_MAX) _gaze.headYawHistory.shift();

  // Apply head first with full current target (head leads)
  mulBone(pose, 'head', _gaze.pitch * 0.18, _gaze.yaw * 0.25);
  mulBone(pose, 'neck', _gaze.pitch * 0.08, _gaze.yaw * 0.12);

  // Eye follow: sample delayed head target from history (≈30 ms old)
  const delayedSample =
    _gaze.headYawHistory.find((s) => t - s.t >= EYE_FOLLOW_DELAY_MS) ?? _gaze.headYawHistory[0];
  if (delayedSample) {
    // Store for downstream eye-rig consumers; no direct bone write here to avoid fighting lookAt.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__eyeFollowTarget = {
      yaw: delayedSample.yaw,
      pitch: delayedSample.pitch,
    };
  }

  // Blink system
  if (!_gaze.blinkActive && t >= _gaze.nextBlinkMs) {
    _gaze.blinkActive = true;
    _gaze.blinkEndMs  = t + 120 + Math.random() * 60;
    const fast = intent === 'thinking';
    const interval = fast ? 900 + Math.random() * 1400 : 2000 + Math.random() * 3000;
    _gaze.nextBlinkMs = t + interval;
    if (!_gaze.doublePending && Math.random() < 0.15) {
      _gaze.doublePending = true;
      _gaze.nextBlinkMs   = t + 260;
    } else {
      _gaze.doublePending = false;
    }
  }
  if (_gaze.blinkActive && t > _gaze.blinkEndMs) _gaze.blinkActive = false;
  vrm?.expressionManager?.setValue?.('blink', _gaze.blinkActive ? 1 : 0);

  if (!_loggedOnce) {
    _loggedOnce = true;
    console.log('[FILE_EXECUTED] gazeIntentLayer — first frame');
  }
}

export function resetGazeIntentLayer(): void {
  _gaze.yaw = _gaze.pitch = _gaze.tgtYaw = _gaze.tgtPitch = 0;
  _gaze.nextSaccadeMs = _gaze.nextBlinkMs = _gaze.blinkEndMs = 0;
  _gaze.blinkActive = _gaze.doublePending = false;
  _loggedOnce = false;
}
