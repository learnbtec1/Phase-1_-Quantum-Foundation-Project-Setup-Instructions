'use client';

import React, { useRef, useState, useEffect } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function Chat() {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const spokenAssistantIdsRef = useRef<Set<string>>(new Set());
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

    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: text },
    ]);
    setInputText('');
    setIsLoading(true);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('chat:sent'));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = res.ok && data.reply ? data.reply : 'عذراً، حدث خطأ. حاول مرة أخرى.';
      const assistantMessage: Message = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: reply,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('chat:received'));
        if (!spokenAssistantIdsRef.current.has(assistantMessage.id)) {
          spokenAssistantIdsRef.current.add(assistantMessage.id);
          window.dispatchEvent(new CustomEvent('avatar:speak', { detail: reply }));
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: 'عذراً، تعذر الاتصال. تحقق من تشغيل الباكند.',
        },
      ]);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('chat:received'));
    } finally {
      setIsLoading(false);
    }
  };

  const onHover = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ui:hover'));
  };

  return (
    <div
      className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-end"
      role="complementary"
      aria-label="Chat"
    >
      <div className="pointer-events-auto flex flex-col flex-1 min-h-0 max-h-full justify-end p-4">
        <div
          ref={messagesContainerRef}
          className="flex-shrink-0 max-h-[140px] overflow-y-auto overflow-x-hidden rounded-t-xl border border-white/10 border-b-0 bg-slate-800/60 backdrop-blur-md px-3 py-2 overscroll-contain shadow-lg glass custom-scrollbar mb-2"
        >
          {messages.length > 0 && (
            <div className="space-y-1.5">
              {messages.map((msg) => (
                <div
                  key={msg.id}
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
                <div className="flex justify-start text-cyan-400/80 text-xs px-2">
                  جاري الكتابة...
                </div>
              )}
            </div>
          )}
        </div>
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-slate-800/70 backdrop-blur-md shadow-xl glass"
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
            onMouseEnter={onHover}
            onFocus={onHover}
            placeholder="اكتب رسالتك إلى فورينا..."
            className="flex-1 bg-slate-700/80 border border-slate-600 rounded-lg px-4 py-2.5 text-gray-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 text-sm min-w-0 transition"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={sendMessage}
            onPointerEnter={onHover}
            onMouseEnter={onHover}
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
