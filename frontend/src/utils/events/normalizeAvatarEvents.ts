/**
 * normalizeAvatarEvents.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PERMANENT NORMALIZER — Full Human Persona Kernel / Avatar Event Schema
 *
 * Maps BehaviorRulesEngine + AgentDirector gesture aliases → rig tokens consumed
 * by AvatarCanvas.onGesture (procedural rig + gesture normalisation).
 */

// ─── Gesture token canonicalisation ─────────────────────────────────────────

/** Tokens AvatarCanvas.onGesture handles (procedural + legacy gesture aliases). */
export type GestureToken =
  | 'wave'
  | 'explain'
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
  | 'celebration';

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
  /** إيماءة إجرائية VRM (VRMSkeletonManager) — كانت تُسقَط سابقاً إلى idle لغيابها هنا */
  explain: 'explain',
  Explain: 'explain',
  EXPLAIN: 'explain',
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
  peace: 'wave',
  agree: 'agree',
  clap: 'clap',
  cheer: 'clap',
  look: 'wave',
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
  /** Some pipelines only set `gesture` (e.g. ad-hoc CustomEvent) — treat like type/name. */
  gesture?: string;
  side?: 'left' | 'right' | 'both';
  duration?: number;
  intensity?: number;
  variance?: number;
  preroll?: number;
}

export interface EmotionEventInput {
  emotion?: string;
  tag?: string;
  strength?: number;
  /** يُعادل `strength` لتوافق أحداث `avatar:emotion` اليدوية */
  intensity?: number;
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
  /** Mirrors `type` when it is also a VRMSkeletonManager GestureId — helps listeners that read `gesture` first. */
  gesture?: GestureToken;
  side: 'left' | 'right' | 'both';
  duration: number;
  intensity: number;
  variance: number;
  preroll: number;
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
  if ('type' in detail || 'name' in detail || 'gesture' in detail) {
    const g = detail as GestureEventInput;
    const rawToken = g.type ?? g.name ?? g.gesture;
    const type = canonicalGestureToken(rawToken);
    const out: GestureEventDetail = {
      type,
      side:      (g.side ?? 'right') as 'left' | 'right' | 'both',
      duration:  g.duration  ?? 2.0,
      intensity: g.intensity ?? 0.8,
      variance:  g.variance  ?? Math.random(),
      preroll:   g.preroll   ?? 0,
    };
    if (type === 'idle' || type === 'explain' || type === 'point' || type === 'think' || type === 'wave' || type === 'clap' || type === 'agree') {
      out.gesture = type;
    }
    return out;
  }

  if ('emotion' in detail || 'tag' in detail) {
    const em = detail as EmotionEventInput;
    const result: EmotionEventDetail = {
      emotion: (em.emotion ?? em.tag ?? 'neutral').toLowerCase(),
    };
    const s = em.strength ?? em.intensity;
    if (s !== undefined) result.strength = s;
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
