/**
 * SpontaneousBehavior.ts
 * ──────────────────────────────────────────────────────────────
 * Injects organic, unprompted micro-behaviours into the avatar
 * when it is idle (not speaking, not receiving input) or thinking.
 *
 * Behaviours (randomly selected, weighted):
 *   • look_away    — gaze drifts off-screen briefly
 *   • weight_shift — body-weight sway (already in VRMSkeleton idle
 *                    variants; here we signal via motorSpeedMulRef)
 *   • curious_tilt — head tilts sideways (dispatches avatar:gesture think)
 *   • self_touch   — brief relax/shrug gesture
 *   • deep_breath  — increases motorSpeedMulRef briefly for a breath surge
 *
 * Integration:
 *   import { startSpontaneousBehavior, stopSpontaneousBehavior }
 *     from '@/lib/behavior/SpontaneousBehavior';
 *
 *   // Pass the same refs used by VRMSkeletonManager
 *   startSpontaneousBehavior({ isTalkingRef, isThinkingRef, motorSpeedMulRef });
 */

import type { MutableRefObject } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpontaneousBehaviorConfig {
  isTalkingRef:     MutableRefObject<boolean>;
  isThinkingRef:    MutableRefObject<boolean>;
  motorSpeedMulRef?: MutableRefObject<number>;
  /** Ref tracking whether avatar is in active listening mode (mic on, student speaking) */
  isListeningRef?:  MutableRefObject<boolean>;
}

// ─── Behaviour catalogue ─────────────────────────────────────────────────────

type BehaviourId =
  | 'look_away'
  | 'curious_tilt'
  | 'self_touch'
  | 'deep_breath'
  | 'idle_nod'
  | 'micro_wave'
  | 'eyebrow_raise'
  | 'head_tilt_micro'
  | 'chin_scratch'
  // ── الجديدة: سلوكيات بشرية متقدمة ──────────────────────────────────────────
  | 'contemplation_pause'   // وقفة تأمل — يحدّق قليلاً كأنه يفكر
  | 'excited_energy_burst'  // نبضة طاقة — عند الفرح أو الإنجاز
  | 'empathy_lean'          // ميل للتعاطف — عند الطالب المحبط
  | 'confidence_gesture'    // إيماءة ثقة — تثبيت السلطة
  | 'curiosity_spark'       // شرارة فضول — سؤال مفاجئ غير متوقع
  | 'memory_recall'         // استدعاء ذاكرة — يتذكر شيئاً من الجلسة
  | 'celebrate_micro'       // احتفال خفيف — مكافأة تقدم صغير
  | 'reset_breath';         // أنفاس إعادة ضبط — بعد موضوع صعب


interface Behaviour {
  id:         BehaviourId;
  /** Relative probability weight (higher = more frequent) */
  weight:     number;
  /** Only fires during thinking (true) or anytime idle/thinking (false) */
  thinkOnly:  boolean;
  execute:    (cfg: SpontaneousBehaviorConfig) => void;
}

function dispatch(event: string, detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(event, { detail }));
}

