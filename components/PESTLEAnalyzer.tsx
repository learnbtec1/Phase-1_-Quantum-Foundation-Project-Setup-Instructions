"use client";
import React, { useState } from 'react';
import PestleChallengeQuiz from './PestleChallengeQuiz';

interface PESTLEFactor {
  factor: string;
  icon: string;
  description: string;
  examples: string[];
  impact_family_farm?: string;
  impact_arla?: string;
  questions?: string[];
}

interface PESTLEAnalyzerProps {
  factors: Record<string, PESTLEFactor>;
  selectedCompany?: 'family_farm' | 'arla_cooperative';
  onComplete?: (analysis: Record<string, string>) => void;
}

export default function PESTLEAnalyzer({ factors, selectedCompany = 'family_farm', onComplete }: PESTLEAnalyzerProps) {
  const [currentFactor, setCurrentFactor] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, string>>({});
  const [studentNotes, setStudentNotes] = useState('');
  const [showChallenge, setShowChallenge] = useState(false);
  const [challengeFactor, setChallengeFactor] = useState<string | null>(null);
  const [bonusPoints, setBonusPoints] = useState(0);

  const factorKeys = Object.keys(factors);
  const completedCount = Object.keys(analysis).length;
  const isComplete = completedCount === factorKeys.length;

  const handleOpenFactor = (key: string) => {
    setChallengeFactor(key);
    setShowChallenge(true);
  };

  const handleChallengePass = () => {
    setShowChallenge(false);
    setCurrentFactor(challengeFactor);
    setBonusPoints(prev => prev + 5);
    setChallengeFactor(null);
  };

  const handleChallengeSkip = () => {
    setShowChallenge(false);
    setCurrentFactor(challengeFactor);
    setChallengeFactor(null);
  };

  const handleSaveAnalysis = () => {
    if (!currentFactor || !studentNotes.trim()) return;

    setAnalysis(prev => ({
      ...prev,
      [currentFactor]: studentNotes
    }));

    setStudentNotes('');
    setCurrentFactor(null);
  };

  const handleSubmit = () => {
    if (isComplete) {
      onComplete?.(analysis);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-black text-white mb-2">تحليل PESTLE</h2>
        <p className="text-white/60">حلل بيئة الأعمال الخارجية للشركة المختارة</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <div className="px-4 py-2 bg-white/10 rounded-full text-sm font-bold text-white">
            {selectedCompany === 'family_farm' ? '🌿 المزرعة العائلية' : '🥛 تعاونية أرلا'}
          </div>
          <div className="px-4 py-2 bg-purple-500/20 rounded-full text-sm font-bold text-purple-400">
            {completedCount} / {factorKeys.length} مكتمل
          </div>
        </div>
      </div>

      {/* شبكة عوامل PESTLE */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {factorKeys.map(key => {
          const factor = factors[key];
          const isCompleted = !!analysis[key];
          const isActive = currentFactor === key;

          return (
            <button
              key={key}
              onClick={() => handleOpenFactor(key)}
              className={`relative p-6 rounded-2xl border-2 transition-all ${
                isActive
                  ? 'bg-purple-500/20 border-purple-500 shadow-lg shadow-purple-500/30'
                  : isCompleted
                  ? 'bg-green-500/10 border-green-500/50'
                  : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/30'
              }`}
            >
              {isCompleted && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  ✓
                </div>
              )}
              <div className="text-4xl mb-3">{factor.icon}</div>
              <h3 className="text-white font-bold text-lg mb-1">{factor.factor}</h3>
              <p className="text-xs text-white/50 line-clamp-2">{factor.description}</p>
            </button>
          );
        })}
      </div>

      {/* لوحة التحليل المفصلة */}
      {currentFactor && (
        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl mb-6">
          <div className="flex items-center gap-4 mb-6 pb-4 border-b border-white/10">
            <span className="text-5xl">{factors[currentFactor].icon}</span>
            <div>
              <h3 className="text-2xl font-black text-white">{factors[currentFactor].factor}</h3>
              <p className="text-sm text-white/60">{factors[currentFactor].description}</p>
            </div>
          </div>

          {/* أمثلة */}
          <div className="mb-6">
            <h4 className="text-white font-bold mb-3">📌 أمثلة واقعية:</h4>
            <ul className="space-y-2">
              {factors[currentFactor].examples.map((ex, i) => (
                <li key={i} className="text-white/70 text-sm flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>{ex}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* التأثير على الشركة المختارة */}
          <div className="mb-6 bg-white/5 rounded-xl p-4 border border-white/10">
            <h4 className="text-white font-bold mb-2 flex items-center gap-2">
              <span>💡</span>
              التأثير على {selectedCompany === 'family_farm' ? 'المزرعة العائلية' : 'تعاونية أرلا'}:
            </h4>
            <p className="text-white/70 text-sm">
              {selectedCompany === 'family_farm'
                ? factors[currentFactor].impact_family_farm
                : factors[currentFactor].impact_arla}
            </p>
          </div>

          {/* أسئلة إرشادية */}
          {factors[currentFactor].questions && factors[currentFactor].questions!.length > 0 && (
            <div className="mb-6">
              <h4 className="text-white font-bold mb-3">❓ أسئلة إرشادية:</h4>
              <ul className="space-y-2">
                {factors[currentFactor].questions!.map((q, i) => (
                  <li key={i} className="text-cyan-400 text-sm flex items-start gap-2">
                    <span className="mt-1">›</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* حقل إدخال تحليل الطالب */}
          <div className="mb-4">
            <label className="block text-white font-bold mb-2">✍️ تحليلك الشخصي:</label>
            <textarea
              value={analysis[currentFactor] || studentNotes}
              onChange={e => setStudentNotes(e.target.value)}
              placeholder="اكتب تحليلك هنا... كيف يؤثر هذا العامل على الشركة؟ ما الفرص والتحديات؟"
              rows={6}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:border-purple-500 focus:outline-none transition-colors resize-none"
            />
          </div>

          {/* أزرار الإجراءات */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setCurrentFactor(null);
                setStudentNotes('');
              }}
              className="px-6 py-3 rounded-xl border-2 border-white/10 text-white hover:bg-white/10 transition-all font-bold"
            >
              إلغاء
            </button>
            <button
              onClick={handleSaveAnalysis}
              disabled={!studentNotes.trim()}
              className="flex-1 px-6 py-3 rounded-xl font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-indigo-700 text-white hover:shadow-lg hover:shadow-purple-500/50"
            >
              ✓ حفظ التحليل
            </button>
          </div>
        </div>
      )}

      {/* PESTLE Challenge Quiz */}
      {showChallenge && challengeFactor && (
        <PestleChallengeQuiz
          factorKey={challengeFactor}
          onPass={handleChallengePass}
          onSkip={handleChallengeSkip}
        />
      )}

      {/* عرض نقاط المكافأة */}
      {bonusPoints > 0 && (
        <div className="mb-6 p-4 bg-yellow-500/20 border border-yellow-500 rounded-xl text-center">
          <p className="text-yellow-400 font-bold text-lg">
            🌟 لقد ربحت {bonusPoints} نقطة مكافأة من التحديات!
          </p>
        </div>
      )}

      {/* زر الإنهاء */}
      {isComplete && (
        <div className="text-center">
          <button
            onClick={handleSubmit}
            className="px-8 py-4 rounded-2xl font-black text-lg transition-all bg-gradient-to-r from-green-600 to-emerald-700 text-white hover:shadow-xl hover:shadow-green-500/50"
          >
            ✓ إنهاء تحليل PESTLE وحفظ النتائج
          </button>
        </div>
      )}
    </div>
  );
}
