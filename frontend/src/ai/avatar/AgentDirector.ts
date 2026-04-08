/**
 * AgentDirector.ts — THE FINAL MASTER VERSION (Phase 4)
 * تم دمج ميزات "النشامي" التفاعلية مع تصحيح هيكلي شامل للأقواس.
 */

import type {
  PADVector,
  EmotionLabel,
  BehaviorOutput,
  AgentFrame,
} from '@/types/ai';
import { useBrainStore }                     from '@/store/useBrainStore';
import { decideBehaviorFromPAD }             from '@/ai/cognitive/BehaviorRulesEngine';
import type { EmotionalContextBrief }        from '@/ai/cognitive/BehaviorRulesEngine';
import { gestureEngine, unifiedGestureEngine } from '@/ai/cognitive/GestureEngine';
import { PRIORITY, resolveEmotionGesturePlay } from '@/constants/gestures';
import type { TeachingStrategy } from '@/ai/teaching/TeachingStrategyEngine';
import { checkGestureCooldown, recordGestureLog, getLastGestureLog } from '@/ai/memory/store';
import { dispatchAvatar }                    from '@/utils/events/normalizeAvatarEvents';
import { speakWithTTS, stopTTSGlobally, resolveSpeakRate } from '@/ai/io/tts';
import { COGNI_PERSONA, AVATAR_PERSONALITY } from '@/config/personality';
import { ENABLE_MIME_MODE } from '@/config/avatar';
import { emotionalMemoryManager }            from '@/ai/avatar/EmotionalMemoryManager';
import {
  microReactionDelay,
  humanDelay,
  jitter,
  getRandomDelay,
  estimateSpeechDurationMs,
  gesturePrerollMs,
} from '@/utils/TimingUtils';

declare global {
  interface Window {
    __AUDIO_UNLOCKED__?: boolean;
    /** Dev console: window.__agentDirector.processWsFrame({ type:'agent:gesture', gesture:'Thinking' }) */
    __agentDirector?: AgentDirector;
    /** Dev console: window.__cogniGestureEngine.play('Clapping') */
    __cogniGestureEngine?: typeof unifiedGestureEngine;
  }
}

interface _RulesEngineBehavior {
  gesture:       string;
  expression:    string;
  voiceParameters: {
    pitch: number;
    rate: number;
    /** Optional: curiosity-based offset (BehaviorRulesEngine + personality) */
    personalityPitchNudge?: number;
    padPitch?: number;
  };
  thinkingDelayMs: number;
}

const PAD_DEBOUNCE_MS = 300;
const EMOTION_DEBOUNCE_MS = 250;
const MAX_TIMERS = 64;

/** Safe fallbacks if persona fields are ever stripped in a bad build */
const COGNI_TIMING = {
  deliberationScale:        COGNI_PERSONA.timing?.deliberationScale ?? 1,
  gestureVarianceScale:     COGNI_PERSONA.timing?.gestureVarianceScale ?? 1,
  baselineGestureIntensity: COGNI_PERSONA.timing?.baselineGestureIntensity ?? 1,
};
const COGNI_VOICE = {
  rate:       COGNI_PERSONA.voiceParameters?.rate ?? 1,
  pitchScale: COGNI_PERSONA.voiceParameters?.pitchScale ?? 1,
};

function devLog(...args: unknown[]): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.log('[AgentDirector][Cogni]', ...args);
  }
}