const BEHAVIOURS: Behaviour[] = [
  {
    id: 'look_away',
    weight: 3,
    thinkOnly: false,
    execute: () => {
      // avatar:gaze is now consumed by AnimationController → properly blends neckGaze
      dispatch('avatar:gaze', {
        yaw:      (Math.random() - 0.5) * 0.50,
        pitch:    (Math.random() - 0.5) * 0.20,
        durationMs: 900 + Math.random() * 700,
      });
    },
  },
  {
    id: 'curious_tilt',
    weight: 2,           // reduced from 3 (was too heavy)
    thinkOnly: false,
    execute: () => {
      // Micro event only — no full heavy gesture (avoids interrupting orchestration)
      dispatch('avatar:gaze', {
        yaw:      (Math.random() > 0.5 ? 1 : -1) * (0.07 + Math.random() * 0.09),
        pitch:    -0.05,
        durationMs: 1200 + Math.random() * 600,
      });
      dispatch('avatar:micro:gesture', { kind: 'question_tilt', durationMs: 480 });
    },
  },
  {
    id: 'self_touch',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // Acknowledge / agree — looks natural between exchanges
      dispatch('avatar:gesture', {
        gesture: 'agree',
        duration: 1400 + Math.random() * 600,
      });
    },
  },
  {
    id: 'deep_breath',
    weight: 1,
    thinkOnly: false,
    execute: (cfg) => {
      if (!cfg.motorSpeedMulRef) return;
      const original = cfg.motorSpeedMulRef.current;
      cfg.motorSpeedMulRef.current = Math.min(1.4, original + 0.35);
      setTimeout(() => {
        if (cfg.motorSpeedMulRef) cfg.motorSpeedMulRef.current = original;
      }, 1200 + Math.random() * 400);
    },
  },
  {
    id: 'idle_nod',
    weight: 3,
    thinkOnly: true, // during thinking
    execute: () => {
      dispatch('avatar:gesture', {
        gesture: 'think',
        duration: 2000 + Math.random() * 1000,
      });
    },
  },
  {
    id: 'micro_wave',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      dispatch('avatar:gesture', {
        gesture: 'wave',
        duration: 1600 + Math.random() * 600,
      });
    },
  },
  {
    id: 'eyebrow_raise',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // Micro expression: brief eyebrow raise (surprise/interest)
      dispatch('avatar:micro:gesture', { kind: 'eyebrow', durationMs: 420 });
    },
  },
  {
    id: 'head_tilt_micro',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // Curiosity head tilt via gaze override
      dispatch('avatar:gaze', {
        yaw:      (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.1),
        pitch:    -0.04,
        durationMs: 1100 + Math.random() * 500,
      });
      dispatch('avatar:micro:gesture', { kind: 'question_tilt', durationMs: 600 });
    },
  },
  {
    id: 'chin_scratch',
    weight: 1,
    thinkOnly: true,
    execute: () => {
      dispatch('avatar:gesture', { gesture: 'think', duration: 2200 + Math.random() * 800 });
      dispatch('avatar:micro:gesture', { kind: 'chin_up', durationMs: 350 });
    },
  },

  // ── السلوكيات الجديدة ──────────────────────────────────────────────────────

  {
    id: 'contemplation_pause',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // وقفة تأمل ذكية — كأنه يُراجع فكرة في ذهنه
      dispatch('avatar:gaze', { yaw: -0.15, pitch: -0.18, durationMs: 1400 });
      dispatch('avatar:micro:gesture', { kind: 'chin_up', durationMs: 600 });
      dispatch('avatar:blink', { style: 'slow' });
    },
  },

  {
    id: 'excited_energy_burst',
    weight: 2,
    thinkOnly: false,
    execute: (cfg) => {
      // نبضة طاقة عند الشعور بالحماس
      if (cfg.motorSpeedMulRef) {
        const prev = cfg.motorSpeedMulRef.current;
        cfg.motorSpeedMulRef.current = Math.min(1.4, prev + 0.28);
        setTimeout(() => { if (cfg.motorSpeedMulRef) cfg.motorSpeedMulRef.current = prev; }, 1800);
      }
      dispatch('avatar:gesture', { gesture: 'agree', duration: 1200 });
      dispatch('avatar:micro:gesture', { kind: 'eyebrow', durationMs: 280 });
    },
  },

  {
    id: 'empathy_lean',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // ميل للتعاطف — إظهار الانتباه الكامل
      dispatch('avatar:headpose', { yaw: 0.06, pitch: -0.04, duration: 2200 });
      dispatch('avatar:gesture', { gesture: 'agree', duration: 1400 });
    },
  },

  {
    id: 'confidence_gesture',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // إيماءة سلطة وثقة — تُرسّخ هيبة المعلم
      dispatch('avatar:gesture', { gesture: 'point', duration: 1600 + Math.random() * 400 });
      dispatch('avatar:gaze', { yaw: 0, pitch: 0, durationMs: 1200 });
    },
  },

  {
    id: 'curiosity_spark',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // شرارة فضول — سؤال مفاجئ غير متوقع (brow raise)
      dispatch('avatar:micro:gesture', { kind: 'eyebrow', durationMs: 500 });
      dispatch('avatar:gesture', { gesture: 'think', duration: 1800 });
    },
  },

  {
    id: 'memory_recall',
    weight: 1,
    thinkOnly: false,
    execute: () => {
      // استدعاء ذاكرة — ينظر للجانب كأنه يتذكر
      dispatch('avatar:gaze', { yaw: (Math.random() > 0.5 ? 1 : -1) * 0.25, pitch: 0.08, durationMs: 1100 });
      dispatch('avatar:blink', { style: 'slow' });
    },
  },

  {
    id: 'celebrate_micro',
    weight: 2,
    thinkOnly: false,
    execute: () => {
      // احتفال خفيف — مكافأة تقدم صغير
      dispatch('avatar:gesture', { gesture: 'agree', duration: 1000 });
      dispatch('avatar:micro:gesture', { kind: 'nod', durationMs: 320 });
    },
  },

  {
    id: 'reset_breath',
    weight: 1,
    thinkOnly: false,
    execute: (cfg) => {
      // أنفاس إعادة ضبط — بعد موضوع ثقيل
      if (cfg.motorSpeedMulRef) {
        const prev = cfg.motorSpeedMulRef.current;
        cfg.motorSpeedMulRef.current = Math.max(0.55, prev - 0.25);
        setTimeout(() => { if (cfg.motorSpeedMulRef) cfg.motorSpeedMulRef.current = prev; }, 2200);
      }
      dispatch('avatar:gesture', { gesture: 'idle', duration: 1800 });
    },
  },
];

