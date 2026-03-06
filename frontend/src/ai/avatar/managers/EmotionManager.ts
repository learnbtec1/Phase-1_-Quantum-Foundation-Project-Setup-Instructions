/**
 * EmotionManager — inspired by AIMascotKit (tk256ailab/AIMascotKit)
 * Maps 11 emotions to VRM face expressions + VRMA body animations.
 *
 * Emotion labels (matching AIMascotKit's emotion_analyzer.py):
 *   normal | angry | sad | happy | excited | blush | surprised | sleepy | thinking | relax | goodbye
 */
import {
  VRM,
  VRMExpressionPresetName,
} from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type AvatarEmotion =
  | 'normal' | 'angry' | 'sad' | 'happy' | 'excited'
  | 'blush' | 'surprised' | 'sleepy' | 'thinking' | 'relax' | 'goodbye'
  // aliases from the rest of the codebase
  | 'neutral' | 'celebration' | 'encouraging' | 'strictEvaluation' | 'friendly';

interface EmotionConfig {
  /** VRM expression preset name  */
  expression: VRMExpressionPresetName;
  /** expression weight 0–1 */
  expressionIntensity: number;
  /** URL of VRMA animation file (relative to /public) */
  vrmaUrl: string;
  /** loop the animation? */
  loop: boolean;
}

/**
 * 11 emotions from AIMascotKit + neutral alias.
 * VRMA files copied from AIMascotKit/assets/animations/.
 */
