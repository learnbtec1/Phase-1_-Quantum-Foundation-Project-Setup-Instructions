"use client";
import React, { useState } from 'react';

interface ReportData {
  studentName: string;
  unitId: string;
  comparisonText: string;
  pestleAnalysis: Record<string, string>;
  collectedEvidence: any[];
  totalPoints: number;
}

interface ReportGeneratorProps {
  data: ReportData;
  onClose: () => void;
  onSubmit: () => void;
}

export default function ReportGenerator({ data, onClose, onSubmit }: ReportGeneratorProps) {
  const [studentName, setStudentName] = useState(data.studentName || '');
  const [isPreview, setIsPreview] = useState(false);

  const generateReportHTML = () => {
    const pestleFactors = Object.keys(data.pestleAnalysis);
    
    return `
      <div style="font-family: 'Arial', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; background: white; color: #000;">
        <div style="text-align: center; border-bottom: 4px solid #16a34a; padding-bottom: 20px; margin-bottom: 30px;">
          <h1 style="color: #16a34a; font-size: 32px; margin: 0;">BTEC Level 2 Business</h1>
          <h2 style="color: #333; font-size: 24px; margin: 10px 0;">Unit 1: Purposes of Business in Agriculture</h2>
          <p style="color: #666; font-size: 14px; margin: 5px 0;">Student: <strong>${studentName}</strong></p>
          <p style="color: #666; font-size: 14px; margin: 5px 0;">Date: ${new Date().toLocaleDateString('ar-EG')}</p>
        </div>

        <section style="margin-bottom: 30px;">
          <h3 style="color: #16a34a; font-size: 20px; border-left: 4px solid #16a34a; padding-left: 12px;">المقدمة</h3>
          <p style="line-height: 1.8; color: #333;">
            هذا التقرير يتناول تحليل أغراض إنشاء الشركات في قطاع الزراعة، مع التركيز على مقارنة شركة زراعية صغيرة (المزرعة العائلية) وشركة كبيرة (التعاونية الزراعية)، وتحليل بيئة الأعمال الخارجية باستخدام نموذج PESTLE.
          </p>
        </section>

        <section style="margin-bottom: 30px;">
          <h3 style="color: #16a34a; font-size: 20px; border-left: 4px solid #16a34a; padding-left: 12px;">مقارنة الشركات</h3>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #16a34a;">
            <p style="line-height: 1.8; color: #333; white-space: pre-wrap;">${data.comparisonText || 'لم يتم إدخال تحليل مقارنة.'}</p>
          </div>
        </section>

        <section style="margin-bottom: 30px;">
          <h3 style="color: #16a34a; font-size: 20px; border-left: 4px solid #16a34a; padding-left: 12px;">تحليل PESTLE</h3>
          ${pestleFactors.map(factor => `
            <div style="margin-bottom: 20px; background: #f8f9fa; padding: 15px; border-radius: 8px;">
              <h4 style="color: #16a34a; font-size: 16px; margin: 0 0 10px 0;">${factor}</h4>
              <p style="line-height: 1.8; color: #333; margin: 0;">${data.pestleAnalysis[factor]}</p>
            </div>
          `).join('')}
        </section>

        <section style="margin-bottom: 30px;">
          <h3 style="color: #16a34a; font-size: 20px; border-left: 4px solid #16a34a; padding-left: 12px;">الأدلة المجمعة</h3>
          <p style="color: #666; margin-bottom: 10px;">عدد الأدلة: ${data.collectedEvidence.length}</p>
          <ul style="list-style: none; padding: 0;">
            ${data.collectedEvidence.slice(0, 10).map(ev => `
              <li style="background: #f8f9fa; padding: 10px; margin-bottom: 8px; border-radius: 6px; border-left: 3px solid ${ev.category === 'primary' ? '#0ea5e9' : '#f97316'};">
                <strong>${ev.title}</strong> <span style="font-size: 12px; color: #666;">(${ev.category === 'primary' ? 'بحث أولي' : 'بحث ثانوي'})</span>
              </li>
            `).join('')}
          </ul>
        </section>

        <section style="margin-bottom: 30px;">
          <h3 style="color: #16a34a; font-size: 20px; border-left: 4px solid #16a34a; padding-left: 12px;">الخاتمة والتوصيات</h3>
          <p style="line-height: 1.8; color: #333;">
            بناءً على التحليل السابق، يتضح أن الشركات الزراعية تواجه تحديات متعددة من بيئة الأعمال الخارجية. التعاونيات الكبيرة تستفيد من اقتصاديات الحجم والوصول للأسواق العالمية، بينما المزارع العائلية تركز على الجودة والعلاقات المحلية. يُوصى بمراعاة العوامل البيئية والتكنولوجية عند التخطيط لأي مشروع زراعي مستقبلي.
          </p>
        </section>

        <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb;">
          <p style="color: #666; font-size: 12px;">تم إنشاء هذا التقرير باستخدام BTEC Platform 2026 | Virtual Learning Experience</p>
          <p style="color: #16a34a; font-weight: bold; margin-top: 10px;">النقاط المكتسبة: ${data.totalPoints} XP</p>
        </div>
      </div>
    `;
  };

  const handleDownloadPDF = () => {
    const reportHTML = generateReportHTML();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>BTEC Report - ${studentName}</title>
            <style>
              @media print {
                body { margin: 0; }
              }
            </style>
          </head>
          <body onload="window.print(); window.close();">
            ${reportHTML}
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-4xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10 bg-gradient-to-r from-green-900/50 to-emerald-900/50">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-black text-white">📄 مولد التقرير النهائي</h2>
              <p className="text-sm text-white/60 mt-1">اكتمل تقريرك بناءً على تحليلك وأدلتك</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              aria-label="Close"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isPreview ? (
            <div className="space-y-6">
              {/* اسم الطالب */}
              <div>
                <label className="block text-white font-bold mb-2">اسم الطالب/ة:</label>
                <input
                  type="text"
                  value={studentName}
                  onChange={e => setStudentName(e.target.value)}
                  placeholder="أدخل اسمك الكامل"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:border-green-500 focus:outline-none"
                />
              </div>

              {/* ملخص المحتوى */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="text-white font-bold text-lg mb-4">📋 ملخص محتوى التقرير:</h3>
                <div className="space-y-3 text-sm text-white/70">
                  <div className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span>المقدمة التعريفية بالوحدة</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span>مقارنة الشركات ({data.comparisonText ? data.comparisonText.length : 0} حرف)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span>تحليل PESTLE ({Object.keys(data.pestleAnalysis).length}/6 عوامل)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span>الأدلة المجمعة ({data.collectedEvidence.length} دليل)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span>الخاتمة والتوصيات</span>
                  </div>
                </div>
              </div>

              {/* نقاط الإنجاز */}
              <div className="bg-gradient-to-br from-green-500/20 to-emerald-600/20 border border-green-500/30 rounded-xl p-6 text-center">
                <div className="text-5xl font-black text-green-400 mb-2">{data.totalPoints} XP</div>
                <p className="text-white/80 text-sm">مجموع النقاط المكتسبة</p>
              </div>
            </div>
          ) : (
            /* Preview Mode */
            <div 
              className="bg-white text-black p-8 rounded-xl"
              dangerouslySetInnerHTML={{ __html: generateReportHTML() }}
            />
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-white/10 bg-black/20">
          <div className="flex gap-3">
            <button
              onClick={() => setIsPreview(!isPreview)}
              className="flex-1 py-3 rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 transition-all"
            >
              {isPreview ? '✏️ تعديل' : '👁️ معاينة'}
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={!studentName.trim()}
              className="flex-1 py-3 rounded-xl font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-blue-600 text-white hover:bg-blue-700"
            >
              📥 تحميل PDF
            </button>
            <button
              onClick={onSubmit}
              disabled={!studentName.trim()}
              className="flex-1 py-3 rounded-xl font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-green-600 to-emerald-700 text-white hover:shadow-lg hover:shadow-green-500/50"
            >
              ✓ إرسال التقرير
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
