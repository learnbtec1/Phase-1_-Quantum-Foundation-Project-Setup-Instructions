"use client";
import React, { useState } from 'react';

interface PestleChallenge {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const pestleChallenges: Record<string, PestleChallenge> = {
  Political: {
    question: "ما هو العامل السياسي الذي يؤثر بشكل مباشر على المزارع الصغيرة؟",
    options: ["الإعانات الحكومية", "سعر الفائدة", "التكنولوجيا الحديثة", "تفضيلات المستهلك"],
    correctIndex: 0,
    explanation: "الإعانات الحكومية هي دعم مالي تقدمه الحكومة للمزارعين، وهي عامل سياسي مباشر."
  },
  Economic: {
    question: "أي من التالي يمثل عاملاً اقتصادياً؟",
    options: ["القوانين البيئية", "ارتفاع تكاليف الإنتاج", "الاتجاهات الاجتماعية", "السياسات الحكومية"],
    correctIndex: 1,
    explanation: "ارتفاع تكاليف الإنتاج يؤثر مباشرة على الأرباح والقرارات المالية."
  },
  Social: {
    question: "ما هو الاتجاه الاجتماعي الذي يدعم المزارع العضوية؟",
    options: ["انخفاض الأسعار", "الوعي الصحي المتزايد", "التكنولوجيا", "القوانين"],
    correctIndex: 1,
    explanation: "الوعي الصحي المتزايد يدفع المستهلكين لشراء منتجات عضوية."
  },
  Technological: {
    question: "كيف تساعد التكنولوجيا الزراعة الحديثة؟",
    options: ["تقلل الضرائب", "تزيد الإنتاجية", "تغير القوانين", "تحسن الطقس"],
    correctIndex: 1,
    explanation: "التكنولوجيا الحديثة (جرارات، أنظمة ري) تزيد الإنتاجية وتقلل الهدر."
  },
  Legal: {
    question: "ما هو مثال على عامل قانوني؟",
    options: ["سعر البذور", "قوانين سلامة الغذاء", "الطقس", "المنافسة"],
    correctIndex: 1,
    explanation: "قوانين سلامة الغذاء هي متطلبات قانونية يجب على المزارعين الالتزام بها."
  },
  Environmental: {
    question: "أي من التالي عامل بيئي يؤثر على الزراعة؟",
    options: ["الضرائب", "تغير المناخ", "التسويق", "الموظفين"],
    correctIndex: 1,
    explanation: "تغير المناخ يؤثر على أنماط الأمطار ودرجات الحرارة، مما يؤثر على المحاصيل."
  }
};

interface PestleChallengeQuizProps {
  factorKey: string;
  onPass: () => void;
  onSkip: () => void;
}

export default function PestleChallengeQuiz({ factorKey, onPass, onSkip }: PestleChallengeQuizProps) {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const challenge = pestleChallenges[factorKey];

  if (!challenge) {
    onPass();
    return null;
  }

  const handleSubmit = () => {
    if (selectedOption === null) return;
    setShowResult(true);
    if (selectedOption === challenge.correctIndex) {
      setTimeout(() => onPass(), 2000);
    }
  };

  const isCorrect = selectedOption === challenge.correctIndex;

  return (
    <div className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-lg flex items-center justify-center p-8">
      <div className="bg-gradient-to-br from-purple-900 to-indigo-950 p-8 rounded-3xl border-4 border-purple-500 max-w-2xl w-full shadow-2xl">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🧠</div>
          <h2 className="text-3xl font-black text-white mb-2">تحدي PESTLE</h2>
          <p className="text-purple-300">أجب بشكل صحيح لفتح العامل التالي!</p>
        </div>

        <div className="bg-white/10 p-6 rounded-2xl mb-6">
          <p className="text-xl font-bold text-white mb-4">{challenge.question}</p>
          <div className="space-y-3">
            {challenge.options.map((option, idx) => (
              <button
                key={idx}
                onClick={() => !showResult && setSelectedOption(idx)}
                disabled={showResult}
                className={`w-full text-right px-6 py-4 rounded-xl font-bold transition-all ${
                  showResult
                    ? idx === challenge.correctIndex
                      ? 'bg-green-600 text-white'
                      : idx === selectedOption
                      ? 'bg-red-600 text-white'
                      : 'bg-white/5 text-gray-400'
                    : selectedOption === idx
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {String.fromCharCode(65 + idx)}. {option}
                {showResult && idx === challenge.correctIndex && ' ✓'}
                {showResult && idx === selectedOption && idx !== challenge.correctIndex && ' ✗'}
              </button>
            ))}
          </div>
        </div>

        {showResult && (
          <div className={`p-4 rounded-xl mb-6 ${isCorrect ? 'bg-green-600/20 border border-green-500' : 'bg-red-600/20 border border-red-500'}`}>
            <p className="text-white font-bold mb-2">
              {isCorrect ? '🎉 إجابة صحيحة!' : '❌ إجابة خاطئة'}
            </p>
            <p className="text-white/80 text-sm">{challenge.explanation}</p>
          </div>
        )}

        <div className="flex gap-4">
          {!showResult && (
            <>
              <button
                onClick={onSkip}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-all"
              >
                تخطي
              </button>
              <button
                onClick={handleSubmit}
                disabled={selectedOption === null}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all"
              >
                تحقق من الإجابة
              </button>
            </>
          )}
          {showResult && !isCorrect && (
            <button
              onClick={() => {
                setShowResult(false);
                setSelectedOption(null);
              }}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition-all"
            >
              حاول مرة أخرى
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
