'use client';

import React, { useState } from 'react';

/**
 * صفحة اختبار المتكاملة لتقييم الملفات المتعددة
 * تتحقق من:
 * 1. أن الـ backend يستقبل الطلبات بشكل صحيح
 * 2. أن الـ frontend route يمرر البيانات بشكل صحيح
 * 3. أن النتيجة تأتي مع توزيع الملفات
 */

export default function TestMultiFileIntegration() {
  const [step, setStep] = useState<'input' | 'testing' | 'result'>('input');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  // بيانات الاختبار الافتراضية
  const testData = {
    assignment_text: `
الواجب: قارن بين منصتي TalkMateAI و Phase-1 (Quantum Foundation)
المطلوب:
- P1: صف كل منصة بالتفصيل
- M1: حلل الفروقات بين المنصتين
- D1: قيّم كيف يمكن دمج المنصتين معاً

شرط: يجب مقارنة منصتين على الأقل
    `,
    solutions: [
      {
        file_label: 'TalkMateAI',
        file_content: `
منصة TalkMateAI:

1. الوصف:
TalkMateAI هي منصة تواصل ذكية تستخدم الذكاء الاصطناعي لتحسين التفاعل بين المستخدمين.
المنصة توفر واجهة سهلة الاستخدام وتدعم التواصل الفوري والمحادثات الذكية.

2. المميزات:
- معالجة اللغة الطبيعية المتقدمة
- دعم تعدد اللغات بما فيها العربية
- واجهة تفاعلية وسهلة التعلم
- تكامل مع الأنظمة الأخرى

3. البنية التحتية:
- Frontend: بناء على React و Next.js
- Backend: استخدام FastAPI
- قاعدة بيانات: MongoDB
- معالجة النصوص: OpenAI API

4. الاستخدام:
المنصة موجهة للشركات والمؤسسات التي تريد تحسين التواصل مع عملائها.
        `,
        description: 'وصف تفصيلي لمنصة TalkMateAI'
      },
      {
        file_label: 'Phase-1 (Quantum Foundation)',
        file_content: `
منصة Phase-1 - Quantum Foundation:

1. الوصف:
Phase-1 هو مشروع تعليمي متقدم يركز على أسس الحوسبة الكمية والذكاء الاصطناعي.
المشروع يوفر بيئة تعلم شاملة مع أدوات تفاعلية وحاكيات متقدمة.

2. المميزات:
- محاكاة الأنظمة الكمية
- أدوات تعليمية متفاعلة
- مكتبة ضخمة من الخوارزميات
- دعم البحث العلمي والتطوير

3. البنية التحتية:
- Frontend: Next.js 14+ مع Three.js للعرض ثلاثي الأبعاد
- Backend: FastAPI و Express.js
- قاعدة بيانات: Azure Cosmos DB
- معالجة البيانات: Python مع NumPy و Pandas

4. الاستخدام:
في الأساس موجهة للطلاب والباحثين الذين يريدون التعمق في الحوسبة المتقدمة.
        `,
        description: 'وصف تفصيلي لمشروع Quantum Foundation'
      }
    ]
  };

  const handleTest = async () => {
    setStep('testing');
    setError('');
    setResult(null);

    try {
      console.log('📤 إرسال طلب تقييم متعدد الملفات...');
      console.log(`📁 عدد الملفات: ${testData.solutions.length}`);
      console.log('📋 الملفات:', testData.solutions.map(s => s.file_label));

      const response = await fetch('/api/evaluate-multi-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignment_text: testData.assignment_text,
          solutions: testData.solutions
        }),
      });

      console.log(`📥 رمز الحالة: ${response.status}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`HTTP ${response.status}: ${errorData.detail || 'خطأ غير معروف'}`);
      }

      const result = await response.json();
      console.log('✅ تم استقبال النتيجة:', result);

      setResult({
        ...result,
        metadata: {
          filesCount: testData.solutions.length,
          timestamp: new Date().toLocaleString('ar-EG')
        }
      });

      setStep('result');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('❌ خطأ:', errorMessage);
      setError(errorMessage);
      setStep('result');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto rtl" dir="rtl">
      <h1 className="text-4xl font-bold mb-2 text-cyan-400">🧪 اختبار نظام التقييم المتكامل</h1>
      <p className="text-gray-400 mb-6">التحقق من عمل تقييم الملفات المتعددة</p>

      {step === 'input' && (
        <div className="space-y-6">
          {/* معلومات الاختبار */}
          <div className="p-6 bg-gray-900/50 border border-cyan-500 rounded-lg">
            <h2 className="text-xl font-semibold mb-4 text-cyan-300">📋 بيانات الاختبار</h2>
            
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-purple-300 mb-2">الواجب:</h3>
              <div className="p-3 bg-gray-800 rounded border border-gray-700 text-sm text-gray-300 whitespace-pre-wrap">
                {testData.assignment_text.trim()}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-purple-300 mb-2">الملفات المراد تقييمها:</h3>
              <div className="grid gap-3">
                {testData.solutions.map((sol, idx) => (
                  <div key={idx} className="p-4 bg-gray-800 rounded border border-purple-500">
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-semibold text-cyan-300">📁 {sol.file_label}</p>
                      <span className="text-xs text-gray-400">
                        {sol.file_content.length} حرف
                      </span>
                    </div>
                    <p className="text-gray-400 text-xs mb-2">{sol.description}</p>
                    <div className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-3">
                      {sol.file_content.trim().substring(0, 200)}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* الخطوات */}
          <div className="p-6 bg-gray-900/50 border border-purple-500 rounded-lg">
            <h2 className="text-lg font-semibold mb-4 text-purple-300">⚙️ الخطوات التي ستتم:</h2>
            <ol className="space-y-2 text-sm text-gray-300">
              <li>✅ 1. إرسال الواجب وملفات الحل إلى الـ Frontend Route: `/api/evaluate-multi-file`</li>
              <li>✅ 2. التحقق من صحة البيانات وتنسيقها</li>
              <li>✅ 3. إعادة توجيه الطلب إلى الـ Backend: `/api/v1/assessment/evaluate-multi-file`</li>
              <li>✅ 4. دمج الملفات معاً قبل التقييم</li>
              <li>✅ 5. استخراج المعايير واستدعاء GPT-4o-mini</li>
              <li>✅ 6. إرجاع النتيجة مع توزيع المعايير لكل ملف</li>
            </ol>
          </div>

          {/* زر البدء */}
          <button
            onClick={handleTest}
            className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 rounded-lg font-bold text-lg transition transform hover:scale-105"
          >
            🚀 ابدأ الاختبار
          </button>
        </div>
      )}

      {step === 'testing' && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin mb-4">
            <div className="text-4xl">⏳</div>
          </div>
          <p className="text-lg text-cyan-300 font-semibold">جاري تقييم الملفات...</p>
          <p className="text-sm text-gray-400 mt-2">يرجى الانتظار حتى ننهي التقييم</p>
        </div>
      )}

      {step === 'result' && (
        <div className="space-y-6">
          {error ? (
            <div className="p-6 bg-red-900/20 border border-red-500 rounded-lg">
              <h2 className="text-xl font-bold text-red-400 mb-3">❌ حدث خطأ!</h2>
              <div className="bg-red-900/10 p-4 rounded border border-red-700 font-mono text-sm text-red-300 overflow-auto max-h-48">
                {error}
              </div>
              <button
                onClick={() => setStep('input')}
                className="mt-4 px-6 py-2 bg-red-600 hover:bg-red-700 rounded font-semibold transition"
              >
                ← العودة
              </button>
            </div>
          ) : result ? (
            <div className="space-y-6">
              {/* النتيجة النهائية */}
              <div className="p-8 bg-gradient-to-br from-cyan-900/30 to-purple-900/30 border-2 border-cyan-400 rounded-lg text-center">
                <p className="text-sm text-gray-400 mb-2">النتيجة النهائية</p>
                <p className="text-6xl font-bold text-cyan-300 mb-2">
                  {result.final_grade || '❓'}
                </p>
                <p className="text-lg text-purple-300">
                  ✅ تم تقييم <span className="font-bold">{result.files_evaluated}</span> ملف(ات)
                </p>
              </div>

              {/* التفاصيل */}
              {result.file_distribution && (
                <div className="p-6 bg-gray-900/50 border border-purple-500 rounded-lg">
                  <h2 className="text-xl font-bold mb-4 text-purple-300">📊 توزيع المعايير</h2>
                  <div className="grid gap-4">
                    {Object.entries(result.file_distribution).map(([file, criteria]: [string, any]) => (
                      <div key={file} className="p-4 border border-cyan-500 rounded bg-gray-800">
                        <p className="font-bold text-cyan-300 mb-3">📁 {file}</p>
                        <div className="flex gap-2 flex-wrap">
                          {Object.entries(criteria).map(([crit, achieved]: [string, any]) => (
                            <span
                              key={crit}
                              className={`px-3 py-1 rounded font-semibold text-sm ${
                                achieved
                                  ? 'bg-green-900/40 text-green-400 border border-green-500'
                                  : 'bg-red-900/40 text-red-400 border border-red-500'
                              }`}
                            >
                              {achieved ? '✅' : '❌'} {crit}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ملخص */}
              {result.consolidated_summary && (
                <div className="p-6 bg-gray-900/50 border border-cyan-500 rounded-lg">
                  <h2 className="text-lg font-bold mb-3 text-cyan-300">💬 التقييم</h2>
                  <p className="text-gray-300 leading-relaxed text-sm">
                    {result.consolidated_summary}
                  </p>
                </div>
              )}

              {/* البيانات الوصفية */}
              <div className="p-4 bg-gray-900/50 border border-gray-600 rounded text-xs text-gray-400">
                <p>⏰ التاريخ والوقت: {result.metadata.timestamp}</p>
                <p>📁 عدد الملفات: {result.metadata.filesCount}</p>
              </div>

              {/* أزرار العودة */}
              <button
                onClick={() => setStep('input')}
                className="w-full py-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-700 hover:to-purple-700 rounded-lg font-semibold transition"
              >
                ← إجراء اختبار جديد
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
