'use client';

import React, { useState } from 'react';
import useEvaluateMultiFile, { SolutionFile } from '@/hooks/useEvaluateMultiFile';

/**
 * مثال عملي: استخدام الـ Hook الجديد لتقييم حلول متعددة الملفات
 * 
 * هذا المكون يوضح:
 * 1. كيفية جمع ملفات متعددة من المستخدم
 * 2. كيفية استدعاء الـ endpoint الصحيح
 * 3. كيفية عرض النتائج بشكل منفصل لكل ملف
 */

export default function MultiFileEvaluationExample() {
  const { evaluateMultiFile } = useEvaluateMultiFile();
  
  const [assignmentText, setAssignmentText] = useState('');
  const [solutions, setSolutions] = useState<SolutionFile[]>([
    { file_label: 'الملف الأول', file_content: '', description: '' },
    { file_label: 'الملف الثاني', file_content: '', description: '' },
  ]);
  
  const [result, setResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // دالة لتحديث محتوى الملف
  const updateSolution = (index: number, field: string, value: string) => {
    const updated = [...solutions];
    (updated[index] as any)[field] = value;
    setSolutions(updated);
  };

  // دالة لإضافة ملف جديد
  const addFile = () => {
    setSolutions([
      ...solutions,
      { file_label: `ملف جديد ${solutions.length + 1}`, file_content: '' }
    ]);
  };

  // دالة للتقييم
  const handleEvaluate = async () => {
    setIsLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await evaluateMultiFile({
        assignment_text: assignmentText,
        solutions: solutions.filter(s => s.file_content.trim().length > 0)
      });

      if (res.success) {
        setResult(res);
      } else {
        setError(res.error || 'فشل التقييم');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto rtl" dir="rtl">
      <h1 className="text-3xl font-bold mb-6 text-cyan-400">تقييم حلول متعددة الملفات</h1>

      {/* الواجب */}
      <div className="mb-6">
        <label className="block text-lg font-semibold mb-2">نص الواجب:</label>
        <textarea
          value={assignmentText}
          onChange={(e) => setAssignmentText(e.target.value)}
          className="w-full h-24 p-3 bg-gray-800 border border-cyan-500 rounded text-white"
          placeholder="أدخل نص الواجب..."
        />
      </div>

      {/* الملفات */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">الملفات المطلوب تقييمها:</h2>
          <button
            onClick={addFile}
            className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-600 rounded hover:opacity-90 transition"
          >
            + إضافة ملف
          </button>
        </div>

        {solutions.map((solution, idx) => (
          <div key={idx} className="mb-6 p-4 border border-purple-500 rounded-lg bg-gray-900/50">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold mb-1">اسم الملف:</label>
                <input
                  type="text"
                  value={solution.file_label}
                  onChange={(e) => updateSolution(idx, 'file_label', e.target.value)}
                  className="w-full p-2 bg-gray-800 border border-cyan-500 rounded text-white"
                  placeholder="مثال: TalkMateAI"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">وصف (اختياري):</label>
                <input
                  type="text"
                  value={solution.description || ''}
                  onChange={(e) => updateSolution(idx, 'description', e.target.value)}
                  className="w-full p-2 bg-gray-800 border border-cyan-500 rounded text-white"
                  placeholder="وصف محتوى الملف"
                />
              </div>
            </div>

            <label className="block text-sm font-semibold mb-1">محتوى الملف:</label>
            <textarea
              value={solution.file_content}
              onChange={(e) => updateSolution(idx, 'file_content', e.target.value)}
              className="w-full h-32 p-3 bg-gray-800 border border-cyan-500 rounded text-white"
              placeholder="أدخل محتوى الملف..."
            />
            <p className="text-xs text-gray-400 mt-1">
              {solution.file_content.length} حرف
            </p>
          </div>
        ))}
      </div>

      {/* الأزرار */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={handleEvaluate}
          disabled={isLoading}
          className={`px-6 py-3 rounded font-semibold transition ${
            isLoading
              ? 'bg-gray-600 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700'
          }`}
        >
          {isLoading ? '⏳ جاري التقييم...' : '✅ تقييم الحلول'}
        </button>
      </div>

      {/* الأخطاء */}
      {error && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-500 rounded">
          <p className="text-red-400">❌ {error}</p>
        </div>
      )}

      {/* النتائج */}
      {result && (
        <div className="mt-8 p-6 border-2 border-cyan-400 rounded-lg bg-cyan-900/20">
          <h2 className="text-2xl font-bold mb-6 text-cyan-300">📊 نتائج التقييم</h2>

          {/* الدرجة النهائية */}
          <div className="mb-6 p-4 bg-gray-800 rounded border border-cyan-500">
            <p className="text-sm text-gray-400 mb-1">الدرجة النهائية</p>
            <p className="text-4xl font-bold text-cyan-400">{result.final_grade}</p>
            <p className="text-sm text-gray-400 mt-2">
              عدد الملفات المُقيّمة: <span className="text-cyan-300 font-semibold">{result.files_evaluated}</span>
            </p>
          </div>

          {/* توزيع المعايير */}
          {result.file_distribution && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-4 text-purple-300">توزيع المعايير عبر الملفات</h3>
              <div className="grid gap-3">
                {Object.entries(result.file_distribution).map(([fileLabel, criteria]: [string, any]) => (
                  <div key={fileLabel} className="p-3 bg-gray-800 rounded border border-purple-500">
                    <p className="font-semibold text-cyan-300 mb-2">📁 {fileLabel}</p>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(criteria).map(([criterion, achieved]: [string, any]) => (
                        <span
                          key={criterion}
                          className={`px-2 py-1 rounded text-sm font-semibold ${
                            achieved
                              ? 'bg-green-900/30 text-green-400 border border-green-500'
                              : 'bg-red-900/30 text-red-400 border border-red-500'
                          }`}
                        >
                          {achieved ? '✅' : '❌'} {criterion}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* الملخص */}
          {result.consolidated_summary && (
            <div className="mb-6 p-4 bg-gray-800 rounded border border-purple-500">
              <h3 className="text-lg font-semibold mb-2 text-purple-300">📝 الملخص</h3>
              <p className="text-gray-300 leading-relaxed text-sm">{result.consolidated_summary}</p>
            </div>
          )}

          {/* تفاصيل المعايير */}
          {result.criteria && (
            <div>
              <h3 className="text-lg font-semibold mb-4 text-purple-300">تفاصيل المعايير</h3>
              <div className="space-y-3">
                {Object.entries(result.criteria).map(([criterion, details]: [string, any]) => (
                  <div key={criterion} className="p-3 bg-gray-800 rounded border border-gray-700">
                    <p className="font-semibold text-cyan-300 mb-1">{criterion}</p>
                    {details.reasoning && (
                      <p className="text-sm text-gray-300">{details.reasoning}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
