"use client";
import React, { useState } from 'react';

type Character = 'victoria' | 'stefan' | 'student';

interface DialogueLine {
  speaker: Character;
  text: string;
  emotion?: string;
  options?: string[];
}

interface DialogueBoxProps {
  dialogues: DialogueLine[];
  onComplete?: () => void;
  onChoice?: (choice: string) => void;
}

const characterAvatars: Record<Character, string> = {
  victoria: '👩‍🌾',
  stefan: '👨‍🌾',
  student: '🎓'
};

const characterNames: Record<Character, string> = {
  victoria: 'فيكتوريا',
  stefan: 'ستيفان',
  student: 'أنت'
};

const emotionColors: Record<string, string> = {
  excited: 'border-yellow-500',
  thoughtful: 'border-blue-500',
  curious: 'border-purple-500',
  analytical: 'border-cyan-500',
  impressed: 'border-green-500',
  questioning: 'border-orange-500',
  learning: 'border-pink-500',
  proud: 'border-emerald-500',
  reflective: 'border-indigo-500',
  encouraging: 'border-lime-500',
  supportive: 'border-teal-500',
  default: 'border-white/20'
};

export default function DialogueBox({ dialogues, onComplete, onChoice }: DialogueBoxProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

  if (!dialogues || dialogues.length === 0) return null;

  const currentLine = dialogues[currentIndex];
  const isLastLine = currentIndex === dialogues.length - 1;
  const borderColor = emotionColors[currentLine.emotion || 'default'];

  const handleNext = () => {
    if (currentLine.options && !selectedChoice) {
      // يجب على الطالب اختيار خيار قبل المتابعة
      return;
    }

    if (isLastLine) {
      onComplete?.();
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelectedChoice(null);
    }
  };

  const handleChoice = (choice: string) => {
    setSelectedChoice(choice);
    onChoice?.(choice);
  };

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-3xl z-[200]">
      <div className={`bg-slate-900/95 backdrop-blur-xl border-2 ${borderColor} rounded-3xl shadow-2xl p-6 transition-all`}>
        {/* Header: شخصية + اسم */}
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-white/10">
          <div className="text-5xl">{characterAvatars[currentLine.speaker]}</div>
          <div>
            <h3 className="text-white font-bold text-lg">{characterNames[currentLine.speaker]}</h3>
            {currentLine.emotion && (
              <p className="text-xs text-white/50 uppercase tracking-widest">{currentLine.emotion}</p>
            )}
          </div>
          <div className="ml-auto text-xs text-white/30 font-mono">
            {currentIndex + 1} / {dialogues.length}
          </div>
        </div>

        {/* نص الحوار */}
        <div className="mb-6">
          <p className="text-white text-base leading-relaxed">{currentLine.text}</p>
        </div>

        {/* خيارات الطالب (إن وجدت) */}
        {currentLine.options && currentLine.options.length > 0 && (
          <div className="space-y-3 mb-6">
            <p className="text-sm text-cyan-400 font-semibold mb-2">اختر ردك:</p>
            {currentLine.options.map((option, i) => (
              <button
                key={i}
                onClick={() => handleChoice(option)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                  selectedChoice === option
                    ? 'bg-cyan-500/20 border-cyan-500 text-white'
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/30'
                }`}
              >
                <span className="font-medium">{option}</span>
              </button>
            ))}
          </div>
        )}

        {/* أزرار التنقل */}
        <div className="flex justify-between items-center">
          <button
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex(prev => prev - 1)}
            className="px-4 py-2 text-sm font-bold text-white/50 disabled:opacity-20 hover:text-white transition-colors"
          >
            ‹ السابق
          </button>

          <button
            onClick={handleNext}
            disabled={currentLine.options && !selectedChoice}
            className={`px-6 py-3 rounded-xl font-bold transition-all ${
              currentLine.options && !selectedChoice
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:shadow-lg hover:shadow-green-500/50'
            }`}
          >
            {isLastLine ? 'إنهاء الحوار' : 'التالي ›'}
          </button>
        </div>
      </div>
    </div>
  );
}
