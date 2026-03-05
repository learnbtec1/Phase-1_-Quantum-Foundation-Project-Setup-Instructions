/**
 * ExpressionManager — derived from r3f-vrm (DavidCks/r3f-vrm)
 * Manages smooth transitions between VRM face expressions.
 * Supports: angry, happy, neutral, relaxed, sad, surprised
 */
import { VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import * as THREE from 'three';

export interface FaceExpressionFrame {
  /** duration in milliseconds */
  duration: number;
  angry?: number;
  happy?: number;
  neutral?: number;
  relaxed?: number;
  sad?: number;
  surprised?: number;
}

const FACE_KEYS: (keyof Omit<FaceExpressionFrame, 'duration'>)[] = [
  'angry', 'happy', 'neutral', 'relaxed', 'sad', 'surprised',
];

// VRM preset name map
const KEY_TO_PRESET: Record<string, VRMExpressionPresetName> = {
  angry: VRMExpressionPresetName.Angry,
  happy: VRMExpressionPresetName.Happy,
  neutral: VRMExpressionPresetName.Neutral,
  relaxed: VRMExpressionPresetName.Relaxed,
  sad: VRMExpressionPresetName.Sad,
  surprised: VRMExpressionPresetName.Surprised,
};

export class ExpressionManager {
  private _vrm: VRM | null = null;
  private _queue: FaceExpressionFrame[] = [];
  private _currentIndex = 0;
  private _elapsed = 0;
  private _active = false;

  constructor(vrm?: VRM) {
    if (vrm) this._vrm = vrm;
  }

  setVRM(vrm: VRM) {
    this._vrm = vrm;
  }

  /** Read current expression weights from VRM */
  get currentValues(): Record<string, number> {
    if (!this._vrm?.expressionManager) return {};
    const result: Record<string, number> = {};
    for (const key of FACE_KEYS) {
      result[key] = this._vrm.expressionManager.getValue(KEY_TO_PRESET[key]) ?? 0;
    }
    return result;
  }

  /**
   * Set a single expression immediately (no queue).
   * @param name one of: angry | happy | neutral | relaxed | sad | surprised
   * @param intensity 0–1
   * @param fadeDuration ms to fade from current to new, default 300
   */
  setExpression(name: string, intensity: number, fadeDuration = 300) {
    const from = this.currentValues;
    const frame: FaceExpressionFrame = { duration: fadeDuration };
    for (const key of FACE_KEYS) {
      frame[key] = key === name ? intensity : 0;
    }
    this._queue = [
      { ...from, duration: fadeDuration } as FaceExpressionFrame,
      frame,
    ];
    this._currentIndex = 0;
    this._elapsed = 0;
    this._active = true;
  }

  /**
   * Queue multiple frames with smooth interpolation.
   * Automatically appends a neutral reset frame at the end.
   */
  applySequence(frames: FaceExpressionFrame[]) {
    if (frames.length === 0) return;
    this._queue = [...frames, { duration: 300, neutral: 1 }];
    this._currentIndex = 0;
    this._elapsed = 0;
    this._active = true;
    this._applyFrame(frames[0]);
  }

  /**
   * Call every frame from useFrame({ delta }) in seconds.
   */
  update(deltaSeconds: number) {
    if (!this._active || !this._vrm?.expressionManager) return;
    if (this._currentIndex >= this._queue.length - 1) {
      this._active = false;
      return;
    }

    this._elapsed += deltaSeconds * 1000;
    const from = this._queue[this._currentIndex];
    const to = this._queue[this._currentIndex + 1];
    const duration = to.duration ?? 300;

    let t = Math.min(this._elapsed / duration, 1);
    t = THREE.MathUtils.smootherstep(t, 0, 1);

    // Interpolate each key
    for (const key of FACE_KEYS) {
      const vFrom = (from[key] ?? 0) as number;
      const vTo = (to[key] ?? 0) as number;
      const val = vFrom + (vTo - vFrom) * t;
      this._vrm.expressionManager.setValue(KEY_TO_PRESET[key], val);
    }

    if (this._elapsed >= duration) {
      this._currentIndex++;
      this._elapsed = 0;
      if (this._currentIndex < this._queue.length) {
        this._applyFrame(this._queue[this._currentIndex]);
      }
    }
  }

  private _applyFrame(frame: FaceExpressionFrame) {
    if (!this._vrm?.expressionManager) return;
    for (const key of FACE_KEYS) {
      if (frame[key] !== undefined) {
        this._vrm.expressionManager.setValue(KEY_TO_PRESET[key], frame[key] as number);
      }
    }
  }

  dispose() {
    this._vrm = null;
    this._queue = [];
  }
}
