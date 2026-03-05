/**
 * HumanizationRig.ts — IGNIS v15.5
 * ─────────────────────────────────────────────────────────────────────────────
 * Adds human-like embodiment to a VRM avatar:
 *   breath · blink · gaze · head-spring · hand-gestures · lip-sync · idle sway
 *
 * Usage:
 *   const rig = new HumanizationRig(vrm, options)
 *   // inside useFrame:
 *   rig.update(dt)
 *   // dispose on unmount:
 *   rig.dispose()
 *
 * Compatible with VRM 0.x (blendShapeProxy) and VRM 1.x (expressionManager).
 * No external dependencies beyond THREE and @pixiv/three-vrm.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Public types ─────────────────────────────────────────────────────────────

export type EmotionTag =
  | 'neutral' | 'friendly' | 'thinking'
  | 'encouraging' | 'strict' | 'celebrate';

export type VisemeFrame = {
  /** Seconds from start of utterance */
  time: number;
  /** Phoneme / viseme name (a, i, u, e, o … or ARKit names) */
  phoneme: string;
  /** Duration in seconds (optional) */
  duration?: number;
  /** Amplitude 0–1 (optional, defaults to 1) */
  amp?: number;
};

export type RigOptions = {
  enableBreath?: boolean;
  enableBlink?: boolean;
  enableGaze?: boolean;
  enableHead?: boolean;
  enableGestures?: boolean;
  enableLipSync?: boolean;
  enableIdle?: boolean;

  /** Head spring damping ratio (ζ ≈ 0.7–0.9) */
  headSpringZeta?: number;
  /** Head spring natural frequency rad/s */
  headSpringOmega?: number;
  /** Gaze spring damping */
  gazeSpringZeta?: number;
  /** Gaze spring frequency */
  gazeSpringOmega?: number;

  /** Breath Hz low end (0.12–0.18 Hz) */
  breathHzMin?: number;
  breathHzMax?: number;

  /** Blinks per minute low end */
  blinkPerMinMin?: number;
  blinkPerMinMax?: number;

  /** Hold duration (ms) added to consonant visemes to prevent gulping */
  visemeHoldConsonantMs?: number;
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: Required<RigOptions> = {
  enableBreath:   true,
  enableBlink:    true,
  enableGaze:     true,
  enableHead:     true,
  enableGestures: true,
  enableLipSync:  true,
  enableIdle:     true,

  headSpringZeta:  0.75,
  headSpringOmega: 7.5,
  gazeSpringZeta:  0.80,
  gazeSpringOmega: 7.0,

  breathHzMin: 0.12,
  breathHzMax: 0.18,

  blinkPerMinMin: 22,
  blinkPerMinMax: 32,

  visemeHoldConsonantMs: 40,
};

// Phonemes that need the consonant hold to avoid mouth-gulping
const CONSONANT_LIKE = new Set([
  'p','b','m','f','v','t','d','k','g','s','z',
  'sh','zh','ch','jh','l','r','n',
]);

// VRM standard expression name map for visemes
const VISEME_TO_EXPR: Record<string, string> = {
  A: 'A', I: 'I', U: 'U', E: 'E', O: 'O',
  a: 'A', i: 'I', u: 'U', e: 'E', o: 'O',
};

// ─── Main class ───────────────────────────────────────────────────────────────

export class HumanizationRig {
  public vrm: VRM;
  public opts: Required<RigOptions>;
  public disposed = false;

  // Skeleton references — may be undefined if a model lacks certain bones
  private head?: THREE.Object3D;
  private neck?: THREE.Object3D;
  private spine?: THREE.Object3D;
  private rightHand?: THREE.Object3D;
  private leftHand?: THREE.Object3D;

  // Internal clock (accumulated dt)
  private t = 0;

  // Breath
  private breathFreq: number;

  // Blink
  private nextBlinkAt = 0;
  private isBlinking = false;
  private blinkProgress = 0;

  // Gaze / head spring
  private gazeTarget     = new THREE.Vector3(0, 1.5, 1.5);
  private currentGaze    = new THREE.Vector3(0, 1.5, 1.5);
  private headAngles     = { yaw: 0, pitch: 0 };
  private headTarget     = { yaw: 0, pitch: 0 };
  private headVel        = { yaw: 0, pitch: 0 };

  // Idle sway
  private idlePhase: number;

  // Lip-sync
  private visemesQueue:   VisemeFrame[] = [];
  private visemeWeights:  Record<string, number> = {};
  private visemeDecay     = 10;     // units/second
  private lastVisemeTime  = 0;
  private lastSentenceAt  = 0;

  // Expression system detection (VRM1 vs VRM0)
  private hasExpressionMgr = false;

  // ─── Constructor ────────────────────────────────────────────────────────────

  constructor(vrm: VRM, options?: RigOptions) {
    this.vrm  = vrm;
    this.opts = { ...DEFAULTS, ...(options ?? {}) };

    this.breathFreq = randRange(this.opts.breathHzMin, this.opts.breathHzMax);
    this.idlePhase  = Math.random() * Math.PI * 2;

    this.bindBones();
    this.detectVersion();
    this.scheduleNextBlink(0);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Called every frame from useFrame — pass Three.js frame delta (seconds). */
  public update(dt: number) {
    if (this.disposed) return;
    // Clamp dt to avoid explosion after tab-backgrounding
    const d = Math.min(dt, 1 / 15);
    this.t += d;

    if (this.opts.enableBreath)                 this.updateBreath(d);
    if (this.opts.enableBlink)                  this.updateBlink(d);
    if (this.opts.enableGaze || this.opts.enableHead) this.updateGazeAndHead(d);
    if (this.opts.enableIdle)                   this.updateIdle(d);
    if (this.opts.enableLipSync)                this.updateLipSync(d);

    // Flush VRM expression updates
    this.flushExpressions();
  }

  /** Map an IGNIS emotion tag to facial expressions. */
  public setEmotion(tag: EmotionTag) {
    switch (tag) {
      case 'friendly':
      case 'encouraging':
      case 'celebrate':
        this.setExpr('Joy',    0.35, 0.15);
        this.setExpr('Angry',  0.0);
        this.setExpr('Sorrow', 0.0);
        break;
      case 'thinking':
        this.setExpr('Sorrow', 0.15, 0.20);
        this.setExpr('Joy',    0.0);
        this.setExpr('Angry',  0.0);
        break;
      case 'strict':
        this.setExpr('Angry',  0.22, 0.15);
        this.setExpr('Joy',    0.0);
        this.setExpr('Sorrow', 0.0);
        break;
      default:
        this.setExpr('Joy',    0.0);
        this.setExpr('Angry',  0.0);
        this.setExpr('Sorrow', 0.0);
        break;
    }
  }

  /** Feed word-timing visemes from TTS. Call just before or at audio play start. */
  public feedVisemes(timings: VisemeFrame[], sentenceJustEnded = false) {
    this.visemesQueue  = [...timings].sort((a, b) => a.time - b.time);
    this.lastVisemeTime = this.t;
    if (sentenceJustEnded) this.lastSentenceAt = this.t;
  }

  /** Set the 3-D point Verona should look at (world space). */
  public setGazeTarget(v: THREE.Vector3 | { x: number; y: number; z: number }) {
    this.gazeTarget.set(v.x, v.y, v.z);
  }

  /** Trigger a named gesture. */
  public playGesture(name: 'wave' | 'point' | 'open' | 'affirm', strength = 1.0) {
    if (!this.opts.enableGestures) return;
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    switch (name) {
      case 'wave':
        if (this.rightHand) {
          const rh = this.rightHand;
          rh.rotation.z = THREE.MathUtils.degToRad(12 * s);
          setTimeout(() => { rh.rotation.z = THREE.MathUtils.degToRad(-10 * s); }, 140);
          setTimeout(() => { rh.rotation.z = 0; }, 280);
        }
        break;
      case 'point':
        this.setExpr('LookRight', 0.2, 0.12);
        setTimeout(() => this.setExpr('LookRight', 0.0, 0.12), 600);
        break;
      case 'open':
      case 'affirm':
        // Subtle confirming head nod via pitch target
        this.headTarget.pitch = clampN(this.headTarget.pitch + THREE.MathUtils.degToRad(4 * s), -0.35, 0.35);
        setTimeout(() => { this.headTarget.pitch = 0; }, 500);
        break;
    }
  }

  /** Release all resources. Call on component unmount. */
  public dispose() {
    this.disposed = true;
    this.zeroVisemes();
    ['Blink','Joy','Angry','Sorrow'].forEach(k => this.setExpr(k, 0));
    this.flushExpressions();
  }

  // ─── Private: per-frame updates ─────────────────────────────────────────────

  private updateBreath(dt: number) {
    // Slowly drift breath frequency for natural variability
    this.breathFreq = lerp(
      this.breathFreq,
      randRange(this.opts.breathHzMin, this.opts.breathHzMax),
      dt * 0.04
    );
    const amp    = 0.018 + Math.sin(this.t * 0.11) * 0.004;
    const breath = Math.sin(this.t * Math.PI * 2 * this.breathFreq) * amp;
    if (this.spine) this.spine.position.y = breath;
  }

  private scheduleNextBlink(now: number) {
    const bpm      = randRange(this.opts.blinkPerMinMin, this.opts.blinkPerMinMax);
    const interval = 60 / bpm;
    const jitter   = randRange(-0.18, 0.18);
    // Slightly faster after a sentence ends (simulates natural response blink)
    const recencyMult = (this.t - this.lastSentenceAt) < 1.5 ? 0.55 : 1.0;
    this.nextBlinkAt = now + (interval + jitter) * recencyMult;
  }

  private updateBlink(dt: number) {
    void dt; // consumed implicitly via blindTween's rAF
    if (this.t >= this.nextBlinkAt && !this.isBlinking) {
      this.isBlinking = true;
      this.animateBlink();
      this.scheduleNextBlink(this.t);
    }
  }

  private animateBlink() {
    // ~60 ms close + 45 ms open — fast natural blink
    this.tween(0, 1, 0.06, v => {
      this.blinkProgress = v;
      this.setExpr('Blink', v);
    }, () => {
      this.tween(1, 0, 0.045, v => {
        this.blinkProgress = v;
        this.setExpr('Blink', v);
      }, () => { this.isBlinking = false; });
    });
  }

  private updateGazeAndHead(dt: number) {
    // Spring-damp gaze towards target
    this.currentGaze = springVec3(
      this.currentGaze, this.gazeTarget,
      this.opts.gazeSpringZeta, this.opts.gazeSpringOmega, dt,
    );

    // Add micro-saccade every 2–5 s (tiny random offset)
    if (Math.sin(this.t * 0.7) > 0.997) {
      const jx = randRange(-0.03, 0.03);
      const jy = randRange(-0.02, 0.02);
      this.currentGaze.x += jx;
      this.currentGaze.y += jy;
    }

    // Direction from head towards gaze point
    const headWPos = this.head
      ? this.head.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(0, 1.5, 0);
    const dir = new THREE.Vector3().subVectors(this.currentGaze, headWPos).normalize();

    // Derive yaw/pitch
    const yaw   = Math.atan2(dir.x, dir.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.7, 0.7));

    this.headTarget.yaw   = THREE.MathUtils.clamp(yaw   *  0.50, -0.60,  0.60);
    this.headTarget.pitch = THREE.MathUtils.clamp(pitch * -0.45, -0.35,  0.35);

    // Spring integration
    const { angles, vel } = spring2D(
      this.headAngles, this.headTarget, this.headVel,
      this.opts.headSpringZeta, this.opts.headSpringOmega, dt,
    );
    this.headAngles = angles;
    this.headVel    = vel;

    if (this.head && this.opts.enableHead) {
      this.head.rotation.y = this.headAngles.yaw;
      this.head.rotation.x = this.headAngles.pitch;
    }
  }

  private updateIdle(dt: number) {
    void dt;
    this.idlePhase += dt * 0.55;
    const sway = Math.sin(this.idlePhase) * 0.008;
    if (this.neck) this.neck.position.x = sway;
  }

  private updateLipSync(dt: number) {
    // Decay all active viseme weights
    for (const k of Object.keys(this.visemeWeights)) {
      this.visemeWeights[k] = Math.max(0, this.visemeWeights[k] - this.visemeDecay * dt);
      this.applyViseme(k, this.visemeWeights[k]);
    }

    if (!this.visemesQueue.length) return;

    const elapsed = this.t - this.lastVisemeTime;

    // Drain all frames whose time has arrived
    while (this.visemesQueue.length && this.visemesQueue[0].time <= elapsed + 0.025) {
      const vf   = this.visemesQueue.shift()!;
      const key  = phonemeToViseme(vf.phoneme);
      const peak = THREE.MathUtils.clamp(vf.amp ?? 1.0, 0, 1);
      const isCon = CONSONANT_LIKE.has(vf.phoneme.toLowerCase());
      const holdMs = isCon ? this.opts.visemeHoldConsonantMs : Math.max(0, (vf.duration ?? 0.07) * 1000 * 0.75);

      this.visemeWeights[key] = Math.max(this.visemeWeights[key] ?? 0, peak);
      this.applyViseme(key, this.visemeWeights[key]);

      // Queue decay after hold
      const k = key;
      setTimeout(() => {
        if (!this.disposed) {
          this.visemeWeights[k] = Math.max(0, (this.visemeWeights[k] ?? 0) - 0.45);
        }
      }, Math.max(1, holdMs));
    }
  }

  // ─── Expression helpers (VRM0/1 unified) ────────────────────────────────────

  private _exprPending: Record<string, number> = {};

  private setExpr(name: string, weight: number, lerpAmt = 1.0) {
    const current = this._exprPending[name] ?? this.getExpr(name);
    this._exprPending[name] = THREE.MathUtils.lerp(current, THREE.MathUtils.clamp(weight, 0, 1), lerpAmt);
  }

  private getExpr(name: string): number {
    const v = this.vrm as any;
    if (this.hasExpressionMgr) return v.expressionManager?.getValue(name) ?? 0;
    return v.blendShapeProxy?.getValue(name) ?? 0;
  }

  private flushExpressions() {
    const v = this.vrm as any;
    for (const [name, weight] of Object.entries(this._exprPending)) {
      if (this.hasExpressionMgr) {
        v.expressionManager?.setValue(name, weight);
      } else {
        v.blendShapeProxy?.setValue(name, weight);
      }
    }
    if (this.hasExpressionMgr) v.expressionManager?.update?.();
    else v.blendShapeProxy?.update?.();
    this._exprPending = {};
  }

  private applyViseme(key: string, weight: number) {
    const exprName = VISEME_TO_EXPR[key] ?? key;
    this.setExpr(exprName, weight);
  }

  private zeroVisemes() {
    for (const v of ['A','I','U','E','O']) this.setExpr(v, 0);
    this.visemeWeights = {};
  }

  // ─── Ramp tween (rAF-based, no external dep) ────────────────────────────────

  private tween(
    from: number, to: number, duration: number,
    onUpdate: (v: number) => void, onDone?: () => void,
  ) {
    const start = performance.now();
    const tick = () => {
      if (this.disposed) return;
      const elapsed = (performance.now() - start) / 1000;
      const t = Math.min(1, elapsed / Math.max(duration, 0.001));
      onUpdate(from + (to - from) * easeInOutQuad(t));
      if (t < 1) requestAnimationFrame(tick);
      else onDone?.();
    };
    requestAnimationFrame(tick);
  }

  // ─── Bone binding ────────────────────────────────────────────────────────────

  private bindBones() {
    const h = (this.vrm as any).humanoid;
    // VRM 0.x uses getBoneNode, VRM 1.x uses getBone()?.node
    const get = (name: string): THREE.Object3D | undefined =>
      h?.getBoneNode?.(name) ?? h?.getBone?.(name)?.node ?? undefined;

    this.head      = get('head');
    this.neck      = get('neck');
    this.spine     = get('spine');
    this.leftHand  = get('leftHand');
    this.rightHand = get('rightHand');
  }

  private detectVersion() {
    this.hasExpressionMgr = !!(this.vrm as any).expressionManager;
  }
}

// ─── Pure math helpers ────────────────────────────────────────────────────────

function randRange(a: number, b: number) { return a + Math.random() * (b - a); }
function clampN(v: number, lo: number, hi: number) { return Math.min(Math.max(v, lo), hi); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function spring2D(
  angles: { yaw: number; pitch: number },
  target:  { yaw: number; pitch: number },
  vel:     { yaw: number; pitch: number },
  zeta: number, omega: number, dt: number,
) {
  const ay = -2 * zeta * omega * vel.yaw   - omega * omega * (angles.yaw   - target.yaw);
  const ap = -2 * zeta * omega * vel.pitch - omega * omega * (angles.pitch - target.pitch);
  const newVel    = { yaw: vel.yaw + ay * dt,     pitch: vel.pitch + ap * dt };
  const newAngles = { yaw: angles.yaw + newVel.yaw * dt, pitch: angles.pitch + newVel.pitch * dt };
  return { angles: newAngles, vel: newVel };
}

function springVec3(
  cur: THREE.Vector3, target: THREE.Vector3,
  zeta: number, omega: number, dt: number,
): THREE.Vector3 {
  const k = 1 - Math.exp(-omega * zeta * dt);
  return cur.clone().lerp(target, k);
}

function phonemeToViseme(p: string): string {
  const k = p.toLowerCase();
  if (['a','aa','ah'].includes(k))           return 'A';
  if (['i','ee','ih'].includes(k))           return 'I';
  if (['u','oo','uh'].includes(k))           return 'U';
  if (['e','eh'].includes(k))                return 'E';
  if (['o','oh'].includes(k))                return 'O';
  if (['p','b','m'].includes(k))             return 'U';
  if (['f','v'].includes(k))                 return 'I';
  if (['t','d','s','z','sh','zh','ch','jh'].includes(k)) return 'E';
  if (['l','r','n','y','w','g','k'].includes(k))         return 'A';
  return 'A'; // fallback
}
