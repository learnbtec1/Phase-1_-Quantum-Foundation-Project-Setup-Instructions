import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300; 

/**
 * تقييم متكامل لحلول متعددة الملفات
 * POST /api/evaluate-multi-file
 * 
 * الطلب:
 * {
 *   "assignment_text": "الواجب...",
 *   "solutions": [
 *     {
 *       "file_label": "ملف 1",
 *       "file_content": "محتوى...",
 *       "description": "وصف (اختياري)"
 *     },
 *     {
 *       "file_label": "ملف 2", 
 *       "file_content": "محتوى...",
 *       "description": "وصف (اختياري)"
 *     }
 *   ]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 📄 استخراج الواجب
    const assignment_text = String(
      body?.assignment_text ?? 
      body?.assignmentText ?? 
      body?.assignmentBrief ?? 
      ''
    ).trim();

    // 📁 استخراج الملفات المتعددة
    const solutions = body?.solutions ?? [];

    // ✅ التحقق من صحة البيانات
    if (!assignment_text || assignment_text.length < 20) {
      return new Response(JSON.stringify({ 
        type: "error", 
        detail: "نص الواجب فارغ أو قصير جداً. يجب أن يكون 20 حرف على الأقل." 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!Array.isArray(solutions) || solutions.length === 0) {
      return new Response(JSON.stringify({ 
        type: "error", 
        detail: "يجب إرسال ملف واحد على الأقل في مصفوفة solutions" 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ✅ التحقق من كل ملف
    let total_length = 0;
    for (let i = 0; i < solutions.length; i++) {
      const sol = solutions[i];
      
      if (!sol.file_label || typeof sol.file_label !== 'string') {
        return new Response(JSON.stringify({ 
          type: "error", 
          detail: `الملف رقم ${i + 1}: يجب توفير file_label (اسم الملف)` 
        }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!sol.file_content || typeof sol.file_content !== 'string') {
        return new Response(JSON.stringify({ 
          type: "error", 
          detail: `الملف "${sol.file_label}": يجب توفير file_content (محتوى الملف)` 
        }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (sol.file_content.length < 50) {
        return new Response(JSON.stringify({ 
          type: "error", 
          detail: `الملف "${sol.file_label}": المحتوى قصير جداً (${sol.file_content.length} حرف). الحد الأدنى 50 حرف.` 
        }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      total_length += sol.file_content.length;
    }

    console.log(`📁 تم استقبال ${solutions.length} ملف(ات)`);
    console.log(`📊 إجمالي المحتوى: ${total_length} حرف`);

    // 🚀 إرسال الطلب للـ backend
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    
    console.log(`🔗 إرسال إلى: ${backendUrl}/api/v1/assessment/evaluate-multi-file`);
    
    const backendResponse = await fetch(
      `${backendUrl}/api/v1/assessment/evaluate-multi-file`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_text: assignment_text,
          solutions: solutions
        })
      }
    );

    // 📊 معالجة الرد
    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('❌ Backend Error:', {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        error: errorText
      });

      return new Response(JSON.stringify({ 
        type: "error", 
        detail: `خطأ من الخادم: ${errorText}`,
        status: backendResponse.status
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ✅ نجاح HTTP - تحقق من أخطاء التطبيق
    const result = await backendResponse.json();

    if (result?.error) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: result?.message || result?.error,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`✅ تقييم متكامل مكتمل - النتيجة: ${result.final_grade}`);

    // تحويل النتيجة لصيغة التوافقية مع الـ frontend القديم (إذا لزم الأمر)
    return new Response(JSON.stringify({
      success: true,
      data: result,
      final_grade: result.final_grade,
      files_evaluated: result.files_evaluated
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(JSON.stringify({ 
      type: "error", 
      detail: `خطأ غير متوقع: ${String(error)}`
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
