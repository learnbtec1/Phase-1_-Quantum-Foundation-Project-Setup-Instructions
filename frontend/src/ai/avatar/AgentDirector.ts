/**
 * AgentDirector.ts — Phase 4 Real-Time Avatar Orchestration Engine
 *
 * Subscribes to useBrainStore and translates every relevant state change into
 * a live, timed avatar performance:
 *
 *   PAD change   → BehaviorRulesEngine → gesture + voice update
 *   emotionLabel → micro-expression + full behavior contract (nod, blink, pose)
 *   lastFrame    → gesture from AgentFrame.gesture field + voice params
 *   currentAction (explicit) → honored as-is with thinking delay
 *
 * Conflict resolution (priority, lowest number = highest priority):
 *   0 — interrupt / user-override
 *   1 — explicit currentAction from processFrame
 *   2 — emotion-driven behavior contract
 *   3 — PAD-change fallback behavior
 *
 * Human-like randomisation:
 *   • All gestures include ±variance noise
 *   • Micro-expressions fire 80–180 ms after the trigger
 *   • Full behavior fires after emotion-appropriate thinking delay
 *   • Gesture fire-time includes 200 ms pre-roll (fires before speech keyword)
 *
 * Usage:
 *   import { agentDirector } from '@/ai/avatar/AgentDirector';
 *
 *   // In your app root (once):
 *   agentDirector.start();
 *
 *   // When done (e.g. on component unmount):
 *   agentDirector.stop();
 *
 *   // Explicit TTS scheduling (when no PCM audio comes from the backend):
 *   await agentDirector.scheduleTTS('مرحباً', 'happy');
 */

import type {
  PADVector,
  EmotionLabel,
  BehaviorOutput,
  AgentFrame,
} from '@/types/ai';
import { useBrainStore }                    from '@/store/useBrainStore';
import { decideBehaviorFromPAD }            from '@/ai/cognitive/BehaviorRulesEngine';
import { gestureEngine }                    from '@/ai/cognitive/GestureEngine';
import { checkGestureCooldown, recordGestureLog } from '@/ai/memory/store';
import { dispatchAvatar }                   from '@/utils/events/normalizeAvatarEvents';
import { speakWithTTS, stopTTS }            from '@/ai/io/tts';
import {
  microReactionDelay,
  humanDelay,
  jitter,
  getRandomDelay,
  estimateSpeechDurationMs,
  gesturePrerollMs,
} from '@/utils/TimingUtils';

// ─── Internal types ───────────────────────────────────────────────────────────

/**
 * Duck-typed shape ACTUALLY returned by BehaviorRulesEngine.decideBehaviorFromPAD.
 * The function annotates its return as BehaviorOutput but writes extra fields
 * (expression, voiceParameters) that the types/ai.ts interface does not declare.
 * We cast internally to avoid TS errors while still accessing those fields.
 */
