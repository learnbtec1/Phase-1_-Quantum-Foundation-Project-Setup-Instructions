import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300; 

export async function POST(req: NextRequest) {
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

    // التحقق من وجود البيانات قبل الإرسال
    if (!assignment_text || assignment_text.length < 20) {
      return new Response(JSON.stringify({ 
        type: "error", 
        detail: "نص الواجب فارغ أو قصير جداً. يجب أن يكون 20 حرف على الأقل." 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!student_text || student_text.length < 50) {
      return new Response(JSON.stringify({ 
        type: "error", 
        detail: `إجابة الطالب قصيرة جداً. الحد الأدنى 50 حرف. الطول الحالي: ${student_text.length}` 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const backendResponse = await fetch(`${backendUrl}/api/v1/assessment/forensic-grade-v3`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignment_text: assignment_text,
        student_text: student_text
      })
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('Backend Error Details:', {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        error: errorText
      });
      // Parse JSON if backend returned structured error (e.g. 503 with final_grade: ERROR)
      // Return 200 with error payload so frontend displays message instead of generic error
      let errorPayload: Record<string, unknown> = { type: "error", detail: errorText };
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.final_grade === "ERROR") {
          errorPayload = {
            success: true,
            data: {
              summary: { totalCriteria: 0, achievedCount: 0, achievedPercent: 0 },
              criteria: [],
              final_grade: "ERROR",
              error_message: parsed.summary || "تقييم غير متاح حالياً، يرجى المحاولة لاحقاً.",
            },
            report: parsed.summary || "تقييم غير متاح حالياً.",
          };
        }
      } catch {
        errorPayload = {
          success: true,
          data: {
            summary: { totalCriteria: 0, achievedCount: 0, achievedPercent: 0 },
            criteria: [],
            final_grade: "ERROR",
            error_message: "تقييم غير متاح حالياً، يرجى المحاولة لاحقاً.",
          },
          report: "خطأ في خدمة التقييم.",
        };
      }
      return new Response(JSON.stringify(errorPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
      });
    }

    const result = await backendResponse.json();

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
    console.error("Bridge Error:", {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    return new Response(JSON.stringify({ 
      type: "error",
      detail: `خطأ في الخادم: ${error.message}` 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}