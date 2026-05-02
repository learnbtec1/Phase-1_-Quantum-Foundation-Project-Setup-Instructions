/**
 * Shared types for LLM-driven avatar behavior plans (WebSocket `behavior` field).
 * All fields optional at runtime — normalize with `normalizeAvatarBehavior`.
 */

export type AvatarPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export type AvatarGazeTarget = 'user' | 'away' | 'think' | 'idle';

export type AvatarGestureSide = 'left' | 'right' | 'both';

export type AvatarMotionChannel = 'micro' | 'upper' | 'full';

export interface AvatarEmotionDirective {
  type: string;
  /** 0..1 */
  intensity: number;
  secondary?: {
    type: string;
    intensity: number;
  };
}

export interface AvatarGestureDirective {
  type: string;
  side?: AvatarGestureSide;
  startOffsetMs: number;
  durationMs: number;
  channel?: AvatarMotionChannel;
  /** Higher wins on conflict; default 0.5 */
  priority?: number;
  /** Urgent cues: schedule with minimal dependence on playback anchor skew. */
  critical_timing?: boolean;
}

export interface AvatarGazeDirective {
  target: AvatarGazeTarget;
  startOffsetMs?: number;
  durationMs: number;
}

export interface AvatarMicroExpressionDirective {
  type: string;
  startOffsetMs: number;
  durationMs: number;
  intensity?: number;
}

export interface AvatarBehaviorPhaseHints {
  thinkingLeadInMs?: number;
}

export interface AvatarBehaviorDirective {
  emotion?: AvatarEmotionDirective;
  gestures?: AvatarGestureDirective[];
  gaze?: AvatarGazeDirective | AvatarGazeDirective[];
  microExpressions?: AvatarMicroExpressionDirective[];
  phaseHints?: AvatarBehaviorPhaseHints;
}

/** CustomEvent detail: avatar:emotion (extended; backward compatible) */
export interface AvatarEmotionEventDetail {
  emotion?: string;
  intensity?: number;
  secondaryEmotion?: string;
  secondaryIntensity?: number;
}

/** CustomEvent detail: avatar:gaze */
export interface AvatarGazeEventDetail {
  target: AvatarGazeTarget;
  durationMs: number;
  startOffsetMs?: number;
}

/** CustomEvent detail: avatar:gesture (timed / LLM) */
export interface AvatarGestureEventDetail {
  type: string;
  side?: AvatarGestureSide;
  duration?: number;
  durationMs?: number;
  channel?: AvatarMotionChannel;
  priority?: number;
}

/** CustomEvent detail: avatar:micro:gesture */
export interface AvatarMicroGestureEventDetail {
  type: string;
  durationMs?: number;
  intensity?: number;
  side?: AvatarGestureSide;
}

