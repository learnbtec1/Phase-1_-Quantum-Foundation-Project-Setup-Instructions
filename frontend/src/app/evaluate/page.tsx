'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { AvatarCanvasRef } from './AvatarCanvas';
import styles from './page.module.css';
import { parseVeronaResponse, inferResponsePlan } from '@/ai/avatar/brain';
import { directAvatarPerformance } from '@/ai/avatar/director';
import { classifyReplyType, emotionToProsody, humanizeTelemetry, selfCheckTelemetry } from '@/ai/cognitive/CognitiveEngine';
import { getLastGestureLog } from '@/ai/memory/store';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';

const AvatarCanvas = dynamic(() => import('./AvatarCanvas'), {
  ssr: false,
  loading: () => (
    <div className={styles.avatarLoadingFallback}>
      جاري تحميل الأفاتار…
    </div>
  ),
});

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  { label: '🏠 أخبرني عن بيتك', text: 'أخبرني عن بيتك وعالمك' },
  { label: '👋 من أنتِ؟', text: 'من أنتِ؟ عرّفي نفسكِ' },
  { label: '📚 كيف تساعديني؟', text: 'كيف يمكنكِ مساعدتي في دراستي؟' },
  { label: '✨ ما هو NEXUS؟', text: 'ما هو نظام NEXUS وكيف يعمل؟' },
];

// Emotion → student-performance result mapping for Phase 7
const EMOTION_TO_PERF: Record<string, string> = {
  celebration: 'correct', excited: 'correct', happy: 'correct',
  encouraging: 'partial', friendly: 'partial',
  thinking: 'incorrect', sad: 'incorrect', empathy: 'incorrect', neutral: 'partial',
};

