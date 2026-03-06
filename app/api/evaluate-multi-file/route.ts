import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * تقييم متكامل لحلول متعددة الملفات
 * POST /api/evaluate-multi-file
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const assignment_text = String(
      body?.assignment_text ??
      body?.assignmentText ??
      body?.assignmentBrief ??
      ''
    ).trim();

    const solutions = body?.solutions ?? [];

    if (!assignment_text || assignment_text.length < 20) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: 'نص الواجب فارغ أو قصير جداً. يجب أن يكون 20 حرف على الأقل.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!Array.isArray(solutions) || solutions.length === 0) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: 'يجب إرسال ملف واحد على الأقل في مصفوفة solutions'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let totalLength = 0;
    for (let i = 0; i < solutions.length; i++) {
      const sol = solutions[i];

      if (!sol.file_label || typeof sol.file_label !== 'string') {
        return new Response(JSON.stringify({
          type: 'error',
          detail: `الملف رقم ${i + 1}: يجب توفير file_label (اسم الملف)`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!sol.file_content || typeof sol.file_content !== 'string') {
        return new Response(JSON.stringify({
          type: 'error',
          detail: `الملف "${sol.file_label}": يجب توفير file_content (محتوى الملف)`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (sol.file_content.length < 50) {
        return new Response(JSON.stringify({
          type: 'error',
          detail: `الملف "${sol.file_label}": المحتوى قصير جداً (${sol.file_content.length} حرف). الحد الأدنى 50 حرف.`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      totalLength += sol.file_content.length;
    }

    console.log(`📁 تم استقبال ${solutions.length} ملف(ات)`);
    console.log(`📊 إجمالي المحتوى: ${totalLength} حرف`);

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const backendResponse = await fetch(
      `${backendUrl}/api/v1/assessment/evaluate-multi-file`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignment_text, solutions })
      }
    );

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('❌ Backend Error:', {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        error: errorText
      });

      return new Response(JSON.stringify({
        type: 'error',
        detail: `خطأ من الخادم: ${errorText}`,
        status: backendResponse.status
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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
      type: 'error',
      detail: `خطأ غير متوقع: ${String(error)}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
