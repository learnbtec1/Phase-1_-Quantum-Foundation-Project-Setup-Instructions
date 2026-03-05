"use client"; // يجب أن يكون هذا هو السطر رقم 1 دائماً

import React, { useState } from 'react';
import { useProgress } from '@/context/ProgressContext';

// تعريف الأنواع (Props) بعد التوجيه والاستيراد
interface AnswerInputProps {
  taskId: string;
  unitId: string;
  onClose: () => void;
}

export default function AnswerInput({ taskId, unitId, onClose }: AnswerInputProps) {
  const [answer, setAnswer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { completeTask } = useProgress();

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setIsSubmitting(true);
    
    // محاكاة التقييم
    setTimeout(() => {
      completeTask(`${unitId}:${taskId}`, 20);
      setIsSubmitting(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-[100] pointer-events-none p-4">
      <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-xl border border-white/10 p-6 rounded-3xl shadow-2xl pointer-events-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-cyan-400 font-bold">مهمة التقييم: {taskId}</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            ✕
          </button>
        </div>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="w-full h-40 bg-black/50 border border-white/5 rounded-2xl p-4 text-white text-sm outline-none focus:border-cyan-500/50 mb-4 resize-none"
          placeholder="اكتب إجابتك التحليلية هنا..."
        />

        <button 
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-black rounded-xl transition-all"
        >
          {isSubmitting ? "جاري الإرسال..." : "إرسال الإجابة"}
        </button>
      </div>
    </div>
  );
}