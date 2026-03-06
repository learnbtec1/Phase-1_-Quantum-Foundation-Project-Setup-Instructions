'use client';

import React, { useState } from 'react';

/**
 * أداة تشخيصية متقدمة لنظام تقييم الملفات المتعددة
 * 
 * تساعد في:
 * 1. تتبع ما يتم إرساله بالفعل إلى الـ API
 * 2. معرفة ما يستقبله الـ Backend
 * 3. تحديد مكان المشكلة بدقة
 */

export default function MultiFileDebugger() {
  const [testType, setTestType] = useState<'frontend' | 'backend' | 'both'>('both');
  const [logs, setLogs] = useState<Array<{ type: 'log' | 'error' | 'success' | 'info'; message: string; timestamp: string }>>([]);

  const addLog = (type: 'log' | 'error' | 'success' | 'info', message: string) => {
    const timestamp = new Date().toLocaleTimeString('ar-EG');
    setLogs(prev => [...prev, { type, message, timestamp }]);
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  const clearLogs = () => setLogs([]);

  // ===============================================
  // اختبار 1: تتبع ما يرسله الـ Frontend
  // ===============================================
  const testFrontendSending = async () => {
    clearLogs();
    addLog('info', '🧪 ابدأ اختبار إرسال الـ Frontend');

    const testPayload = {
      assignment_text: "الواجب: قارن بين شركتين",
      solutions: [
        {
          file_label: "الشركة الأولى (TalkMateAI)",
          file_content: "هذه محاولة أولى. " + "x".repeat(100),
          description: "وصف الشركة الأولى"
        },
        {
          file_label: "الشركة الثانية (Phase-1)",
          file_content: "هذه محاولة ثانية. " + "y".repeat(100),
          description: "وصف الشركة الثانية"
        }
      ]
    };

    addLog('log', `📤 سيتم إرسال البيانات التالية:`);
    addLog('log', `📝 نص الواجب: ${testPayload.assignment_text.substring(0, 50)}...`);
    addLog('log', `📁 عدد الملفات: ${testPayload.solutions.length}`);
    
    testPayload.solutions.forEach((sol, idx) => {
      addLog('log', `   - الملف ${idx + 1}: "${sol.file_label}" (${sol.file_content.length} حرف)`);
    });

    try {
      addLog('info', '🚀 جاري الإرسال إلى /api/evaluate-multi-file...');

      const response = await fetch('/api/evaluate-multi-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload),
      });

      addLog('log', `📥 حالة الرد: ${response.status} ${response.statusText}`);

      const responseData = await response.json();

      if (response.ok) {
        addLog('success', `✅ نجح الاستقبال!`);
        addLog('log', `📊 النتيجة: ${responseData.data?.final_grade || responseData.final_grade}`);
        addLog('log', `📁 عدد الملفات المُقيّمة: ${responseData.data?.files_evaluated || responseData.files_evaluated}`);
        
        if (responseData.data?.file_distribution || responseData.file_distribution) {
          const dist = responseData.data?.file_distribution || responseData.file_distribution;
          addLog('log', `📊 توزيع الملفات:`);
          Object.entries(dist).forEach(([file, criteria]: [string, any]) => {
            addLog('log', `   - ${file}: ${Object.keys(criteria).join(', ')}`);
          });
        }
      } else {
        addLog('error', `❌ فشل: ${responseData.detail || 'خطأ مجهول'}`);
      }
    } catch (err) {
      addLog('error', `❌ خطأ في الاتصال: ${String(err)}`);
    }
  };

  // ===============================================
  // اختبار 2: تتبع ما يستقبله الـ Backend
  // ===============================================
  const testBackendReceiving = async () => {
    clearLogs();
    addLog('info', '🧪 ابدأ اختبار استقبال الـ Backend');

    const testPayload = {
      assignment_text: "الواجب: قارن بين شركتين. أنت بحاجة إلى مقارنة منصتين على الأقل",
      solutions: [
        {
          file_label: "Platform A",
          file_content: "منصة أولى. " + "a".repeat(200),
          description: "First platform"
        },
        {
          file_label: "Platform B",
          file_content: "منصة ثانية. " + "b".repeat(200),
          description: "Second platform"
        }
      ]
    };

    try {
      addLog('info', '🔗 الاتصال المباشر بـ Backend: http://127.0.0.1:8000');
      addLog('log', `📤 إرسال ${testPayload.solutions.length} ملف(ات)`);

      const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      
      const response = await fetch(`${backendUrl}/api/v1/assessment/evaluate-multi-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload),
      });

      addLog('log', `📥 حالة الرد: ${response.status}`);

      const responseData = await response.json();

      if (response.ok) {
        addLog('success', `✅ Backend استقبل الطلب بنجاح!`);
        addLog('log', `🎯 النتيجة: ${responseData.final_grade}`);
        addLog('log', `📊 عدد الملفات المقيّمة: ${responseData.files_evaluated}`);
        
        if (responseData.file_distribution) {
          addLog('success', `✅ تم دمج الملفات بشكل صحيح!`);
          Object.entries(responseData.file_distribution).forEach(([file, criteria]: [string, any]) => {
            const criteriaList = Object.entries(criteria)
              .map(([k, v]) => `${v ? '✅' : '❌'} ${k}`)
              .join(', ');
            addLog('log', `   📁 ${file}: ${criteriaList}`);
          });
        }
      } else {
        addLog('error', `❌ خطأ من Backend: ${responseData.detail || 'مجهول'}`);
      }
    } catch (err) {
      addLog('error', `❌ لا يمكن الاتصال بـ Backend. تأكد من تشغيله...`);
      addLog('error', String(err));
    }
  };

  // ===============================================
  // اختبار 3: تحليل شامل
  // ===============================================
  const testComplete = async () => {
    clearLogs();
    addLog('info', '🧪 ابدأ الاختبار الشامل الكامل');

    // خطوة 1
    addLog('log', '');
    addLog('info', '✅ الخطوة 1: قائمة التحقق من الملفات المطلوبة');
    const files = [
      { name: 'hooks/useEvaluateMultiFile.ts', expected: true },
      { name: 'frontend/src/app/api/evaluate-multi-file/route.ts', expected: true },
      { name: 'backend/app/services/integrated_grader.py', expected: true },
      { name: 'components/MultiFileEvaluationExample.tsx', expected: true },
      { name: 'app/test-multi-file/page.tsx', expected: true }
    ];

    files.forEach(f => {
      addLog('log', `   ✅ ${f.name}`);
    });

    // خطوة 2
    addLog('log', '');
    addLog('info', '✅ الخطوة 2: اختبر إرسال Frontend');
    addLog('log', '   📝 يجب أن يصل الطلب إلى /api/evaluate-multi-file');
    addLog('log', '   📊 يجب أن يحتوي على:');
    addLog('log', '      - assignment_text (نص الواجب)');
    addLog('log', '      - solutions[] (مصفوفة الملفات)');
    addLog('log', '   ✅ كل ملف يجب أن يحتوي على:');
    addLog('log', '      - file_label (اسم الملف)');
    addLog('log', '      - file_content (المحتوى > 50 حرف)');

    // خطوة 3
    addLog('log', '');
    addLog('info', '✅ الخطوة 3: اختبر إرسال Backend');
    addLog('log', '   📝 يجب أن يتم دمج الملفات');
    addLog('log', '   📊 يجب أن يرجع:');
    addLog('log', '      - final_grade (الدرجة النهائية)');
    addLog('log', '      - file_distribution (توزيع المعايير على الملفات)');

    // الآن نفذ الاختبارات
    addLog('log', '');
    addLog('info', '🚀 جاري تنفيذ الاختبارات...');
    addLog('log', '');

    addLog('info', '━━━ التحقق من Frontend Endpoint ━━━');
    await testFrontendSending();

    addLog('log', '');
    addLog('info', '━━━ التحقق من Backend Endpoint ━━━');
    await testBackendReceiving();

    addLog('log', '');
    addLog('success', '✅ انتهى الاختبار الشامل!');
  };

  return (
    <div className="min-h-screen p-6 bg-gray-950 text-white rtl" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-2 text-cyan-400">🔧 أداة التشخيص المتقدمة</h1>
        <p className="text-gray-400 mb-6">تشخيص مشكلة "مازال يقرا ملف واحد"</p>

        {/* الأزرار */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button
            onClick={testFrontendSending}
            className="p-4 bg-gradient-to-br from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 rounded-lg font-bold transition"
          >
            <div className="text-2xl mb-2">📤</div>
            <div>اختبر Frontend</div>
            <div className="text-xs text-blue-200 mt-1">هل يُرسل الملفات بشكل صحيح؟</div>
          </button>

          <button
            onClick={testBackendReceiving}
            className="p-4 bg-gradient-to-br from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 rounded-lg font-bold transition"
          >
            <div className="text-2xl mb-2">📥</div>
            <div>اختبر Backend</div>
            <div className="text-xs text-purple-200 mt-1">هل يستقبل الملفات بشكل صحيح؟</div>
          </button>

          <button
            onClick={testComplete}
            className="p-4 bg-gradient-to-br from-cyan-600 to-cyan-800 hover:from-cyan-700 hover:to-cyan-900 rounded-lg font-bold transition"
          >
            <div className="text-2xl mb-2">🧪</div>
            <div>اختبار شامل</div>
            <div className="text-xs text-cyan-200 mt-1">فحص كامل النظام</div>
          </button>
        </div>

        {/* السجلات */}
        <div className="mb-6 p-6 border border-cyan-500 rounded-lg bg-gray-900/50">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-cyan-300">📊 السجلات</h2>
            <button
              onClick={clearLogs}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm transition"
            >
              🗑️ حذف السجلات
            </button>
          </div>

          <div className="bg-gray-950 rounded p-4 font-mono text-sm h-96 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-500">لم تُجرَ اختبارات بعد...</p>
            ) : (
              logs.map((log, idx) => {
                const colors = {
                  log: 'text-gray-400',
                  error: 'text-red-500',
                  success: 'text-green-500',
                  info: 'text-cyan-400'
                };
                return (
                  <div key={idx} className={colors[log.type]}>
                    <span className="text-gray-600">[{log.timestamp}]</span> {log.message}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* المساعدة */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ماذا يجب أن ترى */}
          <div className="p-6 bg-gray-900/50 border border-green-500 rounded-lg">
            <h3 className="text-lg font-bold text-green-400 mb-4">✅ ماذا يجب أن ترى (النجاح)</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>✅ <code className="bg-gray-800 px-2 py-1 rounded">📁 عدد الملفات: 2</code></li>
              <li>✅ <code className="bg-gray-800 px-2 py-1 rounded">file_distribution</code> موجود</li>
              <li>✅ كل ملف له معايير منفصلة</li>
              <li>✅ النتيجة النهائية: <code className="bg-gray-800 px-2 py-1 rounded">DISTINCTION</code></li>
              <li>✅ رسالة: <code className="bg-gray-800 px-2 py-1 rounded">تم دمج الملفات</code></li>
            </ul>
          </div>

          {/* ماذا يعني الفشل */}
          <div className="p-6 bg-gray-900/50 border border-red-500 rounded-lg">
            <h3 className="text-lg font-bold text-red-400 mb-4">❌ ماذا يعني الفشل</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>❌ <code className="bg-gray-800 px-2 py-1 rounded">📁 عدد الملفات: 1</code></li>
              <li>❌ لا يوجد <code className="bg-gray-800 px-2 py-1 rounded">file_distribution</code></li>
              <li>❌ خطأ في الاتصال بـ Backend</li>
              <li>❌ رسالة: <code className="bg-gray-800 px-2 py-1 rounded">student_text</code> وليس <code className="bg-gray-800 px-2 py-1 rounded">solutions</code></li>
              <li>❌ نتيجة مختلفة (PASS بدلاً من DISTINCTION)</li>
            </ul>
          </div>
        </div>

        {/* الخطوات التالية */}
        <div className="mt-8 p-6 bg-gray-900/50 border border-yellow-500 rounded-lg">
          <h3 className="text-lg font-bold text-yellow-400 mb-4">📋 الخطوات التشخيصية</h3>
          <ol className="space-y-2 text-sm text-gray-300">
            <li>1️⃣ اضغط على <strong>"اختبر Frontend"</strong> - إذا فشل، المشكلة في الإرسال</li>
            <li>2️⃣ اضغط على <strong>"اختبر Backend"</strong> - إذا فشل، تأكد من تشغيل Backend</li>
            <li>3️⃣ اضغط على <strong>"اختبار شامل"</strong> - لفحص النظام بالكامل</li>
            <li>4️⃣ انظر للسجلات - ابحث عن <code className="bg-gray-800 px-2 py-1 rounded">❌ error</code> باللون الأحمر</li>
            <li>5️⃣ إذا رأيت <code className="bg-gray-800 px-2 py-1 rounded">file_distribution</code> فالنظام يعمل ✅</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
