import React from 'react';

const AIAnalysisDashboard = ({ result }) => {
  const { ai_generated_probability, details } = result;

  return (
    <div className="p-6 bg-gray-900 text-white rounded-xl shadow-2xl">
      <h3 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2">
        التحليل الجنائي اللغوي (Forensic Analysis)
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* مؤشر احتمالية الذكاء الاصطناعي */}
        <div className="flex flex-col items-center justify-center p-4 bg-gray-800 rounded-lg">
          <span className="text-sm text-gray-400">احتمالية AI</span>
          <div className="text-4xl font-black text-red-500">{ai_generated_probability}%</div>
          <div className="w-full bg-gray-700 h-2 mt-2 rounded-full">
            <div 
              className="bg-red-500 h-2 rounded-full transition-all duration-1000" 
              style={{ width: `${ai_generated_probability}%` }}
            ></div>
          </div>
        </div>

        {/* تفاصيل المؤشرات الإحصائية */}
        <div className="space-y-4">
          <MetricBar label="التنوع المعجمي (Lexical Diversity)" value={details.lexical_diversity * 100} color="bg-blue-500" />
          <MetricBar label="انتظام الجمل (Sentence Uniformity)" value={details.sentence_uniformity * 100} color="bg-yellow-500" />
          <MetricBar label="الرتابة الأسلوبية (Style Uniformity)" value={details.critic_scores.style_uniformity * 100} color="bg-purple-500" />
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-900/30 border border-blue-500/50 rounded-lg">
        <p className="text-sm italic text-blue-200">
          "هذا النص يظهر نمطاً {ai_generated_probability > 65 ? 'آلياً متكرراً' : 'بشرياً عفوياً'} بناءً على تحليل 15 مؤشراً أسلوبياً."
        </p>
      </div>
    </div>
  );
};

const MetricBar = ({ label, value, color }) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span>{label}</span>
      <span>{Math.round(value)}%</span>
    </div>
    <div className="w-full bg-gray-700 h-1.5 rounded-full">
      <div className={`${color} h-1.5 rounded-full`} style={{ width: `${value}%` }}></div>
    </div>
  </div>
);

export default AIAnalysisDashboard;