/**
 * normalizeAvatarEvents.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PERMANENT NORMALIZER — Full Human Persona Kernel / Avatar Event Schema
 *
 * RIG SOURCE-OF-TRUTH (both AvatarCanvas.tsx and VRMAvatar.tsx agree):
 *
 *   avatar:gesture  → { type: GestureToken, side?: 'left'|'right'|'both',
 *                        duration?: number, intensity?: number,
 *                        variance?: number, preroll?: number }
 *     Rig reads:  detail.type   (camelCase tokens)
 *     Rig tokens: 'wave' | 'openHand' | 'point' | 'beat'
 *     Note: 'emphasis' is NOT in any rig switch → normalised → 'beat'
 *
 *   avatar:emotion  → { emotion: string }
 *     Rig reads:  detail.emotion
 *
 *   avatar:listening → { active: boolean }
 *     Rig reads:  detail.active  (boolean; NOT state:'start'|'stop')
 *
 * This util accepts either the cognitive-layer shape OR the rig shape and
 * always outputs the rig shape, making all dispatchers safe regardless of
 * which field-name convention the caller uses.
 */

// ─── Gesture token canonicalisation ─────────────────────────────────────────

export type GestureToken = 'wave' | 'openHand' | 'point' | 'beat';

/** Map any variant spelling/casing to the rig's exact camelCase token. */
const GESTURE_TOKEN_MAP: Record<string, GestureToken> = {
  wave:      'wave',
  Wave:      'wave',
  WAVE:      'wave',

  openHand:   'openHand',
  openhand:   'openHand',
  open_hand:  'openHand',
  'open-hand':'openHand',
  OpenHand:   'openHand',

  point:     'point',
  Point:     'point',
  POINT:     'point',
  pointing:  'point',

  beat:      'beat',
  Beat:      'beat',
  BEAT:      'beat',

  // 'emphasis' is from brain.ts ResponsePlan type but unsupported in rig switch;
  // remap to a gentle beat so something visible always fires.
  emphasis:  'beat',
  Emphasis:  'beat',

  // 'sit' appears in actions.ts GestureType but has no rig pose handler — keep as-is
  // so the event is dispatched and the rig silently falls through to idle.
  sit:       'beat',
};

function canonicalGestureToken(raw: string | undefined): GestureToken {
  if (!raw) return 'beat';
  return GESTURE_TOKEN_MAP[raw] ?? (raw as GestureToken);
}

// ─── Typed input shapes ──────────────────────────────────────────────────────

/** What the cognitive layer / director might emit (accepts BOTH old and new keys). */
export interface GestureEventInput {
  // rig key (direction: keep)
  type?: string;
  // specced alternative — normaliser maps this to type
  name?: string;
  side?: 'left' | 'right' | 'both';
  duration?: number;
  intensity?: number;
  variance?: number;
  preroll?: number;
}

export interface EmotionEventInput {
  // rig key (direction: keep)
  emotion?: string;
  // specced alternative
  tag?: string;
  strength?: number;
  duration?: number;
}

export interface ListeningEventInput {
  // rig key (direction: keep)
  active?: boolean;
  // specced alternative
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

/**
 * Normalise any avatar event detail to the shape the rig actually reads.
 *
 * Works for all three event kinds:
 *   - gesture  (accepts { type | name } → emits { type })
 *   - emotion  (accepts { emotion | tag } → emits { emotion })
 *   - listening (accepts { active | state } → emits { active })
 *
 * Pass-through for any other keys/events — nothing is lost.
 */
export function normalizeAvatarEvent(detail: GestureEventInput): GestureEventDetail;
export function normalizeAvatarEvent(detail: EmotionEventInput): EmotionEventDetail;
export function normalizeAvatarEvent(detail: ListeningEventInput): ListeningEventDetail;
export function normalizeAvatarEvent(
  detail: GestureEventInput | EmotionEventInput | ListeningEventInput,
): GestureEventDetail | EmotionEventDetail | ListeningEventDetail {

  // ── Gesture ──────────────────────────────────────────────────────────────
  if ('type' in detail || 'name' in detail) {
    const g = detail as GestureEventInput;
    const rawToken = g.type ?? g.name;
    return {
      type:      canonicalGestureToken(rawToken),
      side:      (g.side ?? 'right') as 'left' | 'right' | 'both',
      duration:  g.duration  ?? 2.0,
      intensity: g.intensity ?? 0.8,
      variance:  g.variance  ?? Math.random(),
      preroll:   g.preroll   ?? 0,
    };
  }

  // ── Emotion ──────────────────────────────────────────────────────────────
  if ('emotion' in detail || 'tag' in detail) {
    const em = detail as EmotionEventInput;
    const result: EmotionEventDetail = {
      emotion: (em.emotion ?? em.tag ?? 'neutral').toLowerCase(),
    };
    if (em.strength !== undefined) result.strength = em.strength;
    if (em.duration !== undefined) result.duration = em.duration;
    return result;
  }

  // ── Listening ────────────────────────────────────────────────────────────
  if ('active' in detail || 'state' in detail) {
    const ls = detail as ListeningEventInput;
    const active = ls.active !== undefined
      ? ls.active
      : ls.state === 'start';
    const result: ListeningEventDetail = { active };
    if (ls.reason !== undefined) result.reason = ls.reason;
    return result;
  }

  // ── Fallback: return as-is (unknown event shape) ─────────────────────────
  return detail as GestureEventDetail;
}

// ─── dispatchAvatar helper ───────────────────────────────────────────────────

/**
 * Drop-in replacement for `window.dispatchEvent(new CustomEvent(eventType, {detail}))`.
 * Normalises the detail payload before dispatch so the rig always receives
 * the correct field names and token casing.
 */
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
