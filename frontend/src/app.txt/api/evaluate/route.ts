import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 دقائق

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 290000); 

    try {
        // نرسل نص الواجب كما هو ليستخرج منه البايثون المعايير
        const subjectHeader = body.selectedSubject ? `SUBJECT TOPIC: ${body.selectedSubject}\n` : '';
        const finalAssignmentText = `${subjectHeader}\n=== ASSIGNMENT BRIEF (RUBRIC SOURCE) ===\n${body.assignmentContext || 'No Assignment Brief Provided'}`;

        const response = await fetch('http://127.0.0.1:8000/api/v1/assessment/grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignment_text: finalAssignmentText,
                student_text: body.studentAnswer
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Python Error: ${errorText}`);
        }

        const pythonResult = await response.json();

        // تحويل البيانات
        const criteriaList = Object.entries(pythonResult.criteria).map(([code, data]: any) => ({
            code: code,
            verdict: data.achieved ? "Achieved" : "Not Achieved",
            reasons: [data.feedback || "لم يتم تقديم سبب محدد."],
            evidence: (data.evidence_quote && data.evidence_quote !== "No evidence") 
                ? [{ quote: data.evidence_quote, start: data.start_index || 0, end: data.end_index || 0 }] 
                : [],
            recommendations: !data.achieved ? ["يرجى مراجعة المعيار وتحسين الأدلة."] : []
        }));

        const achievedCount = criteriaList.filter(c => c.verdict === "Achieved").length;
        
        return NextResponse.json({
            success: true,
            data: {
                summary: {
                    totalCriteria: criteriaList.length,
                    achievedCount: achievedCount,
                    achievedPercent: criteriaList.length > 0 ? Math.round((achievedCount / criteriaList.length) * 100) : 0
                },
                criteria: criteriaList,
                final_grade: pythonResult.final_grade
            },
            report: pythonResult.summary
        });

    } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') throw new Error("انتهت مهلة التحليل.");
        throw fetchError;
    }

  } catch (error: any) {
    console.error("Bridge Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}