/**
 * Continuous motion driver (migration Step 1).
 *
 * Long-term: single per-frame owner for state-driven pose (VRMA base → intent → gesture → presence).
 * Current: no behavioral change — samples VRMA base pose and embodiment each frame for future wiring.
 */
import type { EmbodimentState } from '@/lib/avatar/embodimentState';
import type { BonePoseMap } from '@/app/avatar-agent/motion/PoseComposer';

export type MotionSourceTag = 'VRMA' | 'GESTURE' | 'IDLE';

export type MotionDriverFrameContext = {
  embodiment: EmbodimentState;
  /** Raw VRMA bone map from the mixer (`vrmaPoseRef.current.bones`), before arm fallback merge. */
  vrmaBasePose: BonePoseMap;
  /** VRMA input after optional arm fallback merge — matches `blendPoseLayers` `vrma` slot. */
  vrmaBlendInput: BonePoseMap;
  motionSource: MotionSourceTag;
};

export class MotionDriver {
  private lastDt = 0;
  private lastVrmaBase: BonePoseMap | null = null;
  private lastMotionSource: MotionSourceTag = 'IDLE';

  /**
   * Per-frame hook — will own layering order once migration completes.
   * Step 1: retain references for diagnostics / upcoming centralized blending only.
   */
  update(dt: number, ctx: MotionDriverFrameContext): void {
    this.lastDt = dt;
    this.lastVrmaBase = ctx.vrmaBasePose;
    this.lastMotionSource = ctx.motionSource;
    void ctx.embodiment;
    void ctx.vrmaBlendInput;
  }

  get lastFrameDelta(): number {
    return this.lastDt;
  }

  /** Confirms VRMA base pose is reachable from the driver each frame (same map instance as skeleton). */
  getLastVrmaBasePose(): BonePoseMap | null {
    return this.lastVrmaBase;
  }

  get lastMotionSourceTag(): MotionSourceTag {
    return this.lastMotionSource;
  }
}

export const motionDriver = new MotionDriver();
