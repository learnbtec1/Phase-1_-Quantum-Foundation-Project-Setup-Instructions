import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// تعريف نوع حالة اللعبة
type GameState = {
  money?: number;
  energy?: number;
};

// إنشاء اتصال بـ OpenAI باستخدام المفتاح
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    // 1. التحقق من وجود المفتاح
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { reply: '⚠️ مفتاح API غير موجود. يرجى التأكد من ملف .env.local' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const message = body.message || '';
    const mode = body.mode || 'teacher'; // 'simulation' or 'teacher'
    const gameState = (body.gameState || {}) as GameState;

    // 2. تحديد شخصية الذكاء الاصطناعي بناءً على الوضع (محاكاة أو معلم)
    let systemPrompt = '';

    if (mode === 'simulation') {
      // وضع المحاكاة: مستشار استراتيجي يراعي الميزانية والطاقة
      const money = gameState.money ?? 0;
      const energy = gameState.energy ?? 0;
      
      systemPrompt = `
        أنت مساعد استراتيجي في لعبة محاكاة إدارة أعمال.
        حالة اللاعب الحالية:
        - الميزانية: ${money}$
        - الطاقة: ${energy}/10
        
        دورك:
        - قدم نصائح مختصرة وحاسمة بناءً على الميزانية والطاقة.
        - إذا كان المال منخفضاً (<5000)، حذر اللاعب من الإفلاس.
        - إذا كانت الطاقة منخفضة (<3)، انصحه بالراحة.
        - ساعده في اتخاذ قرارات بشأن الحملات التسويقية والتوظيف.
        - لا تستخدم جملاً طويلة جداً.
      `;
    } else {
      // وضع المعلم: معلم داعم يشرح المفاهيم (SWOT, PESTLE, etc)
      systemPrompt = `
        أنت معلم خبير وموجه أكاديمي ودود جداً.
        دورك هو مساعدة الطالب على فهم مفاهيم الإدارة (SWOT, PESTLE, 4Ps) وغيرها.
        - إذا شعرت أن الطالب "قلق" أو "متوتر"، قدم له دعماً نفسياً أولاً.
        - اشرح المفاهيم بأسلوب مبسط وعملي.
        - تحدث باللغة العربية بطلاقة وود.
      `;
    }

    // 3. إرسال الطلب إلى OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // أو gpt-3.5-turbo لتقليل التكلفة
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.7, // توازن بين الإبداع والدقة
      max_tokens: 300,
    });

    const reply = completion.choices[0].message.content;

    return NextResponse.json({ reply });

  } catch (error: any) {
    console.error('AI Error:', error);
    return NextResponse.json(
      { reply: 'حدث خطأ أثناء الاتصال بالمعلم الذكي. حاول مرة أخرى.' },
      { status: 500 }
    );
  }
}