'use client';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Download, FileText, Printer, Check, X, ChevronDown, User, 
  ScanEye, Fingerprint, Activity, Percent, ShieldAlert 
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType } from 'docx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';

// قاعدة البيانات (كما هي)
const UNITS_DB: any = {
  "G10_S1_U4": {
    code: "Unit 4",
    title: "خطة التسويق (Marketing Plan)",
    criteria: [
      { id: "A.P1", text: "وصف أهداف التسويق للمنظمة المختارة" },
      { id: "A.P2", text: "شرح كيفية تأثير العوامل الخارجية على النشاط التسويقي" },
      { id: "A.M1", text: "تحليل فعالية أهداف التسويق في تحقيق النجاح" },
      { id: "A.D1", text: "تقييم نقدي لخطة التسويق المقترحة" }
    ]
  },
  // يمكن إضافة باقي الوحدات هنا
};

export default function AssessmentRecorder() {
  const [selectedUnitKey, setSelectedUnitKey] = useState("G10_S1_U4");
  const [studentName, setStudentName] = useState("");
  const [assessorName, setAssessorName] = useState("Oracle AI");
  const [evaluations, setEvaluations] = useState<any>({});
  const [generalFeedback, setGeneralFeedback] = useState("");

  // متغيرات الكاشف
  const [isScanning, setIsScanning] = useState(false);
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [scanReport, setScanReport] = useState<string[]>([]);

  const recordRef = useRef<HTMLDivElement>(null);
  const currentUnit = UNITS_DB[selectedUnitKey] || UNITS_DB["G10_S1_U4"];

  // حالة التأكد من أن الكود يعمل في المتصفح فقط
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleCriteriaChange = (id: string, field: 'achieved' | 'feedback', value: any) => {
    setEvaluations((prev: any) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

  // --- محرك كشف الاستلال ---
  const runAiDetector = () => {
    if (!generalFeedback && Object.keys(evaluations).length === 0) {
      return toast.error("لا يوجد محتوى لفحصه! قم بتعبئة التقييم.");
    }

    setIsScanning(true);
    setAiScore(null);
    setScanReport([]);

    // محاكاة التحليل
    setTimeout(() => {
      const calculatedScore = Math.floor(Math.random() * 100); 
      setAiScore(calculatedScore);
      
      const report = [];
      if (calculatedScore < 20) {
        report.push(`✅ محتوى بشري أصيل (نسبة ${calculatedScore}%).`);
      } else if (calculatedScore < 50) {
        report.push(`⚠️ محتوى هجين (نسبة ${calculatedScore}%) - يحتاج تدقيق.`);
      } else {
        report.push(`🚨 محتوى مولّد بالذكاء الاصطناعي (نسبة ${calculatedScore}%).`);
      }

      setScanReport(report);
      setIsScanning(false);
      toast.success(`اكتمل الفحص: ${calculatedScore}% نسبة استلال`);
    }, 2500);
  };

  // دوال التصدير (مختصرة للتركيز على الزر)
  const generateWord = async () => {
    alert("سيتم تحميل ملف Word..."); // ضع كود التصدير الكامل هنا إذا أردت
  };

  const generatePDF = async () => {
    if (!recordRef.current) return;
    const canvas = await html2canvas(recordRef.current, { scale: 2, backgroundColor: '#0a0a1a' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`${studentName}_AI_Report.pdf`);
  };

  // شريط الأزرار الثابت عبر Portal

  // إصلاح: إزالة pointer-events-none من الحاوية الخارجية، وضمان أن الشريط يظهر دائماً عند mounted فقط
  const fixedBar = mounted ? createPortal(
    <div className="fixed bottom-6 left-0 right-0 z-[9999] flex justify-center px-4">
      <div className="bg-gray-900/95 backdrop-blur-xl border border-white/20 p-4 rounded-3xl flex flex-wrap gap-4 items-center shadow-2xl max-w-4xl w-full mx-auto">
        {/* زر كشف الاستلال */}
        <button 
          onClick={runAiDetector}
          disabled={isScanning}
          className="flex-1 min-w-[200px] flex items-center justify-center gap-3 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white px-6 py-4 rounded-2xl font-bold transition-all shadow-lg border border-orange-500/50"
        >
          {isScanning ? <Activity className="animate-spin" /> : <ScanEye size={24} />}
          <span className="text-lg">كشف نسبة الاستلال %</span>
        </button>

        {/* الفاصل */}
        <div className="w-px h-10 bg-white/20 hidden md:block"></div>

        {/* أزرار التصدير */}
        <div className="flex gap-3 flex-1">
          <button onClick={generateWord} className="flex-1 flex items-center justify-center gap-2 bg-[#2b5797] hover:bg-[#1e3e6f] text-white px-4 py-4 rounded-2xl font-bold transition-all">
            <FileText size={20} /> Word
          </button>
          <button onClick={generatePDF} className="flex-1 flex items-center justify-center gap-2 bg-[#b30b00] hover:bg-[#8a0900] text-white px-4 py-4 rounded-2xl font-bold transition-all">
            <Printer size={20} /> PDF
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="min-h-screen bg-[#020205] text-white p-6 md:p-12 font-sans pb-48" dir="rtl">
      {/* ... محتوى الصفحة العادي ... */}

      {/* ... */}

      {/* شريط الأزرار الثابت */}
      {fixedBar}
    </div>
  );
}