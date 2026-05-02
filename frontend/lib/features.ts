/**
 * Text-first policy: 3D / avatar UI is off unless explicitly enabled.
 * Set NEXT_PUBLIC_USE_AVATAR=true only when product ships an avatar and resources allow.
 */
export function isAvatarEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_AVATAR === "true";
}
