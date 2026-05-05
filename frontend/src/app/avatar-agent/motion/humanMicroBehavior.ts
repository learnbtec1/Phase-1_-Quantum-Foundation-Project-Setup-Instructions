'use client';
/**
 * humanMicroBehavior.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Unified Human Micro-Behavior Layer
 * Blink + Breathing + Eye Saccades — three independent, real-time systems
 * wired to the actual VRM runtime (expressionManager + bone pose map).
 *
 * CRITICAL DESIGN RULES:
 *  1. This file writes to REAL outputs — expressionManager.setValue + BonePoseMap.
 *  2. All systems are stateless-persistent (module-level state, no React).
 *  3. Never fights other layers — additive on existing quaternions.
 *  4. Each system has its own throttled debug log behind a single flag.
 *  5. If a bone key is missing → silent skip (never throws).
 */

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';

// ── Shared scratch objects (avoid GC pressure each frame) ─────────────────
const _e   = new THREE.Euler(0, 0, 0, 'YXZ');
const _qD  = new THREE.Quaternion();
const _qO  = new THREE.Quaternion();

function addBoneEuler(pose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  const q = pose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qD.setFromEuler(_e);
  _qO.copy(q).multiply(_qD);
  pose.set(key, _qO.clone());
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM 1 — BLINK
// Uses vrm.expressionManager.setValue() directly.
// VRM 1.0: expression name is 'blink'. VRM 0.x: 'Blink'.
// We try both and cache which one works.
// ═══════════════════════════════════════════════════════════════════════════
type ExprMgr = { setValue?: (name: string, v: number) => void; getExpressionTrackName?: (n: string) => string | null | undefined } | null | undefined;

const _blinkState = {
  nextMs:         0,
  closeMs:        0,   // blink started at
  openMs:         0,   // blink ends at
  active:         false,
  doublePending:  false,
  expressionKey:  '' as '' | 'blink' | 'Blink' | 'blinkLeft',
  loggedOnce:     false,
};

function _resolveBlinkKey(mgr: ExprMgr): string {
  if (!mgr) return '';
  if (_blinkState.expressionKey) return _blinkState.expressionKey;
  // Probe — try common VRM expression names
  for (const k of ['blink', 'Blink', 'blinkLeft', 'BlinkLeft']) {
    try {
      mgr.setValue?.(k, 0);
      _blinkState.expressionKey = k as 'blink' | 'Blink' | 'blinkLeft';
      return k;
    } catch { /* key not found → try next */ }
  }
  return '';
}

function applyBlink(mgr: ExprMgr, speaking: boolean): void {
  const t = nowMs();
  // Blink rate: 2–5 s when calm, 0.8–1.6 s while speaking/thinking
  if (!_blinkState.active && t >= _blinkState.nextMs) {
    _blinkState.active   = true;
    _blinkState.closeMs  = t;
    _blinkState.openMs   = t + 80 + Math.random() * 60;  // 80–140 ms close
    const interval       = speaking
      ? 800  + Math.random() * 800       // 0.8–1.6 s while speaking
      : 2500 + Math.random() * 2500;     // 2.5–5 s at rest
    _blinkState.nextMs   = t + interval;
    // 12% chance of double-blink
    if (!_blinkState.doublePending && Math.random() < 0.12) {
      _blinkState.doublePending = true;
      _blinkState.nextMs = t + 250;
    } else {
      _blinkState.doublePending = false;
    }
  }
  if (_blinkState.active && t > _blinkState.openMs) {
    _blinkState.active = false;
  }

  const key = _resolveBlinkKey(mgr);
  if (!key) return;

  // Ease in/out for natural feel (not a hard cut)
  let blinkValue = 0;
  if (_blinkState.active) {
    const elapsed  = t - _blinkState.closeMs;
    const duration = _blinkState.openMs - _blinkState.closeMs;
    const progress = Math.min(1, elapsed / Math.max(1, duration));
    // Triangle: rise 0→1 in first 40%, fall 1→0 in last 60%
    blinkValue = progress < 0.4
      ? progress / 0.4
      : 1 - (progress - 0.4) / 0.6;
  }

  try { mgr?.setValue?.(key, blinkValue); } catch { /* ignore — expression may not exist */ }

  if (!_blinkState.loggedOnce && blinkValue > 0.1) {
    _blinkState.loggedOnce = true;
    console.log('[HUMAN_MICRO:BLINK] first blink fired', { key, blinkValue: blinkValue.toFixed(2) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM 2 — BREATHING
// Real chest + spine + shoulder additive deltas.
// Frequency 0.20–0.26 Hz (12–16 breaths/min).
// More perceptible than breathingLayer.ts — slightly higher amplitude.
// ═══════════════════════════════════════════════════════════════════════════
const BREATH_HZ    = 0.22;   // ~13 breaths/min
const BREATH_AMP   = 0.014;  // rad — visually perceptible
const SHOULDER_LAG = 0.045;  // seconds behind chest

function applyBreathing(pose: BonePoseMap, tSec: number, speaking: boolean): void {
  const w = Math.PI * 2 * BREATH_HZ;
  // Slight amplitude boost when speaking (diaphragmatic engagement)
  const amp  = BREATH_AMP * (speaking ? 1.35 : 1.0);
  // Slow drift so breath depth is never perfectly periodic (feels organic)
  const ampWobble = 1 + 0.06 * Math.sin(tSec * 0.07 + 0.3);

  const chest     = Math.sin(tSec * w)                  * amp * ampWobble;
  const spine     = Math.sin(tSec * w + 0.1)            * amp * ampWobble * 0.55;
  const shoulders = Math.sin((tSec - SHOULDER_LAG) * w) * amp * ampWobble * 0.38;

  // Chest: gentle forward tilt (pitch-up = sternum rises)
  addBoneEuler(pose, 'chest', chest * -0.9, 0, 0);
  addBoneEuler(pose, 'spine', spine * -0.5, 0, 0);
  // Shoulders rise slightly, opposite sides out of phase ±5%
  addBoneEuler(pose, 'leftShoulder',  0, 0,  shoulders);
  addBoneEuler(pose, 'rightShoulder', 0, 0, -shoulders * 0.94);
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM 3 — EYE SACCADES
// Writes directly to VRM lookAt target via expressionManager or
// lookAt setter if available. Fallback: tiny head delta via pose map.
// ═══════════════════════════════════════════════════════════════════════════
const _saccade = {
  nextMs:   0,
  tgtYaw:   0,
  tgtPitch: 0,
  yaw:      0,
  pitch:    0,
  // delay ring: eyes follow head by ~25 ms
  history: [] as { t: number; yaw: number; pitch: number }[],
};

function applySaccades(
  pose: BonePoseMap,
  deltaSec: number,
  intent: string,
  vrm?: { lookAt?: { target?: THREE.Object3D | null; getLookAtWorldDirection?: (v: THREE.Vector3) => THREE.Vector3 } | null },
): void {
  const t = nowMs();

  // Saccade target: new random position every 0.8–2.5 s
  if (t >= _saccade.nextMs) {
    _saccade.nextMs = t + 800 + Math.random() * 1700;
    const isFocused = intent === 'explaining' || intent === 'confirming';
    if (isFocused) {
      // Near centre — maintaining eye contact
      _saccade.tgtYaw   = (Math.random() - 0.5) * 0.045;
      _saccade.tgtPitch = (Math.random() - 0.5) * 0.025;
    } else {
      // Look slightly away (thinking / neutral)
      const side = Math.random() < 0.5 ? -1 : 1;
      _saccade.tgtYaw   = side * (0.03 + Math.random() * 0.07);
      _saccade.tgtPitch = 0.01 + Math.random() * 0.03;
    }
  }

  // Fast saccade spring (eyes snap, then settle)
  const k = 1 - Math.exp(-deltaSec * 14);
  _saccade.yaw   = THREE.MathUtils.lerp(_saccade.yaw,   _saccade.tgtYaw,   k);
  _saccade.pitch = THREE.MathUtils.lerp(_saccade.pitch, _saccade.tgtPitch, k);

  // ── Path A: VRM lookAt target object (cleanest, most correct) ────────────
  // VRM 1.0 lookAt: set a world-space target. We use the existing lookAt target
  // if present, or store to globalThis for downstream consumers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__eyeSaccadeTarget = { yaw: _saccade.yaw, pitch: _saccade.pitch };

  // ── Path B: Tiny additive delta on head + neck (fallback) ────────────────
  // Keeps at most ±0.06 rad so it never fights the main head-pose system.
  const headDelta = 0.22;   // eyes → head coupling factor
  const neckDelta = 0.10;
  addBoneEuler(pose, 'head', _saccade.pitch * headDelta, _saccade.yaw * headDelta, 0);
  addBoneEuler(pose, 'neck', _saccade.pitch * neckDelta, _saccade.yaw * neckDelta, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — call once per useFrame after all intent/motion layers
// ═══════════════════════════════════════════════════════════════════════════
let _microLogLastMs = 0;

export function applyHumanMicroBehavior(
  pose:     BonePoseMap,
  tSec:     number,
  delta:    number,
  speaking: boolean,
  intent:   string,
  vrm?: {
    expressionManager?: ExprMgr;
    lookAt?: { target?: THREE.Object3D | null } | null;
  } | null,
): void {
  // ── 1. Blink ─────────────────────────────────────────────────────────────
  applyBlink(vrm?.expressionManager, speaking);

  // ── 2. Breathing ─────────────────────────────────────────────────────────
  applyBreathing(pose, tSec, speaking);

  // ── 3. Eye saccades ──────────────────────────────────────────────────────
  applySaccades(pose, delta, intent, vrm as Parameters<typeof applySaccades>[3]);

  // ── Debug log (throttled 1s) ──────────────────────────────────────────────
  const _now = nowMs();
  if (_now - _microLogLastMs > 1000) {
    _microLogLastMs = _now;
    console.log('[HUMAN_MICRO]', {
      blink:     _blinkState.active,
      blinkKey:  _blinkState.expressionKey || 'unresolved',
      breathAmp: (BREATH_AMP * (speaking ? 1.35 : 1)).toFixed(4),
      saccadeYaw:   _saccade.yaw.toFixed(4),
      saccadePitch: _saccade.pitch.toFixed(4),
      speaking,
      intent: intent || '(none)',
    });
  }
}
