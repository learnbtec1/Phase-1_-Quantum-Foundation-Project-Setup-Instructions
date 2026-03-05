"use client";

import React, { useState, useEffect } from 'react';
import { useProgress } from '@/context/ProgressContext';

type Phase = 'intro' | 'research' | 'pestle' | 'report' | 'certificate';

const phases = [
  { id: 'intro', label: 'المقدمة', icon: '📚', color: 'bg-emerald-600' },
  { id: 'research', label: 'البحث', icon: '🔍', color: 'bg-green-600' },
  { id: 'pestle', label: 'تحليل PESTLE', icon: '📊', color: 'bg-lime-600' },
  { id: 'report', label: 'التقرير', icon: '📄', color: 'bg-teal-600' },
  { id: 'certificate', label: 'الشهادة', icon: '🎓', color: 'bg-emerald-700' }
];

const pestleFactors = [
  { key: 'Political', label: 'سياسي', icon: '🏛️', color: 'from-red-50 to-red-100' },
  { key: 'Economic', label: 'اقتصادي', icon: '💰', color: 'from-yellow-50 to-yellow-100' },
  { key: 'Social', label: 'اجتماعي', icon: '👥', color: 'from-blue-50 to-blue-100' },
  { key: 'Technological', label: 'تكنولوجي', icon: '🤖', color: 'from-purple-50 to-purple-100' },
  { key: 'Legal', label: 'قانوني', icon: '⚖️', color: 'from-indigo-50 to-indigo-100' },
  { key: 'Environmental', label: 'بيئي', icon: '🌍', color: 'from-green-50 to-green-100' }
];

