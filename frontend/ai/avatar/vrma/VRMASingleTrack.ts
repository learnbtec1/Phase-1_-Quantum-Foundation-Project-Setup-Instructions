/**
 * VRMA Single Track — isolated playback (Phase 2).
 *
 * Owns one mixer action slot for VRMA clips only. No procedural bones, no emotion layer.
 * Wire from a host (e.g. VRMAPlayer) when ready; do not import AvatarCanvas here.
 */
import type { VRM } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';
import { ensureVrmLookAtQuaternionProxy } from '@/lib/vrm/ensureLookAtQuaternionProxy';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class VRMASingleTrack {
  private readonly _loader: GLTFLoader;
  private _clipCache = new Map<string, THREE.AnimationClip>();
  private _current: THREE.AnimationAction | null = null;
  private _loadingUrl: string | null = null;

  constructor() {
    this._loader = new GLTFLoader();
    (this._loader as { register: (fn: (parser: unknown) => unknown) => void }).register(
      (parser: unknown) => new VRMAnimationLoaderPlugin(parser as never),
    );
  }

  /** Stop current clip with fade. */
  stop(fade = 0.25): void {
    if (this._current) {
      this._current.fadeOut(fade);
      this._current = null;
    }
  }

  /**
   * Load (once) and play a single VRMA URL on the given mixer for this VRM.
   * @param loop — if false, fires `onFinished` once when the clip ends.
   */
  async play(
    url: string,
    vrm: VRM,
    mixer: THREE.AnimationMixer,
    options: { loop: boolean; fadeIn?: number; onFinished?: () => void },
  ): Promise<void> {
    const { loop, fadeIn = 0.25, onFinished } = options;
    if (this._loadingUrl === url) return;
    this._loadingUrl = url;

    let clip = this._clipCache.get(url);
    if (!clip) {
      const gltf = await this._loader.loadAsync(url);
      const vrmAnimation: VRMAnimation | undefined = (gltf as { userData?: { vrmAnimations?: VRMAnimation[] } }).userData
        ?.vrmAnimations?.[0];
      if (!vrmAnimation) {
        this._loadingUrl = null;
        return;
      }
      ensureVrmLookAtQuaternionProxy(vrm);
      try {
        clip = createVRMAnimationClip(vrmAnimation, vrm) as THREE.AnimationClip;
      } catch (e) {
        console.warn('[VRMASingleTrack] createVRMAnimationClip failed:', e);
        this._loadingUrl = null;
        return;
      }
      this._clipCache.set(url, clip);
    }

    this._loadingUrl = null;
    this.stop(0.15);

    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.fadeIn(fadeIn);
    action.play();
    this._current = action;

    if (!loop && onFinished) {
      const done = () => {
        mixer.removeEventListener('finished', done);
        onFinished();
      };
      mixer.addEventListener('finished', done);
    }
  }

  dispose(): void {
    this.stop(0);
    this._clipCache.clear();
  }
}
