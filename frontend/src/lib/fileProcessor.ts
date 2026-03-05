// src/lib/fileProcessor.ts
import mammoth from 'mammoth';

/**
 * وظيفة استخراج النص من ملفات Word و PDF
 */
export const extractTextFromFile = async (file: File): Promise<string> => {
  const fileType = file.type;

  if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // معالجة ملفات Word
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } 
  
  if (fileType === 'application/pdf') {
    // ملاحظة: معالجة PDF في المتصفح تحتاج مكتبة مثل pdfjs-dist
    // كحل سريع، سنعتمد على استخراج بسيط أو يمكنك إرسال الملف مباشرة للباكند
    // هنا سنفترض أننا سنقوم بالاستخراج النصي البسيط
    return "سيتم استخراج النص من PDF هنا... (يفضل استخدام pdfjs-dist)";
  }

  throw new Error("صيغة الملف غير مدعومة. يرجى رفع ملفات Word أو PDF فقط.");
};