/** CustomEvent detail: avatar:phase */
export interface AvatarPhaseEventDetail {
  phase: AvatarPhase;
  /** Optional ms hint for thinking lead-in */
  thinkingLeadInMs?: number;
  /** How long this phase override applies (ms), unless cleared earlier (e.g. speak:start) */
  holdMs?: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Defensive parse — returns null if nothing usable (backward compatible).
 */
export function normalizeAvatarBehavior(raw: unknown): AvatarBehaviorDirective | null {
  const o = asRecord(raw);
  if (!o) return null;

  const out: AvatarBehaviorDirective = {};

  const emo = asRecord(o.emotion);
  if (emo && typeof emo.type === 'string' && emo.type.trim()) {
    const intensity = clamp01(Number(emo.intensity ?? 1));
    const sec = asRecord(emo.secondary);
    out.emotion = {
      type: emo.type.trim().toLowerCase(),
      intensity,
      secondary:
        sec && typeof sec.type === 'string' && sec.type.trim()
          ? {
              type: sec.type.trim().toLowerCase(),
              intensity: clamp01(Number(sec.intensity ?? 0.3)),
            }
          : undefined,
    };
  }

  const gesturesRaw = o.gestures;
  if (Array.isArray(gesturesRaw)) {
    const gestures: AvatarGestureDirective[] = [];
    for (const g of gesturesRaw) {
      const gr = asRecord(g);
      if (!gr || typeof gr.type !== 'string' || !gr.type.trim()) continue;
      const startOffsetMs = Math.max(0, Math.min(120_000, Number(gr.startOffsetMs ?? gr.start_ms ?? 0) || 0));
      const durationMs = Math.max(200, Math.min(8000, Number(gr.durationMs ?? gr.duration_ms ?? 2500) || 2500));
      const side = ['left', 'right', 'both'].includes(String(gr.side ?? '').toLowerCase())
        ? (String(gr.side).toLowerCase() as AvatarGestureSide)
        : undefined;
      const channel = ['micro', 'upper', 'full'].includes(String(gr.channel ?? '').toLowerCase())
        ? (String(gr.channel).toLowerCase() as AvatarMotionChannel)
        : undefined;
      const pr = Number(gr.priority ?? 0.5);
      const crit = gr.critical_timing === true || gr.criticalTiming === true;
      gestures.push({
        type: gr.type.trim().toLowerCase(),
        side,
        startOffsetMs,
        durationMs,
        channel,
        priority: Number.isFinite(pr) ? Math.max(0, Math.min(1, pr)) : 0.5,
        ...(crit ? { critical_timing: true } : {}),
      });
    }
    if (gestures.length) out.gestures = gestures;
  }

  const gazeRaw = o.gaze;
  if (gazeRaw) {
    const targets: AvatarGazeDirective[] = [];
    const list = Array.isArray(gazeRaw) ? gazeRaw : [gazeRaw];
    for (const item of list) {
      const gr = asRecord(item);
      if (!gr) continue;
      const t = String(gr.target ?? '').toLowerCase();
      if (!['user', 'away', 'think', 'idle'].includes(t)) continue;
      const durationMs = Math.max(200, Math.min(20000, Number(gr.durationMs ?? gr.duration_ms ?? 2000) || 2000));
      const startOffsetMs = Math.max(0, Math.min(60_000, Number(gr.startOffsetMs ?? gr.start_ms ?? 0) || 0));
      targets.push({
        target: t as AvatarGazeTarget,
        durationMs,
        startOffsetMs: startOffsetMs || undefined,
      });
    }
    if (targets.length === 1) out.gaze = targets[0];
    else if (targets.length > 1) out.gaze = targets;
  }

  const microRaw = o.microExpressions ?? o.micro_expressions;
  if (Array.isArray(microRaw)) {
    const microExpressions: AvatarMicroExpressionDirective[] = [];
    for (const m of microRaw) {
      const mr = asRecord(m);
      if (!mr || typeof mr.type !== 'string' || !mr.type.trim()) continue;
      microExpressions.push({
        type: mr.type.trim().toLowerCase(),
        startOffsetMs: Math.max(0, Math.min(120_000, Number(mr.startOffsetMs ?? mr.start_ms ?? 0) || 0)),
        durationMs: Math.max(100, Math.min(5000, Number(mr.durationMs ?? mr.duration_ms ?? 400) || 400)),
        intensity: mr.intensity != null ? clamp01(Number(mr.intensity)) : undefined,
      });
    }
    if (microExpressions.length) out.microExpressions = microExpressions;
  }

  const ph = asRecord(o.phaseHints);
  if (ph) {
    const thinkingLeadInMs = Number(ph.thinkingLeadInMs ?? ph.thinking_lead_in_ms);
    if (Number.isFinite(thinkingLeadInMs) && thinkingLeadInMs >= 0 && thinkingLeadInMs < 30_000) {
      out.phaseHints = { thinkingLeadInMs: Math.round(thinkingLeadInMs) };
    }
  }

  if (!out.emotion && !out.gestures && !out.gaze && !out.microExpressions && !out.phaseHints) {
    return null;
  }
  return out;
}

/** Map LLM gesture names to canvas VRMA / procedural keys (subset). */
export const BEHAVIOR_GESTURE_TO_AVATAR: Readonly<Record<string, string>> = {
  wave: 'wave',
  waving: 'wave',
  point: 'point',
  pointing: 'point',
  clap: 'clap',
  clapping: 'clap',
  cheer: 'clap',
  think: 'openHand',
  thinking: 'openHand',
  nod: 'beat',
  beckon: 'openHand',
  openhand: 'openHand',
  open_hand: 'openHand',
};
