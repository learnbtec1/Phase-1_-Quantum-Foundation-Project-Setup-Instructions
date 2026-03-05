'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

type ChatMode = 'simulation' | 'teacher';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type GameState = {
  money: number;
  energy: number;
};

export default function AiTeacherChat({
  initialMode = 'teacher',
  gameState = { money: 50000, energy: 10 }
}: {
  initialMode?: ChatMode;
  gameState?: GameState;
}) {
  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      role: 'assistant',
      content: 'مرحباً! أنا مساعدك الذكي. اختر وضع المحاكاة أو المعلم واسألني ما تشاء.'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          mode,
          gameState
        })
      });
      const data = await response.json();
      const assistantMessage: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.reply ?? 'لم أفهم الرسالة. حاول مرة أخرى.'
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', content: 'حدث خطأ مؤقت. حاول مرة أخرى.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-dark rounded-3xl border border-white/10 p-6 w-full max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">المعلم الذكي</h2>
          <p className="text-sm text-gray-400">توجيه أكاديمي + دعم محاكاة</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('teacher')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition ${
              mode === 'teacher' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-300'
            }`}
          >
            وضع المعلم
          </button>
          <button
            onClick={() => setMode('simulation')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition ${
              mode === 'simulation' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300'
            }`}
          >
            وضع المحاكاة
          </button>
        </div>
      </div>

      <div className="bg-black/40 rounded-2xl p-4 h-80 overflow-y-auto space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white'
                    : 'bg-white/10 text-gray-100'
                }`}
              >
                {message.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="mt-4 flex gap-3">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && sendMessage()}
          className="flex-1 bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-cyan-400"
          placeholder="اكتب رسالتك هنا..."
          aria-label="إرسال رسالة"
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold disabled:opacity-60"
        >
          {loading ? 'جاري...' : 'إرسال'}
        </button>
      </div>
    </div>
  );
}
