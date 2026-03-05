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

export class EmotionManager {
  private _vrm: VRM | null = null;
  /** External mixer shared with VRMAvatar — avoids double-mixer conflict */
  private _mixer: THREE.AnimationMixer | null = null;
  private _currentAction: THREE.AnimationAction | null = null;
  private _currentEmotion: string = 'neutral';
  private _clipCache: Map<string, THREE.AnimationClip> = new Map();
  private _loader: GLTFLoader;
  private _isLoading = false;

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
   * Sets face expression and plays the VRMA body animation.
   */
  setEmotion(emotion: string) {
    const cfg = EMOTION_CONFIG[emotion] ?? EMOTION_CONFIG['normal'];
    this._currentEmotion = emotion;

    // ── face expression ───────────────────────────────────────────────────
    this._applyFaceExpression(cfg.expression, cfg.expressionIntensity);

    // ── body animation ────────────────────────────────────────────────────
    // One-shot only — do NOT loop body animations (would override procedural gestures)
    this._playVRMA(cfg.vrmaUrl, false, () => {
      // After one-shot finishes: reset face to neutral gradually
      setTimeout(() => this._applyFaceExpression(VRMExpressionPresetName.Neutral, 0.15), 800);
    });
  }

  /**
   * Must be called every frame (delta in seconds).
   * NOTE: Only call this if using EmotionManager's own internal mixer.
   * If you passed an external mixer in setVRM(), update that mixer externally.
   */
  update(delta: number) {
    this._mixer?.update(delta);
  }

  /** Fade current face expressions back to neutral over `durationMs` ms. */
  resetToNeutral(durationMs = 500) {
    if (!this._vrm?.expressionManager) return;
    const mgr = this._vrm.expressionManager;
    const presets = [
      VRMExpressionPresetName.Angry,
      VRMExpressionPresetName.Happy,
      VRMExpressionPresetName.Sad,
      VRMExpressionPresetName.Surprised,
      VRMExpressionPresetName.Relaxed,
    ] as const;
    presets.forEach(p => mgr.setValue(p, 0));
    mgr.setValue(VRMExpressionPresetName.Neutral, 0.2);
  }

  // ── private ───────────────────────────────────────────────────────────────

  private _applyFaceExpression(preset: VRMExpressionPresetName, intensity: number) {
    if (!this._vrm?.expressionManager) return;
    const mgr = this._vrm.expressionManager;
    // Clear all presets first
    const ALL = [
      VRMExpressionPresetName.Angry,
      VRMExpressionPresetName.Happy,
      VRMExpressionPresetName.Sad,
      VRMExpressionPresetName.Surprised,
      VRMExpressionPresetName.Relaxed,
      VRMExpressionPresetName.Neutral,
    ] as const;
    ALL.forEach(p => mgr.setValue(p, p === VRMExpressionPresetName.Neutral ? 0.1 : 0));
    mgr.setValue(preset, intensity);
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
