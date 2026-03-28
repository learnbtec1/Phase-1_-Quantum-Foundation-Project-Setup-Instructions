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
import { gestureEngine }                     from '@/ai/cognitive/GestureEngine';
import { checkGestureCooldown, recordGestureLog } from '@/ai/memory/store';
import { dispatchAvatar }                    from '@/utils/events/normalizeAvatarEvents';
import { speakWithTTS, stopTTS }             from '@/ai/io/tts';
import {
  microReactionDelay,
  humanDelay,
  jitter,
  getRandomDelay,
  estimateSpeechDurationMs,
  gesturePrerollMs,
} from '@/utils/TimingUtils';

declare global {
  interface Window { __AUDIO_UNLOCKED__?: boolean; }
}

interface _RulesEngineBehavior {
  gesture:       string;
  expression:    string;
  voiceParameters: { pitch: number; rate: number };
  thinkingDelayMs: number;
}

const PAD_DEBOUNCE_MS = 300;
const EMOTION_DEBOUNCE_MS = 250;
const MAX_TIMERS = 64;

function emit(name: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (['avatar:gesture', 'avatar:emotion', 'avatar:listening', 'avatar:nod', 'avatar:headpose', 'avatar:speak:start', 'avatar:speak:end'].includes(name)) {
    dispatchAvatar(name as any, detail);
  } else {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

const EMOTION_GESTURE_MAP: Partial<Record<EmotionLabel, string>> = {
  excited: 'wave', happy: 'openHand', encouraging: 'openHand', proud: 'openHand',
  surprised: 'openHand', angry: 'point', thinking: 'openHand', curious: 'beat',
  attentive: 'beat', concerned: 'openHand', calm: 'openHand', relaxed: 'openHand',
  empathetic: 'openHand', sad: 'beat', anxious: 'beat', bored: 'beat', sleepy: 'beat', neutral: 'beat',
};

export class AgentDirector {
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
      // 3. الأوامر الصريحة والإطارات
      useBrainStore.subscribe(s => s.currentAction, a => { if (a) this._executeAction(a); }),
      useBrainStore.subscribe(s => s.lastFrame, f => { if (f) this._reactToFrame(f); }),
      
      // 4. ميزة السمع النشط (Active Listening)
      useBrainStore.subscribe(s => (s as any).isUserSpeaking, isSpeaking => { 
        if (isSpeaking) this._handleUserSpeaking(); 
      }),
      
      // 5. كسر جمود وضعية Neutral
      useBrainStore.subscribe(s => s.emotionLabel, emotion => { 
        if (emotion === 'neutral') this._handleNeutralEmotion(); 
      })
    ];
    this._unsubs.push(...subs);
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    this._unsubs.forEach(fn => fn());
    this._timers.forEach(t => clearTimeout(t));
    this._unsubs = []; 
    this._timers = [];
    console.log('[AgentDirector] STOPPED — All systems cleared');
  }

  // ── Reaction Handlers ───────────────────────────────────────────────────────

  private _reactToEmotion(emotion: EmotionLabel): void {
    this._lastEmotion = emotion;
    this._later(microReactionDelay(), () => emit('avatar:emotion', { emotion }));
    this._later(humanDelay(emotion), () => this._applyEmotionContract(emotion));
  }

  private _reactToPAD(pad: PADVector): void {
    const raw = decideBehaviorFromPAD(pad) as unknown as _RulesEngineBehavior;
    this._later(jitter(raw.thinkingDelayMs, 0.2), () => {
      emit('avatar:voice', { rate: raw.voiceParameters.rate, pitch: raw.voiceParameters.pitch });
      this._fireGesture(raw.gesture, { intensity: 0.65, durationSec: 1.4, side: 'right' });
    });
  }

  private _reactToFrame(frame: AgentFrame): void {
    const delay = jitter(frame.thinking_time_ms, 0.15);
    this._later(0, () => emit('avatar:voice', { rate: frame.voice.rate, pitch: frame.voice.pitch }));
    
    const planned = gestureEngine.planGestures(
      frame.gesture?.trim() || '', 
      frame.emotion, 
      estimateSpeechDurationMs(frame.text ?? '')
    );

    planned.forEach(p => {
      this._later(delay + p.fireAtMs, () => this._fireGesture(p.descriptor.type as string, {
        intensity: p.descriptor.intensity ?? 0.75,
        durationSec: p.descriptor.duration ?? 2.0,
        side: p.descriptor.side ?? 'right',
      }));
    });
  }

  private _executeAction(action: BehaviorOutput): void {
    this._later(jitter(action.thinkingDelayMs, 0.12), () => {
      if (action.gesture) this._fireGesture(action.gesture, {
        intensity: action.gestureIntensity ?? 0.75,
        durationSec: action.gestureDurationMs ? action.gestureDurationMs / 1000 : 1.5,
        side: action.gestureSide ?? 'right',
      });
    });
  }

  // ── [NEW] Behavioral Features (النشامي) ─────────────────────────────────────

  /** السمع النشط: يهز الأفاتار رأسه عند اكتشاف صوت المستخدم */
  private _handleUserSpeaking(): void {
    this._later(getRandomDelay(100, 400), () => {
      emit('avatar:nod', { intensity: 0.15, duration: 0.6 });
      // ميل بسيط للرأس لإظهار الاهتمام
      emit('avatar:headpose', { 
        yaw: 0.05 * (Math.random() > 0.5 ? 1 : -1), 
        pitch: -0.05, 
        duration: 1500 
      });
    });
  }

  /** كسر الجمود: حركات عشوائية بسيطة عند الصمت الطويل */
  private _handleNeutralEmotion(): void {
    this._later(getRandomDelay(5000, 8000), () => {
      if (useBrainStore.getState().emotionLabel === 'neutral') {
        const fallbackGestures = ['tilt', 'blink', 'relaxed'];
        const randomG = fallbackGestures[Math.floor(Math.random() * fallbackGestures.length)];
        this._fireGesture(randomG, { intensity: 0.3, durationSec: 1.2, side: 'right' });
      }
    });
  }

  /** خطة بديلة عند تعطل الصوت: محاكاة أداء الكلام حركياً */
  private _handleTTSFallback(text: string, emotion: EmotionLabel): void {
    console.warn('[AgentDirector] TTS Fallback — Simulating performance');
    emit('avatar:speak:start', {});
    this._applyEmotionContract(emotion);
    this._later(estimateSpeechDurationMs(text), () => emit('avatar:speak:end', {}));
  }

  // ── Emotion Contracts ───────────────────────────────────────────────────────

  private _applyEmotionContract(emotion: EmotionLabel): void {
    const intensity = this._gestureIntensityForEmotion(emotion);
    this._fireGesture(EMOTION_GESTURE_MAP[emotion] ?? 'beat', { intensity, durationSec: 1.6, side: 'right' });
    
    emit('avatar:blink', { 
      style: ['calm', 'relaxed', 'sad', 'thinking'].includes(emotion) ? 'slow' : 'normal' 
    });

    this._applyHeadPose(emotion);

    if (['attentive', 'encouraging', 'happy', 'calm'].includes(emotion)) {
      this._later(getRandomDelay(300, 600), () => emit('avatar:nod', { intensity: 0.25, duration: 0.5 }));
    }
  }

  private _gestureIntensityForEmotion(e: EmotionLabel): number {
    const map: any = { excited: 0.95, happy: 0.78, encouraging: 0.8, thinking: 0.5, neutral: 0.45 };
    return map[e] ?? 0.55;
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
    if (!checkGestureCooldown(g)) return;
    recordGestureLog(g);
    this._later(Math.max(0, gesturePrerollMs() - 200), () => emit('avatar:gesture', { 
      type: g, side: o.side, duration: o.durationSec, intensity: o.intensity, variance: Math.random() * 0.12 
    }));
  }

  // ── TTS Scheduling ──────────────────────────────────────────────────────────

  async scheduleTTS(text: string, emotion: EmotionLabel, delay = 0): Promise<void> {
    if (!text?.trim()) return;
    await new Promise<void>(res => {
      this._later(delay, async () => {
        useBrainStore.getState().setTalking(true);
        const ok = await speakWithTTS(text, { 
          emotion, 
          arVoice: 'male', 
          onStart: () => emit('avatar:speak:start', {}), 
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

  interruptSpeech(): void {
    stopTTS(); 
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