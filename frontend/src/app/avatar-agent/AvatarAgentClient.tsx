'use client';

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useAgentAgent } from '@/hooks/useAgentAgent';

// AvatarCanvas is loaded dynamically (SSR off) — it drives all avatar events
// via window listeners. The vrmUrl prop must remain unchanged.
const AvatarCanvas = dynamic(() => import('./AvatarCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a12] text-gray-300 text-sm">
      جاري تحميل الدكتور حمزة...
    </div>
  ),
});

export default function AvatarAgentClient() {
  const {
    isConnected,
    isProcessing,
    isListening,
    lastTranscript,
    lastDialogue,
    emotion,
    error,
    toggleListening,
    sendText,
    clearHistory,
  } = useAgentAgent({});

  const [userInput, setUserInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const onSend = () => {
    if (!userInput.trim()) return;
    sendText(userInput.trim());
    setUserInput('');
    inputRef.current?.focus();
  };

  return (
    <main className="relative w-full h-screen bg-[#0a0a12] overflow-hidden" dir="rtl">

      {/* Avatar layer — must stay absolutely positioned to fill the full screen */}
      <div className="absolute inset-0">
        <AvatarCanvas vrmUrl="/models/teach.vrm" />
      </div>

      {/* HUD overlay — bottom bar */}
      <div className="absolute bottom-0 inset-x-0 p-4 flex flex-col gap-3 bg-black/40 backdrop-blur-xl border-t border-white/10 shadow-2xl">

        {(lastTranscript || lastDialogue) && (
          <div className="flex justify-between text-xs text-gray-300 px-1">
            <span>🎧 آخر ما سمعه: {lastTranscript || '...'}</span>
            <span>💬 آخر رد: {lastDialogue || '...'}</span>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-950/50 rounded px-3 py-1">
            ⚠️ {error}
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className={isConnected ? 'text-emerald-400' : 'text-red-400'}>
            {isConnected ? '🟢 متصل' : '🔴 غير متصل'}
          </span>

          <div className="flex items-center gap-2">
            {isListening && (
              <span className="flex gap-1">
                <span className="w-1.5 h-3 bg-cyan-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-4 bg-cyan-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-5 bg-cyan-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            )}
            <span
              className={
                isListening
                  ? 'text-cyan-400'
                  : isProcessing
                  ? 'text-yellow-400'
                  : 'text-gray-400'
              }
            >
              {isListening ? 'يستمع...' : isProcessing ? 'يفكر...' : 'جاهز'}
            </span>
          </div>

          <span className="text-purple-400">🧠 {emotion}</span>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSend()}
            className="flex-1 px-3 py-2 text-sm bg-white/10 text-white border border-white/20 rounded-md
              focus:outline-none focus:border-cyan-500 placeholder-gray-500"
            placeholder="اكتب رسالة للدكتور حمزة..."
          />

          <button
            onClick={onSend}
            disabled={!isConnected || !userInput.trim() || isProcessing}
            className="px-4 py-2 bg-violet-600 text-white rounded-md text-sm
              disabled:opacity-40 disabled:cursor-not-allowed hover:bg-violet-500 transition"
          >
            إرسال
          </button>

          <button
            onClick={toggleListening}
            disabled={!isConnected}
            className={`px-4 py-2 text-white rounded-md text-sm transition ${
              isListening
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-cyan-600 hover:bg-cyan-500'
            } disabled:opacity-40`}
          >
            {isListening ? '⛔' : '🎤'}
          </button>

          <button
            onClick={clearHistory}
            disabled={!isConnected}
            className="px-3 py-2 bg-gray-700 text-white rounded-md text-sm
              disabled:opacity-40 hover:bg-gray-600 transition"
            title="مسح السجل"
          >
            🗑
          </button>
        </div>
      </div>
    </main>
  );
}