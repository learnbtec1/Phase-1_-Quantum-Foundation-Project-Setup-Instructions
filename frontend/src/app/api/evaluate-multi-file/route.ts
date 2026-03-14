import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface StudentSolutionFile {
  file_label: string;
  file_content: string;
  description?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const assignment_text = String(
      body?.assignment_text ??
      body?.assignmentText ??
      body?.assignmentBrief ??
      ''
    ).trim();

    const solutions: StudentSolutionFile[] = Array.isArray(body?.solutions) ? body.solutions : [];

    if (!assignment_text || assignment_text.length < 20) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: 'نص الواجب فارغ أو قصير جداً. يجب أن يكون 20 حرف على الأقل.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (solutions.length === 0) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: 'لا توجد ملفات حلول. يرجى رفع ملف إجابة واحد على الأقل.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Merge all uploaded files into a single student_text, labelled per file
    // No truncation here — the backend's extract_relevant_excerpt handles smart sampling
    // per criterion, so sending the full text is correct and necessary.
    const student_text = solutions
      .map((f) => {
        const label = f.file_label || 'ملف';
        const desc = f.description ? ` — ${f.description}` : '';
        return `=== ${label}${desc} ===\n${f.file_content}`;
      })
      .join('\n\n');

    if (student_text.replace(/=+.*?===/g, '').trim().length < 50) {
      return new Response(JSON.stringify({
        type: 'error',
        detail: 'محتوى الملفات قصير جداً أو فارغ. الحد الأدنى 50 حرف.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

    const backendResponse = await fetch(`${backendUrl}/api/v1/assessment/forensic-grade-v3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignment_text, student_text }),
    });

    const errorEnvelope = (msg: string) => ({
      success: true,
      data: {
        summary: { totalCriteria: 0, achievedCount: 0, achievedPercent: 0 },
        criteria: [],
        final_grade: 'ERROR',
        error_message: msg,
      },
      report: msg,
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('[evaluate-multi-file] backend error', backendResponse.status, errorText);
      let payload = errorEnvelope('تقييم غير متاح حالياً، يرجى المحاولة لاحقاً.');
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.final_grade === 'ERROR') {
          payload = errorEnvelope(parsed.summary || 'تقييم غير متاح حالياً.');
        }
      } catch { /* keep default */ }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }

    const result = await backendResponse.json();

    const rawCriteria = result.criteria_results || result.criteria || {};
    const criteriaArray = Object.entries(rawCriteria).map(([code, data]: [string, any]) => ({
      code,
      achieved: !!data.achieved,
      feedback: data.feedback || '',
      reasons: Array.isArray(data.reasons) ? data.reasons : (data.feedback ? [data.feedback] : []),
      evidence: Array.isArray(data.evidence)
        ? data.evidence
        : data.evidence_quote
          ? [{ quote: data.evidence_quote, start: data.start_index ?? 0, end: data.end_index ?? 0 }]
          : [],
      recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
    }));

    const achievedCount = criteriaArray.filter((c) => c.achieved).length;
    const totalCriteria = criteriaArray.length;

    // Return in the shape normalizeIntegratedResult() expects
    const responsePayload = {
      success: true,
      data: {
        summary: {
          totalCriteria,
          achievedCount,
          achievedPercent: totalCriteria > 0 ? Math.round((achievedCount / totalCriteria) * 100) : 0,
        },
        criteria: Object.fromEntries(criteriaArray.map((c) => [c.code, c])),
        final_grade: result.final_grade || 'PENDING',
        consolidated_summary: result.summary || '',
        evaluation_id: result.evaluation_id ?? undefined,
        ephemeral: result.ephemeral ?? undefined,
      },
      report: result.summary || '',
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });

  } catch (error: any) {
    console.error('[evaluate-multi-file] unexpected error', error.message);
    return new Response(JSON.stringify({
      type: 'error',
      detail: `خطأ في الخادم: ${error.message}`,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
