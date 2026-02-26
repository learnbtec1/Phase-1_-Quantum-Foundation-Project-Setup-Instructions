'use client';

import React, { useRef, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const VRMAvatar = dynamic(() => import('@/components/VRMAvatar'), { ssr: false });

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function EvaluatePage() {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

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
      const reply = res.ok && data.reply ? data.reply : 'عذراً، حدث خطأ. حاول مرة أخرى.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'عذراً، تعذر الاتصال. تحقق من تشغيل الباكند.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden evaluate-company-bg">
      {/* خلفية شركة: شبكة خفيفة + تدرج */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900/95 to-slate-950" aria-hidden />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/20 via-transparent to-emerald-950/15 pointer-events-none" aria-hidden />
      <div className="absolute top-6 left-6 right-6 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent pointer-events-none" aria-hidden />
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none" aria-hidden />

      {/* شارة BTEC — زاوية */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/90">BTEC</span>
        <span className="text-[10px] text-slate-400">|</span>
        <span className="text-[10px] text-slate-500">بيئة تعلم احترافية</span>
      </div>

      <div className="relative flex flex-col h-full min-h-0 z-0">
        {/* شاشة العرض — كأننا في قاعة شركة */}
        <div className="flex-1 flex items-center justify-center min-h-0 w-full p-6 pt-16">
          <div className="relative w-full max-w-2xl max-h-[520px] h-full rounded-2xl overflow-hidden evaluate-screen-frame">
            <div className="absolute inset-0 rounded-2xl border-2 border-slate-600/50 shadow-[0_0_60px_-10px_rgba(6,182,212,0.15),inset_0_1px_0_rgba(255,255,255,0.05)] pointer-events-none z-10" />
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-black/40 to-transparent pointer-events-none z-10 rounded-b-2xl" />
            <div className="w-full h-full rounded-2xl overflow-hidden bg-slate-900/80">
              <VRMAvatar vrmUrl="/models/Furina.vrm" />
            </div>
          </div>
        </div>

        {/* سجل المحادثة — لوحة زجاجية */}
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
                  <span className="opacity-90">{msg.role === 'user' ? 'أنت' : 'فورينا'}: </span>
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start text-cyan-400/80 text-xs px-2">جاري الكتابة...</div>
            )}
          </div>
        )}
      </div>

      {/* شريط الإدخال — طاولة تحكم */}
        <div
          className="flex-shrink-0 flex items-center gap-3 mx-4 mb-4 px-4 py-3 rounded-xl border border-white/10 bg-slate-800/70 backdrop-blur-md shadow-xl"
          style={{
            minHeight: '2.5cm',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
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
          <button
            type="button"
            onClick={sendMessage}
            disabled={isLoading || !inputText.trim()}
            className="shrink-0 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-lg shadow-cyan-900/30 transition"
          >
            إرسال
          </button>
        </div>
      </div>
    </div>
  );
}