function emit(name: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (['avatar:gesture', 'avatar:emotion', 'avatar:listening', 'avatar:nod', 'avatar:headpose', 'avatar:speak:start', 'avatar:speak:end'].includes(name)) {
    dispatchAvatar(name as any, detail);
  } else {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

/** Cogni: slightly longer “thinking” before reacting — patient educator */
function cogniDelayMs(base: number): number {
  return Math.round(base * COGNI_TIMING.deliberationScale);
}

const EMOTION_GESTURE_MAP: Partial<Record<EmotionLabel, string>> = {
  excited: 'clap', happy: 'openHand', encouraging: 'openHand', proud: 'clap',
  surprised: 'openHand', angry: 'point', thinking: 'openHand', curious: 'beat',
  attentive: 'beat', concerned: 'openHand', calm: 'openHand', relaxed: 'openHand',
  empathetic: 'openHand', sad: 'beat', anxious: 'beat', bored: 'beat', sleepy: 'beat', neutral: 'beat',
};

/**
 * Emotion labels that have a named VRMA equivalent — played via UnifiedGestureEngine
 * so the priority queue and cross-fade system are respected.
 */
const EMOTION_TO_VRMA: Partial<Record<EmotionLabel, string>> = {
  excited:      'Clapping',
  happy:        'Clapping',
  encouraging:  'Clapping',
  proud:        'standing-cheering',
  surprised:    'Surprised',
  sad:          'Sad',
  angry:        'Angry',
  sleepy:       'Sleepy',
  thinking:     'Thinking',
  curious:      'Thinking',
};

/** Canvas / عميل Azure يستمع لـ `agent:message` (نص + مشاعر + إيماءة مقترحة). */
function emitAgentMessage(text: string, emotion: EmotionLabel): void {
  if (typeof window === 'undefined') return;
  const gesture = EMOTION_GESTURE_MAP[emotion];
  window.dispatchEvent(
    new CustomEvent('agent:message', {
      detail: { text, emotion, gesture },
    }),
  );
}

function useAgentMessageAzureTts(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_USE_AGENT_MESSAGE_AZURE_TTS === 'true'
  );
}

export class AgentDirector {
  /** V31 — dedupe rapid identical scheduleTTS (quota / WS duplicate frames) */
  private _lastScheduledTtsText = '';
  private _lastScheduledTtsAt = 0;
  private _unsubs:             Array<() => void>               = [];
  private _timers:             ReturnType<typeof setTimeout>[] = [];
  private _running             = false;
  private _lastEmotionReact    = 0;
  private _lastPADReact        = 0;
  private _lastEmotion:        EmotionLabel | '' = '';

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    if (this._running) return;
    this._running = true;
    console.log('%c[AgentDirector] STARTED — Phase 4 orchestration active', 'color:#7c3aed;font-weight:bold');
    devLog(
      'persona active',
      COGNI_PERSONA.id,
      'deliberation×',
      COGNI_TIMING.deliberationScale,
      'variance×',
      COGNI_TIMING.gestureVarianceScale,
      'intensity×',
      COGNI_TIMING.baselineGestureIntensity,
    );
    // After Canvas listeners attach, force standing (avoids missing the event if start() runs first).
    this._later(80, () => {
      if (!this._running) return;
      emit('avatar:sit', { sitting: false });
    });

    const subs = [
      // 1. مراقبة العواطف
      useBrainStore.subscribe(s => s.emotionLabel, (next, prev) => {
        if (next !== prev && Date.now() - this._lastEmotionReact > EMOTION_DEBOUNCE_MS) {
          this._lastEmotionReact = Date.now();
          this._reactToEmotion(next);
        }
      }),
      // 2. مراقبة متجهات PAD
      useBrainStore.subscribe(s => s.pad, (next, prev) => {
        const delta = Math.abs(next.pleasure - prev.pleasure) + Math.abs(next.arousal - prev.arousal);
        if (delta > 0.1 && Date.now() - this._lastPADReact > PAD_DEBOUNCE_MS) {
          this._lastPADReact = Date.now();
          this._reactToPAD(next);
        }
      }),
      // 3. آخر إطار LLM
      useBrainStore.subscribe(s => s.lastFrame, f => { if (f) this._reactToFrame(f); }),
      
      // 4. ميزة السمع النشط (Active Listening) — field now exists on BrainState
      useBrainStore.subscribe(s => s.isUserSpeaking, isSpeaking => {
        if (isSpeaking) this._handleUserSpeaking();
      }),

      // 5. كسر جمود وضعية Neutral
      useBrainStore.subscribe(s => s.emotionLabel, emotion => {
        if (emotion === 'neutral') this._handleNeutralEmotion();
      }),

      // 6. currentAction dispatch (was never called — now setCurrentAction is used)
      useBrainStore.subscribe(s => s.currentAction, a => { if (a) this._executeAction(a); }),

      // 7. طبقة الوعي: تحديث هدف التدريس → يعكسه الأفاتار بإيماءة تفكير قصيرة
      useBrainStore.subscribe(s => s.currentTeachingGoal, (goal, prev) => {
        if (goal && goal !== prev) this._reactToNewGoal(goal);
      }),

      // 8. الوعي الحي: cues من إطار الدماغ JSON
      useBrainStore.subscribe(s => s.latestAwarenessCues, cues => {
        if (cues) this._reactToAwarenessCues(cues);
      }),

      // 9. الحدس: كشف ضعف خفي → تغيير أسلوب الشرح
      useBrainStore.subscribe(s => s.hiddenWeakness, (weakness, prev) => {
        if (weakness && weakness !== prev) this._reactToHiddenWeakness(weakness);
      }),

      // 10. الوعي الزمني: تغيّر مرحلة الجلسة → تكيّف السلوك
      useBrainStore.subscribe(s => s.sessionPhase, (phase, prev) => {
        if (phase !== prev) this._reactToSessionPhase(phase);
      }),

      // 11. الإقناع: تغيّر مود الإقناع → تغيّر أسلوب الصوت
      useBrainStore.subscribe(s => s.lastPersuasionMode, mode => {
        if (mode) this._applyPersuasionBodyLanguage(mode as 'logos' | 'ethos' | 'pathos' | 'kairos');
      }),
    ];
    this._unsubs.push(...subs);

    // V28 — emotional contagion hints from backend (student affect → calmer / warmer avatar)
    if (typeof window !== 'undefined') {
      const onContagion = (e: Event) => {
        const d = (e as CustomEvent).detail as { emotion?: string; intensity?: number };
        if (!d?.emotion) return;
        emit('avatar:emotion', { emotion: d.emotion });
        if (d.emotion === 'calm') {
          emit('avatar:gesture', { type: 'openHand', duration: 2 });
        }
      };
      window.addEventListener('cogni:student_contagion', onContagion);
      this._unsubs.push(() => window.removeEventListener('cogni:student_contagion', onContagion));
    }
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    this._unsubs.forEach(fn => fn());
    this._timers.forEach(t => clearTimeout(t));
    this._unsubs = [];
    this._timers = [];
    if (this._neutralBreakTimerId !== null) {
      clearTimeout(this._neutralBreakTimerId);
      this._neutralBreakTimerId = null;
    }
    console.log('[AgentDirector] STOPPED — All systems cleared');
  }

  // ── Reaction Handlers ───────────────────────────────────────────────────────

  private _reactToEmotion(emotion: EmotionLabel): void {
    this._lastEmotion = emotion;
    const lf = useBrainStore.getState().lastFrame;
    const emoStr =
      typeof lf?.emotion === 'string' && lf.emotion.trim().length > 0
        ? lf.emotion.trim()
        : emotion;
    emit('avatar:emotion', { emotion: emoStr });
    this._later(cogniDelayMs(humanDelay(emotion)), () => {
      this._applyEmotionContract(emotion);
      // If this emotion has a named VRMA, dispatch through the priority queue
      const vrmaName = EMOTION_TO_VRMA[emotion];
      if (vrmaName) {
        const p = (['surprised', 'angry'].includes(emotion)) ? PRIORITY.CRITICAL : PRIORITY.HIGH;
        void unifiedGestureEngine.play(vrmaName, { priority: p });
      }
    });
  }

  private _reactToPAD(pad: PADVector): void {
    const traj = emotionalMemoryManager.getTrajectory();
    const emoCtx: EmotionalContextBrief = {
      trend: traj.trend,
      avgPleasure: traj.avgPleasure,
      variance: traj.variance,
    };
    // FIX: Phase 3/4 — PAD + emotional trajectory in one rules pass
    const raw = decideBehaviorFromPAD(pad, emoCtx) as unknown as _RulesEngineBehavior;
    const expr = (raw.expression ?? 'neutral').toLowerCase();
    this._later(cogniDelayMs(microReactionDelay()), () => {
      emit('avatar:emotion', { emotion: expr });
    });
    let gesture = raw.gesture;
    if (traj.trend === 'volatile' && traj.variance > 0.35 && gesture === 'point') {
      gesture = 'beat';
    }
    if (
      AVATAR_PERSONALITY.friendliness >= 0.75
      && pad.pleasure >= -0.15
      && gesture === 'point'
    ) {
      gesture = 'openHand';
    }

    const thinkMs = jitter(raw.thinkingDelayMs, 0.2) * COGNI_TIMING.deliberationScale;
    const adaptPG = emotionalMemoryManager.getPersonalityAdaptation();
    if (adaptPG.preferPointingGestures && gesture === 'openHand' && Math.random() < 0.38) {
      gesture = 'point';
    }
    let calmIntensity = Math.min(0.82, 0.65 * COGNI_TIMING.baselineGestureIntensity);
    if (traj.trend === 'rising_positive') {
      calmIntensity = Math.min(0.92, calmIntensity * 1.12);
    }
    if (traj.trend === 'falling_negative' || traj.trend === 'stable_negative') {
      calmIntensity *= 0.88;
    }

    this._later(thinkMs, () => {
      emit('avatar:voice', {
        rate: raw.voiceParameters.rate * COGNI_VOICE.rate,
        pitch: raw.voiceParameters.pitch * COGNI_VOICE.pitchScale,
      });
      // Single source: _fireGesture only (subscription 6 / _executeAction would double-fire)
      this._fireGesture(gesture, { intensity: calmIntensity, durationSec: 1.8, side: 'right' });
      // Occasional playful flourish when long-term memory suggests the user enjoys light tone
      const pg = emotionalMemoryManager.getPersonalityAdaptation();
      if (Math.random() < pg.playfulGestureChance * 0.24) {
        this._later(850 + Math.random() * 550, () => {
          // Prefer peace/agree — `wave` is once-per-session in gesture memory store
          const playG = Math.random() < 0.55 ? 'peace' : 'agree';
          this._fireGesture(playG, {
            intensity: 0.52 * COGNI_TIMING.baselineGestureIntensity,
            durationSec: 2.05,
            side: 'right',
          });
        });
      }
    });
  }

  private _reactToFrame(frame: AgentFrame): void {
    const delay = jitter(frame.thinking_time_ms, 0.15) * COGNI_TIMING.deliberationScale;
    this._later(0, () => emit('avatar:voice', {
      rate: frame.voice.rate * COGNI_VOICE.rate,
      pitch: frame.voice.pitch * COGNI_VOICE.pitchScale,
    }));

    // Single source of truth: LLM `performance` array — word-sync cues (avatar:performance dispatch optional / currently off in useAgentAgent).
    if (frame.gesturesFromStructuredPerformance) {
      return;
    }

    const planned = gestureEngine.planGestures(
      frame.gesture?.trim() || '',
      frame.emotion,
      estimateSpeechDurationMs(frame.text ?? ''),
    );

    const gi = COGNI_TIMING.baselineGestureIntensity;
    planned.forEach(p => {
      this._later(delay + p.fireAtMs, () => this._fireGesture(p.descriptor.type as string, {
        intensity: Math.min(0.88, (p.descriptor.intensity ?? 0.75) * gi),
        // Keep 1.55–2.2s visible window for procedural gesture hold (AvatarCanvas uses `duration`)
        durationSec: Math.max(1.55, (p.descriptor.duration ?? 2.0) * 1.05),
        side: p.descriptor.side ?? 'right',
      }));
    });
  }

  private _executeAction(action: BehaviorOutput): void {
    this._later(jitter(action.thinkingDelayMs, 0.12) * COGNI_PERSONA.timing.deliberationScale, () => {
      if (!action.gesture) return;
      // FIX: emotional memory biases explicit actions too
      const traj = emotionalMemoryManager.getTrajectory();
      let g = action.gesture;
      if (
        (traj.trend === 'falling_negative' || traj.trend === 'stable_negative')
        && ['point', 'head_down', 'lean_back'].includes(g)
      ) {
        g = 'openHand';
      }
      let gi = (action.gestureIntensity ?? 0.75) * COGNI_PERSONA.timing.baselineGestureIntensity;
      if (traj.trend === 'rising_positive') gi = Math.min(0.95, gi * 1.08);
      if (traj.trend === 'falling_negative' || traj.trend === 'stable_negative') gi *= 0.87;
      this._fireGesture(g, {
        intensity: Math.min(0.92, gi),
        durationSec: ((action.gestureDurationMs ?? 1800) / 1000) * 1.02,
        side: action.gestureSide ?? 'right',
      });
    });
  }

  // ── [NEW] Behavioral Features (النشامي) ─────────────────────────────────────

  /** السمع النشط: يهز الأفاتار رأسه عند اكتشاف صوت المستخدم */
  private _handleUserSpeaking(): void {
    this._later(cogniDelayMs(getRandomDelay(100, 400)), () => {
      emit('avatar:nod', { intensity: 0.15, duration: 0.6 });
      // ميل بسيط للرأس لإظهار الاهتمام
      emit('avatar:headpose', { 
        yaw: 0.05 * (Math.random() > 0.5 ? 1 : -1), 
        pitch: -0.05, 
        duration: 1500 
      });
    });
  }

  // ── Awareness layer methods ──────────────────────────────────────────────────

  /** تفاعل مع تحديث هدف التدريس من Thinker */
  private _reactToNewGoal(goal: string): void {
    devLog('New teaching goal:', goal.slice(0, 80));
    this._later(cogniDelayMs(microReactionDelay()), () => {
      // Show "planning" gesture — brief think then gentle wave to indicate readiness
      void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.LOW });
      this._later(2000, () => {
        void unifiedGestureEngine.play('Acknowledging', { priority: PRIORITY.LOW });
      });
    });
  }

  // ── Intuition, Temporal, Persuasion reactions ─────────────────────────────

  private _reactToHiddenWeakness(weakness: string): void {
    devLog('Hidden weakness detected:', weakness.slice(0, 60));
    // Concerned expression + lean forward
    this._later(300, () => {
      emit('avatar:emotion', { emotion: 'concerned', strength: 0.6 });
      void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.NORMAL });
      emit('avatar:headpose', { yaw: 0.05, pitch: -0.04, duration: 1800 });
    });
  }

  private _reactToSessionPhase(phase: string): void {
    devLog('Session phase →', phase);
    switch (phase) {
      case 'warmup':
        void unifiedGestureEngine.play('Waving', { priority: PRIORITY.LOW });
        emit('avatar:emotion', { emotion: 'friendly', strength: 0.65 });
        break;
      case 'deepwork':
        void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.LOW });
        emit('avatar:emotion', { emotion: 'attentive', strength: 0.7 });
        break;
      case 'cooldown':
        void unifiedGestureEngine.play('Acknowledging', { priority: PRIORITY.LOW });
        emit('avatar:emotion', { emotion: 'calm', strength: 0.6 });
        break;
      case 'closing':
        // Peak-End Rule: end with positive energy
        this._later(800, () => {
          void unifiedGestureEngine.play('Clapping', { priority: PRIORITY.NORMAL });
          emit('avatar:emotion', { emotion: 'proud', strength: 0.8 });
        });
        break;
    }
  }

  private _applyPersuasionBodyLanguage(mode: 'logos' | 'ethos' | 'pathos' | 'kairos'): void {
    const behaviorMap: Record<string, { gesture: string; emotion: string }> = {
      logos:   { gesture: 'Pointing',      emotion: 'attentive' },
      ethos:   { gesture: 'Acknowledging', emotion: 'proud'     },
      pathos:  { gesture: 'Agreeing',      emotion: 'encouraging' },
      kairos:  { gesture: 'Waving',        emotion: 'excited'   },
    };
    const b = behaviorMap[mode];
    if (!b) return;
    this._later(200, () => {
      void unifiedGestureEngine.play(b.gesture, { priority: PRIORITY.BACKGROUND });
      emit('avatar:blink', { style: mode === 'pathos' ? 'slow' : 'normal' });
    });
  }

  /** تطبيق سلوك الأفاتار المرتبط باستراتيجية التدريس المختارة */
  applyTeachingStrategyBehavior(strategy: TeachingStrategy): void {
    if (!strategy) return;
    const { avatarGesture, avatarEmotion, bodyLanguage } = strategy;
    this._later(cogniDelayMs(120), () => {
      emit('avatar:emotion', { emotion: avatarEmotion, strength: 0.72 });
      void unifiedGestureEngine.play(avatarGesture, { priority: PRIORITY.NORMAL });
      emit('avatar:gaze', {
        yaw: bodyLanguage.gazeTarget === 'think' ? -0.18 : 0,
        pitch: bodyLanguage.gazeTarget === 'think' ? -0.12 : 0,
        durationMs: 2500,
      });
      emit('avatar:blink', { style: bodyLanguage.blinkStyle });
    });
  }

  /** تفاعل مع cues الوعي الحي من JSON brain frame */
  private _reactToAwarenessCues(cues: Record<string, unknown>): void {
    const studentState = String(cues.student_state ?? '');
    const energy = typeof cues.movement_energy === 'number' ? cues.movement_energy : null;
    // Student seems bored/disengaged → warmer, more engaging gesture
    if (studentState === 'bored' || studentState === 'disengaged') {
      this._later(400, () => {
        this._fireGesture('wave', { intensity: 0.65, durationSec: 2.0, side: 'right' });
      });
    }
    // Student confused → empathetic agree + acknowledge
    if (studentState === 'confused') {
      this._later(300, () => {
        void unifiedGestureEngine.play('Acknowledging', { priority: PRIORITY.NORMAL });
      });
    }
    // High energy → match with more expressive body language
    if (energy !== null && energy > 0.75) {
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('cogni:motorspeed', { detail: { multiplier: 1.2, durationMs: 3000 } }));
        }, 200);
      }
    }
  }

  private _neutralBreakTimerId: ReturnType<typeof setTimeout> | null = null;

  /** كسر الجمود: حركات عشوائية بسيطة عند الصمت الطويل (idempotent — لا تتراكم) */
  private _handleNeutralEmotion(): void {
    if (this._neutralBreakTimerId !== null) return; // already scheduled
    const delay = getRandomDelay(5000, 8000);
    this._neutralBreakTimerId = setTimeout(() => {
      this._neutralBreakTimerId = null;
      if (useBrainStore.getState().emotionLabel === 'neutral') {
        // Alternate between procedural (fast) and VRMA-based (named) idle gestures
        const useVrma = Math.random() < 0.35;
        if (useVrma) {
          const vrmaIdles = ['look-around', 'look-around2', 'Relax', 'Idle1', 'Idle2', 'Idle3', 'Idle4'];
          const pick = vrmaIdles[Math.floor(Math.random() * vrmaIdles.length)];
          void unifiedGestureEngine.play(pick, { priority: PRIORITY.LOW });
        } else {
          const fallbackGestures = ['look', 'relax', 'agree'];
          const randomG = fallbackGestures[Math.floor(Math.random() * fallbackGestures.length)];
          this._fireGesture(randomG, {
            intensity: 0.28 * COGNI_TIMING.baselineGestureIntensity,
            durationSec: 1.35,
            side: 'right',
          });
        }
      }
    }, delay);
  }

  /** خطة بديلة عند تعطل الصوت: محاكاة أداء الكلام حركياً */
  private _handleTTSFallback(text: string, emotion: EmotionLabel): void {
    console.warn('[AgentDirector] TTS Fallback — Simulating performance');
    // CRITICAL ORDER: fire gesture FIRST so vrmaGestureUntilRef is set
    // before avatar:speak:start reaches AvatarCanvas onSpeakStart.
    // If speak:start fires first, onSpeakStart sees no active gesture and
    // immediately plays sitTalk, killing the gesture animation.
    this._applyEmotionContract(emotion);
    emit('avatar:speak:start', {});
    this._later(estimateSpeechDurationMs(text), () => emit('avatar:speak:end', {}));
  }

  // ── Emotion Contracts ───────────────────────────────────────────────────────

  private _applyEmotionContract(emotion: EmotionLabel): void {
    const skipBodyGesture = useBrainStore.getState().lastFrame?.gesturesFromStructuredPerformance;
    if (!skipBodyGesture) {
      const intensity = this._gestureIntensityForEmotion(emotion);
      this._fireGesture(EMOTION_GESTURE_MAP[emotion] ?? 'beat', { intensity, durationSec: 3.5, side: 'right' });
    }

    emit('avatar:blink', { 
      style: ['calm', 'relaxed', 'sad', 'thinking'].includes(emotion) ? 'slow' : 'normal' 
    });

    this._applyHeadPose(emotion);

    if (['attentive', 'encouraging', 'happy', 'calm'].includes(emotion)) {
      this._later(getRandomDelay(300, 600), () => emit('avatar:nod', { intensity: 0.25, duration: 0.5 }));
    }
  }

  private _gestureIntensityForEmotion(e: EmotionLabel): number {
    const map: Partial<Record<EmotionLabel, number>> = {
      excited: 0.95, happy: 0.78, encouraging: 0.8, thinking: 0.5, neutral: 0.45,
    };
    const raw = map[e] ?? 0.55;
    return Math.min(0.9, raw * COGNI_TIMING.baselineGestureIntensity);
  }

  private _applyHeadPose(e: EmotionLabel): void {
    const poses: any = { 
      thinking: { yaw: -0.09, pitch: 0, duration: 3200 }, 
      attentive: { yaw: 0, pitch: -0.04, duration: 3000 }, 
      concerned: { yaw: 0, pitch: 0.07, duration: 3200 } 
    };
    if (poses[e]) emit('avatar:headpose', poses[e]);
  }

  private _fireGesture(g: string, o: any): void {
    // Standing-first: emit full gesture tokens. AvatarCanvas maps seated-safe motion only when UI sit is active.
    // FIX: personality-consistent gestures — high friendliness softens point unless user profile prefers technical pointing
    const adaptPG = emotionalMemoryManager.getPersonalityAdaptation();
    let mapped = g;
    if (AVATAR_PERSONALITY.friendliness >= 0.75 && mapped === 'point') {
      if (!adaptPG.preferPointingGestures || Math.random() < 0.42) {
        mapped = 'openHand';
      }
    } else if (adaptPG.preferPointingGestures && mapped === 'openHand' && Math.random() < 0.34) {
      mapped = 'point';
    }
    const traj = emotionalMemoryManager.getTrajectory();
    let intensity = Number(o.intensity);
    if (traj.trend === 'rising_positive') {
      intensity = Math.min(0.95, intensity * 1.06);
    }
    if (traj.trend === 'falling_negative' || traj.trend === 'stable_negative') {
      intensity *= 0.9;
    }
    intensity = Math.min(0.94, intensity);

    const lfAct = useBrainStore.getState().lastFrame?.gesture?.trim();
    if (!checkGestureCooldown(mapped, { explicitActionToken: lfAct })) return;

    const lastLog = getLastGestureLog();
    const lastG = lastLog.length ? lastLog[lastLog.length - 1] : '';
    const explicit = lfAct?.toLowerCase() ?? '';
    const explicitMatch =
      !!explicit
      && (explicit === mapped.toLowerCase()
        || explicit.includes(mapped)
        || mapped.includes(explicit));
    if (!explicitMatch && lastG === mapped && ['openHand', 'point', 'beat'].includes(mapped)) {
      const alts: Record<string, string> = { point: 'openHand', openHand: 'beat', beat: 'point' };
      mapped = alts[mapped] ?? 'beat';
      if (!checkGestureCooldown(mapped, { explicitActionToken: lfAct })) return;
    }

    recordGestureLog(mapped);
    const v = COGNI_TIMING.gestureVarianceScale;
    const rnd =
      typeof window !== 'undefined' && typeof (window as unknown as { __GESTURE_RNG__?: () => number }).__GESTURE_RNG__ === 'function'
        ? (window as unknown as { __GESTURE_RNG__: () => number }).__GESTURE_RNG__
        : Math.random;
    const durJitterSec = (rnd() - 0.5) * 0.35 * v;
    const durationSec = Math.max(0.45, (o.durationSec ?? 1.8) + durJitterSec);
    const variance = rnd() * 0.12 * v;
    const ampScale = 0.85 + rnd() * 0.3;
    const wristTwist = (rnd() - 0.5) * 0.09 * v;
    const asym = (rnd() - 0.5) * 0.04;
    intensity = Math.min(0.95, intensity * ampScale + asym);

    this._later(Math.max(0, gesturePrerollMs() - 200), () => {
      devLog('gesture →', mapped, 'dur≈', durationSec.toFixed(2), 's', 'side=', o.side, 'I=', intensity.toFixed(2));

      // Route through UnifiedGestureEngine.play() when the gesture is a known VRMA/canonical name.
      // This preserves vrmaStem, priority, and goes through the full VRMA system.
      // Fallback to legacy dispatchAvatar for procedural tokens (openHand, beat, etc.)
      const VRMA_GESTURES_SET = new Set([
        'Thinking', 'thinking', 'think',
        'Waving', 'waving', 'wave',
        'Clapping', 'clapping', 'clap',
        'Pointing', 'pointing', 'point',
        'Agreeing', 'agreeing', 'agree',
        'Acknowledging', 'acknowledging',
        'Goodbye', 'goodbye', 'bye',
        'Beckoning', 'beckoning',
        'Sad', 'sad', 'Angry', 'angry',
        'Surprised', 'surprised',
        'Sleepy', 'sleepy',
        'standing-cheering', 'Clapping',
        'listening', 'processing',
      ]);

      if (VRMA_GESTURES_SET.has(mapped)) {
        // Full VRMA pipeline: gesture + priority + crossfade + correct bone state
        void unifiedGestureEngine.play(mapped, {
          priority: PRIORITY.NORMAL,
          durationMs: Math.round(durationSec * 1000),
        });
      } else {
        // Legacy procedural path (openHand, beat, lean_forward, etc.)
        emit('avatar:gesture', {
          type: mapped,
          gesture: mapped,   // also set gesture field for VRMSkeletonManager
          side: o.side,
          duration: durationSec,
          intensity,
          variance: variance + wristTwist,
        });
      }
    });
  }

  // ── TTS Scheduling ──────────────────────────────────────────────────────────

  async scheduleTTS(text: string, emotion: EmotionLabel, delay = 0): Promise<void> {
    if (!text?.trim()) return;
    const trimmed = text.trim();
    const now = Date.now();
    if (
      trimmed === this._lastScheduledTtsText
      && now - this._lastScheduledTtsAt < 10_000
    ) {
      console.warn('[AgentDirector] scheduleTTS skipped — duplicate text within 10s');
      return;
    }
    this._lastScheduledTtsText = trimmed;
    this._lastScheduledTtsAt = now;

    if (ENABLE_MIME_MODE) {
      await new Promise<void>(res => {
        this._later(delay, () => {
          stopTTSGlobally();
          emitAgentMessage(trimmed, emotion);
          useBrainStore.getState().setTalking(true);
          emit('avatar:speak:start', {});
          const simulatedMs = Math.max(400, Math.min(120_000, trimmed.length * 65));
          const endT = setTimeout(() => {
            this._timers = this._timers.filter(x => x !== endT);
            useBrainStore.getState().setTalking(false);
            emit('avatar:speak:end', {});
            res();
          }, simulatedMs);
          this._timers.push(endT);
        });
      });
      return;
    }

    const clientAzure = useAgentMessageAzureTts();

    await new Promise<void>(res => {
      this._later(delay, async () => {
        stopTTSGlobally();
        emitAgentMessage(trimmed, emotion);

        if (clientAzure) {
          // الصوت يُشغَّل من `AvatarCanvas` عبر `onAgentSpeak` (Azure SDK + visemes).
          res();
          return;
        }

        useBrainStore.getState().setTalking(true);
        const ok = await speakWithTTS(text, { 
          emotion,
          rate: resolveSpeakRate(emotion, COGNI_VOICE.rate),
          ...(COGNI_VOICE.pitchScale > 1.01 ? { pitch: '+2Hz' as const } : {}),
          arVoice: 'male', 
          onStart: () => {
            emit('avatar:speak:start', {});
          }, 
          onEnd: () => { 
            useBrainStore.getState().setTalking(false); 
            emit('avatar:speak:end', {}); 
            res(); 
          } 
        });
        if (!ok) { this._handleTTSFallback(text, emotion); res(); }
      });
    });
  }

  // ── Public WebSocket frame router ───────────────────────────────────────────

  /**
   * Route a parsed WebSocket frame into the gesture / emotion system.
   * Handles: agent:gesture, agent:emotion, agent:action, agent:thinking.
   *
   * @example (dev console)
   *   window.__agentDirector.processWsFrame({ type: 'agent:gesture', gesture: 'Thinking' })
   *   window.__agentDirector.processWsFrame({ type: 'agent:emotion', emotion: 'excited' })
   */
  /**
   * Dev / UI: drive avatar mood → gesture from a string (same path as `agent:emotion` WS).
   */
  updateEmotion(emotion: string): void {
    const e = String(emotion ?? '').trim();
    if (!e) return;
    this.processWsFrame({ type: 'agent:emotion', emotion: e });
  }

  /**
   * React to a user-typed message before send (listening / thinking are handled in UI).
   */
  processUserMessage(message: string): void {
    const sentiment = this.analyzeSentiment(message);
    if (sentiment === 'happy') void unifiedGestureEngine.play('Clapping', { priority: PRIORITY.HIGH });
    else if (sentiment === 'question') void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.NORMAL });
    else if (sentiment === 'greeting') void unifiedGestureEngine.play('greeting', { priority: PRIORITY.HIGH });
    else if (sentiment === 'grateful') void unifiedGestureEngine.play('thankful', { priority: PRIORITY.NORMAL });
    else if (sentiment === 'sad') void unifiedGestureEngine.play('Sad', { priority: PRIORITY.NORMAL });
  }

  analyzeSentiment(text: string): string {
    const lowerText = text.toLowerCase();
    if (/[؟?]/.test(text) && /لماذا|كيف|ما |why|how|what/.test(lowerText)) return 'question';
    if (/شكر|thank|thanks/.test(lowerText)) return 'grateful';
    if (/مرحب|أهلا|السلام|hello|\bhi\b|\bhey\b/.test(lowerText)) return 'greeting';
    if (/!|رائع|عظيم|great|awesome|wow/.test(lowerText)) return 'happy';
    if (/حزين|sad/.test(lowerText)) return 'sad';
    return 'neutral';
  }

  private inferEmotionFromResponseText(text: string): string {
    const s = text.toLowerCase();
    if (!text.trim()) return 'neutral';
    if (/[؟?]/.test(text) && /لماذا|كيف|ما |why|how|what/.test(s)) return 'thinking';
    if (/!|رائع|عظيم|great|awesome|wow/.test(s)) return 'excited';
    if (/شكر|thank|thanks/.test(s)) return 'grateful';
    if (/^\s*(مرحب|أهلا|السلام|hello|hi\b|hey\b)/.test(s)) return 'greeting';
    if (/حزين|sad/.test(s)) return 'sad';
    return 'neutral';
  }

  private applyAgentResponseFrame(frame: Record<string, unknown>): void {
    const responseText = String(frame.content ?? frame.text ?? '').trim();
    const emoRaw = String(frame.emotion ?? '').trim();
    const emoStr = emoRaw.toLowerCase();

    if (emoStr) {
      emit('avatar:emotion', { emotion: emoRaw });
      if (emoStr === 'thinking' || emoStr === 'confused' || emoStr === 'processing') {
        void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.HIGH });
        return;
      }
      const vrma = EMOTION_TO_VRMA[emoStr as EmotionLabel];
      if (vrma) {
        const p =
          emoStr === 'surprised' || emoStr === 'angry' ? PRIORITY.CRITICAL : PRIORITY.HIGH;
        void unifiedGestureEngine.play(vrma, { priority: p });
        return;
      }
      const g = resolveEmotionGesturePlay(emoStr);
      if (g) void unifiedGestureEngine.play(g, { priority: PRIORITY.HIGH });
      return;
    }

    if (/شكر|thank|thanks/i.test(responseText)) {
      void unifiedGestureEngine.play('thankful', { priority: PRIORITY.NORMAL });
    } else if (responseText.includes('!')) {
      void unifiedGestureEngine.play('Surprised', { priority: PRIORITY.HIGH });
    } else {
      const hint = this.inferEmotionFromResponseText(responseText);
      const g = resolveEmotionGesturePlay(hint);
      if (g) void unifiedGestureEngine.play(g, { priority: PRIORITY.NORMAL });
    }
  }

  processWsFrame(frame: Record<string, unknown>): void {
    const t = String(frame.type ?? '').toLowerCase();
    switch (t) {
      case 'agent:response':
      case 'llm_response': {
        this.applyAgentResponseFrame(frame);
        break;
      }
      case 'agent:gesture': {
        const name = String(frame.gesture ?? frame.name ?? '').trim();
        if (!name) return;
        const rawP = frame.priority;
        const p: number =
          typeof rawP === 'number' ? rawP :
          rawP === 'CRITICAL' ? PRIORITY.CRITICAL :
          rawP === 'HIGH'     ? PRIORITY.HIGH :
          rawP === 'LOW'      ? PRIORITY.LOW :
          rawP === 'BACKGROUND' ? PRIORITY.BACKGROUND :
          PRIORITY.NORMAL;
        void unifiedGestureEngine.play(name, { priority: p as typeof PRIORITY[keyof typeof PRIORITY] });
        break;
      }
      case 'agent:emotion': {
        const emoRaw = String(frame.emotion ?? '').trim();
        if (!emoRaw) return;
        const emo = emoRaw.toLowerCase();
        emit('avatar:emotion', { emotion: emoRaw });
        const vrmaName = EMOTION_TO_VRMA[emo as EmotionLabel];
        if (vrmaName) {
          const p =
            emo === 'surprised' || emo === 'angry' ? PRIORITY.CRITICAL : PRIORITY.HIGH;
          void unifiedGestureEngine.play(vrmaName, { priority: p });
          break;
        }
        const fallback = resolveEmotionGesturePlay(emo);
        if (fallback) {
          void unifiedGestureEngine.play(fallback, { priority: PRIORITY.HIGH });
        }
        break;
      }
      case 'agent:action': {
        const action = String(frame.action ?? '').trim();
        const ACTION_MAP: Record<string, string> = {
          wave:     'Waving',
          point:    'Pointing',
          clap:     'Clapping',
          bow:      'Acknowledging',
          think:    'Thinking',
          explain:  'Pointing',
          celebrate:'standing-cheering',
          wait:     'Idle1',
          listen:   'listening',
          process:  'processing',
          beckon:   'Beckoning',
          goodbye:  'Goodbye',
          agree:    'Agreeing',
        };
        const mapped = ACTION_MAP[action.toLowerCase()] ?? action;
        void unifiedGestureEngine.play(mapped, { priority: PRIORITY.HIGH });
        break;
      }
      case 'agent:thinking': {
        useBrainStore.getState().setThinking(true);
        void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.HIGH });
        break;
      }
      default:
        devLog('processWsFrame: unhandled type', t);
    }
  }

  interruptSpeech(): void {
    stopTTSGlobally(); 
    useBrainStore.getState().interrupt();
    this._timers.forEach(t => clearTimeout(t)); 
    this._timers = [];
  }

  private _later(ms: number, fn: () => void): void {
    const t = setTimeout(() => { 
      this._timers = this._timers.filter(x => x !== t); 
      fn(); 
    }, Math.max(0, ms));
    this._timers.push(t);
    if (this._timers.length > MAX_TIMERS) this._timers.shift();
  }

} // <--- هذا هو القوس النهائي والوحيد للفئة

export const agentDirector = new AgentDirector();

// ── Dev console helpers (no-op in production) ────────────────────────────────
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  window.__agentDirector = agentDirector;
  window.__cogniGestureEngine = unifiedGestureEngine;
}