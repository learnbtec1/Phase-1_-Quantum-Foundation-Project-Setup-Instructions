import type { VRM } from '@pixiv/three-vrm';
import { VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';

/**
 * `@pixiv/three-vrm-animation` warns when {@link VRMLookAtQuaternionProxy} is missing from `vrm.scene`
 * before {@link createVRMAnimationClip}. Adding it once suppresses that warning and avoids duplicate creation mid-clip.
 */
export function ensureVrmLookAtQuaternionProxy(vrm: VRM): void {
  if (!vrm.lookAt) return;
  const existing = vrm.scene.children.find(
    (o): o is VRMLookAtQuaternionProxy => o instanceof VRMLookAtQuaternionProxy,
  );
  if (existing) {
    if (!existing.name) existing.name = 'VRMLookAtQuaternionProxy';
    return;
  }
  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
  proxy.name = 'VRMLookAtQuaternionProxy';
  vrm.scene.add(proxy);
}
