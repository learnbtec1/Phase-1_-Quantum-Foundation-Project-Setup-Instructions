'use client';

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import {
  normalizeAvatarBehavior,
  BEHAVIOR_GESTURE_TO_AVATAR,
  type AvatarBehaviorDirective,
  type AvatarGazeEventDetail,
  type AvatarMicroGestureEventDetail,
  type AvatarEmotionEventDetail,
  type AvatarGestureDirective,
} from '@/types/avatarBehavior';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';

const SPEAK_START_FALLBACK_MS = 2500;

function devLog(...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[AvatarBehavior]', ...args);
  }
}

/**
 * Schedules LLM `behavior` relative to `avatar:speak:start` (server TTS / client TTS).
 * Clears timers on new speech, stop_speech, unmount.
 */
export function useAvatarBehaviorScheduler(mountedRef: MutableRefObject<boolean>): {
  clearAll: () => void;
  scheduleFromWsFrame: (
    behaviorRaw: unknown,
    options: { skipGestures: boolean; rawEmotion: string },
  ) => void;
} {
  const timersRef = useRef<number[]>([]);
  const speakListenerRef = useRef<((() => void) | null)>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<AvatarBehaviorDirective | null>(null);

  const clearAll = useCallback(() => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (typeof window !== 'undefined' && speakListenerRef.current) {
      window.removeEventListener('avatar:speak:start', speakListenerRef.current);
      speakListenerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const runAnchored = useCallback((t0: number, b: AvatarBehaviorDirective) => {
    if (!mountedRef.current || typeof window === 'undefined') return;

    const push = (delay: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        if (!mountedRef.current) return;
        fn();
      }, Math.max(0, delay));
      timersRef.current.push(id);
    };

    const gazeList = b.gaze
      ? Array.isArray(b.gaze)
        ? b.gaze
        : [b.gaze]
      : [];
    for (const g of gazeList) {
      const delay = Math.max(0, t0 + (g.startOffsetMs ?? 0) - Date.now());
      push(delay, () => {
        const d: AvatarGazeEventDetail = {
          target: g.target,
          durationMs: g.durationMs,
          startOffsetMs: g.startOffsetMs,
        };
        window.dispatchEvent(new CustomEvent('avatar:gaze', { detail: d }));
        devLog('gaze', d);
      });
    }

    for (const m of b.microExpressions ?? []) {
      const delayM = Math.max(0, t0 + m.startOffsetMs - Date.now());
      push(delayM, () => {
        const d: AvatarMicroGestureEventDetail = {
          type: m.type,
          durationMs: m.durationMs,
          intensity: m.intensity,
        };
        window.dispatchEvent(new CustomEvent('avatar:micro:gesture', { detail: d }));
        devLog('micro', d);
      });
    }

    type GD = AvatarGestureDirective;
    const upperWinners = new Map<string, GD>();
    const microGestures: GD[] = [];
    for (const g of b.gestures ?? []) {
      const ch = g.channel ?? 'upper';
      if (ch === 'micro') {
        microGestures.push(g);
        continue;
      }
      const key = ch === 'full' ? 'full' : 'upper';
      const pr = g.priority ?? 0.5;
      const cur = upperWinners.get(key);
      if (!cur || pr > (cur.priority ?? 0.5)) {
        upperWinners.set(key, g);
      } else if (pr === (cur.priority ?? 0.5)) {
        devLog('skip gesture (same priority, keep first)', g.type);
      } else {
        devLog('skip gesture (lower priority)', g.type, pr, cur.priority);
      }
    }
    const toSchedule = [...upperWinners.values(), ...microGestures];
    for (const g of toSchedule) {
      const delayG = g.critical_timing
        ? Math.max(0, g.startOffsetMs)
        : Math.max(0, t0 + g.startOffsetMs - Date.now());
      push(delayG, () => {
        const mapped = BEHAVIOR_GESTURE_TO_AVATAR[g.type] ?? g.type;
        dispatchAvatar('avatar:gesture', {
          type: mapped,
          side: g.side ?? 'right',
          duration: Math.max(0.3, g.durationMs / 1000),
        });
        devLog('gesture', mapped, g.startOffsetMs);
      });
    }
  }, [mountedRef]);

  const scheduleFromWsFrame = useCallback(
    (behaviorRaw: unknown, options: { skipGestures: boolean; rawEmotion: string }) => {
      clearAll();
      const b = normalizeAvatarBehavior(behaviorRaw);
      if (!b) {
        if (behaviorRaw != null && process.env.NODE_ENV !== 'production') {
          console.warn('[AvatarBehavior] Malformed or empty behavior payload — ignored');
        }
        return;
      }
      devLog('normalized', b);

      if (typeof window === 'undefined') return;

      if (b.emotion) {
        const primary = b.emotion.type || options.rawEmotion;
        const detail: AvatarEmotionEventDetail = {
          emotion: primary,
          intensity: b.emotion.intensity,
          secondaryEmotion: b.emotion.secondary?.type,
          secondaryIntensity: b.emotion.secondary?.intensity,
        };
        window.dispatchEvent(new CustomEvent('avatar:emotion', { detail }));
        devLog('emotion immediate', detail);
      }

      const gestures = options.skipGestures ? [] : b.gestures;
      const toRun: AvatarBehaviorDirective = {
        ...b,
        gestures,
      };
      if (options.skipGestures && b.gestures?.length) {
        devLog('skip scheduling LLM gestures (structured performance owns turn)');
      }

      pendingRef.current = toRun;

      const anchor = () => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (!pending) return;
        const t0 = Date.now();
        runAnchored(t0, pending);
      };

      const onSpeakStart = () => {
        if (speakListenerRef.current !== onSpeakStart) return;
        window.removeEventListener('avatar:speak:start', onSpeakStart);
        speakListenerRef.current = null;
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        devLog('anchor: avatar:speak:start');
        anchor();
      };

      speakListenerRef.current = onSpeakStart;
      window.addEventListener('avatar:speak:start', onSpeakStart);

      fallbackTimerRef.current = window.setTimeout(() => {
        fallbackTimerRef.current = null;
        if (speakListenerRef.current === onSpeakStart) {
          window.removeEventListener('avatar:speak:start', onSpeakStart);
          speakListenerRef.current = null;
          devLog('anchor: fallback (no speak:start)');
          anchor();
        }
      }, SPEAK_START_FALLBACK_MS);
    },
    [clearAll, runAnchored],
  );

  useEffect(() => () => clearAll(), [clearAll]);

  return { clearAll, scheduleFromWsFrame };
}
