import { isAvatarEnabled } from "@/lib/features";

/**
 * Mount point for any future <Avatar /> / 3D experience.
 * Renders nothing unless NEXT_PUBLIC_USE_AVATAR === 'true' (and then only when you add the real component).
 * Does not import Three.js / VRM / Canvas so the bundle stays text-only.
 */
export function OptionalAvatarMount() {
  if (!isAvatarEnabled()) {
    return null;
  }
  // Future: return <Avatar ... /> or dynamic(() => import('./HeavyAvatar'), { ssr: false })
  return null;
}
