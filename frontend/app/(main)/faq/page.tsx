"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/lovable-ui/ui/accordion";

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "كيف يعمل التقييم الذكي لـ BTEC في المنصة؟",
    a:
      "يستخرج النظام المعايير من نص الواجهة، ثم يطابق إجابة الطالب مع أدلة من مكتبة الوحدات والمرجعية (RAG). يُقيّم كل معيار (P / M / D) مع شرح قصير: لماذا تحقق أو لا، واقتراح تحسين تربوي — دون استبدال دور المعلّم.",
  },
  {
    q: "ماذا تعني P و M و D؟",
    a:
      "P (Pass): تحقيق المتطلب الأساسي للمعيار. M (Merit): أداء عالٍ يفوق التوقع الأساسي. D (Distinction): أداء متميز يطابق أعلى وصف في المعيار. التدرج يعكس معايير Pearson لأسلوب BTEC وليس مجرد «درجة رقمية».",
  },
  {
    q: "ما علاقة فحص الانتحال بنسبة مثل 25٪؟",
    a:
      "كثير من المدارس يضعون حداً إرشادياً للتشابه (مثلاً 25٪) في السياسة الداخلية. أداة الانتحال تعرض التشابه مع المخزون المرجعي ولا تستخدم عتبة صارمة كقفل تلقائي على التقييم؛ راجع النتائج بعين المعلّم واتبع سياسة مؤسستك.",
  },
  {
    q: "كيف أرسل عمل الطلاب للتقييم؟",
    a:
      "من صفحة «تقييم BTEC» الصق النص أو ارفع الملفات المدعومة (مثل PDF / Word) كما يحدد النظام. تأكد من أن النص واضح وأن معايير الواجهة مرفوعة أو معروفة لتحسين استرجاع الدليل.",
  },
  {
    q: "هل نتيجة الذكاء الاصطناعي نهائية؟",
    a:
      "النتيجة مساعدة احترافية للمعلّم: تفسيرية وقابلة للمراجعة. يبقى القرار الأكاديمي والامتثال لسياسة المؤسسة معك. يمكن تعديل الفهم من خلال سياق الواجهة أو مراجعة الأدلة قبل الاعتماد.",
  },
];

export default function FaqPage() {
  return (
    <div className="min-h-0" dir="rtl">
      <div
        className="relative overflow-hidden rounded-2xl border border-amber-500/20 px-4 py-8 sm:px-8"
        style={{ backgroundColor: "#030712" }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(251,191,36,0.25), transparent 50%)",
          }}
        />
        <div className="relative text-center">
          <h1
            className="text-3xl font-bold tracking-tight sm:text-4xl"
            style={{
              textShadow:
                "0 0 32px rgba(251, 191, 36, 0.45), 0 0 64px rgba(250, 204, 21, 0.2)",
            }}
          >
            <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent">
              الأسئلة الشائعة
            </span>
          </h1>
          <p className="mt-2 text-sm text-slate-400">EduVerse — تقييم BTEC والانتحال</p>
        </div>

        <div className="relative mx-auto mt-10 max-w-3xl">
          <Accordion type="single" collapsible className="w-full space-y-2">
            {FAQ_ITEMS.map((item, i) => (
              <AccordionItem
                key={i}
                value={`item-${i}`}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] shadow-[0_0_24px_rgba(0,0,0,0.35)] backdrop-blur-xl"
              >
                <AccordionTrigger className="px-4 py-4 text-start text-base font-medium text-amber-100/95 hover:text-amber-50 hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-slate-300">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </div>
  );
}
