// frontend/src/lib/behavior/behaviorEventHandler.ts
//
// تحويل حقل `behavior` من WebSocket إلى أوامر مجدولة.
// الإنتاج الافتراضي: يبقى useAvatarBehaviorScheduler المسؤول عن `behavior` بعد avatar:speak:start.
// فعّل الجدولة من هنا عبر NEXT_PUBLIC_COGNI_BEHAVIOR_HANDLER_ON_PLAY=true (تجريب — قد يتداخل مع المجدول الحالي).

import type { BehaviorPayload, GestureCommand, GazeCommand } from './types';
import { unifiedGestureEngine } from '@/ai/cognitive/UnifiedGestureEngine';

/** ═══ NEW ═══ Dispatch emotional state from behavior engine / WS to VRM layer. */
export function handleEmotionalStateFromWS(emotionalState: unknown): void {
  if (!emotionalState || typeof emotionalState !== 'object') return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:emotionalState', {
      detail: emotionalState,
    }),
  );
}

function rawToPayload(raw: unknown): BehaviorPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const gesturesRaw = Array.isArray(o.gestures) ? o.gestures : [];
  const microRaw = Array.isArray(o.micro_expressions)
    ? o.micro_expressions
    : Array.isArray(o.microExpressions)
      ? o.microExpressions
      : [];
  const gazeRaw = Array.isArray(o.gaze) ? o.gaze : o.gaze ? [o.gaze] : [];
  const posture = o.posture && typeof o.posture === 'object' ? (o.posture as BehaviorPayload['posture']) : null;

  const gestures = gesturesRaw
    .map((g) => {
      if (!g || typeof g !== 'object') return null;
      const x = g as Record<string, unknown>;
      const type = typeof x.type === 'string' ? x.type : '';
      if (!type) return null;
      const side = (['left', 'right', 'both', 'none'].includes(String(x.side))
        ? String(x.side)
        : 'right') as GestureCommand['side'];
      const start = Number(x.start_offset_ms ?? x.startOffsetMs ?? x.start_ms ?? 0);
      const dur = Number(x.duration_ms ?? x.durationMs ?? 1000);
      const pr = Number(x.priority ?? 5);
      const ch = String(x.channel ?? 'upper').toLowerCase();
      const channel = (['micro', 'upper', 'full'].includes(ch) ? ch : 'upper') as GestureCommand['channel'];
      const sfRaw = x.scale_factor ?? x.scaleFactor;
      const sf = sfRaw != null ? Number(sfRaw) : undefined;
      const crit = x.critical_timing === true || x.criticalTiming === true;
      return {
        type,
        side,
        start_offset_ms: Number.isFinite(start) ? Math.max(0, start) : 0,
        duration_ms: Number.isFinite(dur) ? Math.max(200, dur) : 1000,
        priority: Number.isFinite(pr) ? pr : 5,
        channel,
        ...(crit ? { critical_timing: true } : {}),
        // ═══ NEW ═══
        ...(Number.isFinite(sf) ? { scale_factor: Math.max(0.3, Math.min(1.5, sf as number)) } : {}),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const micro_expressions = microRaw
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const x = m as Record<string, unknown>;
      const type = typeof x.type === 'string' ? x.type : '';
      if (!type) return null;
      const start = Number(x.start_offset_ms ?? x.startOffsetMs ?? x.start_ms ?? 0);
      const dur = Number(x.duration_ms ?? x.durationMs ?? 400);
      const inten = Number(x.intensity ?? 0.7);
      return {
        type,
        start_offset_ms: Number.isFinite(start) ? Math.max(0, start) : 0,
        duration_ms: Number.isFinite(dur) ? Math.max(100, dur) : 400,
        intensity: Number.isFinite(inten) ? Math.max(0, Math.min(1, inten)) : 0.7,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const gaze = gazeRaw
    .map((gz) => {
      if (!gz || typeof gz !== 'object') return null;
      const x = gz as Record<string, unknown>;
      const target = String(x.target ?? 'user').toLowerCase();
      if (!['user', 'away', 'think'].includes(target)) return null;
      const start = Number(x.start_offset_ms ?? x.startOffsetMs ?? x.start_ms ?? 0);
      const dur = Number(x.duration_ms ?? x.durationMs ?? 2000);
      return {
        target: target as GazeCommand['target'],
        start_offset_ms: Number.isFinite(start) ? Math.max(0, start) : 0,
        duration_ms: Number.isFinite(dur) ? Math.max(200, dur) : 2000,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  if (!gestures.length && !micro_expressions.length && !gaze.length && !posture) return null;

  return { gestures, micro_expressions, gaze, posture };
}

export function handleBehaviorFromWS(wsMessage: Record<string, unknown>, speechStartDelay = 0): void {
  const beh = wsMessage.behavior;
  const behObj = beh && typeof beh === 'object' ? (beh as Record<string, unknown>) : null;
  // ═══ NEW ═══
  const emotionalState = behObj?.emotional_state ?? behObj?.emotionalState;
  if (emotionalState) {
    handleEmotionalStateFromWS(emotionalState);
  }
  // ═══ NEW END ═══
  const payload = rawToPayload(beh);
  if (!payload) return;
  unifiedGestureEngine.scheduleBehavior(payload, speechStartDelay);
}

export function cancelAllBehavior(): void {
  unifiedGestureEngine.cancelScheduledBehavior();
}

/** Push BTEC criterion HUD updates from WS `btec_update` frames (Redis-backed session state on server). */
export function dispatchBtecUpdateFromWS(frame: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const code = frame.criterion_code ?? frame.criterionCode;
  if (code == null || String(code).trim() === '') return;
  window.dispatchEvent(
    new CustomEvent('cogni:btec:update', {
      detail: {
        criterion_code: String(code).trim(),
        hud_status: frame.hud_status ?? frame.hudStatus,
        assignment_id: frame.assignment_id ?? frame.assignmentId,
        status: frame.status,
        evidence: frame.evidence,
      },
    }),
  );
}
