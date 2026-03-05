/**
 * AvatarHumanProUltra.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-exports the inner AvatarHumanProUltra R3F component from AvatarViewer
 * with VRMChat-compatible type names.
 *
 * VRMChat.tsx expects:
 *   - default export  → AvatarHumanProUltra  (forwardRef component)
 *   - AvatarUltraRef  → imperative handle type
 *   - UltraEmotion    → emotion union type
 */

import type { AvatarUltraHandle } from '../AvatarViewer';

// Re-export the inner forwardRef component as default
export { AvatarHumanProUltra as default } from '../AvatarViewer';

// Re-export shared types
export type { UltraEmotion, UltraGesture } from '../AvatarViewer';

// Provide VRMChat's expected name for the handle interface
export type AvatarUltraRef = AvatarUltraHandle;
