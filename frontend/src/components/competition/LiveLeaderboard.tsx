'use client';

import { useEffect, useMemo, useState } from 'react';

interface Competitor {
  id: string;
  name: string;
  points: number;
  time: number;
  accuracy: number;
  avatar: string;
  team?: string;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const formatNumber = (value: number) => new Intl.NumberFormat('ar-EG').format(value);

export default function LiveLeaderboard() {
  const [competitors, setCompetitors] = useState<Competitor[]>([
    { id: '1', name: 'أحمد محمد', points: 1250, time: 845, accuracy: 98, avatar: '👑' },
    { id: '2', name: 'سارة خالد', points: 1100, time: 920, accuracy: 95, avatar: '🌟' },
    { id: '3', name: 'فهد العتيبي', points: 980, time: 1105, accuracy: 92, avatar: '⚡' },
    { id: '4', name: 'نورة القحطاني', points: 850, time: 1250, accuracy: 88, avatar: '🎯' },
    { id: '5', name: 'محمد الحربي', points: 720, time: 1400, accuracy: 85, avatar: '🚀' },
  ]);

  const [currentUser, setCurrentUser] = useState<Competitor>({
    id: '6',
    name: 'أنت',
    points: 650,
    time: 1520,
    accuracy: 82,
    avatar: '👤'
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setCompetitors((prev) =>
        prev.map((comp) => ({
          ...comp,
          points: comp.points + Math.floor((comp.accuracy / 100) * 8),
          time: Math.max(600, comp.time - 3)
        }))
      );
      setCurrentUser((prev) => ({
        ...prev,
        points: prev.points + 4,
        time: Math.max(600, prev.time - 2)
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const sortedCompetitors = useMemo(
    () => [...competitors].sort((a, b) => b.points - a.points),
    [competitors]
  );

  const rankProgress = 85;

  return (
    <div className="bg-gradient-to-b from-gray-900 to-black rounded-2xl border border-gray-800 p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">🏆 لوحة المتصدرين</h2>
        <div className="text-emerald-400">
          <span className="text-sm">تحديث تلقائي كل 5 ثواني</span>
        </div>
      </div>

      <div className="space-y-3">
        {sortedCompetitors.map((competitor, index) => (
          <div
            key={competitor.id}
            className={`flex items-center p-4 rounded-xl ${index === 0 ? 'bg-gradient-to-r from-yellow-900/30 to-amber-900/30 border border-yellow-700' : 'bg-white/5 hover:bg-white/10'}`}
          >
            <div className="w-10 text-center">
              <div className={`w-8 h-8 flex items-center justify-center rounded-full ${index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : index === 2 ? 'bg-amber-700' : 'bg-gray-800'}`}>
                <span className="font-bold">{index + 1}</span>
              </div>
            </div>

            <div className="text-3xl ml-4">{competitor.avatar}</div>

            <div className="flex-1 ml-4">
              <div className="flex justify-between">
                <h3 className="font-bold text-white">{competitor.name}</h3>
                <span className="text-emerald-400 font-bold">{formatNumber(competitor.points)} XP</span>
              </div>
              <div className="flex justify-between text-sm text-gray-400">
                <span>⏱️ {formatTime(competitor.time)}</span>
                <span>🎯 دقة: {competitor.accuracy}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6 border-t border-gray-800">
        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 p-4 rounded-xl">
          <div className="flex items-center">
            <div className="text-3xl ml-4">{currentUser.avatar}</div>
            <div className="flex-1 ml-4">
              <div className="flex justify-between">
                <h3 className="font-bold text-white">{currentUser.name}</h3>
                <span className="text-blue-400 font-bold">{formatNumber(currentUser.points)} XP</span>
              </div>
              <div className="flex justify-between text-sm text-gray-300">
                <span>المركز: 6</span>
                <span>⏱️ {formatTime(currentUser.time)}</span>
                <span>🎯 دقة: {currentUser.accuracy}%</span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm text-gray-400 mb-1">التقدم للترتيب التالي:</div>
            <progress className="progress-primary" value={rankProgress} max={100} aria-label="التقدم للترتيب التالي" />
            <div className="text-xs text-gray-400 mt-1 text-left">تحتاج 70 نقطة للوصول للمركز الخامس</div>
          </div>
        </div>
      </div>
    </div>
  );
}
