import type { VRM } from '@pixiv/three-vrm';
import type { AnimationMixer } from 'three';

/**
 * Stops every action on the Cogni VRM mixer, drops cached mixer state for the VRM root,
 * and restores the humanoid to its bind rest pose (T-stance). Call before attaching
 * new VRMA clips so `clipAction` starts from a clean slate.
 *
 * Requires the same root passed to `new AnimationMixer(vrm.scene)` (typical for VRMA).
 */
export function stopAllCogniAnimations(
  mixer: AnimationMixer | null | undefined,
  vrm: VRM | null | undefined,
): void {
  if (!mixer || !vrm?.humanoid) return;

  mixer.stopAllAction();
  mixer.uncacheRoot(vrm.scene);

  const { humanoid } = vrm;
  if (humanoid.autoUpdateHumanBones) {
    humanoid.resetNormalizedPose();
  } else {
    humanoid.resetRawPose();
  }
  humanoid.update();

  vrm.springBoneManager?.setInitState();
  vrm.springBoneManager?.reset();

  vrm.update(0);
}
