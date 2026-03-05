import React from 'react';
import { CheckCircleIcon, XCircleIcon, LightBulbIcon } from '@heroicons/react/24/outline';

interface CriterionResult {
  achieved: boolean;
  quality?: string; // تم تعديلها لتطابق الباكند (بدلاً من feedback)
  evidence?: string[]; // تم تعديلها لمصفوفة (بدلاً من evidence_quote)
  missing_requirements?: string[];
  required?: number; // من المحرك الماسي
  provided?: number; // من المحرك الماسي
}

interface EvaluationResult {
  final_grade?: string;
  criteria_results?: Record<string, CriterionResult>;
  partial?: boolean;
  total?: number;
  processed?: number;
}

interface Props {
  evaluationResult: EvaluationResult | null;
}

export default function CriteriaAnalysisBox({ evaluationResult }: Props) {
  if (!evaluationResult) {
    return null;
  }

  const { final_grade, criteria_results, total, processed } = evaluationResult;
  const isPending = final_grade === 'INCOMPLETE (EVALUATION IN PROGRESS)' || !final_grade;

  const getGradeColor = (grade?: string) => {
    if (!grade) return 'text-gray-400';
    if (grade.includes('DISTINCTION')) return 'text-green-500';
    if (grade.includes('MERIT')) return 'text-blue-400';
    if (grade.includes('PASS')) return 'text-amber-400';
    if (grade.includes('FAIL') || grade.includes('REFER')) return 'text-red-500';
    return 'text-gray-400';
  };

  const criteriaEntries = Object.entries(criteria_results || {});

  return (
    <div className="mt-8 space-y-6" dir="rtl">
      {/* Grade Header Card */}
      <div className={`p-8 rounded-2xl border bg-gray-900 shadow-xl flex flex-col items-center justify-center text-center ${isPending ? 'border-gray-600 animate-pulse' : 'border-gray-700'}`}>
        <h2 className="text-xl text-gray-400 font-semibold mb-2">النتيجة النهائية</h2>
        <div className={`text-4xl md:text-5xl font-bold tracking-wider ${getGradeColor(final_grade)}`}>
          {final_grade || 'PENDING...'}
        </div>
        {total !== undefined && processed !== undefined && (
          <p className="text-sm text-gray-500 mt-4">
            تمت معالجة {processed} من أصل {total} معيار
          </p>
        )}
      </div>

      {/* Criteria List */}
      <div className="space-y-4">
        {criteriaEntries.map(([code, result]) => {
          const { achieved, quality, evidence, missing_requirements, required, provided } = result;
          const cardBorder = achieved ? 'border-green-500/50 bg-green-900/10' : 'border-red-500/50 bg-red-900/10';
          const iconColor = achieved ? 'text-green-400' : 'text-red-400';

          return (
            <div key={code} className={`p-6 rounded-xl border ${cardBorder} transition-colors duration-300`}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {achieved ? (
                      <CheckCircleIcon className={`w-8 h-8 ${iconColor}`} />
                    ) : (
                      <XCircleIcon className={`w-8 h-8 ${iconColor}`} />
                    )}
                  </div>
                  <h3 className="text-2xl font-bold text-white tracking-wide">{code}</h3>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${achieved ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                    {achieved ? 'مستوفى' : 'غير مستوفى'}
                  </div>
                  {/* عرض العداد الرقمي للشفافية */}
                  {(required !== undefined || provided !== undefined) && (
                    <div className="text-xs text-gray-400 font-mono">
                      (المطلوب: {required || 0} | المُقدم: {provided || 0})
                    </div>
                  )}
                </div>
              </div>

              <div className="text-gray-300 leading-relaxed space-y-3">
                {/* تم استخدام quality هنا */}
                {quality && <p>{quality}</p>}

                {/* تم تعديل الأدلة لتعرض كمصفوفة */}
                {evidence && evidence.length > 0 && (
                  <div className="space-y-2">
                    {evidence.map((quote, idx) => (
                      <blockquote key={idx} className="border-r-4 border-gray-600 pr-4 py-2 text-gray-400 italic text-sm bg-black/20 rounded">
                        "{quote}"
                      </blockquote>
                    ))}
                  </div>
                )}

                {!achieved && missing_requirements && missing_requirements.length > 0 && (
                  <div className="mt-4 p-4 rounded-lg bg-red-950/30 border border-red-900/50">
                    <div className="flex items-center gap-2 mb-2 text-red-300 font-semibold">
                      <LightBulbIcon className="w-5 h-5" />
                      <span>المتطلبات المفقودة:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-red-200 text-sm pr-2">
                      {missing_requirements.map((req, idx) => (
                        <li key={idx}>{req}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}