export default function Dashboard2D() {
  const { progress, setStudentName, savePESTLEAnalysis, saveComparison, completeTask } = useProgress();
  const [currentPhase, setCurrentPhase] = useState<Phase>('intro');
  const [studentName, setNameInput] = useState('');
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [comparisonText, setComparisonText] = useState('');
  const [pestleInputs, setPestleInputs] = useState<Record<string, string>>({
    Political: '',
    Economic: '',
    Social: '',
    Technological: '',
    Legal: '',
    Environmental: ''
  });

  // حساب التقدم
  const completedFactors = Object.values(pestleInputs).filter(v => v.trim().length > 0).length;
  const progressPercentage = Math.round((completedFactors / 6) * 100);

  const handleNameSubmit = () => {
    if (studentName.trim()) {
      setStudentName(studentName.trim());
      setNameSubmitted(true);
    }
  };

  const handlePestleUpdate = () => {
    savePESTLEAnalysis(pestleInputs);
    completeTask('pestle_analysis', completedFactors * 10);
    alert(`تم حفظ تحليل PESTLE! (${completedFactors}/6 عوامل مكتملة)`);
  };

  const handleComparisonSubmit = () => {
    if (comparisonText.trim()) {
      saveComparison(comparisonText);
      completeTask('comparison', 30);
      setCurrentPhase('pestle');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-900 via-neutral-900 to-black text-white">
      {/* Name Entry Screen */}
      {!nameSubmitted && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-gradient-to-br from-emerald-900 to-green-950 p-12 rounded-3xl border-4 border-emerald-600 shadow-2xl max-w-md w-full">
            <div className="text-8xl text-center mb-6">🌾</div>
            <h1 className="text-4xl font-black text-center mb-4">المستشار الزراعي</h1>
            <p className="text-emerald-200 text-center mb-8">أدخل اسمك لبدء رحلة التحليل</p>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="اسم الطالب..."
              className="w-full bg-white/10 border-2 border-emerald-400 rounded-xl px-6 py-4 text-white text-center text-xl placeholder:text-white/40 focus:border-emerald-300 focus:outline-none mb-6"
              onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
            />
            <button
              onClick={handleNameSubmit}
              disabled={!studentName.trim()}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl font-bold text-lg transition-all"
            >
              ابدأ الرحلة 🚀
            </button>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-black/90 backdrop-blur-md border-b border-emerald-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-2xl">🌾</span>
            <div>
              <h2 className="font-black text-xl">لوحة تحكم المستشار الزراعي</h2>
              <p className="text-xs text-emerald-400">{progress.studentName || 'الطالب'}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-gray-400">التقدم الإجمالي</p>
              <p className="font-bold text-emerald-400">{progressPercentage}%</p>
            </div>
            <div className="w-48">
              <progress
                className="progress-emerald"
                value={progressPercentage}
                max={100}
                aria-label="التقدم الإجمالي"
              />
            </div>
            <div className="text-2xl font-black text-emerald-400">{progress.totalPoints} XP</div>
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="pt-24 flex">
        {/* Sidebar */}
        <aside className="w-80 h-[calc(100vh-6rem)] sticky top-24 bg-gradient-to-b from-neutral-900 to-black border-r border-emerald-800 p-6">
          <h3 className="text-sm font-bold text-emerald-400 mb-4 uppercase tracking-wider">مراحل المهمة</h3>
          <nav className="space-y-3">
            {phases.map((phase) => (
              <button
                key={phase.id}
                onClick={() => setCurrentPhase(phase.id as Phase)}
                className={`w-full text-right px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${currentPhase === phase.id
                    ? `${phase.color} text-white shadow-lg`
                    : 'bg-white/5 hover:bg-white/10 text-gray-400'
                  }`}
              >
                <span className="text-2xl">{phase.icon}</span>
                <span className="font-bold">{phase.label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-8 p-4 bg-emerald-950/50 rounded-xl border border-emerald-800">
            <p className="text-xs text-emerald-300 mb-2">💡 نصيحة</p>
            <p className="text-xs text-gray-400">استخدم كلمات مفتاحية مثل "cooperative" و "sustainability" للحصول على نقاط إضافية!</p>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 p-8 max-w-5xl mx-auto">
          {/* Intro Phase */}
          {currentPhase === 'intro' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-emerald-900/30 to-green-950/30 p-8 rounded-2xl border border-emerald-700">
                <h1 className="text-5xl font-black mb-4">🌾 The Green Field Project</h1>
                <p className="text-xl text-emerald-200 mb-6">رحلة فيكتوريا وستيفان الزراعية</p>
                <div className="h-1 w-32 bg-emerald-500 rounded-full mb-8"></div>

                <div className="space-y-4">
                  <div className="flex gap-4 items-start">
                    <div className="bg-emerald-600 p-3 rounded-full text-3xl">👩‍🌾</div>
                    <div className="flex-1 bg-white/5 p-4 rounded-2xl rounded-tl-none">
                      <p className="font-bold text-emerald-400 mb-1">فيكتوريا - مالكة مزرعة Green Valley</p>
                      <p className="text-gray-300">مرحباً! أنا أدير مزرعة عائلية صغيرة متخصصة في الخضروات العضوية. نحن نعمل بشكل مستقل وأواجه تحديات مثل ارتفاع التكاليف والمنافسة.</p>
                    </div>
                  </div>

                  <div className="flex gap-4 items-start">
                    <div className="bg-blue-600 p-3 rounded-full text-3xl">👨‍🌾</div>
                    <div className="flex-1 bg-white/5 p-4 rounded-2xl rounded-tl-none">
                      <p className="font-bold text-blue-400 mb-1">ستيفان - عضو في تعاونية Arla</p>
                      <p className="text-gray-300">أهلاً! أنا جزء من تعاونية كبيرة تضم آلاف المزارعين. نتشارك الموارد والأرباح، مما يمنحنا قوة تفاوضية أكبر في السوق.</p>
                    </div>
                  </div>

                  <div className="flex gap-4 items-start">
                    <div className="bg-purple-600 p-3 rounded-full text-3xl">🎓</div>
                    <div className="flex-1 bg-white/5 p-4 rounded-2xl rounded-tl-none">
                      <p className="font-bold text-purple-400 mb-1">مهمتك كمستشار</p>
                      <p className="text-gray-300">قارن بين نموذجي الأعمال (Sole Trader vs Cooperative)، حلل البيئة التجارية باستخدام PESTLE، واكتب تقريراً احترافياً!</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setCurrentPhase('research')}
                  className="mt-8 w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-lg transition-all"
                >
                  ابدأ البحث →
                </button>
              </div>
            </div>
          )}

          {/* Research Phase */}
          {currentPhase === 'research' && (
            <div className="space-y-6">
              <h2 className="text-4xl font-black mb-6">🔍 مركز البحث</h2>

              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-green-900/40 to-emerald-950/40 p-6 rounded-2xl border-2 border-green-600">
                  <div className="text-5xl mb-4">🌿</div>
                  <h3 className="text-2xl font-bold mb-3">Green Valley Farm</h3>
                  <div className="space-y-2 text-sm text-gray-300">
                    <p><span className="text-emerald-400 font-bold">الملكية:</span> Sole Trader (فيكتوريا)</p>
                    <p><span className="text-emerald-400 font-bold">الحجم:</span> صغير (8 موظفين)</p>
                    <p><span className="text-emerald-400 font-bold">النطاق:</span> محلي</p>
                    <p><span className="text-emerald-400 font-bold">التصنيف:</span> خاص</p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-900/40 to-cyan-950/40 p-6 rounded-2xl border-2 border-blue-600">
                  <div className="text-5xl mb-4">🥛</div>
                  <h3 className="text-2xl font-bold mb-3">Arla Cooperative</h3>
                  <div className="space-y-2 text-sm text-gray-300">
                    <p><span className="text-blue-400 font-bold">الملكية:</span> Cooperative (11,600 عضو)</p>
                    <p><span className="text-blue-400 font-bold">الحجم:</span> كبير جداً (5000+ موظف)</p>
                    <p><span className="text-blue-400 font-bold">النطاق:</span> دولي</p>
                    <p><span className="text-blue-400 font-bold">التصنيف:</span> تعاوني</p>
                  </div>
                </div>
              </div>

              <div className="bg-neutral-900 p-6 rounded-2xl border border-gray-700">
                <h3 className="text-xl font-bold mb-4">✍️ اكتب مقارنة شاملة</h3>
                <textarea
                  value={comparisonText}
                  onChange={(e) => setComparisonText(e.target.value)}
                  placeholder="قارن بين الشركتين من حيث الغرض، الملكية، الحجم، النطاق، والتصنيف... استخدم كلمات مفتاحية مثل: purpose, ownership, sole trader, cooperative, liability, profit"
                  rows={8}
                  className="w-full bg-black/40 border border-gray-700 rounded-xl p-4 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none resize-none"
                />
                <div className="flex justify-between items-center mt-4">
                  <p className="text-sm text-gray-400">{comparisonText.split(/\s+/).filter(w => w).length} كلمة</p>
                  <button
                    onClick={handleComparisonSubmit}
                    disabled={comparisonText.trim().length < 50}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl font-bold transition-all"
                  >
                    حفظ والانتقال لـ PESTLE →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PESTLE Phase */}
          {currentPhase === 'pestle' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-4xl font-black">📊 تحليل PESTLE</h2>
                <div className="text-right">
                  <p className="text-sm text-gray-400">العوامل المكتملة</p>
                  <p className="text-3xl font-black text-emerald-400">{completedFactors}/6</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {pestleFactors.map((factor) => (
                  <div key={factor.key} className={`bg-gradient-to-br ${factor.color} p-6 rounded-2xl border border-gray-300`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-4xl">{factor.icon}</span>
                      <div>
                        <h3 className="text-xl font-black text-gray-900">{factor.label}</h3>
                        <p className="text-xs text-gray-600">{factor.key}</p>
                      </div>
                    </div>
                    <textarea
                      value={pestleInputs[factor.key]}
                      onChange={(e) => setPestleInputs(prev => ({ ...prev, [factor.key]: e.target.value }))}
                      placeholder={`اكتب تحليلك للعامل ${factor.label}...`}
                      rows={4}
                      className="w-full bg-white/80 border border-gray-300 rounded-xl p-3 text-gray-900 text-sm placeholder:text-gray-500 focus:border-gray-600 focus:outline-none resize-none"
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={handlePestleUpdate}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-lg transition-all"
              >
                💾 تحديث التحليل ({completedFactors}/6)
              </button>
            </div>
          )}

          {/* Report Phase */}
          {currentPhase === 'report' && (
            <div className="space-y-6">
              <h2 className="text-4xl font-black mb-6">📄 التقرير النهائي</h2>

              <div className="bg-white text-black p-12 rounded-2xl">
                <div className="text-center mb-8 border-b-4 border-emerald-600 pb-6">
                  <h1 className="text-4xl font-black mb-2">BTEC Level 2 Business</h1>
                  <h2 className="text-2xl font-bold text-emerald-700">Unit 1: The Green Field Project</h2>
                  <p className="text-gray-600 mt-2">Agricultural Business Analysis</p>
                </div>

                <div className="mb-6">
                  <p className="font-bold">Student: <span className="text-emerald-700">{progress.studentName}</span></p>
                  <p className="font-bold">Date: <span className="text-gray-600">{new Date().toLocaleDateString('ar-EG')}</span></p>
                  <p className="font-bold">Total XP: <span className="text-emerald-700">{progress.totalPoints} 🏆</span></p>
                </div>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-2xl font-black mb-3 text-emerald-700">📊 Comparison Analysis</h3>
                    <p className="text-gray-800 leading-relaxed">{progress.comparisonText || 'لا توجد مقارنة بعد...'}</p>
                  </div>

                  <div>
                    <h3 className="text-2xl font-black mb-3 text-emerald-700">🌍 PESTLE Analysis</h3>
                    <div className="grid gap-4">
                      {pestleFactors.map(factor => (
                        progress.pestleAnalysis[factor.key] && (
                          <div key={factor.key} className="bg-gray-50 p-4 rounded-xl">
                            <h4 className="font-bold text-lg mb-2">{factor.icon} {factor.label}</h4>
                            <p className="text-gray-700">{progress.pestleAnalysis[factor.key]}</p>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => window.print()}
                  className="mt-8 w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all"
                >
                  🖨️ طباعة التقرير
                </button>
              </div>

              {progress.totalPoints >= 60 && (
                <button
                  onClick={() => setCurrentPhase('certificate')}
                  className="w-full py-4 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 rounded-xl font-bold text-lg transition-all shadow-xl"
                >
                  🎓 الحصول على الشهادة
                </button>
              )}
            </div>
          )}

          {/* Certificate Phase */}
          {currentPhase === 'certificate' && (
            <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-8">
              <div className="bg-gradient-to-br from-amber-50 to-yellow-50 p-16 rounded-3xl border-8 border-amber-600 shadow-2xl max-w-3xl w-full relative">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZDRhZjM3IiBzdHJva2Utd2lkdGg9IjEiIG9wYWNpdHk9IjAuMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-20"></div>

                <div className="relative z-10 text-center">
                  <div className="text-8xl mb-6">🌾</div>
                  <div className="mb-8">
                    <h1 className="text-6xl font-black text-emerald-800 mb-2">BTEC CERTIFICATE</h1>
                    <p className="text-2xl font-bold text-amber-800">Level 2 Business</p>
                  </div>

                  <div className="my-12">
                    <p className="text-xl text-gray-700 mb-4">This certifies that</p>
                    <p className="text-5xl font-black text-emerald-900 border-b-4 border-emerald-700 pb-4 mb-4">{progress.studentName}</p>
                    <p className="text-xl text-gray-700 mb-6">has successfully completed</p>
                    <p className="text-3xl font-bold text-gray-900 mb-2">The Green Field Project:</p>
                    <p className="text-xl text-gray-700">Agricultural Business Analysis</p>
                  </div>

                  <div className="flex justify-center gap-8 mb-12">
                    <div className="text-center">
                      <p className="text-5xl font-black text-emerald-700">{progress.totalPoints}</p>
                      <p className="text-sm text-gray-600">XP Earned 🏆</p>
                    </div>
                    <div className="text-center">
                      <p className="text-5xl font-black text-amber-700">{progress.totalPoints >= 100 ? 'Distinction' : progress.totalPoints >= 80 ? 'Merit' : 'Pass'}</p>
                      <p className="text-sm text-gray-600">Grade</p>
                    </div>
                  </div>

                  <div className="flex justify-between text-sm text-gray-700 border-t-2 border-gray-300 pt-6">
                    <div>
                      <p className="font-bold mb-1">Dr. Sarah Johnson</p>
                      <p className="text-xs">Course Coordinator</p>
                    </div>
                    <div>
                      <p className="font-bold mb-1">Date: {new Date().toLocaleDateString('en-GB')}</p>
                    </div>
                    <div>
                      <p className="font-bold mb-1">Prof. Michael Chen</p>
                      <p className="text-xs">Academic Director</p>
                    </div>
                  </div>

                  <div className="mt-8 flex gap-4">
                    <button
                      onClick={() => window.print()}
                      className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all"
                    >
                      🖨️ طباعة الشهادة
                    </button>
                    <button
                      onClick={() => setCurrentPhase('report')}
                      className="flex-1 py-4 bg-gray-600 hover:bg-gray-500 text-white rounded-xl font-bold transition-all"
                    >
                      ← عودة
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
