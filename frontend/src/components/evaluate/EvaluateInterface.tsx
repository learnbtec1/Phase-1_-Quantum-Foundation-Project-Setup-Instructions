'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createSTT } from '@/ai/io/stt';
import { parseCogniResponse } from '@/ai/avatar/brain';
import { reactToUserInput, applyCogniResponse } from '@/ai/avatar/actions';

const QUICK_PROMPTS = [
  { label: '👋 قل مرحباً', text: 'مرحباً د. حمزة، كيف حالك؟' },
  { label: 'تعرف على BTEC', text: 'مرحباً، أريد أن أتعرّف على BTEC' },
  { label: 'معيار P1', text: 'اشرح لي معيار P1 في الوحدة الأولى' },
  { label: 'Merit و Distinction', text: 'ما الفرق بين Merit و Distinction؟' },
  { label: 'Customer Service', text: 'كيف أجهز لواجب Customer Service؟' },
];

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function EvaluateInterface() {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const spokenAssistantIdsRef = useRef<Set<string>>(new Set());
  const sttRef = useRef<ReturnType<typeof createSTT> | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(true);
  const [showQuickPrompts, setShowQuickPrompts] = useState(true);

  useEffect(() => {
    sttRef.current = createSTT();
    return () => sttRef.current?.stop();
  }, []);

  const toggleListen = useCallback(() => {
    const stt = sttRef.current;
    if (!stt?.isSupported()) return;
    if (isListening) {
      stt.stop();
      setIsListening(false);
      window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active: false } }));
      return;
    }
    setIsListening(true);
    window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active: true } }));
    const committedRef = { current: inputText.trim() };
    stt.start((r) => {
      if (r.isFinal && r.transcript.trim()) {
        committedRef.current = (committedRef.current + ' ' + r.transcript).trim().slice(0, 4000);
        setInputText(committedRef.current);
      } else if (!r.isFinal) {
        setInputText((committedRef.current + ' ' + r.transcript).trim().slice(0, 4000));
      }
    }, { lang: 'ar-SA', continuous: true, interimResults: true });
  }, [isListening, inputText]);

  useEffect(() => {
    messagesContainerRef.current?.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const content = (text ?? inputText.trim()).slice(0, 4000);
    if (!content || isLoading) return;

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content }]);
    if (!text) setInputText('');
    setShowQuickPrompts(false);
    setIsLoading(true);
    // رد فعل جسدي فوري قبل انتظار رد الـ API
    reactToUserInput(content);
    window.dispatchEvent(new CustomEvent('chat:sent'));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });
      const data = await res.json();
      const reply = res.ok && data.reply ? data.reply : 'عذراً، حدث خطأ. حاول مرة أخرى.';
      const assistantMessage: Message = { id: `a-${Date.now()}`, role: 'assistant', content: reply };
      setMessages((prev) => [...prev, assistantMessage]);
      window.dispatchEvent(new CustomEvent('chat:received', { detail: { text: reply } }));

      if (!spokenAssistantIdsRef.current.has(assistantMessage.id)) {
        const s = spokenAssistantIdsRef.current;
        if (s.size >= 100) {
          const first = s.values().next().value;
          if (first) s.delete(first);
        }
        s.add(assistantMessage.id);
        const { dialogue, emotion, action } = parseCogniResponse(reply);
        // أطلق المشاعر والإيماءات المستخرجة من رد الذكاء
        applyCogniResponse(action, emotion);
        if (dialogue?.trim()) {
          window.dispatchEvent(new CustomEvent('avatar:speak', { detail: { text: dialogue.trim() } }));
        }
      }
    } catch {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: 'عذراً، تعذر الاتصال.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInputText(prompt);
    sendMessage(prompt);
  };

  return (
    <div className="absolute inset-0 z-20 pointer-events-none flex flex-col">
      {/* ─── Header ───────────────────────────────────────────────────────────── */}
      <header className="pointer-events-auto shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <Link href="/dashboard" className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          <span className="text-sm font-medium">لوحة التحكم</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            د. حمزة متصل
          </span>
          <span className="text-slate-400 text-sm font-bold tracking-wide">التفاعل مع د. حمزة</span>
        </div>
      </header>

      {/* ─── Main Content: 3D + Chat Panel ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* 3D Scene area — fills remaining space */}
        <div className="flex-1 min-h-[40vh] md:min-h-0" />

        {/* ─── Chat Panel (Right sidebar on desktop, bottom on mobile) ─────────── */}
        <aside
          className={`pointer-events-auto shrink-0 flex flex-col transition-all duration-300 evaluate-chat-panel ${
            chatExpanded
              ? 'w-full md:w-[420px] md:max-w-[50vw] h-[55vh] md:h-full'
              : 'w-full md:w-16 h-14 md:h-full'
          }`}
        >
          {/* Panel toggle + title */}
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5">
            {chatExpanded ? (
              <>
                <h2 className="text-base font-bold text-cyan-400 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  محادثة د. حمزة
                </h2>
                <button
                  type="button"
                  onClick={() => setChatExpanded(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition"
                  aria-label="طي المحادثة"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setChatExpanded(true)}
                className="w-full flex items-center justify-center gap-2 py-2 text-cyan-400 hover:text-cyan-300 transition"
                aria-label="فتح المحادثة"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                <span className="text-sm font-medium">المحادثة</span>
              </button>
            )}
          </div>

          {chatExpanded && (
            <>
              {/* Messages */}
              <div
                ref={messagesContainerRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4 custom-scrollbar"
              >
                {messages.length === 0 && showQuickPrompts && (
                  <div className="space-y-4">
                    <p className="text-slate-400 text-sm">اختر سؤالاً للبدء أو اكتب رسالتك:</p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_PROMPTS.map((prompt, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleQuickPrompt(prompt.text)}
                          disabled={isLoading}
                          className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/30 text-slate-200 hover:text-cyan-200 text-sm transition-all"
                        >
                          {prompt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-2.5 ${
                        msg.role === 'user'
                          ? 'bg-cyan-600/90 text-white rounded-br-md'
                          : 'bg-slate-700/60 text-slate-100 rounded-bl-md border border-slate-600/50'
                      }`}
                    >
                      <span className="block text-xs font-medium opacity-80 mb-1">{msg.role === 'user' ? 'أنت' : 'د. حمزة'}</span>
                      <p className="text-sm leading-relaxed">
                        {msg.role === 'assistant'
                          ? (parseCogniResponse(msg.content).dialogue?.trim() || msg.content)
                          : msg.content}
                      </p>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-700/60 rounded-2xl rounded-bl-md px-4 py-3 border border-slate-600/50">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce evaluate-bounce-delay-0" />
                        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce evaluate-bounce-delay-1" />
                        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce evaluate-bounce-delay-2" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="shrink-0 p-4 pt-0 border-t border-white/5">
                <div className="flex items-end gap-3 p-3 rounded-2xl evaluate-input-wrap">
                    <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onFocus={() => window.dispatchEvent(new Event('ui:hover'))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="اكتب سؤالك عن BTEC..."
                    rows={1}
                    maxLength={4000}
                    disabled={isLoading}
                    className="flex-1 min-h-[44px] max-h-32 resize-none bg-slate-800/80 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 text-sm"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={toggleListen}
                      disabled={isLoading}
                      title={isListening ? 'إيقاف الاستماع' : 'استماع بالصوت'}
                      className={`p-2.5 rounded-xl transition ${
                        isListening
                          ? 'bg-red-500/80 text-white animate-pulse'
                          : 'bg-slate-700/80 text-slate-300 hover:bg-cyan-600/50 hover:text-white'
                      }`}
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => sendMessage()}
                      disabled={isLoading || !inputText.trim()}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-cyan-900/30 transition"
                    >
                      إرسال
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
