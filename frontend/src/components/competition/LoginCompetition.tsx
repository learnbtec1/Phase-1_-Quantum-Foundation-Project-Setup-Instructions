'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginCompetition() {
  const [studentId, setStudentId] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [competitionMode, setCompetitionMode] = useState<'solo' | 'team'>('solo');
  const router = useRouter();

  const handleLogin = () => {
    if (!studentId.trim()) return;
    localStorage.setItem('studentId', studentId.trim());
    localStorage.setItem('competitionMode', competitionMode);
    if (competitionMode === 'team' && teamCode.trim()) {
      localStorage.setItem('teamCode', teamCode.trim().toUpperCase());
    } else {
      localStorage.removeItem('teamCode');
    }
    router.push('/competition-dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🏆</div>
          <h1 className="text-3xl font-bold text-white">منافسة المستشار الزراعي</h1>
          <p className="text-gray-300 mt-2">تحدى زملاءك وفهم الواجب بسرعة!</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-white mb-2" htmlFor="studentId">
              رقم الطالب
            </label>
            <input
              id="studentId"
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="أدخل رقمك الجامعي"
              className="w-full bg-white/20 border border-white/30 rounded-xl px-4 py-3 text-white placeholder:text-gray-300"
            />
          </div>

          <div className="bg-black/30 p-4 rounded-xl">
            <h3 className="text-white font-bold mb-3">وضع المنافسة</h3>
            <div className="flex gap-4">
              <button
                onClick={() => setCompetitionMode('solo')}
                className={`flex-1 py-3 rounded-lg transition-all ${competitionMode === 'solo' ? 'bg-emerald-600' : 'bg-gray-700'}`}
              >
                <div className="text-2xl">👤</div>
                <div className="text-sm">فردي</div>
              </button>
              <button
                onClick={() => setCompetitionMode('team')}
                className={`flex-1 py-3 rounded-lg transition-all ${competitionMode === 'team' ? 'bg-blue-600' : 'bg-gray-700'}`}
              >
                <div className="text-2xl">👥</div>
                <div className="text-sm">جماعي</div>
              </button>
            </div>

            {competitionMode === 'team' && (
              <div className="mt-4">
                <label className="block text-white mb-2" htmlFor="teamCode">
                  كود الفريق (اختياري)
                </label>
                <input
                  id="teamCode"
                  type="text"
                  value={teamCode}
                  onChange={(e) => setTeamCode(e.target.value)}
                  placeholder="ABCD123"
                  className="w-full bg-white/20 border border-white/30 rounded-xl px-4 py-3 text-white placeholder:text-gray-300"
                />
              </div>
            )}
          </div>

          <div className="bg-gradient-to-r from-yellow-900/50 to-amber-900/50 p-4 rounded-xl">
            <h3 className="text-yellow-300 font-bold mb-2">🎯 الجوائز اليومية</h3>
            <ul className="text-gray-300 text-sm space-y-1">
              <li>🏆 المركز الأول: 500 نقطة + شهادة تميز</li>
              <li>🥈 المركز الثاني: 300 نقطة</li>
              <li>🥉 المركز الثالث: 200 نقطة</li>
              <li>⚡ أسرع حل: 100 نقطة إضافية</li>
            </ul>
          </div>

          <button
            onClick={handleLogin}
            disabled={!studentId.trim()}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 rounded-xl font-bold text-lg transition-all"
          >
            🚀 دخول المنافسة
          </button>
        </div>
      </div>
    </div>
  );
}
