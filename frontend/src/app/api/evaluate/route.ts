import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ERROR_PAYLOAD = (msg: string) => ({
  success: true,
  data: {
    summary: { totalCriteria: 0, achievedCount: 0, achievedPercent: 0 },
    criteria: [] as unknown[],
    final_grade: 'ERROR',
  },
  report: msg,
});

export async function POST(req: NextRequest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 290_000);

  try {
    const body = await req.json();

    // 🛡️ تطهير وتوحيد البيانات (Canonical Normalization)
    const assignment_text = String(
      body?.assignment_text ??
      body?.assignmentText ??
      body?.assignmentBrief ??
      ''
    ).trim();

    const student_text = String(
      body?.student_text ??
      body?.studentText ??
      body?.studentAnswer ??
      ''
    ).trim();

    if (!assignment_text || assignment_text.length < 20) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: 'نص الواجب فارغ أو قصير جداً. يجب أن يكون 20 حرف على الأقل.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!student_text || student_text.length < 50) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: `إجابة الطالب قصيرة جداً. الحد الأدنى 50 حرف. الطول الحالي: ${student_text.length}`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const backendResponse = await fetch(`${backendUrl}/api/v1/assessment/forensic-grade-v3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignment_text, student_text }),
      signal: controller.signal,
    });

    // Always parse as JSON (backend always returns JSON, even on 503)
    let result: any;
    try {
      result = await backendResponse.json();
    } catch {
      console.error('Backend returned non-JSON response, status:', backendResponse.status);
      return new Response(JSON.stringify(ERROR_PAYLOAD('فشل تحليل رد الخادم. يرجى المحاولة لاحقاً.')), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }

    // Handle all error/non-OK cases in one place
    if (!backendResponse.ok || result?.final_grade === 'ERROR') {
      const msg = typeof result?.summary === 'string' && result.summary
        ? result.summary
        : typeof result?.detail === 'string' && result.detail
          ? result.detail
          : 'تقييم غير متاح حالياً. يرجى التحقق من إعدادات API والمحاولة لاحقاً.';
      console.error('Backend evaluation error:', { status: backendResponse.status, msg });
      return new Response(JSON.stringify(ERROR_PAYLOAD(msg)), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }

    // Build criteria array from backend response
    const rawCriteria = result.criteria_results || result.criteria || {};
    const criteriaArray = Object.entries(rawCriteria).map(([code, data]: [string, any]) => ({
      code,
      verdict: data.achieved ? 'Achieved' : 'Not Achieved',
      reasons: Array.isArray(data.reasons) ? data.reasons : (data.feedback ? [data.feedback] : []),
      evidence: Array.isArray(data.evidence) ? data.evidence : (data.evidence_quote ? [{ quote: data.evidence_quote, start: data.start_index ?? 0, end: data.end_index ?? 0 }] : []),
      recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
    }));

    const achievedCount = criteriaArray.filter((c: any) => c.verdict === 'Achieved').length;
    const totalCriteria = criteriaArray.length;

    const responsePayload = {
      success: true,
      data: {
        summary: {
          totalCriteria,
          achievedCount,
          achievedPercent: totalCriteria > 0 ? Math.round((achievedCount / totalCriteria) * 100) : 0,
        },
        criteria: criteriaArray,
        final_grade: result.final_grade || 'PENDING',
      },
      report: result.summary || '',
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error: any) {
    const isAbort = error?.name === 'AbortError';
    const msg = isAbort
      ? 'انتهت مهلة الاتصال (5 دقائق). يرجى المحاولة لاحقاً.'
      : `خطأ في الخادم: ${error?.message ?? 'خطأ غير معروف'}`;
    console.error('Bridge Error:', { message: error?.message, timestamp: new Date().toISOString() });
    return new Response(JSON.stringify(ERROR_PAYLOAD(msg)), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  } finally {
    clearTimeout(timeout);
  }
}