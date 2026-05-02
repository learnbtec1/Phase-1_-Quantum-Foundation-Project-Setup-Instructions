import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { extractPptxText } from "@/lib/extract-pptx";

// ============================================================================
// 🚀 SERVER CONFIGURATION & OPTIMIZATION
// ============================================================================
// هذا السطر هو الحل الجذري (The Ultimate Fix) لمشكلة بناء مكتبة pdf-parse
// يجبر Next.js على معالجة هذا المسار في وقت التشغيل (Runtime) ويمنعه من البحث عن ملفات وهمية وقت البناء
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// قائمة الامتدادات المسموحة (لضمان الأمان وعدم إرهاق السيرفر)
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".pptx", ".txt", ".md"];

// ============================================================================
// 🛠️ API HANDLER (Text Extraction Engine)
// ============================================================================
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    // 1. التحقق من وجود الملف (Validation)
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "لم يتم العثور على ملف صالح للتحليل." },
        { status: 400 }
      );
    }

    const name = file.name.toLowerCase();

    // 2. التحقق من الامتداد قبل تحويل الملف للذاكرة (Memory Protection)
    const isValidExtension = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
    if (!isValidExtension) {
      return NextResponse.json(
        { error: `الامتداد غير مدعوم. يرجى استخدام: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // 3. تحويل الملف إلى Buffer للمعالجة
    const arrayBuffer = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    let text = "";

    // 4. توجيه الملف لمحرك الاستخراج المناسب (Routing Strategy)
    if (name.endsWith(".pdf")) {
      const res = await pdf(buf);
      text = res.text || "";
      
    } else if (name.endsWith(".docx")) {
      const res = await mammoth.extractRawText({ buffer: buf });
      text = res.value || "";
      
    } else if (name.endsWith(".pptx")) {
      // استخراج النص من الشرائح وملاحظات المحاضر (مهم جداً في تقييم BTEC)
      text = await extractPptxText(buf, { includeSpeakerNotes: true });
      
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = buf.toString("utf-8");
    }

    // 5. تعقيم المخرجات (Sanitization)
    // التخلص من الرموز الصفرية التي قد تكسر قاعدة بيانات PostgreSQL أو نظام RAG
    const sanitizedText = text.replace(/\0/g, " ").trim();

    return NextResponse.json({ text: sanitizedText }, { status: 200 });

  } catch (error) {
    // 6. تسجيل الخطأ داخلياً لتسهيل التتبع من الـ Docker Logs
    console.error("❌ [File Parsing Error in Cogni]:", error);

    const errorMessage = error instanceof Error ? error.message : "حدث خطأ غير معروف أثناء تحليل الملف.";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}