/**
 * Reply personality — classification, intent depth, human pacing (delays / presence gap).
 * Used by UnifiedGestureEngine; does not replace co-speech or AgentDirector.
 */
import { useBrainStore } from '@/store/useBrainStore';
import { getPersonality, getReactionDelayPersonalityMul } from '@/ai/avatar/avatarPersonality';
import { getAnticipationReactionDelayMul } from '@/lib/behavior/anticipationLayer';

export type ReplyBehaviorClass = 'thinking' | 'agreeing' | 'explaining' | 'neutral';

/** Finer intent — drives motion speed, preamble, and micro-expression nuance. */
export type IntentDepthClass =
  | 'deep_thinking'
  | 'light_thinking'
  | 'soft_agree'
  | 'strong_agree'
  | 'confident_explain'
  | 'uncertain_explain'
  | 'neutral';

export type AvatarMood = 'calm' | 'engaged';

/** Baseline mood from live physical / conversation signals (no extra store fields). */
export function getDerivedAvatarMood(): AvatarMood {
  const s = useBrainStore.getState();
  if (s.talking || s.thinking || s.physical.isListening || s.isUserSpeaking) return 'engaged';
  return 'calm';
}

/** Subtle scale for preambles / idle head-gaze (calm = quieter, engaged = slightly more). */
export function getMoodMotionScale(): number {
  return getDerivedAvatarMood() === 'engaged' ? 1.08 : 0.9;
}

export function classifyReplyBehavior(text: string, emotionHint?: string): ReplyBehaviorClass {
  const lower = (text || '').toLowerCase();
  const em = (emotionHint || '').toLowerCase();
  if (
    /^hm{1,}|think|consider|wondering|let me think|not sure|حيرة|بفكر|دعني أفكر|تفكير/.test(lower) ||
    em.includes('think')
  ) {
    return 'thinking';
  }
  if (
    /\byes\b|agree|correct|right\b|exactly|indeed|true|nod|makes sense|نعم|صح|مظبوط|تمام|موافق/.test(lower) ||
    em.includes('agree') ||
    em.includes('happy')
  ) {
    return 'agreeing';
  }
  if (
    /because|therefore|step |steps |explain|means that|let me |first,|secondly|in other words|لأن|يعني|الخطوة|نوضح|شرح/.test(
      lower,
    ) ||
    em.includes('explain')
  ) {
    return 'explaining';
  }
  return 'neutral';
}

/** When no transcript is passed, infer coarse class from gesture / VRMA stem name. */
export function replyClassFromGestureStem(name: string): ReplyBehaviorClass {
  const k = name.toLowerCase().replace(/\s+/g, '');
  if (/think|ponder|curious|lean|processing/.test(k)) return 'thinking';
  if (/agree|ack|nod/.test(k)) return 'agreeing';
  if (/explain|open|beat|point|wave|clap|typing|listening/.test(k)) return 'explaining';
  return 'neutral';
}

/**
 * Refine `ReplyBehaviorClass` using transcript + light randomness so same cue ≠ same motion.
 */
export function resolveIntentDepth(base: ReplyBehaviorClass, text: string): IntentDepthClass {
  const t = (text || '').toLowerCase();
  if (base === 'neutral') return 'neutral';

  if (base === 'thinking') {
    const deepCue =
      t.length > 140 ||
      /because|however|therefore|analyze|complex|trade-?off|deep|تحليل|معقد|لكن|بالتالي/.test(t);
    if (deepCue && Math.random() < 0.72) return 'deep_thinking';
    if (!deepCue && Math.random() < 0.55) return 'light_thinking';
    return Math.random() < 0.5 ? 'deep_thinking' : 'light_thinking';
  }

  if (base === 'agreeing') {
    if (/!|absolutely|definitely|completely|totally|أكيد|طبعا|بالتأكيد|تمامًا/.test(t)) return 'strong_agree';
    if (Math.random() < 0.5) return 'soft_agree';
    return 'strong_agree';
  }

  if (base === 'explaining') {
    if (/maybe|perhaps|not sure|might|could be|unclear|ربما|يمكن|لست متأكد|غير واضح/.test(t)) {
      return 'uncertain_explain';
    }
    if (Math.random() < 0.52) return 'confident_explain';
    return 'uncertain_explain';
  }

  return 'neutral';
}

/** Wall-clock delay before preamble / gesture (300–900 ms × personality). */
export function getReactionDelayMs(): number {
  const base = 300 + Math.floor(Math.random() * 601);
  return Math.max(
    120,
    Math.round(base * getReactionDelayPersonalityMul() * getAnticipationReactionDelayMul()),
  );
}

