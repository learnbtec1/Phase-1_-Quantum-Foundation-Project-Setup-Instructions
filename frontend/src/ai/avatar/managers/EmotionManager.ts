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
  | 'neutral' | 'celebration' | 'encouraging' | 'strictEvaluation' | 'friendly'
  // situational / new animations
  | 'sitting_idle' | 'sitting_talking' | 'pacing' | 'cheering'
  | 'idle1' | 'idle2' | 'idle3' | 'idle4'
  | 'look_around' | 'jump_high'
  // full 30-file animation library
  | 'waving' | 'typing' | 'pointing' | 'beckoning' | 'agreeing' | 'acknowledging'
  | 'sitting_talking_2' | 'look_around_2';

interface EmotionConfig {
  /** VRM expression preset name  */
  expression: VRMExpressionPresetName;
  /** expression weight 0–1 */
  expressionIntensity: number;
  /** URL of VRMA animation file (relative to /public) */
  vrmaUrl: string;
  /** loop the animation? */
  loop: boolean;
  /** per-emotion blend speed (overrides global _blendSpeed) */
  blendSpeed?: number;
}

/**
 * 11 emotions from AIMascotKit + neutral alias.
 * VRMA files copied from AIMascotKit/assets/animations/.
 */
export const EMOTION_CONFIG: Record<string, EmotionConfig> = {
  // ── core 11 from AIMascotKit ──────────────────────────────────────────────
  normal:     { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3,  vrmaUrl: '/models/animations/Relax.vrma',     loop: true,  blendSpeed: 3.0 },
  happy:      { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.9,  vrmaUrl: '/models/animations/Clapping.vrma',  loop: false, blendSpeed: 5.0 },
  excited:    { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 1.0,  vrmaUrl: '/models/animations/Jump.vrma',      loop: false, blendSpeed: 7.0 },
  angry:      { expression: VRMExpressionPresetName.Angry,     expressionIntensity: 0.9,  vrmaUrl: '/models/animations/Angry.vrma',     loop: false, blendSpeed: 6.0 },
  sad:        { expression: VRMExpressionPresetName.Sad,       expressionIntensity: 0.8,  vrmaUrl: '/models/animations/Sad.vrma',       loop: false, blendSpeed: 1.5 },
  surprised:  { expression: VRMExpressionPresetName.Surprised, expressionIntensity: 0.9,  vrmaUrl: '/models/animations/Surprised.vrma', loop: false, blendSpeed: 8.0 },
  blush:      { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.6,  vrmaUrl: '/models/animations/Blush.vrma',     loop: false, blendSpeed: 4.0 },
  sleepy:     { expression: VRMExpressionPresetName.Relaxed,   expressionIntensity: 0.7,  vrmaUrl: '/models/animations/Sleepy.vrma',    loop: false, blendSpeed: 2.0 },
  thinking:   { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.2,  vrmaUrl: '/models/animations/Thinking.vrma', loop: false, blendSpeed: 3.0 },
  relax:      { expression: VRMExpressionPresetName.Relaxed,   expressionIntensity: 0.6,  vrmaUrl: '/models/animations/Relax.vrma',     loop: true,  blendSpeed: 2.0 },
  goodbye:    { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.5,  vrmaUrl: '/models/animations/Goodbye.vrma',   loop: false, blendSpeed: 3.0 },
  // ── aliases / legacy names used in brain.ts ───────────────────────────────
  neutral:       { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Relax.vrma',     loop: true,  blendSpeed: 3.0 },
  celebration:   { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 1.0, vrmaUrl: '/models/animations/Clapping.vrma',  loop: false, blendSpeed: 7.0 },
  encouraging:   { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.7, vrmaUrl: '/models/animations/Relax.vrma',     loop: false, blendSpeed: 4.0 },
  strictEvaluation: { expression: VRMExpressionPresetName.Angry,  expressionIntensity: 0.5, vrmaUrl: '/models/animations/Thinking.vrma', loop: false, blendSpeed: 5.0 },
  friendly:      { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.6, vrmaUrl: '/models/animations/Clapping.vrma',  loop: false, blendSpeed: 4.0 },
  // ── situational / new animations ─────────────────────────────────────────
  sitting_idle:    { expression: VRMExpressionPresetName.Relaxed,   expressionIntensity: 0.5, vrmaUrl: '/models/animations/sitting.vrma',                        loop: true,  blendSpeed: 2.0 },
  sitting_talking: { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/SittingTalking.vrma',                loop: true,  blendSpeed: 3.0 },
  pacing:          { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.4, vrmaUrl: '/models/animations/Pacing And Talking On A Phone.vrma', loop: true,  blendSpeed: 2.0 },
  cheering:        { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 1.0, vrmaUrl: '/models/animations/Standing Cheering.vrma',             loop: false, blendSpeed: 5.0 },
  idle1:           { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.2, vrmaUrl: '/models/animations/Idle1.vrma',                          loop: true,  blendSpeed: 2.5 },
  idle2:           { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.2, vrmaUrl: '/models/animations/Idle2.vrma',                          loop: true,  blendSpeed: 2.5 },
  idle3:           { expression: VRMExpressionPresetName.Relaxed,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Idle3.vrma',                          loop: true,  blendSpeed: 2.5 },
  idle4:           { expression: VRMExpressionPresetName.Relaxed,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Idle4.vrma',                          loop: true,  blendSpeed: 2.5 },
  look_around:     { expression: VRMExpressionPresetName.Surprised, expressionIntensity: 0.4, vrmaUrl: '/models/animations/LookAround.vrma',                    loop: false, blendSpeed: 4.0 },
  jump_high:       { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.9, vrmaUrl: '/models/animations/JumpHigh.vrma',                       loop: false, blendSpeed: 7.0 },
  // ── full 30-file animation library ────────────────────────────────────────
  waving:              { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.7, vrmaUrl: '/models/animations/Waving.vrma',                       loop: false, blendSpeed: 4.0 },
  typing:              { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.2, vrmaUrl: '/models/animations/Typing.vrma',                       loop: true,  blendSpeed: 2.0 },
  pointing:            { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Pointing.vrma',                     loop: false, blendSpeed: 3.5 },
  beckoning:           { expression: VRMExpressionPresetName.Happy,     expressionIntensity: 0.5, vrmaUrl: '/models/animations/Beckoning.vrma',                    loop: false, blendSpeed: 3.0 },
  agreeing:            { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Agreeing.vrma',                     loop: false, blendSpeed: 4.0 },
  acknowledging:       { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Acknowledging.vrma',                loop: false, blendSpeed: 4.0 },
  sitting_talking_2:   { expression: VRMExpressionPresetName.Neutral,   expressionIntensity: 0.3, vrmaUrl: '/models/animations/Sitting  and talking.vrma',         loop: true,  blendSpeed: 3.0 },
  look_around_2:       { expression: VRMExpressionPresetName.Surprised, expressionIntensity: 0.3, vrmaUrl: '/models/animations/LookAround2.vrma',                  loop: false, blendSpeed: 4.0 },
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
  goodbye:         { animation: 'Goodbye',                       expression: 'neutral'   },
  // ── situational / new ────────────────────────────────────────────────────
  sitting_idle:    { animation: 'sitting',                        expression: 'relaxed'   },
  sitting_talking: { animation: 'SittingTalking',                 expression: 'neutral'   },
  pacing:          { animation: 'Pacing And Talking On A Phone',  expression: 'neutral'   },
  cheering:        { animation: 'Standing Cheering',              expression: 'happy'     },
  idle1:           { animation: 'Idle1',                          expression: 'neutral'   },
  idle2:           { animation: 'Idle2',                          expression: 'neutral'   },
  idle3:           { animation: 'Idle3',                          expression: 'relaxed'   },
  idle4:           { animation: 'Idle4',                          expression: 'relaxed'   },
  look_around:     { animation: 'LookAround',                     expression: 'surprised' },
  jump_high:       { animation: 'JumpHigh',                       expression: 'happy'     },
  // ── full 30-file animation library ────────────────────────────────────────
  waving:              { animation: 'Waving',                     expression: 'happy'     },
  typing:              { animation: 'Typing',                     expression: 'neutral'   },
  pointing:            { animation: 'Pointing',                   expression: 'neutral'   },
  beckoning:           { animation: 'Beckoning',                  expression: 'happy'     },
  agreeing:            { animation: 'Agreeing',                   expression: 'neutral'   },
  acknowledging:       { animation: 'Acknowledging',              expression: 'neutral'   },
  sitting_talking_2:   { animation: 'Sitting  and talking',       expression: 'neutral'   },
  look_around_2:       { animation: 'LookAround2',                expression: 'neutral'   },
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
  // ── situational / new ────────────────────────────────────────────────────
  sitting_idle:     { [VRMExpressionPresetName.Relaxed]:   0.50 },
  sitting_talking:  { [VRMExpressionPresetName.Neutral]:   0.30 },
  pacing:           { [VRMExpressionPresetName.Neutral]:   0.40 },
  cheering:         { [VRMExpressionPresetName.Happy]:     1.00 },
  idle1:            { [VRMExpressionPresetName.Neutral]:   0.20 },
  idle2:            { [VRMExpressionPresetName.Neutral]:   0.20 },
  idle3:            { [VRMExpressionPresetName.Relaxed]:   0.30 },
  idle4:            { [VRMExpressionPresetName.Relaxed]:   0.30 },
  look_around:      { [VRMExpressionPresetName.Surprised]: 0.40 },
  jump_high:        { [VRMExpressionPresetName.Happy]:     0.90 },
  // ── full 30-file animation library ────────────────────────────────────────
  waving:           { [VRMExpressionPresetName.Happy]:     0.70 },
  typing:           { [VRMExpressionPresetName.Neutral]:   0.20 },
  pointing:         { [VRMExpressionPresetName.Neutral]:   0.30 },
  beckoning:        { [VRMExpressionPresetName.Happy]:     0.50 },
  agreeing:         { [VRMExpressionPresetName.Neutral]:   0.30 },
  acknowledging:    { [VRMExpressionPresetName.Neutral]:   0.30 },
  sitting_talking_2:{ [VRMExpressionPresetName.Neutral]:   0.30 },
  look_around_2:    { [VRMExpressionPresetName.Surprised]: 0.30 },
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

  // ── Idle cycling ─────────────────────────────────────────────────────────
  /** Emotions that engage random idle-cycling through idle1–4 */
  private readonly _IDLE_TRIGGER_SET = new Set([
    'neutral', 'normal', 'relax', 'idle1', 'idle2', 'idle3', 'idle4',
  ]);
  /** Pool of looping idle animations to cycle through at random intervals */
  private readonly _IDLE_POOL: AvatarEmotion[] = ['idle1', 'idle2', 'idle3', 'idle4'];
  private _idleCycling     = false;
  private _idleElapsed     = 0;   // seconds since last idle switch
  private _idleTarget      = 7;   // seconds until next switch (re-randomised)
  private _idleIntervalMin = 5;   // minimum seconds between switches
  private _idleIntervalMax = 10;  // maximum seconds between switches
  // ─────────────────────────────────────────────────────────────────────────

  private _microExprs: Map<string, { weight: number; target: number; speed: number }> = new Map([
    ['eyebrowRaise', { weight: 0, target: 0, speed: 8 }],
    ['squint',       { weight: 0, target: 0, speed: 6 }],
    ['halfSmile',    { weight: 0, target: 0, speed: 5 }],
    ['frown',        { weight: 0, target: 0, speed: 4 }],
  ]);

  constructor(vrm?: VRM, mixer?: THREE.AnimationMixer) {
    this._loader = new GLTFLoader();
    this._loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    if (vrm) this.setVRM(vrm, mixer);
  }

  setVRM(vrm: VRM, mixer?: THREE.AnimationMixer) {
    this._vrm = vrm;
    this._mixer = mixer ?? new THREE.AnimationMixer(vrm.scene);
    // Guarantee the avatar is never frozen: start the idle loop as soon as VRM is ready.
    // _playVRMA is async but safe to fire-and-forget here.
    const idleCfg = EMOTION_CONFIG['neutral'];
    void this._playVRMA(idleCfg.vrmaUrl, true);
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

    // ── idle cycling: activate when entering a neutral / idle state ──────────
    const wasIdling = this._idleCycling;
    this._idleCycling = this._IDLE_TRIGGER_SET.has(emotion);
    if (this._idleCycling && !wasIdling) {
      // Entering idle — start a fresh random cycle timer
      this._idleElapsed = 0;
      this._idleTarget  = this._idleIntervalMin +
        Math.random() * (this._idleIntervalMax - this._idleIntervalMin);
    }

    // ── body animation ────────────────────────────────────────────────────────
    if (cfg.loop) {
      // Looping animations: play indefinitely (no onFinished callback needed)
      void this._playVRMA(cfg.vrmaUrl, true);
    } else {
      // One-shot animations: fade back to neutral expression when done
      this._playVRMA(cfg.vrmaUrl, false, () => {
        this._exprTarget = EMOTION_EXPR_WEIGHTS['neutral'] ?? {};
      });
    }
  }

  /**
   * Configure the idle animation cycling interval.
   * @param minSec Minimum seconds between idle switches (default 5)
   * @param maxSec Maximum seconds between idle switches (default 10)
   */
  setIdleInterval(minSec: number, maxSec: number): void {
    this._idleIntervalMin = minSec;
    this._idleIntervalMax = maxSec;
  }

  /**
   * Must be called every frame (delta in seconds).
   * Blends face expressions smoothly toward the current emotion target.
   */
  update(delta: number) {
    this._mixer?.update(delta);
    this._blendExpressions(delta);
    this._updateIdleCycle(delta);
  }

  /** Randomly rotate through idle1–4 while the avatar is in an idle state. */
  private _updateIdleCycle(delta: number): void {
    if (!this._idleCycling) return;
    this._idleElapsed += delta;
    if (this._idleElapsed < this._idleTarget) return;

    // Time to switch — reset timer with a new random interval
    this._idleElapsed = 0;
    this._idleTarget  = this._idleIntervalMin +
      Math.random() * (this._idleIntervalMax - this._idleIntervalMin);

    // Pick a random idle different from the one currently playing
    const pool = this._IDLE_POOL.filter(e => e !== this._currentEmotion);
    const next  = pool[Math.floor(Math.random() * pool.length)] ?? 'idle1';
    const cfg   = EMOTION_CONFIG[next];
    if (!cfg) return;

    this._currentEmotion = next;
    this._exprTarget     = EMOTION_EXPR_WEIGHTS[next] ?? {};
    void this._playVRMA(cfg.vrmaUrl, true);
  }

  private _blendExpressions(delta: number) {
    if (!this._vrm?.expressionManager) return;
    const mgr    = this._vrm.expressionManager;
    const cfg    = EMOTION_CONFIG[this._currentEmotion];
    const speed  = cfg?.blendSpeed ?? this._blendSpeed;
    const factor = Math.min(1, delta * speed);

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

  /**
   * Trigger a subtle warm smile micro-expression.
   * @param intensity - smile weight 0–1 (default 0.6)
   * @param duration  - hold time in seconds (default 2.0)
   */
  warmSmile(intensity = 0.6, duration = 2.0): void {
    const entry = this._microExprs.get('halfSmile');
    if (entry) { entry.target = intensity; entry.speed = 5; }
    setTimeout(() => {
      const e = this._microExprs.get('halfSmile');
      if (e) e.target = 0;
    }, duration * 1000);
  }

  /**
   * Trigger thoughtful look: slight squint + eyebrow raise + gentle head tilt.
   */
  thoughtfulLook(): void {
    const squint = this._microExprs.get('squint');
    const eb     = this._microExprs.get('eyebrowRaise');
    if (squint) { squint.target = 0.4; squint.speed = 6; }
    if (eb)     { eb.target = 0.3;     eb.speed = 5;     }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: 0.08, pitch: 0, duration: 2500 } }));
    }
    setTimeout(() => {
      if (squint) squint.target = 0;
      if (eb)     eb.target = 0;
    }, 2500);
  }

  // ── private ───────────────────────────────────────────────────────────────

  /** @deprecated — use setEmotion() + update(delta) for smooth blending */
  private _applyFaceExpression(preset: VRMExpressionPresetName, intensity: number) {
    // Set target and let the blend loop handle the transition
    this._exprTarget = { [preset]: intensity };
  }

  private async _playVRMA(url: string, loop: boolean, onFinished?: () => void) {
    if (!this._vrm || !this._mixer) return;

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

    const previousAction = this._currentAction;
    const action = this._mixer.clipAction(clip);
    const FADE_DURATION = 0.5; // seconds — fluid crossfade window

    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;

    if (previousAction && previousAction !== action) {
      // crossFadeFrom keeps BOTH actions weighted continuously — no skeleton gap.
      action.crossFadeFrom(previousAction, FADE_DURATION, true);
    } else {
      // First action ever: fade in from zero weight.
      action.fadeIn(FADE_DURATION);
    }

    action.play();
    this._currentAction = action;

    if (!loop) {
      const onFinish = (_e: { type: string; action: THREE.AnimationAction }) => {
        if (_e.action !== action) return; // guard: only react to OUR action
        this._mixer?.removeEventListener('finished', onFinish as never);
        onFinished?.();
        // CRITICAL: return to idle loop so the avatar never freezes after a one-shot.
        const idleUrl = EMOTION_CONFIG['neutral'].vrmaUrl;
        if (url !== idleUrl) {
          void this._playVRMA(idleUrl, true);
        }
      };
      this._mixer.addEventListener('finished', onFinish as never);
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