export default function EvaluatePage() {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<AvatarCanvasRef | null>(null);
  const handleAvatarReady = useCallback((ref: AvatarCanvasRef) => { avatarRef.current = ref; }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sttRef = useRef<{ start: (...a: any[]) => void; stop: () => void } | null>(null);
  // Hybrid Persona Kernel: silence detection timer ref
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Full Human Persona Kernel: BOOT sequence
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[HUMANIZE][BOOT] persona=FullHuman lang=AR autonomy=on');
    // Boot greeting: wait 600-900ms then pipe a warm Arabic welcome through the AI director
    const bootDelay = 600 + Math.floor(Math.random() * 300); // 600–900ms
    const bootTimer = setTimeout(() => {
      const greetingText = 'أهلاً وسهلاً! أنا د. حمزة، معلمك في BTEC Business. كيف أقدر أساعدك اليوم؟';
      setMessages((prev) =>
        prev.length === 0 ? [{ role: 'assistant', content: greetingText }] : prev,
      );
      const bootPlan = inferResponsePlan(greetingText);
      bootPlan.emotion = 'friendly';
      directAvatarPerformance(bootPlan);
      // Emit self-check for boot sequence
      selfCheckTelemetry({ intent: 'greeting', emotion: 'friendly', gesture: 'wave', preroll: '0.2s', voice: { rate: 1.00, pitch: '+0st' }, errors: 0 });
    }, bootDelay);
    return () => clearTimeout(bootTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Barge-in: stop TTS when student starts speaking
  useEffect(() => {
    const onSpeechStart = () => {
      import('@/ai/io/tts').then(({ stopTTS }) => stopTTS()).catch(() => {});
    };
    window.addEventListener('stt:speechstart', onSpeechStart);
    return () => window.removeEventListener('stt:speechstart', onSpeechStart);
  }, []);

  // Full Human Persona Kernel: proactive check-in after silence
  useEffect(() => {
    const onProactive = () => {
      const nudge = '\u0647\u0644 \u0643\u0644 \u0634\u064a\u0621 \u0648\u0627\u0636\u062d\u061f \u0644\u0627 \u062a\u062a\u0631\u062f\u062f \u0628\u0627\u0644\u0633\u0624\u0627\u0644!';
      setMessages((prev) => [...prev, { role: 'assistant', content: nudge }]);
      avatarRef.current?.speak(nudge);
      dispatchAvatar('avatar:emotion', { emotion: 'attentive' });
    };
    window.addEventListener('avatar:proactive', onProactive);
    return () => window.removeEventListener('avatar:proactive', onProactive);
  }, []);

  // Cleanup silence timer on unmount
  useEffect(() => {
    return () => { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); };
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || isLoading) return;

    // Clear silence timer — user is responding
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Stop mic if listening when the user sends a message
    if (isListening) {
      sttRef.current?.stop();
      setIsListening(false);
      dispatchAvatar('avatar:listening', { active: false });
    }

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInputText('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      let detectedEmotion = 'neutral';
      const reply = (() => {
        if (res.ok && data.reply) {
          // Fix 1: prefer backend-parsed clean dialogue field; fall back to local parsing.
          // data.dialogue = Line 1 of the 3-line format, already stripped of *action* and [EMOTION].
          // Parsing data.reply ourselves is kept as a safety net only.
          const { dialogue: parsedDialogue, emotion: veronaEmotion } = parseVeronaResponse(data.reply ?? '');
          const rawClean = (typeof data.dialogue === 'string' && data.dialogue.trim())
            ? data.dialogue.trim()
            : (parsedDialogue || data.reply);
          // Safety scrub: strip any *action* or [EMOTION:] markers that leaked
          // through backend parsing (e.g. model emitted bare action without asterisks).
          const cleanText = rawClean
            .replace(/\*[^*]+\*/g, '')
            .replace(/\[EMOTION:\s*\w+\]/gi, '')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

          // Build full response plan: prefer backend detection, then infer from text
          const plan = inferResponsePlan(cleanText);
          // Backend-detected emotion wins if meaningful
          const backendEmotion = (data.emotion ?? veronaEmotion ?? '').toLowerCase();
          const EMOTION_OVERRIDE_MAP: Record<string, typeof plan.emotion> = {
            celebrate:        'celebration', celebrating: 'celebration',
            friendly:         'friendly',   neutral: 'neutral',
            thinking:         'thinking',   encouraging: 'encouraging',
            strict:           'strictEvaluation',
            happy:            'happy',      excited: 'excited',
            sad:              'sad',        angry: 'angry',
            surprised:        'surprised',  blush: 'blush',
            sleepy:           'sleepy',     relax: 'relax',
            proud:            'proud',      curious: 'curious',
            attentive:        'attentive',  concerned: 'concerned',
          };
          if (backendEmotion && EMOTION_OVERRIDE_MAP[backendEmotion]) {
            plan.emotion = EMOTION_OVERRIDE_MAP[backendEmotion];
          }

          // Fix 2: if the USER's own message is celebratory praise ("أحسنت", "ممتاز"…),
          // boost emotion to celebration regardless of what the AI echoed back.
          const userReplyType = classifyReplyType(text);
          if (
            userReplyType === 'celebration' &&
            (plan.emotion === 'neutral' || plan.emotion === 'friendly' || plan.emotion === 'relax')
          ) {
            plan.emotion = 'celebration';
          }

          // Let the AI Director orchestrate all avatar behavior
          directAvatarPerformance(plan);
          detectedEmotion = plan.emotion;

          // Full Human Persona Kernel: per-turn [SELF-CHECK] audit
          selfCheckTelemetry({
            intent:  String((data as Record<string, unknown>).intent ?? 'unknown'),
            emotion: plan.emotion,
            gesture: plan.gestures[0]?.type ?? 'none',
            preroll: '0.2s',
            voice:   emotionToProsody(plan.emotion),
            memory:  { lastGestures: getLastGestureLog() },
            errors:  0,
          });

          // Hybrid Persona Kernel: COG telemetry per turn
          humanizeTelemetry('COG', {
            intent:   data.intent    ?? 'unknown',
            strategy: data.strategy  ?? 'unknown',
            emotion:  plan.emotion,
            rate:     data.rate      ?? null,
            pitch:    data.pitch     ?? null,
          });

          // Hybrid Persona Kernel: silence detection — if AI asked a question,
          // start a 4-second timer; if user hasn't replied, dispatch a proactive prompt
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          const rt0: string = data.replyType ?? classifyReplyType(cleanText);
          if (rt0 === 'question') {
            silenceTimerRef.current = setTimeout(() => {
              window.dispatchEvent(new CustomEvent('avatar:proactive', { detail: { reason: 'silence' } }));
            }, 4000);
          }

          // OpenAI-only structured fields (blink style, laugh, head_pose come from JSON schema)
          if (data.source === 'openai') {
            if (data.blink) window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: data.blink } }));
            if (data.laugh) window.dispatchEvent(new CustomEvent('avatar:laugh', { detail: { intensity: 0.85, duration: 1400 } }));
            if (data.head_pose?.yaw != null || data.head_pose?.pitch != null) {
              window.dispatchEvent(new CustomEvent('avatar:headpose', {
                detail: { yaw: data.head_pose.yaw ?? 0, pitch: data.head_pose.pitch ?? 0, duration: 2500 },
              }));
            }
          }

          // Fix 3: Phase 10 replyType enhancements run for ALL paths (not just OpenAI).
          // Only fire supplementary events when the director hasn't already handled them.
          const rt: string = data.replyType ?? classifyReplyType(cleanText);
          if (rt === 'celebration' && plan.emotion !== 'celebration') {
            window.dispatchEvent(new CustomEvent('avatar:laugh',  { detail: { intensity: 0.9,  duration: 1500 } }));
            window.dispatchEvent(new CustomEvent('avatar:blink',  { detail: { style: 'rapid', count: 3 } }));
          } else if (rt === 'sad') {
            window.dispatchEvent(new CustomEvent('avatar:blink',    { detail: { style: 'slow' } }));
            window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: 0, pitch: 0.11, duration: 2200 } }));
          } else if (rt === 'surprised') {
            window.dispatchEvent(new CustomEvent('avatar:blink',    { detail: { style: 'double', count: 2 } }));
          } else if (rt === 'question') {
            window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: 0.14, pitch: -0.03, duration: 1800 } }));
            window.dispatchEvent(new CustomEvent('avatar:blink',    { detail: { style: 'slow' } }));
          }

          // Fix 4: dispatch avatar:gesture from the backend action field (data.action).
          // The Python backend extracts the *gesture text* as a separate field — use it.
          if (typeof data.action === 'string' && data.action.trim()) {
            const act = data.action.toLowerCase();
            const gType =
              /يلوح|يلوّح|wave|وداع|تحية/.test(act)         ? 'wave'
              : /يشير|point|نحو|اتجاه/.test(act)            ? 'point'
              : /يفتح|يمد|open|يبسط/.test(act)              ? 'openHand'
              : /يضرب|يصفق|beat|يطرق/.test(act)             ? 'beat'
              : null;
            if (gType) {
              const side =
                /كلتا|كلا|both|يدين/.test(act) ? 'both'
                : /يسار|left/.test(act)         ? 'left'
                : 'right';
              dispatchAvatar('avatar:gesture', { type: gType, side: side as 'left'|'right'|'both', duration: 2.0, intensity: 0.85, variance: Math.random() });
            }
          }

          return cleanText;
        }
        return 'عذراً، حدث خطأ. حاول مرة أخرى.';
      })();
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      avatarRef.current?.speak(reply ?? '');
      // Phase 7: dispatch student performance based on avatar's emotional reaction
      const perfResult = EMOTION_TO_PERF[detectedEmotion] ?? 'partial';
      window.dispatchEvent(new CustomEvent('student:performance', { detail: { result: perfResult } }));
      // Full Human Persona Kernel: progress:update event
      if (perfResult === 'correct' || perfResult === 'incorrect') {
        window.dispatchEvent(new CustomEvent('progress:update', {
          detail: {
            correct: perfResult === 'correct',
            scoreDelta: perfResult === 'correct' ? 1 : 0,
            topic: (data as Record<string, unknown>).intent ?? 'unknown',
          },
        }));
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'عذراً، تعذر الاتصال. تحقق من تشغيل الباكند.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isLoading, isListening]);

  const toggleMic = useCallback(async () => {
    if (isListening) {
      sttRef.current?.stop();
      sttRef.current = null;
      setIsListening(false);
      dispatchAvatar('avatar:listening', { active: false });
    } else {
      const { createSTT } = await import('@/ai/io/stt');
      const stt = createSTT();
      if (!stt.isSupported()) return;
      stt.start((result) => {
        setInputText(result.transcript);
        if (result.isFinal && result.transcript.trim()) {
          sendMessage(result.transcript.trim());
        }
      });
      sttRef.current = stt;
      setIsListening(true);
      dispatchAvatar('avatar:listening', { active: true });
    }
  }, [isListening, sendMessage]);

  return (
    <div className="relative flex flex-col h-screen overflow-hidden evaluate-company-bg">
      {/* ── خلفية ── */}
      <div
        className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900/95 to-slate-950"
        aria-hidden
      />
      <div
        className={`absolute inset-0 opacity-[0.03] ${styles.gridOverlay}`}
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-br from-cyan-950/20 via-transparent to-emerald-950/15 pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute top-6 left-6 right-6 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none"
        aria-hidden
      />

      {/* ── شارة BTEC ── */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/90">BTEC</span>
        <span className="text-[10px] text-slate-400">|</span>
        <span className="text-[10px] text-slate-500">بيئة تعلم احترافية</span>
      </div>

      <div className="relative flex flex-col h-full overflow-hidden z-0">

        {/* ── شاشة الأفاتار — النصف العلوي ── */}
        <div className="flex-1 min-h-0 flex items-stretch justify-center w-full px-6 pt-12 pb-2">
          <div
            className={`relative w-full max-w-2xl rounded-2xl evaluate-screen-frame ${styles.avatarFrame}`}
          >
            <div
              className="absolute inset-0 rounded-2xl border-2 border-slate-600/50 shadow-[0_0_60px_-10px_rgba(6,182,212,0.15),inset_0_1px_0_rgba(255,255,255,0.05)] pointer-events-none z-20"
            />
            {/* ✅ Canvas + VRMAvatar محمّلان ديناميكياً (عميل فقط) */}
            <AvatarCanvas vrmUrl="/models/teach.vrm" onReady={handleAvatarReady} />
          </div>
        </div>

        {/* ── النصف السفلي: المحادثة + الإدخال ── */}
        <div className="flex-shrink-0 flex flex-col gap-2 pb-3">

          {/* ── سجل المحادثة ── */}
          <div
            ref={messagesContainerRef}
            className="flex-shrink-0 max-h-[120px] overflow-y-auto overflow-x-hidden mx-4 rounded-xl border border-white/10 bg-slate-800/60 backdrop-blur-md px-3 py-2 overscroll-contain shadow-lg"
          >
            {messages.length > 0 ? (
              <div className="space-y-1.5">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[90%] rounded-lg px-3 py-1.5 text-xs ${
                        msg.role === 'user'
                          ? 'bg-cyan-600/90 text-white border border-cyan-500/30'
                          : 'bg-slate-700/80 text-slate-100 border border-slate-600/80'
                      }`}
                    >
                      <span className="opacity-90">
                        {msg.role === 'user' ? 'أنت' : 'فورينا'}:{' '}
                      </span>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start text-cyan-400/80 text-xs px-2">
                    جاري الكتابة...
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-xs text-center py-1">ابدأ المحادثة مع فورينا…</p>
            )}
          </div>

          {/* ── اقتراحات ── */}
          <div className="flex-shrink-0 flex flex-wrap gap-2 mx-4 px-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                type="button"
                disabled={isLoading}
                onClick={() => sendMessage(s.text)}
                className="text-xs px-3 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60 hover:border-cyan-400/60 disabled:opacity-40 transition-all backdrop-blur-sm"
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* ── شريط الإدخال ── */}
          <div
            className={`flex-shrink-0 flex items-center gap-3 mx-4 px-4 py-3 rounded-xl border border-white/10 bg-slate-800/70 backdrop-blur-md shadow-xl ${styles.inputBar}`}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="اكتب رسالتك إلى فورينا..."
              className="flex-1 bg-slate-700/80 border border-slate-600 rounded-lg px-4 py-2.5 text-gray-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 text-sm min-w-0 transition"
              disabled={isLoading}
            />
            {/* Phase 1: Microphone button — activates STT */}
            <button
              type="button"
              onClick={toggleMic}
              disabled={isLoading}
              title={isListening ? 'إيقاف الميكروفون' : 'تحدث (ميكروفون)'}
              className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-lg border transition ${
                isListening
                  ? 'bg-violet-600 border-violet-400 text-white shadow-lg shadow-violet-900/50 animate-pulse'
                  : 'bg-slate-700/80 border-slate-600 text-slate-300 hover:bg-slate-600 hover:text-white'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isListening ? '🎙️' : '🎤'}
            </button>
            <button
              type="button"
              onClick={() => sendMessage()}
              disabled={isLoading || !inputText.trim()}
              className="shrink-0 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-lg shadow-cyan-900/30 transition"
            >
              إرسال
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
