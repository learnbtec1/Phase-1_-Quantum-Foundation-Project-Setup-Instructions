/**
 * PositionManager — derived from r3f-vrm (DavidCks/r3f-vrm)
 * Manages VRM avatar position and locomotion (walk/idle/stop).
 */
import { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';

export type LocomotionState = 'idle' | 'walking' | 'stopping';

export interface PositionManagerConfig {
  walkSpeed: number;      // units/sec, default 1.2
  turnSpeed: number;      // rad/sec, default 2.0
  walkBounds: {           // XZ bounds avatar stays within
    minX: number; maxX: number;
    minZ: number; maxZ: number;
  };
}

const DEFAULT_CONFIG: PositionManagerConfig = {
  walkSpeed: 1.2,
  turnSpeed: 2.0,
  walkBounds: { minX: -3, maxX: 3, minZ: -2, maxZ: 2 },
};

export class PositionManager {
  private _vrm: VRM | null = null;
  private _position = new THREE.Vector3();
  private _targetPosition: THREE.Vector3 | null = null;
  private _direction = new THREE.Vector3(0, 0, 1);
  private _state: LocomotionState = 'idle';
  private _config: PositionManagerConfig;
  private _onArrival: (() => void) | null = null;

  constructor(vrm?: VRM, config?: Partial<PositionManagerConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    if (vrm) this.setVRM(vrm);
  }

  setVRM(vrm: VRM) {
    this._vrm = vrm;
    vrm.scene.getWorldPosition(this._position);
  }

  get position(): THREE.Vector3 {
    return this._position.clone();
  }

  get state(): LocomotionState {
    return this._state;
  }

  get isWalking(): boolean {
    return this._state === 'walking';
  }

  /**
   * Start moving toward a world-space target.
   * @param target destination Vector3 (y is ignored, avatar stays on floor)
   * @param onArrival optional callback when destination reached
   */
  walkTo(target: THREE.Vector3, onArrival?: () => void) {
    const clamped = new THREE.Vector3(
      THREE.MathUtils.clamp(target.x, this._config.walkBounds.minX, this._config.walkBounds.maxX),
      this._position.y,
      THREE.MathUtils.clamp(target.z, this._config.walkBounds.minZ, this._config.walkBounds.maxZ),
    );
    this._targetPosition = clamped;
    this._state = 'walking';
    this._onArrival = onArrival ?? null;
  }

  /** Walk forward in current facing direction for a given duration (seconds). */
  walkForward(durationMs: number) {
    const forward = this._direction.clone().setY(0).normalize();
    const target = this._position.clone().addScaledVector(forward, this._config.walkSpeed * (durationMs / 1000));
    this.walkTo(target);
    setTimeout(() => this.stop(), durationMs);
  }

  /** Stop moving. */
  stop() {
    this._state = 'stopping';
    this._targetPosition = null;
    // Brief stopping state, then idle
    setTimeout(() => { this._state = 'idle'; }, 200);
  }

  /** Teleport without animation. */
  setPosition(pos: THREE.Vector3) {
    this._position.copy(pos);
    this._syncToVRM();
  }

  /**
   * Call every frame from useFrame.
   * @param delta seconds since last frame
   */
  update(delta: number) {
    if (!this._vrm || this._state !== 'walking' || !this._targetPosition) return;

    const toTarget = this._targetPosition.clone().sub(this._position).setY(0);
    const dist = toTarget.length();

    if (dist < 0.05) {
      // Arrived
      this._position.copy(this._targetPosition);
      this._syncToVRM();
      this._state = 'idle';
      this._targetPosition = null;
      this._onArrival?.();
      this._onArrival = null;
      return;
    }

    // Turn toward target
    const desiredDir = toTarget.clone().normalize();
    this._direction.lerp(desiredDir, Math.min(1, this._config.turnSpeed * delta));
    this._direction.normalize();

    // Apply facing to VRM
    const angle = Math.atan2(this._direction.x, this._direction.z);
    this._vrm.scene.rotation.y = angle;

    // Move
    const step = Math.min(dist, this._config.walkSpeed * delta);
    this._position.addScaledVector(desiredDir, step);
    this._syncToVRM();
  }

  private _syncToVRM() {
    if (this._vrm) {
      this._vrm.scene.position.copy(this._position);
    }
  }

  dispose() {
    this._vrm = null;
    this._targetPosition = null;
    this._onArrival = null;
  }
}
