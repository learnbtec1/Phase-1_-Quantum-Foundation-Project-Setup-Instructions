import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { initVectorDB } from "@/lib/ai/vectorDB";

// استيراد المكتبات التي قمت برفعها
import { createEvaluationFingerprint } from '@/lib/evaluation/fingerprint';
import { locateEvidence, prepareEvidence } from '@/lib/evaluation/evidence';
import { generateTextReport } from '@/lib/evaluation/report';
import { nowISO } from '@/lib/evaluation/helpers';
import type { FullEvaluation, EvaluationCriterion } from '@/lib/evaluation/compare';

// إعدادات وقت التشغيل
export const runtime = 'nodejs';
export const maxDuration = 60; // السماح بدقيقة كاملة للمعالجة لأن التحليل قد يكون طويلاً

// التحقق من المدخلات باستخدام Zod
const requestSchema = z.object({
  assignmentId: z.string(),
  studentId: z.string(),
  rubricId: z.string(),
  rubricVersion: z.string().default('1.0'),
  studentAnswer: z.string().min(50, "الإجابة قصيرة جداً للتقييم"),
  rubricCriteria: z.array(z.object({
    code: z.string(),
    title: z.string(),
    description: z.string(),
  })).min(1, "يجب توفر معايير للتقييم"),
  assignmentContext: z.string().optional(), // سياق الواجب (اختياري)
});

export async function POST(req: NextRequest) {
  try {
    // 1. التحقق من المدخلات
    const body = await req.json();
    const validation = requestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'بيانات غير صالحة', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { 
      assignmentId, 
      studentId, 
      rubricId, 
      rubricVersion, 
      studentAnswer, 
      rubricCriteria, 
      assignmentContext 
    } = validation.data;

    // 2. التحقق من مفتاح API
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'مفتاح OpenAI غير موجود في إعدادات الخادم' }, { status: 500 });
    }

    // 3. تجهيز "البصمة الرقمية" للتقييم (Fingerprint)
    // نستخدم المكتبة التي رفعتها للتأكد من هوية المدخلات
    const fingerprint = createEvaluationFingerprint({
      studentAnswer,
      evidence: [], // في البداية لا يوجد أدلة
      rubricId,
      rubricVersion,
      systemPrompt: "BTEC_EVALUATOR_V1", // معرف ثابت للبرومبت
      criteriaCodes: rubricCriteria.map(c => c.code)
    });

    // *ملاحظة:* هنا يمكنك إضافة كود للتحقق من قاعدة البيانات
    // إذا كان هذا الـ fingerprint موجوداً مسبقاً، يمكنك إرجاع النتيجة المحفوظة فوراً وتوفير التكلفة.

    // 4. بناء التلقين (System Prompt) للذكاء الاصطناعي
    const systemPrompt = `
    You are an expert academic evaluator for BTEC vocational qualifications.
    Your task is to evaluate the "Student Answer" based strictly on the provided "Rubric Criteria".

    INSTRUCTIONS:
    1. Analyze the student answer deeply.
    2. For each criterion, determine a verdict: "Achieved" or "Not Achieved".
    3. Extract exact quotes from the text as evidence.
    4. Provide reasoning for your verdict.
    5. Provide specific recommendations for improvement.

    OUTPUT FORMAT:
    You must output a SINGLE valid JSON object (no markdown) matching this structure:
    {
      "criteria": [
        {
          "code": "Criterion Code (e.g., P1)",
          "verdict": "Achieved" | "Not Achieved",
          "reasons": ["reason 1", "reason 2"],
          "evidence_quotes": ["exact quote from text 1", "exact quote 2"],
          "recommendations": ["rec 1", "rec 2"]
        }
      ]
    }
    
    IMPORTANT: The "evidence_quotes" must be copied EXACTLY text-for-text from the student answer so we can locate them programmatically.
    `;

    const userPrompt = JSON.stringify({
      context: assignmentContext || "No specific context provided",
      rubric: rubricCriteria,
      student_answer: studentAnswer
    });

    // 5. الاتصال بـ OpenAI
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o', // أو gpt-3.5-turbo حسب ميزانيتك
      temperature: 0, // درجة حرارة صفر لضمان الدقة والصرامة
      response_format: { type: "json_object" },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const aiResult = JSON.parse(content);

    // 6. معالجة النتائج وربط الأدلة (استخدام evidence.ts)
    // الذكاء الاصطناعي يعطينا "النص" فقط، ونحن نستخدم evidence.ts لتحديد "المكان" (start/end)
    
    let totalCriteria = rubricCriteria.length;
    let achievedCount = 0;

    const processedCriteria: EvaluationCriterion[] = aiResult.criteria.map((aiCrit: any) => {
      // حساب الإنجاز
      if (aiCrit.verdict === "Achieved") achievedCount++;

      // معالجة الأدلة: تحويل النصوص إلى كائنات تحتوي على الموقع
      const processedEvidence = (aiCrit.evidence_quotes || []).map((quote: string) => {
        const location = locateEvidence(studentAnswer, quote);
        return {
          quote: quote,
          start: location.start,
          end: location.end
        };
      }).filter((e: any) => e.start !== -1); // استبعاد الأدلة التي لم يتم العثور عليها بدقة

      return {
        code: aiCrit.code,
        verdict: aiCrit.verdict,
        reasons: aiCrit.reasons || [],
        evidence: processedEvidence,
        recommendations: aiCrit.recommendations || []
      };
    });

    // 7. بناء كائن التقييم الكامل (FullEvaluation) حسب compare.ts
    const fullEvaluation: FullEvaluation = {
      summary: {
        totalCriteria,
        achievedCount,
        achievedPercent: Math.round((achievedCount / totalCriteria) * 100)
      },
      criteria: processedCriteria,
      meta: {
        assignmentId,
        studentId,
        rubricId,
        rubricVersion,
        createdAt: nowISO(),
        model: 'gpt-4o',
        prompt_hash: createEvaluationFingerprint({
           studentAnswer, evidence: [], rubricId, rubricVersion, systemPrompt: "BTEC_EVALUATOR_V1", criteriaCodes: rubricCriteria.map(c => c.code)
        }), // تخزين بصمة البرومبت
        fingerprint: fingerprint
      }
    };

    // 8. توليد التقرير النصي (استخدام report.ts)
    const textReport = generateTextReport(fullEvaluation, null); // نمرر null للمقارنة لأن هذا تقييم جديد

    // 9. إرجاع النتيجة للواجهة الأمامية
    return NextResponse.json({
      success: true,
      data: fullEvaluation,
      report: textReport
    });

  } catch (error: any) {
    console.error("Evaluation Error:", error);
    return NextResponse.json(
      { error: 'حدث خطأ أثناء عملية التقييم', details: error.message },
      { status: 500 }
    );
  }
}

export async function queryEmbedding(indexName: string, vector: number[], topK = 5) {
  try {
    const pc = await initVectorDB();
    const index = pc.Index(indexName);
    const result = await index.query({ vector, topK, includeMetadata: true });
    return result.matches || [];
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      throw new Error(`Pinecone index "${indexName}" not found. Please verify the index name and ensure it exists.`);
    }
    throw error;
  }
}