export function getPresenceGapMs(): number {
  return 2500 + Math.floor(Math.random() * 1501);
}

/**
 * Short head / gaze / blink prelude before VRMA body — timings asymmetric (head vs eyes).
 * `intent` refines amplitude and hold when known.
 */
export async function applyReplyBehaviorPreamble(
  kind: ReplyBehaviorClass,
  intent?: IntentDepthClass,
): Promise<void> {
  if (typeof window === 'undefined') return;
  const m = getMoodMotionScale();
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const eyeLagMs = 45 + Math.floor(Math.random() * 136);

  switch (kind) {
    case 'thinking': {
      const deep = intent === 'deep_thinking';
      const yaw = (Math.random() > 0.5 ? 1 : -1) * (deep ? 0.095 : 0.068) * m;
      const pitch = (deep ? -0.068 : -0.048) * m;
      const headDur = Math.round((deep ? 1280 : 920) * (0.92 + Math.random() * 0.14));
      window.dispatchEvent(
        new CustomEvent('avatar:headpose', {
          detail: { yaw, pitch, durationMs: headDur },
        }),
      );
      await wait(eyeLagMs);
      const gazeOff = (Math.random() - 0.5) * (deep ? 0.14 : 0.1);
      const gazePitch = (Math.random() - 0.5) * 0.06 - 0.04;
      const gazeDur = deep ? 1650 + Math.floor(Math.random() * 450) : 1100 + Math.floor(Math.random() * 380);
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: { yaw: gazeOff * m, pitch: gazePitch * m, durationMs: gazeDur },
        }),
      );
      await wait(deep ? 320 : 220);
      window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: 'slow' } }));
      await wait(160 + Math.floor(Math.random() * 120));
      break;
    }
    case 'agreeing': {
      const strong = intent === 'strong_agree';
      window.dispatchEvent(
        new CustomEvent('avatar:nod', {
          detail: { intensity: (strong ? 0.11 : 0.075) * m, duration: strong ? 0.48 : 0.36 },
        }),
      );
      await wait(strong ? 120 : 200);
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: {
            yaw: (Math.random() - 0.5) * 0.04,
            pitch: -0.02 * m,
            durationMs: 620 + Math.floor(Math.random() * 240),
          },
        }),
      );
      await wait(eyeLagMs);
      break;
    }
    case 'explaining': {
      const confident = intent === 'confident_explain';
      const headYaw = (confident ? 0.018 : 0.038) * m;
      window.dispatchEvent(
        new CustomEvent('avatar:headpose', {
          detail: {
            yaw: headYaw,
            pitch: (confident ? 0.028 : 0.02) * m,
            durationMs: confident ? 520 : 640,
          },
        }),
      );
      await wait(eyeLagMs);
      if (!confident) {
        window.dispatchEvent(
          new CustomEvent('avatar:gaze', {
            detail: {
              yaw: (Math.random() - 0.5) * 0.05,
              pitch: -0.03 * m,
              durationMs: 780 + Math.floor(Math.random() * 220),
            },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent('avatar:gaze', {
            detail: { yaw: 0.012 * m, pitch: 0.01 * m, durationMs: 560 + Math.floor(Math.random() * 160) },
          }),
        );
      }
      await wait(confident ? 140 : 200);
      break;
    }
    default:
      await wait(55 + Math.floor(Math.random() * 80));
  }
}

/** Extra multiplier on gesture hold time from intent depth (combined with ±20% engine roll). */
export function getIntentDepthDurationMul(intent: IntentDepthClass): number {
  switch (intent) {
    case 'deep_thinking':
      return 1.08 + Math.random() * 0.1;
    case 'light_thinking':
      return 0.86 + Math.random() * 0.1;
    case 'strong_agree':
      return 0.9 + Math.random() * 0.07;
    case 'soft_agree':
      return 1.04 + Math.random() * 0.08;
    case 'confident_explain':
      return 0.95 + Math.random() * 0.07;
    case 'uncertain_explain':
      return 1.06 + Math.random() * 0.09;
    default:
      return 0.97 + Math.random() * 0.06;
  }
}

/** Additive offset on motion intensity before clamp (VRMA path). */
export function getIntentDepthIntensityOffset(intent: IntentDepthClass): number {
  switch (intent) {
    case 'deep_thinking':
      return -0.07;
    case 'light_thinking':
      return 0.03;
    case 'strong_agree':
      return 0.09;
    case 'soft_agree':
      return -0.04;
    case 'confident_explain':
      return 0.06;
    case 'uncertain_explain':
      return -0.05;
    default:
      return 0;
  }
}
