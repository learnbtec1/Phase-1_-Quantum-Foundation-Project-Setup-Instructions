'use client';

import { useEffect, useMemo, useState } from 'react';

interface Challenge {
  id: string;
  title: string;
  description: string;
  maxTime: number;
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

function calculateCompetitionScore(accuracy: number, timeTaken: number, maxTime: number, difficulty: number) {
  const basePoints = 100 * difficulty;
  const timeBonus = ((maxTime - timeTaken) / maxTime) * 50;
  const accuracyBonus = (accuracy / 100) * 30;
  const streakBonus = 25;
  return Math.round(basePoints + timeBonus + accuracyBonus + streakBonus);
}

export default function TimedChallenge() {
  const challenge: Challenge = useMemo(
    () => ({
      id: 'pestle-fast',
      title: 'تحليل PESTLE السريع',
      description: 'قم بتحليل 6 عوامل PESTLE في أسرع وقت ممكن',
      maxTime: 600,
      points: 100,
      difficulty: 'medium'
    }),
    []
  );

  const [timeLeft, setTimeLeft] = useState(challenge.maxTime);
  const [isRunning, setIsRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRunning && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      setIsRunning(false);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, timeLeft]);

  const startChallenge = () => {
    setIsRunning(true);
    setTimeLeft(challenge.maxTime);
    setCompleted(false);
  };

  const submitChallenge = () => {
    const timeTaken = challenge.maxTime - timeLeft;
    const totalScore = calculateCompetitionScore(92, timeTaken, challenge.maxTime, 2);
    setIsRunning(false);
    setCompleted(true);
    setScore(totalScore);
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-2xl border border-gray-800 p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">⏱️ تحدي السرعة</h2>
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              challenge.difficulty === 'easy' ? 'bg-green-900 text-green-300' :
              challenge.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-300' :
              'bg-red-900 text-red-300'
            }`}>
              {challenge.difficulty === 'easy' ? 'سهل' : challenge.difficulty === 'medium' ? 'متوسط' : 'صعب'}
            </span>
            <span className="text-emerald-400">🏆 {challenge.points} نقطة</span>
          </div>
        </div>

        <div className="text-center">
          <div className="text-5xl font-bold text-white mb-2">{formatTime(timeLeft)}</div>
          <div className="text-sm text-gray-400">الوقت المتبقي</div>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-xl font-bold text-white mb-2">{challenge.title}</h3>
        <p className="text-gray-300">{challenge.description}</p>
      </div>

      <div className="space-y-4">
        <div className="bg-gray-800/50 p-4 rounded-xl">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-white">⚡ مكافأة السرعة</h4>
            <span className="text-yellow-400 font-bold">+50 نقطة إضافية</span>
          </div>
          <p className="text-sm text-gray-300">كلما أنهيت أسرع، كلما زادت نقاط السرعة!</p>
        </div>

        <div className="bg-gray-800/50 p-4 rounded-xl">
          <h4 className="font-bold text-white mb-2">🏆 المنافسون النشطون</h4>
          <div className="flex space-x-2">
            {['👑', '🌟', '⚡', '🎯'].map((avatar, i) => (
              <div key={avatar} className="bg-black/30 p-2 rounded-lg">
                <div className="text-2xl">{avatar}</div>
                <div className="text-xs text-gray-400 mt-1">{formatTime(540 - i * 60)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 flex gap-4">
        {!isRunning && !completed ? (
          <button
            onClick={startChallenge}
            className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 rounded-xl font-bold transition-all"
          >
            🚀 بدأ التحدي
          </button>
        ) : isRunning ? (
          <button
            onClick={submitChallenge}
            className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-bold transition-all"
          >
            ✅ إنهاء التحدي
          </button>
        ) : (
          <div className="flex-1 text-center py-3 bg-gradient-to-r from-yellow-600 to-amber-600 rounded-xl">
            <div className="font-bold">🎉 أكملت التحدي!</div>
            <div className="text-2xl font-bold mt-1">{score} نقطة</div>
          </div>
        )}

        <button className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold">
          👥 تحدى صديق
        </button>
      </div>
    </div>
  );
}