interface _RulesEngineBehavior {
  gesture:         string;
  expression:      string;
  voiceParameters: { pitch: number; rate: number };
  thinkingDelayMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum ms between two PAD-change reactions (debounce). */
const PAD_DEBOUNCE_MS = 300;

/** Minimum ms between two emotion-label reactions (debounce). */
const EMOTION_DEBOUNCE_MS = 250;

/** Maximum simultaneous in-flight timer handles. */
const MAX_TIMERS = 64;

// ─── DOM event dispatcher ─────────────────────────────────────────────────────

function emit(name: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (
    name === 'avatar:gesture' ||
    name === 'avatar:emotion' ||
    name === 'avatar:listening'
  ) {
    // Route through the canonical normaliser (handles field-name aliasing)
    dispatchAvatar(name as 'avatar:gesture', detail as Record<string, unknown>);
  } else {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

// ─── Gesture → emotion mapping ────────────────────────────────────────────────
// Preferred gesture per emotion, used when the emotion drives the behavior
// contract but no explicit gesture was supplied.

const EMOTION_GESTURE_MAP: Partial<Record<EmotionLabel, string>> = {
  excited:     'wave',
  happy:       'openHand',
  encouraging: 'openHand',
  proud:       'openHand',
  surprised:   'openHand',
  angry:       'point',
  thinking:    'openHand',
  curious:     'beat',
  attentive:   'beat',
  concerned:   'openHand',
  calm:        'openHand',
  relaxed:     'openHand',
  sad:         'beat',
  anxious:     'beat',
  bored:       'beat',
  sleepy:      'beat',
  neutral:     'beat',
};

// ─── AgentDirector ────────────────────────────────────────────────────────────

export class AgentDirector {
  private _unsubs:             Array<() => void>             = [];
  private _timers:             ReturnType<typeof setTimeout>[] = [];
  private _running             = false;

  // Debounce timestamps
  private _lastEmotionReact    = 0;
  private _lastPADReact        = 0;

  // Track last-dispatched emotion to suppress no-op updates
  private _lastEmotion:        EmotionLabel | '' = '';

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Subscribe to BrainStore and begin orchestrating.
   * Idempotent — safe to call multiple times.
   */
  start(): void {
    if (this._running) {
      console.warn('[AgentDirector] Already running — ignoring duplicate start()');
      return;
    }
    this._running = true;
    console.log('%c[AgentDirector] STARTED — Phase 4 orchestration active', 'color:#7c3aed;font-weight:bold');

    // ── Subscription 1: emotion label changes ─────────────────────────────
    const unsubEmotion = useBrainStore.subscribe(
      s => s.emotionLabel,
      (next, prev) => {
        if (next !== prev) {
          const now = Date.now();
          if (now - this._lastEmotionReact < EMOTION_DEBOUNCE_MS) {
            console.log(`[AgentDirector] Emotion reaction debounced (${now - this._lastEmotionReact}ms < ${EMOTION_DEBOUNCE_MS}ms)`);
            return;
          }
          this._lastEmotionReact = now;
          console.log(`%c[AgentDirector] emotionLabel: ${prev} → ${next}`, 'color:#06b6d4');
          this._reactToEmotion(next);
        }
      },
    );

    // ── Subscription 2: PAD vector changes ───────────────────────────────
    const unsubPAD = useBrainStore.subscribe(
      s => s.pad,
      (next, prev) => {
        const delta =
          Math.abs(next.pleasure  - prev.pleasure)  +
          Math.abs(next.arousal   - prev.arousal)   +
          Math.abs(next.dominance - prev.dominance);
        if (delta < 0.10) return; // noise threshold
        const now = Date.now();
        if (now - this._lastPADReact < PAD_DEBOUNCE_MS) return;
        this._lastPADReact = now;
        console.log(`[AgentDirector] PAD delta=${delta.toFixed(3)} pad=${JSON.stringify(next)}`);
        this._reactToPAD(next);
      },
    );

    // ── Subscription 3: explicit currentAction (from processFrame) ────────
    const unsubAction = useBrainStore.subscribe(
      s => s.currentAction,
      (action) => {
        if (action) {
          console.log('[AgentDirector] currentAction received:', action);
          this._executeAction(action);
        }
      },
    );

    // ── Subscription 4: new LLM frame (gesture + voice from AgentFrame) ──
    const unsubFrame = useBrainStore.subscribe(
      s => s.lastFrame,
      (frame) => {
        if (frame) {
          console.log('[AgentDirector] lastFrame received:', frame.emotion, frame.gesture);
          this._reactToFrame(frame);
        }
      },
    );

    this._unsubs.push(unsubEmotion, unsubPAD, unsubAction, unsubFrame);
  }

  /** Unsubscribe all listeners, cancel all pending timers. Idempotent. */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
    console.log('[AgentDirector] STOPPED — all subscriptions and timers cleared');
  }

  // ── Internal reaction handlers ──────────────────────────────────────────────

  /** React to an emotion-label transition with a two-phase response. */
  private _reactToEmotion(emotion: EmotionLabel): void {
    this._lastEmotion = emotion;

    // Phase 1 — micro-expression (near-instant, mimics involuntary facial flash)
    const micro = microReactionDelay();
    this._later(micro, () => {
      emit('avatar:emotion', { emotion });
      console.log(`%c[AgentDirector][MICRO] expression=${emotion} +${micro}ms`, 'color:#22d3ee');
    });

    // Phase 2 — full behavior contract after human-like thinking delay
    const think = humanDelay(emotion);
    this._later(think, () => this._applyEmotionContract(emotion));
  }

  /**
   * React to a significant PAD change by running the BehaviorRulesEngine
   * and dispatching the resulting gesture + voice params.
   */
  private _reactToPAD(pad: PADVector): void {
    const raw      = decideBehaviorFromPAD(pad) as unknown as _RulesEngineBehavior;
    const delay    = jitter(raw.thinkingDelayMs, 0.20);
    console.log(`[AgentDirector] PAD behavior: gesture=${raw.gesture} expression=${raw.expression} in ${delay}ms`);

    this._later(delay, () => {
      // Voice parameters
      emit('avatar:voice', {
        rate:  raw.voiceParameters.rate,
        pitch: raw.voiceParameters.pitch,
      });

      // Gesture (PAD-driven fallback; lower priority than emotion contracts)
      this._fireGesture(raw.gesture, { intensity: 0.65, durationSec: 1.4, side: 'right' });
    });
  }

  /**
   * React to an incoming AgentFrame from the LLM:
   *   • Dispatch gesture from the natural-language gesture description
   *   • Apply voice pitch/rate from frame.voice
   *   • Honor thinking_time_ms as the reaction delay
   */
  private _reactToFrame(frame: AgentFrame): void {
    const delay = jitter(frame.thinking_time_ms, 0.15);

    // Voice update first (low latency)
    this._later(0, () => {
      emit('avatar:voice', { rate: frame.voice.rate, pitch: frame.voice.pitch });
    });

    // Gesture from action-text via GestureEngine (motor-memory aware)
    if (frame.gesture?.trim()) {
      this._later(delay, () => {
        console.log(`[AgentDirector][FRAME] gesture action="${frame.gesture.slice(0, 60)}"`);
        gestureEngine.play(frame.gesture, frame.emotion);
      });
    }
  }

  /**
   * Execute an explicit BehaviorOutput stored in BrainStore.currentAction.
   * Priority: higher than PAD-change fallback.
   */
  private _executeAction(action: BehaviorOutput): void {
    const delay = jitter(action.thinkingDelayMs, 0.12);
    this._later(delay, () => {
      if (action.gesture) {
        this._fireGesture(
          action.gesture,
          {
            intensity:   action.gestureIntensity  ?? 0.75,
            durationSec: action.gestureDurationMs ? action.gestureDurationMs / 1000 : 1.5,
            side:        action.gestureSide        ?? 'right',
          },
        );
      }

      if (action.voiceTone) {
        // Map voiceTone → approximate pitch offset
        const pitchMap: Record<string, number> = {
          warm: -1, excited: 2, firm: -2, soft: -1, neutral: 0,
        };
        const pitch = pitchMap[action.voiceTone] ?? 0;
        emit('avatar:voice', { rate: 1.0, pitch });
      }

      console.log(`[AgentDirector][ACTION] executed gesture=${action.gesture} delay=${delay}ms`);
    });
  }

  // ── Emotion behavior contracts ──────────────────────────────────────────────

  /**
   * Apply the full behavior contract for a given emotion.
   * Each emotion has a prescribed set of body language signals fired in sequence.
   */
  private _applyEmotionContract(emotion: EmotionLabel): void {
    console.log(`[AgentDirector] Applying behavior contract: ${emotion}`);

    // Gesture
    const gestureType = EMOTION_GESTURE_MAP[emotion] ?? 'beat';
    const intensity   = this._gestureIntensityForEmotion(emotion);
    this._fireGesture(gestureType, { intensity, durationSec: 1.6, side: 'right' });

    // Blink style
    if (['calm', 'relaxed', 'sad', 'sleepy', 'thinking', 'concerned'].includes(emotion)) {
      emit('avatar:blink', { style: 'slow' });
    } else if (['excited', 'surprised', 'angry'].includes(emotion)) {
      emit('avatar:blink', { style: 'rapid', count: 2 });
    } else {
      emit('avatar:blink', { style: 'normal' });
    }

    // Head pose
    this._applyHeadPose(emotion);

    // Nod (for affirming emotions)
    if (['attentive', 'encouraging', 'happy', 'proud', 'calm'].includes(emotion)) {
      const nodDelay = getRandomDelay(280, 550);
      this._later(nodDelay, () => {
        emit('avatar:nod', {
          intensity: 0.22 + Math.random() * 0.18,
          duration:  430 + Math.random() * 200,
        });
        console.log(`[AgentDirector] Nod dispatched for ${emotion} at +${nodDelay}ms`);
      });
    }

    // Laugh for peak-joy states
    if (['excited', 'happy'].includes(emotion)) {
      this._later(getRandomDelay(100, 350), () => {
        emit('avatar:laugh', { intensity: emotion === 'excited' ? 0.75 : 0.45, duration: 900 });
      });
    }

    console.log(`%c[AgentDirector][CONTRACT] ${emotion} → gesture=${gestureType} intensity=${intensity.toFixed(2)}`, 'color:#a78bfa;font-weight:bold');
  }

  /** Map emotion to a sensible gesture intensity (0–1). */
  private _gestureIntensityForEmotion(emotion: EmotionLabel): number {
    const intensityMap: Partial<Record<EmotionLabel, number>> = {
      excited:     0.95,
      surprised:   0.88,
      happy:       0.78,
      angry:       0.90,
      encouraging: 0.80,
      proud:       0.72,
      curious:     0.55,
      attentive:   0.45,
      thinking:    0.50,
      concerned:   0.52,
      calm:        0.55,
      relaxed:     0.48,
      sad:         0.35,
      neutral:     0.45,
      bored:       0.30,
      sleepy:      0.25,
      anxious:     0.60,
    };
    return intensityMap[emotion] ?? 0.55;
  }

  /** Apply an emotion-appropriate head pose. */
  private _applyHeadPose(emotion: EmotionLabel): void {
    type HeadPoseDetail = { yaw: number; pitch: number; duration: number };
    const poses: Partial<Record<EmotionLabel, HeadPoseDetail>> = {
      thinking:  { yaw: -0.09, pitch:  0,     duration: 3200 },
      sad:       { yaw:  0,    pitch:  0.12,   duration: 4000 },
      curious:   { yaw: -0.08, pitch:  0,     duration: 2800 },
      attentive: { yaw:  0,    pitch: -0.04,   duration: 3000 },
      sleepy:    { yaw:  0,    pitch:  0.08,   duration: 4500 },
      proud:     { yaw:  0,    pitch: -0.06,   duration: 3000 },
      concerned: { yaw:  0,    pitch:  0.07,   duration: 3200 },
      // 'blush' is not a standard EmotionLabel — omitted from the map
    };
    const pose = poses[emotion];
    if (pose) {
      emit('avatar:headpose', pose);
      console.log(`[AgentDirector] headpose for ${emotion}:`, pose);
    }
  }

  // ── Gesture dispatch ─────────────────────────────────────────────────────────

  /**
   * Dispatch a gesture event, respecting motor-memory cooldowns and applying
   * a humanising pre-roll offset.
   */
  private _fireGesture(
    gestureType: string,
    opts: { intensity: number; durationSec: number; side: string },
  ): void {
    if (!checkGestureCooldown(gestureType)) {
      console.log(`[AgentDirector] Gesture "${gestureType}" blocked by motor-memory cooldown`);
      return;
    }
    recordGestureLog(gestureType);

    // Pre-roll: fire slightly before the audio keyword (or immediately if no audio)
    const preroll = gesturePrerollMs();
    const fireAt  = Math.max(0, preroll - 200); // 200 ms is the canonical pre-roll window

    this._later(fireAt, () => {
      emit('avatar:gesture', {
        type:      gestureType,
        side:      opts.side,
        duration:  opts.durationSec,
        intensity: opts.intensity,
        variance:  Math.random() * 0.12,
      });
      console.log(
        `%c[AgentDirector][GESTURE] type=${gestureType} side=${opts.side} dur=${opts.durationSec}s int=${opts.intensity.toFixed(2)} +${fireAt}ms`,
        'color:#a78bfa;font-weight:bold',
      );
    });
  }

  // ── TTS scheduling ──────────────────────────────────────────────────────────

  /**
   * Schedule TTS playback with voice parameters drawn from the current
   * BrainStore action (if available) and the given emotion context.
   *
   * This method is intended as fallback when the backend returns tts_unavailable.
   * When PCM audio arrives from the WebSocket, the hook should play it directly
   * instead of calling this method.
   *
   * @param text         — Arabic or English text to speak
   * @param emotionLabel — current emotion (used for TTS rate/pitch mapping)
   * @param delayMs      — optional pre-speech delay (in addition to thinking delay)
   */
  async scheduleTTS(
    text:         string,
    emotionLabel: EmotionLabel,
    delayMs       = 0,
  ): Promise<void> {
    if (!text?.trim()) return;

    const speechMs = estimateSpeechDurationMs(text);
    console.log(
      `[AgentDirector] scheduleTTS delay=${delayMs}ms est=${speechMs}ms emotion=${emotionLabel}`,
    );

    await new Promise<void>(resolve => {
      this._later(delayMs, async () => {
        useBrainStore.getState().setTalking(true);

        const success = await speakWithTTS(text, {
          emotion: emotionLabel,
          onStart: () => {
            emit('avatar:speak:start', {});
            console.log('[AgentDirector] TTS speak:start');
          },
          onEnd: () => {
            useBrainStore.getState().setTalking(false);
            emit('avatar:speak:end', {});
            console.log('[AgentDirector] TTS speak:end');
            resolve();
          },
        });

        if (!success) {
          console.warn('[AgentDirector] speakWithTTS returned false — TTS path failed');
          useBrainStore.getState().setTalking(false);
          resolve();
        }
      });
    });
  }

  /** Immediately interrupt speech, cancel pending timers, reset talking state. */
  interruptSpeech(): void {
    console.log('%c[AgentDirector] INTERRUPT — stopping TTS and clearing timers', 'color:#ef4444;font-weight:bold');
    stopTTS();
    useBrainStore.getState().interrupt();
    // Clear gesture timers (keep subscription timers)
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
  }

  // ── Timer management ─────────────────────────────────────────────────────────

  private _later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this._timers = this._timers.filter(x => x !== t);
      fn();
    }, Math.max(0, ms));

    this._timers.push(t);
    // Prevent unbounded timer list growth
    if (this._timers.length > MAX_TIMERS) {
      this._timers.shift();
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Singleton AgentDirector.
 *
 * Call `agentDirector.start()` once in your application root component
 * (e.g. in a useEffect with an empty dependency array, or in layout.tsx)
 * and `agentDirector.stop()` on unmount.
 */
export const agentDirector = new AgentDirector();
