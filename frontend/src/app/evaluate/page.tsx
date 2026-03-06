'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { AvatarCanvasRef } from './AvatarCanvas';
import styles from './page.module.css';
import { parseVeronaResponse } from '@/ai/avatar/brain';
import { inferResponsePlan } from '@/ai/avatar/brain';
import { directAvatarPerformance } from '@/ai/avatar/director';

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

  // Barge-in: stop TTS when student starts speaking
  useEffect(() => {
    const onSpeechStart = () => {
      import('@/ai/io/tts').then(({ stopTTS }) => stopTTS()).catch(() => {});
    };
    window.addEventListener('stt:speechstart', onSpeechStart);
    return () => window.removeEventListener('stt:speechstart', onSpeechStart);
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || isLoading) return;

    // Stop mic if listening when the user sends a message
    if (isListening) {
      sttRef.current?.stop();
      setIsListening(false);
      window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active: false } }));
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
          // Clean dialogue (strip Verona tokens but keep Arabic text)
          const { dialogue, emotion: veronaEmotion } = parseVeronaResponse(data.reply);
          const cleanText = dialogue || data.reply;

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
          };
          if (backendEmotion && EMOTION_OVERRIDE_MAP[backendEmotion]) {
            plan.emotion = EMOTION_OVERRIDE_MAP[backendEmotion];
          }

          // Let the AI Director orchestrate all avatar behavior
          directAvatarPerformance(plan);
          detectedEmotion = plan.emotion;

          // When OpenAI returned structured fields, apply them on top of director
          if (data.source === 'openai') {
            if (data.blink) window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: data.blink } }));
            if (data.laugh) window.dispatchEvent(new CustomEvent('avatar:laugh', { detail: { intensity: 0.85, duration: 1400 } }));
            if (data.head_pose?.yaw != null || data.head_pose?.pitch != null) {
              window.dispatchEvent(new CustomEvent('avatar:headpose', {
                detail: { yaw: data.head_pose.yaw ?? 0, pitch: data.head_pose.pitch ?? 0, duration: 2500 },
              }));
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
      window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active: false } }));
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
      window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active: true } }));
    }
  }, [isListening, sendMessage]);

  return (
    <div className="relative flex flex-col min-h-screen evaluate-company-bg">
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

      <div className="relative flex flex-col min-h-screen z-0">
        {/* ── سجل المحادثة ── */}
        <div
          ref={messagesContainerRef}
          className="flex-shrink-0 max-h-[120px] overflow-y-auto overflow-x-hidden mx-4 mb-2 rounded-t-xl border border-white/10 border-b-0 bg-slate-800/60 backdrop-blur-md px-3 py-2 overscroll-contain shadow-lg"
        >
          {messages.length > 0 && (
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
          )}
        </div>

        {/* ── اقتراحات ── */}
        <div className="flex-shrink-0 flex flex-wrap gap-2 mx-4 mb-2 px-1">
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
          className={`flex-shrink-0 flex items-center gap-3 mx-4 mb-2 px-4 py-3 rounded-xl border border-white/10 bg-slate-800/70 backdrop-blur-md shadow-xl ${styles.inputBar}`}
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

        {/* ── شاشة الأفاتار — في أسفل الشاشة ── */}
        <div className="flex-shrink-0 flex items-end justify-center w-full px-6 pb-4">
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
      </div>
    </div>
  );
}
