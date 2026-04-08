/**
 * Central z-index scale for avatar stack vs HUD vs modals.
 * Keep portal/modal values above AVATAR_PORTAL so WebGL stays under chrome when intended.
 */
export const Z_LAYERS = {
  BASE: 0,
  /** Root layout / main shell */
  SHELL: 50,
  /** Fullscreen avatar mount (Body slot under document.body) */
  AVATAR_PORTAL: 10_000,
  /** HUD chrome (toolbars, emotion strip, history toggle) */
  HUD_CHROME: 11_050,
  /** Permission / secondary notices just above HUD */
  PERMISSION_STRIP: 11_080,
  /** Modal backdrops + session gates */
  MODAL_BACKDROP: 12_000,
  /** Toasts on top of modals */
  MODAL_TOAST: 12_010,
  /** Debug only */
  DEBUG_OVERLAY: 99_999,
} as const;

export type ZLayerKey = keyof typeof Z_LAYERS;