export const EMOTION_CONFIG: Record<string, EmotionConfig> = {
  // ── core 11 from AIMascotKit ──────────────────────────────────────────────
  normal:     { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3,  vrmaUrl: '/models/animations/Relax.vrma',     loop: true  },
  happy:      { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.9,  vrmaUrl: '/models/animations/Clapping.vrma',  loop: false },
  excited:    { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 1.0,  vrmaUrl: '/models/animations/Jump.vrma',      loop: false },
  angry:      { expression: VRMExpressionPresetName.Angry,     expressionIntensity: 0.9,  vrmaUrl: '/models/animations/Angry.vrma',     loop: false },
  sad:        { expression: VRMExpressionPresetName.Sad,       expressionIntensity: 0.8,  vrmaUrl: '/models/animations/Sad.vrma',       loop: false },
  surprised:  { expression: VRMExpressionPresetName.Surprised, expressionIntensity: 0.9,  vrmaUrl: '/models/animations/Surprised.vrma', loop: false },
  blush:      { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.6,  vrmaUrl: '/models/animations/Blush.vrma',     loop: false },
  sleepy:     { expression: VRMExpressionPresetName.Relaxed,   expressionIntensity: 0.7,  vrmaUrl: '/models/animations/Sleepy.vrma',    loop: false },
  thinking:   { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.2,  vrmaUrl: '/models/animations/Thinking.vrma', loop: false },
  relax:      { expression: VRMExpressionPresetName.Relaxed,   expressionIntensity: 0.6,  vrmaUrl: '/models/animations/Relax.vrma',     loop: true  },
  goodbye:    { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.5,  vrmaUrl: '/models/animations/Goodbye.vrma',   loop: false },
  // ── aliases / legacy names used in brain.ts ───────────────────────────────
  neutral:       { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Relax.vrma',     loop: true  },
  celebration:   { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 1.0, vrmaUrl: '/models/animations/Clapping.vrma',  loop: false },
  encouraging:   { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.7, vrmaUrl: '/models/animations/Relax.vrma',     loop: false },
  strictEvaluation: { expression: VRMExpressionPresetName.Angry,  expressionIntensity: 0.5, vrmaUrl: '/models/animations/Thinking.vrma', loop: false },
  friendly:      { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.6, vrmaUrl: '/models/animations/Clapping.vrma',  loop: false },
};

/**
 * EMOTION_ANIMATION_MAP — exportable for brain.ts
 */
export const EMOTION_ANIMATION_MAP = {
  neutral:    { animation: 'Relax',     expression: 'neutral'  },
  happy:      { animation: 'Clapping',  expression: 'happy'    },
  excited:    { animation: 'Jump',      expression: 'happy'    },
  angry:      { animation: 'Angry',     expression: 'angry'    },
  sad:        { animation: 'Sad',       expression: 'sad'      },
  surprised:  { animation: 'Surprised', expression: 'surprised'},
  blush:      { animation: 'Blush',     expression: 'happy'    },
  sleepy:     { animation: 'Sleepy',    expression: 'relaxed'  },
  thinking:   { animation: 'Thinking',  expression: 'neutral'  },
  relax:      { animation: 'Relax',     expression: 'relaxed'  },
  goodbye:    { animation: 'Goodbye',   expression: 'neutral'  },
} as const;

// ── Emotion → VRM expression preset weights (for smooth blending) ────────────
const EMOTION_EXPR_WEIGHTS: Record<string, Partial<Record<VRMExpressionPresetName, number>>> = {
  normal:           { [VRMExpressionPresetName.Neutral]:   0.25 },
  neutral:          { [VRMExpressionPresetName.Neutral]:   0.25 },
  happy:            { [VRMExpressionPresetName.Happy]:     0.85 },
  excited:          { [VRMExpressionPresetName.Happy]:     1.00 },
  angry:            { [VRMExpressionPresetName.Angry]:     0.90 },
  sad:              { [VRMExpressionPresetName.Sad]:       0.80 },
  surprised:        { [VRMExpressionPresetName.Surprised]: 0.90 },
  blush:            { [VRMExpressionPresetName.Happy]:     0.60 },
  sleepy:           { [VRMExpressionPresetName.Relaxed]:   0.70 },
  thinking:         { [VRMExpressionPresetName.Neutral]:   0.20, [VRMExpressionPresetName.Relaxed]: 0.30 },
  relax:            { [VRMExpressionPresetName.Relaxed]:   0.60 },
  goodbye:          { [VRMExpressionPresetName.Happy]:     0.50 },
  celebration:      { [VRMExpressionPresetName.Happy]:     1.00 },
  encouraging:      { [VRMExpressionPresetName.Happy]:     0.70 },
  strictEvaluation: { [VRMExpressionPresetName.Angry]:     0.50, [VRMExpressionPresetName.Neutral]: 0.20 },
  friendly:         { [VRMExpressionPresetName.Happy]:     0.65 },
};

const ALL_EXPR_PRESETS = [
  VRMExpressionPresetName.Angry,
  VRMExpressionPresetName.Happy,
  VRMExpressionPresetName.Sad,
  VRMExpressionPresetName.Surprised,
  VRMExpressionPresetName.Relaxed,
  VRMExpressionPresetName.Neutral,
] as const;

export class EmotionManager {
  private _vrm: VRM | null = null;
  /** External mixer shared with VRMAvatar — avoids double-mixer conflict */
  private _mixer: THREE.AnimationMixer | null = null;
  private _currentAction: THREE.AnimationAction | null = null;
  private _currentEmotion: string = 'neutral';
  private _clipCache: Map<string, THREE.AnimationClip> = new Map();
  private _loader: GLTFLoader;
  private _isLoading = false;

  /** Smooth expression blending: target weights and current interpolated weights */
  private _exprTarget:  Partial<Record<VRMExpressionPresetName, number>> = {};
  private _exprCurrent: Map<VRMExpressionPresetName, number> = new Map(
    ALL_EXPR_PRESETS.map(p => [p, 0] as [VRMExpressionPresetName, number])
  );
  /** Blend speed: controls how fast expressions change (higher = faster) */
  private _blendSpeed = 4.5;

  constructor(vrm?: VRM, mixer?: THREE.AnimationMixer) {
    this._loader = new GLTFLoader();
    this._loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    if (vrm) this.setVRM(vrm, mixer);
  }

  setVRM(vrm: VRM, mixer?: THREE.AnimationMixer) {
    this._vrm = vrm;
    // Use the provided external mixer — or create one only if none was given
    // NOTE: do NOT auto-start Idle loop here; that would override procedural gestures
    this._mixer = mixer ?? new THREE.AnimationMixer(vrm.scene);
  }

  get currentEmotion(): string {
    return this._currentEmotion;
  }

  /**
   * Apply one of the 11 emotions.
   * Sets TARGET expression weights (smoothly blended in update()) and plays VRMA body animation.
   */
  setEmotion(emotion: string) {
    const cfg = EMOTION_CONFIG[emotion] ?? EMOTION_CONFIG['normal'];
    this._currentEmotion = emotion;

    // ── face expression: set target (blended in update loop) ────────────────
    this._exprTarget = EMOTION_EXPR_WEIGHTS[emotion] ?? EMOTION_EXPR_WEIGHTS['neutral'] ?? {};

    // ── body animation ────────────────────────────────────────────────────────
    this._playVRMA(cfg.vrmaUrl, false, () => {
      // After one-shot finishes: fade back to neutral target
      this._exprTarget = EMOTION_EXPR_WEIGHTS['neutral'] ?? {};
    });
  }

  /**
   * Must be called every frame (delta in seconds).
   * Blends face expressions smoothly toward the current emotion target.
   */
  update(delta: number) {
    this._mixer?.update(delta);
    this._blendExpressions(delta);
  }

  private _blendExpressions(delta: number) {
    if (!this._vrm?.expressionManager) return;
    const mgr    = this._vrm.expressionManager;
    const factor = Math.min(1, delta * this._blendSpeed);

    for (const preset of ALL_EXPR_PRESETS) {
      const target  = this._exprTarget[preset] ?? 0;
      const current = this._exprCurrent.get(preset) ?? 0;
      const next    = current + (target - current) * factor;
      this._exprCurrent.set(preset, next);
      mgr.setValue(preset, next);
    }
  }

  /** Fade face expressions back to neutral using the smooth blend system. */
  resetToNeutral(_durationMs = 500) {
    this._exprTarget = EMOTION_EXPR_WEIGHTS['neutral'] ?? {};
  }

  // ── Phase 10: Blink-pattern dispatchers ───────────────────────────────────
  // These dispatch avatar:blink events handled by AvatarCanvas's forcedBlinkRef.

  /** 3 rapid blinks — celebration / high-excitement reactions. */
  rapidTripleBlink(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: 'rapid', count: 3 } }));
  }

  /** One slow, deliberate blink — thinking / warm / friendly replies. */
  slowSingleBlink(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: 'slow' } }));
  }

  /** Slow blink combined with head droop — sad / apologetic feedback. */
  slowMournfulBlink(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('avatar:blink',    { detail: { style: 'slow' } }));
    window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: 0, pitch: 0.12, duration: 2800 } }));
  }

  /** Two quick blinks in succession — surprised / double-take reaction. */
  doubleBlink(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: 'double', count: 2 } }));
  }

  /** Dispatch a short micro-expression overlay event to the avatar canvas. */
  triggerMicroExpression(type: string, intensity = 0.7, durationSec = 0.6): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('avatar:micro', {
      detail: { type, intensity, duration: durationSec },
    }));
  }

  // ── private ───────────────────────────────────────────────────────────────

  /** @deprecated — use setEmotion() + update(delta) for smooth blending */
  private _applyFaceExpression(preset: VRMExpressionPresetName, intensity: number) {
    // Set target and let the blend loop handle the transition
    this._exprTarget = { [preset]: intensity };
  }

  private async _playVRMA(url: string, loop: boolean, onFinished?: () => void) {
    if (!this._vrm || !this._mixer) return;

    // Stop current action
    if (this._currentAction) {
      this._currentAction.fadeOut(0.3);
    }

    let clip = this._clipCache.get(url);

    if (!clip) {
      if (this._isLoading) return;
      this._isLoading = true;
      try {
        const gltf = await this._loader.loadAsync(url);
        const vrmAnimation: VRMAnimation | undefined = (gltf as any).userData?.vrmAnimations?.[0];
        if (vrmAnimation && this._vrm) {
          clip = createVRMAnimationClip(vrmAnimation, this._vrm);
          this._clipCache.set(url, clip);
        }
      } catch (e) {
        console.warn(`[EmotionManager] Failed to load VRMA: ${url}`, e);
        this._isLoading = false;
        return;
      }
      this._isLoading = false;
    }

    if (!clip || !this._mixer) return;

    const action = this._mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.fadeIn(0.3);
    action.play();
    this._currentAction = action;

    if (!loop && onFinished) {
      const onFinish = () => {
        this._mixer?.removeEventListener('finished', onFinish);
        onFinished();
      };
      this._mixer.addEventListener('finished', onFinish);
    }
  }

  dispose() {
    this._currentAction?.stop();
    this._mixer?.stopAllAction();
    this._mixer = null;
    this._vrm = null;
    this._clipCache.clear();
  }
}