// ─── Engine ───────────────────────────────────────────────────────────────────

const MIN_IDLE_MS = 5_000;  // minimum gap between spontaneous behaviours (was 10s)
const MAX_IDLE_MS = 14_000; // (was 22s) — tighter window = more organic feel

let _timeoutId: ReturnType<typeof setTimeout> | null = null;
let _running = false;

function pickBehaviour(thinking: boolean): Behaviour {
  const eligible = BEHAVIOURS.filter(b => !b.thinkOnly || thinking);
  const total = eligible.reduce((s, b) => s + b.weight, 0);
  let r = Math.random() * total;
  for (const b of eligible) {
    r -= b.weight;
    if (r <= 0) return b;
  }
  return eligible[0]!;
}

function scheduleNext(cfg: SpontaneousBehaviorConfig): void {
  if (!_running) return;
  const delay = MIN_IDLE_MS + Math.random() * (MAX_IDLE_MS - MIN_IDLE_MS);
  _timeoutId = setTimeout(() => {
    if (!_running) return;
    const talking     = cfg.isTalkingRef.current;
    const thinking    = cfg.isThinkingRef.current;
    // isListeningRef: true when microphone is on and student is speaking
    const isListening = !!(cfg.isListeningRef?.current);

    // While talking: suppress ALL spontaneous (avatar speech owns the stage)
    if (talking) {
      scheduleNext(cfg);
      return;
    }

    const behaviour = pickBehaviour(thinking);

    // While actively listening: only micro/gaze allowed — heavy gestures distract
    const HEAVY_GESTURES: Set<BehaviourId> = new Set([
      'micro_wave', 'curious_tilt', 'chin_scratch',
      'excited_energy_burst', 'confidence_gesture',
    ]);
    if (isListening && HEAVY_GESTURES.has(behaviour.id as BehaviourId)) {
      // Substitute: gentle engaged micro-expression only
      dispatch('avatar:micro:gesture', { kind: 'nod', durationMs: 280 });
      dispatch('avatar:listening', { active: true }); // refresh listening body posture
    } else {
      try {
        behaviour.execute(cfg);
      } catch {
        /* silent — behaviour errors must not break animation loop */
      }
    }
    scheduleNext(cfg);
  }, delay);
}

/** Start the spontaneous behaviour engine. Idempotent. */
export function startSpontaneousBehavior(cfg: SpontaneousBehaviorConfig): void {
  if (_running) return;
  _running = true;
  // First trigger sooner so avatar feels alive right away
  const firstDelay = 4_000 + Math.random() * 6_000;
  _timeoutId = setTimeout(() => scheduleNext(cfg), firstDelay);
}

/** Stop and clean up all pending behaviours. */
export function stopSpontaneousBehavior(): void {
  _running = false;
  if (_timeoutId !== null) {
    clearTimeout(_timeoutId);
    _timeoutId = null;
  }
}
