/**
 * FeetFixer.ts — post-VRMA foot-rotation clamp.
 *
 * After `AnimationMixer.update()` bakes VRMA keyframes into raw bones, extreme
 * foot angles can appear (pivot artefacts from some .vrma exports).  FeetFixer
 * captures the T-pose baseline and soft-clamps per-frame deviations.
 *
 * Usage (AvatarCanvas):
 *   const ff = new FeetFixer(vrm);
 *   ff.captureBaseline();
 *   // each frame:
 *   ff.apply({ enabled: true, maxPitchDeg: 35, maxYawDeg: 12, maxRollDeg: 12, blend: 0.75 });
 */
import * as THREE from 'three';

export interface FeetFixerApplyOptions {
  enabled:       boolean;
  maxPitchDeg?:  number;
  maxYawDeg?:    number;
  maxRollDeg?:   number;
  blend?:        number;
  /** Frame delta-time (seconds). When provided, blend is normalised to 60 fps so
   *  correction speed is frame-rate independent and never causes per-frame snapping. */
  deltaTime?:    number;
}

export interface FeetFixerDiagnostics {
  has:        boolean;
  boneNames?: string[];
}

// VRM type is opaque here — keep as `unknown` to avoid hard dep on @pixiv/three-vrm.
type AnyVRM = {
  humanoid?: {
    getRawBoneNode?: (name: string) => THREE.Object3D | null | undefined;
  };
};

const FOOT_BONES = ['leftFoot', 'rightFoot', 'leftToes', 'rightToes'] as const;

export class FeetFixer {
  private readonly _vrm: AnyVRM;
  private readonly _baseline = new Map<string, THREE.Quaternion>();
  private readonly _euler    = new THREE.Euler();
  private readonly _qTmp     = new THREE.Quaternion();

  constructor(vrm: unknown) {
    this._vrm = vrm as AnyVRM;
  }

  /** Capture current quaternions as the T-pose baseline. Call once after VRM loads. */
  captureBaseline(): void {
    const h = this._vrm?.humanoid;
    if (!h?.getRawBoneNode) return;
    for (const name of FOOT_BONES) {
      const bone = h.getRawBoneNode(name);
      if (bone) this._baseline.set(name, (bone.quaternion as THREE.Quaternion).clone());
    }
  }

  /**
   * Soft-clamp foot/toe euler angles relative to baseline, then blend back.
   * Must be called **after** `AnimationMixer.update()` each frame.
   */
  apply(opts: FeetFixerApplyOptions): void {
    if (!opts.enabled || this._baseline.size === 0) return;
    const h = this._vrm?.humanoid;
    if (!h?.getRawBoneNode) return;

    const maxPitch = THREE.MathUtils.degToRad(opts.maxPitchDeg ?? 35);
    const maxYaw   = THREE.MathUtils.degToRad(opts.maxYawDeg   ?? 12);
    const maxRoll  = THREE.MathUtils.degToRad(opts.maxRollDeg  ?? 12);
    // FIX-2: Delta-time normalised blend — prevents per-frame foot-snapping.
    // At 60 fps, opts.blend is the fraction corrected per second.
    // At 30 fps, we apply twice as much per frame to maintain the same
    // correction speed regardless of frame rate.
    const rawBlend = opts.blend ?? 0.75;
    const dt       = opts.deltaTime ?? (1 / 60);
    const blend    = Math.min(1, 1 - Math.pow(1 - rawBlend, dt * 60));

    for (const name of FOOT_BONES) {
      const bone     = h.getRawBoneNode(name) as THREE.Object3D | null | undefined;
      const baseline = this._baseline.get(name);
      if (!bone || !baseline) continue;

      const q = bone.quaternion as THREE.Quaternion;

      // Compute delta from baseline
      this._qTmp.copy(baseline).invert();
      this._qTmp.premultiply(q);

      this._euler.setFromQuaternion(this._qTmp, 'XYZ');
      this._euler.x = THREE.MathUtils.clamp(this._euler.x, -maxPitch, maxPitch);
      this._euler.y = THREE.MathUtils.clamp(this._euler.y, -maxYaw,   maxYaw);
      this._euler.z = THREE.MathUtils.clamp(this._euler.z, -maxRoll,  maxRoll);

      this._qTmp.setFromEuler(this._euler);
      // Re-apply clamped delta on top of baseline
      const target = baseline.clone().multiply(this._qTmp);
      // Shortest arc: q and −q represent the same rotation; align hemisphere before slerp.
      if (q.dot(target) < 0) target.negate();
      q.slerp(target, blend);
    }
  }

  dumpDiagnostics(): FeetFixerDiagnostics {
    return {
      has:       this._baseline.size > 0,
      boneNames: [...this._baseline.keys()],
    };
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

const FOOT_TRACK_RE = /\b(foot|toes?)\b/i;

/**
 * Remove foot/toe rotation tracks from an AnimationClip.
 * Used with `?pruneFeet=1` diagnostic flag in AvatarCanvas.
 */
export function pruneFootTracksFromClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const kept = clip.tracks.filter(t => !FOOT_TRACK_RE.test(t.name));
  if (kept.length === clip.tracks.length) return clip;
  const pruned = clip.clone();
  pruned.tracks = kept;
  return pruned;
}

/**
 * Remove upper-arm / forearm / hand rotation tracks from an AnimationClip so idle-like
 * VRMA does not fight procedural arm rest (anti–T-pose / zombie arms).
 */
export function pruneArmTracksFromClip(clip: any) {
  try {
    if (!(clip instanceof THREE.AnimationClip)) return clip;
    const names = ['UpperArm', 'LowerArm', 'Hand'];
    const filtered = (clip.tracks ?? []).filter((t: THREE.KeyframeTrack) => {
      const n = String(t?.name ?? '');
      return !names.some(k => n.includes(k));
    });
    if (filtered.length === clip.tracks.length) return clip;
    return new THREE.AnimationClip(clip.name ?? 'clip', clip.duration ?? 0, filtered);
  } catch {
    return clip;
  }
}

/** Strip hips/leg/feet tracks so standing gestures (wave, clap, …) do not distort the lower body. */
export function pruneLegTracksFromClip(clip: THREE.AnimationClip | null): THREE.AnimationClip | null {
  if (!clip || !(clip instanceof THREE.AnimationClip)) return clip;
  const legPattern = /hips|upperleg|lowerleg|foot|toe/i;
  const filteredTracks = clip.tracks.filter((track) => !legPattern.test(track.name));
  if (filteredTracks.length === clip.tracks.length) return clip;
  const newClip = clip.clone();
  newClip.tracks = filteredTracks;
  return newClip;
}
