'use client';
/**
 * Finger Micro Layer
 * Applies a default relaxed curl to all finger joints and adds
 * per-finger micro jitter when speaking.
 *
 * PoseComposer key rules (confirmed from PoseComposer.ts VRM_HUMANOID_TO_POSE_KEY):
 *   Proximal:     lIndexProximal, lMiddleProximal, lRingProximal, lLittleProximal, lThumbProximal
 *                 rIndexProximal, rMiddleProximal, rRingProximal, rLittleProximal, rThumbProximal
 *   Intermediate: leftIndexIntermediate, leftMiddleIntermediate ... (LONG form)
 *   Distal:       leftIndexDistal, leftMiddleDistal ...            (LONG form)
 */

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

const _warnedKeys = new Set<string>();
function warnMissing(key: string): void {
  if (_warnedKeys.has(key)) return;
  _warnedKeys.add(key);
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;
  console.warn(`[BONE_KEY_MISS] fingerMicroLayer: "${key}" not in finalPose`);
}

function mulBone(pose: BonePoseMap, key: string, rx: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = pose.get(key);
  if (!q) { warnMissing(key); return; }
  _e.set(rx, 0, 0, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  pose.set(key, _qOut.clone());
}

// [proximalKey, intermediateKey, distalKey]
const FINGER_CHAINS: [string, string, string][] = [
  ['lIndexProximal',  'leftIndexIntermediate',  'leftIndexDistal'],
  ['lMiddleProximal', 'leftMiddleIntermediate',  'leftMiddleDistal'],
  ['lRingProximal',   'leftRingIntermediate',    'leftRingDistal'],
  ['lLittleProximal', 'leftLittleIntermediate',  'leftLittleDistal'],
  ['lThumbProximal',  'leftThumbDistal',         'leftThumbDistal'],
  ['rIndexProximal',  'rightIndexIntermediate',  'rightIndexDistal'],
  ['rMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal'],
  ['rRingProximal',   'rightRingIntermediate',   'rightRingDistal'],
  ['rLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'],
  ['rThumbProximal',  'rightThumbDistal',        'rightThumbDistal'],
];

// Curl magnitudes (radians, negative = curl inward)
const PROXIMAL_CURL     = -0.25;
const INTERMEDIATE_CURL = -0.35;
const DISTAL_CURL       = -0.15;
const THUMB_SCALE       = 0.40; // thumbs curl less

let _loggedOnce = false;

export function applyFingerMicroLayer(
  pose: BonePoseMap,
  tSec: number,
  speaking: boolean,
): void {
  const jitterScale = speaking ? 1.5 : 1.0;

  FINGER_CHAINS.forEach(([prox, mid, dist], i) => {
    const isThumb = prox.toLowerCase().includes('thumb');
    const proxCurl  = isThumb ? PROXIMAL_CURL     * THUMB_SCALE : PROXIMAL_CURL;
    const midCurl   = isThumb ? INTERMEDIATE_CURL * THUMB_SCALE : INTERMEDIATE_CURL;
    const distCurl  = isThumb ? DISTAL_CURL       * THUMB_SCALE : DISTAL_CURL;
    const seed = i * 1.37;
    const j1 = Math.sin(tSec * 6.0 + seed)        * 0.010 * jitterScale;
    const j2 = Math.sin(tSec * 5.3 + seed + 0.9)  * 0.008 * jitterScale;
    const j3 = Math.sin(tSec * 4.7 + seed + 1.8)  * 0.005 * jitterScale;
    mulBone(pose, prox, proxCurl + j1);
    mulBone(pose, mid,  midCurl  + j2);
    // avoid writing the same distal key twice for thumbs
    if (dist !== mid) mulBone(pose, dist, distCurl + j3);
  });

  if (!_loggedOnce) {
    _loggedOnce = true;
    console.log('[FILE_EXECUTED] fingerMicroLayer — first frame');
  }
}

/** Reset the once-log flag on VRM reload. */
export function resetFingerMicroLayer(): void { _loggedOnce = false; }
