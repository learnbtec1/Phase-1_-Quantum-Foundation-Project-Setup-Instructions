/**
 * Canonical English gesture names used by the arm-gesture rig and action system.
 * Keep in sync with useArmPose, useArmGestureRig, and actions.ts.
 */
export const GestureNames = {
  WAVE:      'wave',
  POINT:     'point',
  /** 'open' — used by new arm-pose hook (useArmPose / useArmGestureRig) */
  OPEN:      'open',
  /** 'openHand' — existing event detail key for backward compat with avatar:gesture listeners */
  OPEN_HAND: 'openHand',
  AFFIRM:    'affirm',
  STOP:      'stop',
  BECKON:    'beckon',
  PRESENT:   'present',
  SHRUG:     'shrug',
  CLAP:      'clap',
  THINK:     'think',
  EMPHASIS:  'emphasis',
  BEAT:      'beat',
  OK:        'ok',
  THUMBS_UP: 'thumbsUp',
} as const;

export type GestureName = typeof GestureNames[keyof typeof GestureNames];
