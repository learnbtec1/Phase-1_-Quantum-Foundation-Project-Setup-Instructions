/**
 * normalizeAvatarEvents.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PERMANENT NORMALIZER — Full Human Persona Kernel / Avatar Event Schema
 *
 * Maps BehaviorRulesEngine + AgentDirector gesture aliases → rig tokens consumed
 * by AvatarCanvas.onGesture (VRMA + procedural paths).
 */

// ─── Gesture token canonicalisation ─────────────────────────────────────────

/** Tokens AvatarCanvas.onGesture handles (VRMA keys + procedural aliases). */
export type GestureToken =
  | 'wave'
  | 'openHand'
  | 'point'
  | 'beat'
  | 'cheer'
  | 'clap'
  | 'relax'
  | 'look'
  | 'think'
  | 'blink'
  | 'idle'
  | 'peace'
  | 'agree'
  | 'shoulder_sigh'
  | 'head_down'
  | 'tilt'
  | 'hands_up'
  | 'lean_back'
  | 'celebration'
  | 'thumbUp'
  | 'beckon';

/**
 * BehaviorRulesEngine + legacy aliases → canonical rig token.
 * See BehaviorRulesEngine.ts gesture strings.
 */
const BEHAVIOR_TO_RIG: Record<string, GestureToken> = {
  // Core rig
  wave: 'wave',
  Wave: 'wave',
  WAVE: 'wave',
  openHand: 'openHand',
  openhand: 'openHand',
  open_hand: 'openHand',
  'open-hand': 'openHand',
  OpenHand: 'openHand',
  point: 'point',
  Point: 'point',
  POINT: 'point',
  pointing: 'point',
  beat: 'beat',
  Beat: 'beat',
  BEAT: 'beat',
  emphasis: 'beat',
  Emphasis: 'beat',
  sit: 'beat',

  // BehaviorRulesEngine outputs — keep tokens Canvas can branch on
  celebration: 'celebration',
  celebrate: 'clap',
  smile: 'openHand',
  shoulder_sigh: 'shoulder_sigh',
  head_down: 'head_down',
  hands_up: 'hands_up',
  lean_back: 'lean_back',
  rest: 'idle',
  lean_forward: 'think',
  idle: 'idle',
  tilt: 'tilt',
  blink: 'blink',
  relaxed: 'relax',
  relax: 'relax',

  // Director / co-speech
  think: 'think',
  peace: 'peace',
  agree: 'agree',
  clap: 'clap',
  cheer: 'cheer',
  look: 'look',
  thumbUp: 'thumbUp',
  thumbup: 'thumbUp',
  thumbs_up: 'thumbUp',
  beckon: 'beckon',
  Beckon: 'beckon',
};

function canonicalGestureToken(raw: string | undefined): GestureToken {
  if (!raw?.trim()) {
    if (typeof console !== 'undefined') {
      console.warn('[normalizeAvatarEvents] empty gesture → idle');
    }
    return 'idle';
  }
  const key = raw.trim();
  const mapped = BEHAVIOR_TO_RIG[key] ?? BEHAVIOR_TO_RIG[key.toLowerCase()];
  if (mapped) return mapped;
  if (typeof console !== 'undefined') {
    console.warn('[normalizeAvatarEvents] unmapped gesture → idle:', key);
  }
  return 'idle';
}

// ─── Typed input shapes ──────────────────────────────────────────────────────

/** What the cognitive layer / director might emit (accepts BOTH old and new keys). */
export interface GestureEventInput {
  type?: string;
  name?: string;
  side?: 'left' | 'right' | 'both';
  duration?: number;
  intensity?: number;
  variance?: number;
  preroll?: number;
  /** V50 — preserved on normalised detail for Canvas / cooldown semantics */
  fromAI?: boolean;
  fromPerformance?: boolean;
}

export interface EmotionEventInput {
  emotion?: string;
  tag?: string;
  strength?: number;
  duration?: number;
}

export interface ListeningEventInput {
  active?: boolean;
  state?: 'start' | 'stop';
  reason?: string;
}

// ─── Normalised output shapes ────────────────────────────────────────────────

export interface GestureEventDetail {
  type: GestureToken;
  side: 'left' | 'right' | 'both';
  duration: number;
  intensity: number;
  variance: number;
  preroll: number;
  fromAI?: boolean;
  fromPerformance?: boolean;
}

export interface EmotionEventDetail {
  emotion: string;
  strength?: number;
  duration?: number;
}

export interface ListeningEventDetail {
  active: boolean;
  reason?: string;
}

// ─── Core normaliser ─────────────────────────────────────────────────────────

export function normalizeAvatarEvent(detail: GestureEventInput): GestureEventDetail;
export function normalizeAvatarEvent(detail: EmotionEventInput): EmotionEventDetail;
export function normalizeAvatarEvent(detail: ListeningEventInput): ListeningEventDetail;
export function normalizeAvatarEvent(
  detail: GestureEventInput | EmotionEventInput | ListeningEventInput,
): GestureEventDetail | EmotionEventDetail | ListeningEventDetail {
  if ('type' in detail || 'name' in detail) {
    const g = detail as GestureEventInput;
    const rawToken = g.type ?? g.name;
    const out: GestureEventDetail = {
      type:      canonicalGestureToken(rawToken),
      side:      (g.side ?? 'right') as 'left' | 'right' | 'both',
      duration:  g.duration  ?? 2.0,
      intensity: g.intensity ?? 0.8,
      variance:  g.variance  ?? Math.random(),
      preroll:   g.preroll   ?? 0,
    };
    if (g.fromAI === true) out.fromAI = true;
    if (g.fromPerformance === true) out.fromPerformance = true;
    return out;
  }

  if ('emotion' in detail || 'tag' in detail) {
    const em = detail as EmotionEventInput;
    const result: EmotionEventDetail = {
      emotion: (em.emotion ?? em.tag ?? 'neutral').toLowerCase(),
    };
    if (em.strength !== undefined) result.strength = em.strength;
    if (em.duration !== undefined) result.duration = em.duration;
    return result;
  }

  if ('active' in detail || 'state' in detail) {
    const ls = detail as ListeningEventInput;
    const active = ls.active !== undefined
      ? ls.active
      : ls.state === 'start';
    const result: ListeningEventDetail = { active };
    if (ls.reason !== undefined) result.reason = ls.reason;
    return result;
  }

  return detail as GestureEventDetail;
}

export function dispatchAvatar(
  eventType: 'avatar:gesture',
  detail: GestureEventInput,
): void;
export function dispatchAvatar(
  eventType: 'avatar:emotion',
  detail: EmotionEventInput,
): void;
export function dispatchAvatar(
  eventType: 'avatar:listening',
  detail: ListeningEventInput,
): void;
export function dispatchAvatar(
  eventType: string,
  detail: GestureEventInput | EmotionEventInput | ListeningEventInput | Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;

  let normalised: unknown = detail;

  if (eventType === 'avatar:gesture') {
    normalised = normalizeAvatarEvent(detail as GestureEventInput);
  } else if (eventType === 'avatar:emotion') {
    normalised = normalizeAvatarEvent(detail as EmotionEventInput);
  } else if (eventType === 'avatar:listening') {
    normalised = normalizeAvatarEvent(detail as ListeningEventInput);
  }

  window.dispatchEvent(new CustomEvent(eventType, { detail: normalised }));
}
