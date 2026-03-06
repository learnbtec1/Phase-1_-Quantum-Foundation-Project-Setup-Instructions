// frontend/src/app/api/openai-grade/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

type GradePayload = {
  grade: 'DISTINCTION' | 'MERIT' | 'PASS' | 'REFER (FAIL)';
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  try {
    if (!OPENAI_API_KEY) return NextResponse.json({ error: 'مفتاح الخادم مفقود' }, { status: 500 });

    const { submission, unit } = await req.json();
    if (!submission) return NextResponse.json({ error: 'Missing submission' }, { status: 400 });

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const system = `
أنت معلم BTEC ذكي ولكن صارم.
أخرج بالعربية فقط، وبصيغة JSON مطابقة تمامًا للمخطط:
{
  "grade": "DISTINCTION|MERIT|PASS|REFER (FAIL)",
  "score": 0..100,
  "feedback": "نص عربي موجز ومحدد",
  "strengths": ["...", "..."],
  "improvements": ["...", "..."]
}
`.trim();

    const user = `
الوحدة: ${unit || 'غير محدد'}

النص المراد تقييمه:
${submission}
`.trim();

    const MAX_RETRIES = 2;
    let completion: any;

    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          temperature: 0,
          max_tokens: 700,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        });
        break;
      } catch (err: any) {
        const st = err?.status || err?.response?.status;
        if (i < MAX_RETRIES && (st === 429 || st === 500 || st === 503)) {
          await sleep(400 * Math.pow(2, i));
          continue;
        }
        return NextResponse.json({ error: 'فشل الاتصال بخدمة OpenAI.' }, { status: 500 });
      }
    }

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    let parsed: GradePayload;
    try {
      parsed = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch {
      return NextResponse.json({ error: 'تعذر استخراج نتيجة التقييم من رد الذكاء الصناعي.' }, { status: 500 });
    }

    parsed.score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}