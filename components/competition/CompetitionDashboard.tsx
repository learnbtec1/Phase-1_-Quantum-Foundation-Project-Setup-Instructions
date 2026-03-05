'use client';

import { useEffect, useMemo, useState } from 'react';
import LiveLeaderboard from '@/components/competition/LiveLeaderboard';
import TimedChallenge from '@/components/competition/TimedChallenge';
import TeamCompetition from '@/components/competition/TeamCompetition';
import CompetitionNotifications from '@/components/competition/CompetitionNotifications';
import AchievementsPanel from '@/components/competition/AchievementsPanel';

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export default function CompetitionDashboard() {
  const [studentId, setStudentId] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [mode, setMode] = useState<'solo' | 'team'>('solo');

  useEffect(() => {
    const id = localStorage.getItem('studentId') ?? '';
    const savedMode = (localStorage.getItem('competitionMode') as 'solo' | 'team') ?? 'solo';
    const code = localStorage.getItem('teamCode') ?? '';
    setStudentId(id);
    setMode(savedMode);
    setTeamCode(code);
  }, []);

  const stats = useMemo(
    () => ({ rank: 6, points: 650, averageTime: 1520, accuracy: 82 }),
    []
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">🏆 منافسة فهم الواجبات</h1>
          <p className="text-gray-400">تحدى زملاءك في فهم المعايير وحل المهام بأسرع وقت!</p>
          {studentId && (
            <div className="mt-3 text-sm text-gray-300">
              مرحباً {studentId} • الوضع: {mode === 'solo' ? 'فردي' : `جماعي ${teamCode ? `(كود ${teamCode})` : ''}`}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <LiveLeaderboard />

            <div className="bg-gradient-to-b from-gray-900 to-black rounded-2xl border border-gray-800 p-6">
              <h3 className="text-xl font-bold mb-4">📊 إحصائياتك</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800/50 p-4 rounded-xl text-center">
                  <div className="text-3xl font-bold text-emerald-400">{stats.rank}</div>
                  <div className="text-sm text-gray-400">المركز</div>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl text-center">
                  <div className="text-3xl font-bold text-blue-400">{stats.points}</div>
                  <div className="text-sm text-gray-400">إجمالي النقاط</div>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl text-center">
                  <div className="text-3xl font-bold text-yellow-400">{formatTime(stats.averageTime)}</div>
                  <div className="text-sm text-gray-400">متوسط الوقت</div>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl text-center">
                  <div className="text-3xl font-bold text-purple-400">{stats.accuracy}%</div>
                  <div className="text-sm text-gray-400">الدقة</div>
                </div>
              </div>
            </div>

            <CompetitionNotifications />
          </div>

          <div className="lg:col-span-2 space-y-6">
            <TimedChallenge />

            <div className="bg-gradient-to-b from-gray-900 to-black rounded-2xl border border-gray-800 p-6">
              <h3 className="text-2xl font-bold mb-4">🎯 تحديات اليوم</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { title: 'مقارنة الشركات', time: '5 دقائق', points: 50, completed: true },
                  { title: 'تحليل SWOT', time: '8 دقائق', points: 75, completed: false },
                  { title: 'كتابة التقرير', time: '10 دقائق', points: 100, completed: false },
                  { title: 'حالة دراسية', time: '12 دقائق', points: 125, completed: false }
                ].map((challenge) => (
                  <div key={challenge.title} className={`p-4 rounded-xl ${challenge.completed ? 'bg-emerald-900/30' : 'bg-gray-800/30'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-bold">{challenge.title}</h4>
                      <span className="text-yellow-400">{challenge.points} نقطة</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-400">
                      <span>⏱️ {challenge.time}</span>
                      {challenge.completed ? (
                        <span className="text-emerald-400">✅ مكتمل</span>
                      ) : (
                        <button className="text-blue-400 hover:text-blue-300">🚀 بدأ</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <TeamCompetition />

            <AchievementsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
