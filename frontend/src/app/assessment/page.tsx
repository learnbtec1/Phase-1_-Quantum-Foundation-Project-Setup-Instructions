'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Upload, FileText, Search, ShieldAlert, ChevronDown, Layers, BookOpen, GraduationCap, Trash2 } from 'lucide-react';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { ACADEMIC_DATA } from '@/lib/academicSubjects';
import { normalizeIntegratedResult, type EvaluationResult } from '@/lib/assessmentNormalize';
import {
  buildAssessmentCoachingPayload,
  persistAssessmentCoaching,
  setCogniFocusSubject,
} from '@/lib/cogniSessionContext';
import { getStudentIdForEvaluation } from '@/lib/studentDeviceId';
import { authHeaders } from '@/lib/auth';
import BusinessSubjectChips from '@/components/student/BusinessSubjectChips';

// --- Interfaces ---

interface PlagiarismResult {
  similarity: number;
  ai: { likelihood: number; signals: string[]; report: string };
  sources: string[];
}

interface StudentSolutionFile {
  file_label: string;
  file_content: string;
  description?: string;
}

// [COPILOT_POLICY_START] — Assessment Policy & Local Plagiarism Engine (no external API)
const ASSESSMENT_POLICY = {
  maxPlagiarismPercent: 25,
  minWordCount: 150,
  rules: [
    { id: 'P01', text: 'يجب ألا تتجاوز نسبة الاستلال/التشابه 25%' },
    { id: 'P02', text: 'يجب أن يحتوي الحل على 150 كلمة كحد أدنى' },
    { id: 'P03', text: 'جميع معايير الاجتياز (P) يجب تحقيقها قبل الانتقال إلى Merit' },
    { id: 'P04', text: 'يُشترط توفير دليل وتطبيق عملي واضح في الإجابة' },
    { id: 'P05', text: 'المحتوى المُولَّد بالكامل بواسطة الذكاء الاصطناعي يُعامَل كاستلال' },
  ],
};

function buildNgrams(text: string, n = 3): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\u0600-\u06ff\s]/g, ' ').split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) grams.add(words.slice(i, i + n).join(' '));
  return grams;
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach(x => { if (b.has(x)) inter++; });
  return Math.round((inter / (a.size + b.size - inter)) * 100);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface PolicyVerdict { pass: boolean; reasons: string[] }
function computeCompliance(studentText: string, simPct: number): PolicyVerdict {
  const reasons: string[] = [];
  let pass = true;
  if (simPct > ASSESSMENT_POLICY.maxPlagiarismPercent) {
    reasons.push(`نسبة التشابه (${simPct}%) تتجاوز الحد المسموح (${ASSESSMENT_POLICY.maxPlagiarismPercent}%)`);
    pass = false;
  }
  const wc = countWords(studentText);
  if (wc < ASSESSMENT_POLICY.minWordCount) {
    reasons.push(`عدد الكلمات (${wc}) أقل من الحد الأدنى (${ASSESSMENT_POLICY.minWordCount} كلمة)`);
    pass = false;
  }
  if (pass) reasons.push('✓ المستند يستوفي جميع متطلبات السياسة الأكاديمية');
  return { pass, reasons };
}

const DEMO_ASSIGNMENT = `ملخص المهمة: الوحدة 9 — بحث وتخطيط حملة تسويقية\nP1: صف مبادئ التسويق وتطبيقاتها.\nP2: صف طرق البحث الأولية والثانوية.\nM1: حلل العوامل المؤثرة على التسويق في منظمة محددة.\nD1: قيّم فعالية التسويق في تحقيق الأهداف التجارية.`;
const DEMO_STUDENT = `التسويق هو عملية تحديد احتياجات العملاء وتلبيتها. تشمل مبادئ التسويق الأربعة: المنتج والسعر والمكان والترويج. في شركة آبل تعتمد الاستراتيجية على التميز وبناء العلامة التجارية. طرق البحث الأولية تشمل الاستبيانات والمقابلات، بينما تشمل الثانوية التقارير والكتب. يتأثر التسويق بعوامل خارجية كالاقتصاد والتكنولوجيا. تحقيق الأهداف يتطلب قياس فعالية الحملات وعائد الاستثمار باستمرار. التحليل العميق يكشف الفجوات في الاستراتيجية ويفتح آفاق للتطوير. عند المقارنة بالمنافسين يتضح التفوق التنافسي لشركة آبل في التسويق الرقمي والتجربة الاستثنائية للعملاء.`;
interface HistoryEntry { subject: string; grade: string; similarity: number; ts: string }
// [COPILOT_POLICY_END]

// --- المكون الرئيسي (يجب أن يكون Default Export) ---
export default function AssessmentPage() {
  // State
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');

  const [studentAnswer, setStudentAnswer] = useState('');
  const [studentSolutions, setStudentSolutions] = useState<StudentSolutionFile[]>([]);
  const [assignmentContext, setAssignmentContext] = useState('');
  const [filesCount, setFilesCount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [plagiarismLoading, setPlagiarismLoading] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismResult | null>(null);
  const [showPlagModal, setShowPlagModal] = useState(false);
  // [COPILOT_POLICY_STATE_START]
  const [localSimilarity, setLocalSimilarity] = useState<number | null>(null);
  const [complianceVerdict, setComplianceVerdict] = useState<PolicyVerdict | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showPolicyPanel, setShowPolicyPanel] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('eduverse-assessment-history');
      if (stored) setHistory(JSON.parse(stored));
    } catch { /* empty */ }
  }, []);
  // [COPILOT_POLICY_STATE_END]

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    return 'حدث خطأ غير متوقع.';
  };

  // Derived Data
  const availableSections = useMemo<string[]>(
    () => selectedClass ? Object.keys(ACADEMIC_DATA[selectedClass] || {}) : [],
    [selectedClass]
  );
  const availableSubjects = useMemo<string[]>(
    () => (selectedClass && selectedSection) ? ACADEMIC_DATA[selectedClass][selectedSection] || [] : [],
    [selectedClass, selectedSection]
  );

  const pickSubjectFromChip = (label: string) => {
    const v = label.trim();
    if (!v) return;
    for (const cls of Object.keys(ACADEMIC_DATA)) {
      for (const sec of Object.keys(ACADEMIC_DATA[cls] || {})) {
        const subs = ACADEMIC_DATA[cls][sec] || [];
        if (subs.includes(v)) {
          setSelectedClass(cls);
          setSelectedSection(sec);
          setSelectedSubject(v);
          setCogniFocusSubject(v);
          return;
        }
      }
    }
    setSelectedSubject(v);
    setCogniFocusSubject(v);
  };

  useEffect(() => {
    const s = selectedSubject.trim();
    if (s) setCogniFocusSubject(s);
  }, [selectedSubject]);

  const dropdownFields: {
    label: string;
    icon: ReactNode;
    val: string;
    set: (value: string) => void;
    opts: string[];
    dis?: boolean;
  }[] = [
      { label: "الصف الدراسي", icon: <GraduationCap />, val: selectedClass, set: setSelectedClass, opts: Object.keys(ACADEMIC_DATA) },
      { label: "الفصل الدراسي", icon: <BookOpen />, val: selectedSection, set: setSelectedSection, opts: availableSections, dis: !selectedClass },
      { label: "المادة التعليمية", icon: <Layers />, val: selectedSubject, set: setSelectedSubject, opts: availableSubjects, dis: !selectedSection }
    ];

  // --- PDF/Docx Extraction ---
  useEffect(() => {
    const loadPdf = async () => {
      if ((window as any).pdfjsLib) return;
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => { (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; };
      document.head.appendChild(script);
    };
    loadPdf();
  }, []);

  const extractPdfText = async (file: File) => {
    const pdf = await (window as any).pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map((item: any) => item.str).join(' ') + '\n';
    return text;
  };

  /**
   * استخراج نص docx عبر السيرفر (python-docx) بدلاً من mammoth.
   * python-docx يقرأ الجداول بشكل صحيح — mammoth يتجاهلها.
   */
  const extractDocxText = async (file: File): Promise<string> => {
    try {
      const fd = new FormData();
      fd.append('files', file, file.name);
      const res = await fetch('/api/extract-text', {
        method: 'POST',
        headers: { ...authHeaders() },
        body: fd,
      });
      if (!res.ok) {
        // fallback to mammoth if backend unavailable
        console.warn('[extractDocxText] backend failed, falling back to mammoth');
        return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      }
      const data = await res.json();
      return data.text || '';
    } catch {
      // fallback to mammoth
      return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    }
  };

  // دالة البوربوينت المحسنة (DOMParser)
  const extractPptxText = async (file: File) => {
    if (file.name.endsWith('.ppt')) {
      return "⚠️ تنبيه: صيغة .ppt القديمة غير مدعومة. يرجى تحويلها إلى .pptx.";
    }
    try {
      const zip = await JSZip.loadAsync(file);
      let fullText = "";
      const slideFiles = Object.keys(zip.files).filter(n => n.startsWith("ppt/slides/slide") && n.endsWith(".xml"));

      if (slideFiles.length === 0) return "⚠️ لا توجد شرائح نصية.";

      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || "0");
        const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || "0");
        return numA - numB;
      });

      const parser = new DOMParser();
      for (const fileName of slideFiles) {
        const slideNum = fileName.match(/slide(\d+)/)?.[1] || "?";
        const xmlString = await zip.files[fileName].async("string");
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const textNodes = xmlDoc.getElementsByTagName("a:t");

        let slideContent = "";
        for (let i = 0; i < textNodes.length; i++) slideContent += (textNodes[i].textContent || "") + " ";

        if (slideContent.trim()) fullText += `\n--- [Slide ${slideNum}] ---\n${slideContent.trim()}\n`;
      }
      return fullText.trim() || "⚠️ الشرائح فارغة.";
    } catch (e) {
      return "خطأ في قراءة ملف الباوربوينت.";
    }
  };

  const handleFileUpload = async (files: File[], isStudent: boolean) => {
    let combined = isStudent ? (studentAnswer || "") : "";
    let count = 0;
    const parsedStudentFiles: StudentSolutionFile[] = [];

    for (const file of files) {
      try {
        let txt = "";
        const ext = file.name.split('.').pop()?.toLowerCase();

        if (ext === 'pdf') txt = await extractPdfText(file);
        else if (ext === 'docx' || ext === 'doc') txt = await extractDocxText(file);
        else if (ext === 'pptx' || ext === 'ppt') txt = await extractPptxText(file);
        else continue;

        if (isStudent) {
          const normalizedText = String(txt || '').trim();
          if (!normalizedText) continue;

          combined += `\n\n--- FILE START: ${file.name} ---\n${normalizedText}\n--- FILE END ---\n`;
          parsedStudentFiles.push({
            file_label: file.name,
            file_content: normalizedText,
          });
          count++;
        } else {
          setAssignmentContext(txt);
        }
      } catch (e) {
        alert(`Error parsing ${file.name}`);
      }
    }

    if (isStudent) {
      if (parsedStudentFiles.length === 0) {
        alert('لم يتم استخراج نص صالح من الملفات المرفوعة.');
        return;
      }
      setStudentAnswer(combined);
      setStudentSolutions(prev => [...prev, ...parsedStudentFiles]);
      setFilesCount(prev => prev + count);
    }
  };

  // --- Reset Function ---
  const handleReset = () => {
    if (confirm("هل أنت متأكد؟ سيتم مسح البيانات للبدء من جديد.")) {
      setStudentAnswer("");
      setStudentSolutions([]);
      setFilesCount(0);
      setResult(null);
      setPlagiarismResult(null);
      setLocalSimilarity(null);
      setComplianceVerdict(null);
    }
  };

  // [COPILOT_DEMO_CHECK_START]
  const handleRunDemoCheck = () => {
    setAssignmentContext(DEMO_ASSIGNMENT);
    setStudentAnswer(DEMO_STUDENT);
    setStudentSolutions([{ file_label: 'demo.txt', file_content: DEMO_STUDENT }]);
    setFilesCount(1);
    setSelectedSubject('4. خطة التسويق');
    setSelectedClass('الصف العاشر');
    setSelectedSection('الفصل الأول');
    const grams1 = buildNgrams(DEMO_STUDENT);
    const grams2 = buildNgrams(DEMO_ASSIGNMENT);
    const sim = jaccardSim(grams1, grams2);
    setLocalSimilarity(sim);
    setComplianceVerdict(computeCompliance(DEMO_STUDENT, sim));
  };
  // [COPILOT_DEMO_CHECK_END]

  const saveToHistory = (grade: string, sim: number) => {
    const entry: HistoryEntry = {
      subject: selectedSubject || '—',
      grade,
      similarity: sim,
      ts: new Date().toLocaleString('ar-SA'),
    };
    const next = [entry, ...history].slice(0, 20);
    setHistory(next);
    try { localStorage.setItem('eduverse-assessment-history', JSON.stringify(next)); } catch { /* empty */ }
  };

  /**
   * Persist a compact, avatar-ready grade snapshot to localStorage so that
   * useAgentAgent can inject it into the next WebSocket message as
   * `grade_result: { final_grade, subject, criteria_summary }`.
   * This lets Dr. Hamza say things like "أرى إنك حصلت على Merit…" naturally.
   */
  const saveLastGrade = (evalResult: EvaluationResult) => {
    try {
      const coach = buildAssessmentCoachingPayload(evalResult, selectedSubject || '—');
      persistAssessmentCoaching(coach);
      const snapshot = {
        final_grade: coach.final_grade,
        subject: coach.subject,
        criteria_summary: coach.criteria_summary,
        achieved: coach.achieved,
        total: coach.total,
        gaps_detail_ar: coach.gaps_detail_ar,
        coaching_goal_ar: coach.coaching_goal_ar,
        ...(coach.report_excerpt ? { report_excerpt: coach.report_excerpt } : {}),
        ts: coach.ts,
      };
      localStorage.setItem('eduverse-last-grade', JSON.stringify(snapshot));
    } catch { /* ignore storage errors */ }
  };

  // --- API Calls ---
  const handleEvaluate = async () => {
    if (!selectedSubject || !assignmentContext || (!studentAnswer && studentSolutions.length === 0)) {
      alert("يرجى تعبئة البيانات ورفع الملفات.");
      return;
    }

    // Pre-flight: ensure assignment brief contains ≥2 BTEC criteria codes (P1, M1, D1 …)
    const criteriaMatches = (assignmentContext.match(/\b[PMD]\d+\b/gi) || []);
    const uniqueCodes = new Set(criteriaMatches.map((c: string) => c.toUpperCase()));
    if (uniqueCodes.size < 2) {
      alert("تحذير: لم يتم العثور على معايير BTEC كافية في نص الواجب.\nيجب أن يحتوي على معيارين على الأقل مثل: P1، M1، D1\n\nتأكد من النص المُدخل في حقل 'سياق الواجب'.");
      return;
    }

    setLoading(true); setResult(null);

    try {
      const assignmentBrief = `${selectedSubject}\n${assignmentContext}`;

      if (studentSolutions.length > 0) {
        const res = await fetch('/api/evaluate-multi-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            assignment_text: assignmentBrief,
            solutions: studentSolutions,
            unit_id: '14',
            student_id: getStudentIdForEvaluation(),
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || "Evaluation failed");

        const normalized = data?.data?.criteria ? data.data : data;
        const evalResult = normalizeIntegratedResult(normalized);
        setResult(evalResult);
        const sim = jaccardSim(buildNgrams(studentAnswer || studentSolutions.map(f => f.file_content).join(' ')), buildNgrams(assignmentBrief));
        setLocalSimilarity(sim);
        setComplianceVerdict(computeCompliance(studentAnswer || '', sim));
        saveToHistory(evalResult.data.final_grade || 'PENDING', sim);
        saveLastGrade(evalResult);
        return;
      }

      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          student_text: studentAnswer,
          assignment_text: assignmentBrief,
          unit_id: '14',
          student_id: getStudentIdForEvaluation(),
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Evaluation failed');
      // Normalize to ensure consistent shape regardless of which path returned data
      const normalized = data?.data?.criteria !== undefined ? data.data : data;
      const evalResult = normalizeIntegratedResult(normalized);
      // Preserve report from the route-level field if it's a string
      if (typeof data?.report === 'string' && data.report) {
        evalResult.report = data.report;
      }
      setResult(evalResult);
      const sim = jaccardSim(buildNgrams(studentAnswer), buildNgrams(`${selectedSubject}\n${assignmentContext}`));
      setLocalSimilarity(sim);
      setComplianceVerdict(computeCompliance(studentAnswer, sim));
      saveToHistory(evalResult.data.final_grade || 'PENDING', sim);
      saveLastGrade(evalResult);
    } catch (e: unknown) { alert(getErrorMessage(e)); } finally { setLoading(false); }
  };

  const handleCheckPlagiarism = async () => {
    if (!studentAnswer) return;
    setPlagiarismResult(null);
    setPlagiarismLoading(true); setShowPlagModal(true);
    try {
      const res = await fetch('/api/plagiarism', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text: studentAnswer })
      });
      const raw = await res.json();
      // Backend/route always returns PlagiarismGuard shape: {score, detail, findings}
      // or the properly-shaped {ai:{likelihood,...}, similarity, sources}
      const rawScore = typeof raw?.score === 'number' ? raw.score : 0;
      const likelihood = raw?.ai?.likelihood != null
        ? Math.round(raw.ai.likelihood)
        : Math.round(rawScore * 100);
      setPlagiarismResult({
        similarity: raw?.similarity != null ? Math.round(raw.similarity) : likelihood,
        ai: {
          likelihood,
          signals: Array.isArray(raw?.ai?.signals)
            ? raw.ai.signals
            : Array.isArray(raw?.findings?.suspected_ai_markers)
              ? raw.findings.suspected_ai_markers
              : [],
          report: typeof raw?.ai?.report === 'string'
            ? raw.ai.report
            : typeof raw?.detail === 'string' ? raw.detail : '',
        },
        sources: Array.isArray(raw?.sources) ? raw.sources : [],
      });
    } catch (e: unknown) { alert(getErrorMessage(e)); setShowPlagModal(false); } finally { setPlagiarismLoading(false); }
  };

  const isEvaluationError = result?.data?.final_grade === 'ERROR';

  // [COPILOT_LOCAL_PLAG_HANDLER]
  const handleLocalCheck = () => {
    if (!studentAnswer) return;
    const grams1 = buildNgrams(studentAnswer);
    const grams2 = assignmentContext ? buildNgrams(assignmentContext) : new Set<string>();
    const sim = jaccardSim(grams1, grams2);
    setLocalSimilarity(sim);
    setComplianceVerdict(computeCompliance(studentAnswer, sim));
  };

  // --- UI Render ---
  return (
    <div className="min-h-screen bg-[#0f172a] text-white font-sans overflow-x-hidden selection:bg-purple-500 selection:text-white" dir="rtl">

      {/* Background Effects */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-blue-600/20 rounded-full blur-[120px] animate-pulse delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto p-8 relative z-10">

        {/* Header */}
        <header className="mb-12 text-center transform hover:scale-105 transition duration-500 cursor-default">
          <h1 className="text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
            نظام التقييم الذكي
          </h1>
          <p className="text-gray-400 mt-4 text-lg tracking-wide">تحليل جنائي • كشف استلال • تقارير BTEC</p>
        </header>

        {/* 1. Dropdowns Section */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {dropdownFields.map((field, idx) => (
            <div key={idx} className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-60 transition duration-500"></div>
              <div className="relative bg-gray-900/80 backdrop-blur-xl border border-white/10 p-6 rounded-2xl shadow-2xl transform transition duration-300 group-hover:-translate-y-2">
                <div className="flex items-center gap-3 mb-3 text-blue-300">
                  {field.icon}
                  <span className="font-bold">{field.label}</span>
                </div>
                <div className="relative">
                  <select
                    value={field.val}
                    onChange={e => { field.set(e.target.value); if (idx === 0) { setSelectedSection(''); setSelectedSubject(''); } if (idx === 1) setSelectedSubject(''); }}
                    disabled={field.dis}
                    aria-label={field.label}
                    title={field.label}
                    className="w-full appearance-none bg-black/20 border border-gray-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <option value="">اختر {field.label}...</option>
                    {field.opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <ChevronDown className="absolute left-4 top-3.5 text-gray-400 pointer-events-none w-5 h-5" />
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="mb-10 rounded-2xl border border-white/10 bg-gray-900/50 p-4 backdrop-blur-sm">
          <h2 className="mb-2 text-sm font-bold text-cyan-200/90">تركيز كوجني على مادة واحدة</h2>
          <BusinessSubjectChips selectedSubject={selectedSubject} onPick={pickSubjectFromChip} />
        </section>

        {/* 2. Upload Section */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">

          {/* Assignment Upload */}
          <div className="group relative">
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative h-full bg-gray-800/60 backdrop-blur-md border border-white/10 rounded-2xl p-8 flex flex-col items-center justify-center text-center transition duration-300 group-hover:transform group-hover:scale-[1.02]">
              <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-4 group-hover:animate-bounce">
                <FileText className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">ملف الواجب (Assignment Brief)</h3>
              <p className="text-gray-400 text-sm mb-6">يجب أن يحتوي على جدول المعايير (P1, M1..)</p>

              <label className="cursor-pointer bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-blue-500/30 transition-all transform hover:scale-105 active:scale-95">
                <span>اختر ملف</span>
                <input type="file" className="hidden" accept=".pdf,.docx,.doc" onChange={e => e.target.files && handleFileUpload(Array.from(e.target.files), false)} />
              </label>
              {assignmentContext && <div className="mt-4 flex items-center gap-2 text-green-400 bg-green-900/20 px-4 py-1 rounded-full text-sm">✓ تم الرفع</div>}
            </div>
          </div>

          {/* Student Upload */}
          <div className="group relative">
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative h-full bg-gray-800/60 backdrop-blur-md border border-white/10 rounded-2xl p-8 flex flex-col items-center justify-center text-center transition duration-300 group-hover:transform group-hover:scale-[1.02]">
              <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mb-4 group-hover:animate-bounce">
                <Upload className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">حل الطالب</h3>
              <p className="text-gray-400 text-sm mb-6">يدعم ملفات متعددة (PDF, PPTX, DOCX)</p>

              <label className="cursor-pointer bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-purple-500/30 transition-all transform hover:scale-105 active:scale-95">
                <span>رفع الملفات</span>
                <input type="file" className="hidden" multiple accept=".pdf,.docx,.doc,.pptx,.ppt" onChange={e => e.target.files && handleFileUpload(Array.from(e.target.files), true)} />
              </label>
              {filesCount > 0 && <div className="mt-4 flex items-center gap-2 text-green-400 bg-green-900/20 px-4 py-1 rounded-full text-sm">✓ تم دمج {filesCount} ملفات</div>}
            </div>
          </div>
        </section>

        {/* 3. Action Buttons */}
        <div className="flex justify-center gap-6 mb-16 flex-wrap">
          <button
            type="button"
            onClick={handleReset}
            disabled={filesCount === 0}
            className="relative group px-6 py-4 rounded-2xl bg-red-900/20 border border-red-500/30 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:border-red-400 hover:bg-red-900/40"
          >
            <div className="relative flex items-center gap-2 text-red-400 font-bold">
              <Trash2 />
              <span>طالب جديد</span>
            </div>
          </button>

          <button
            type="button"
            onClick={handleRunDemoCheck}
            className="relative group px-6 py-4 rounded-2xl bg-yellow-900/20 border border-yellow-500/30 overflow-hidden transition-all hover:border-yellow-400 hover:bg-yellow-900/40"
            title="تحميل بيانات تجريبية للاختبار السريع"
          >
            <div className="relative flex items-center gap-2 text-yellow-400 font-bold text-sm">
              <span>⚡ تجربة سريعة</span>
            </div>
          </button>

          <button
            type="button"
            onClick={handleEvaluate}
            disabled={loading}
            className="relative group px-10 py-4 rounded-2xl bg-gray-800 border border-green-500/30 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:border-green-400 hover:shadow-[0_0_30px_rgba(34,197,94,0.3)]"
          >
            <div className="absolute inset-0 bg-green-600/10 group-hover:bg-green-600/20 transition"></div>
            <div className="relative flex items-center gap-3 text-green-400 font-bold text-lg">
              {loading ? <div className="w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin"></div> : <FileText />}
              <span>{loading ? "جاري التحليل..." : "بدء التقييم الشامل"}</span>
            </div>
          </button>

          <button
            type="button"
            onClick={handleCheckPlagiarism}
            disabled={plagiarismLoading}
            className="relative group px-10 py-4 rounded-2xl bg-gray-800 border border-purple-500/30 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:border-purple-400 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]"
          >
            <div className="absolute inset-0 bg-purple-600/10 group-hover:bg-purple-600/20 transition"></div>
            <div className="relative flex items-center gap-3 text-purple-400 font-bold text-lg">
              {plagiarismLoading ? <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div> : <Search />}
              <span>{plagiarismLoading ? "جاري الفحص..." : "فحص البصمة الرقمية"}</span>
            </div>
          </button>
        </div>

        {/* 4. Results Section */}
        {result && result.success && (
          <div className="space-y-8 animate-fade-in-up">
            {isEvaluationError && (
              <div className="bg-amber-900/20 border border-amber-500/40 rounded-2xl p-5">
                <h3 className="text-amber-300 font-bold mb-2">تنبيه: تعذر إكمال التقييم الذكي</h3>
                <p className="text-amber-100 text-sm leading-relaxed">{typeof result.report === 'string' ? result.report : 'الخادم لم يُرجع تفاصيل كافية. يرجى التحقق من إعدادات API ثم إعادة المحاولة.'}</p>
              </div>
            )}

            <div className="relative bg-gray-900/80 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/10 rounded-full blur-[80px]"></div>
              <div className="relative z-10 flex flex-wrap justify-between items-center gap-8">
                <div>
                  <h2 className="text-3xl font-bold text-white mb-2">النتيجة النهائية</h2>
                  <div className={`text-6xl font-extrabold ${result.data.final_grade === 'REFER (FAIL)' ? 'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]' : result.data.final_grade === 'ERROR' ? 'text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]' : 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]'}`}>
                    {result.data.final_grade || "PENDING"}
                  </div>
                  {result.data.final_grade === 'REFER (FAIL)' && (
                    <p className="text-red-300 mt-2 max-w-xl text-sm border-r-2 border-red-500 pr-2">{typeof result.report === 'string' ? result.report : ''}</p>
                  )}
                </div>

                <div className="flex gap-8 text-center">
                  <div className="bg-gray-800/50 p-4 rounded-2xl border border-white/5">
                    <div className="text-gray-400 text-sm mb-1">المعايير</div>
                    <div className="text-3xl font-bold text-white">{result.data?.summary?.achievedCount ?? 0} <span className="text-gray-500 text-lg">/ {result.data?.summary?.totalCriteria ?? 0}</span></div>
                  </div>
                  <div className="bg-gray-800/50 p-4 rounded-2xl border border-white/5">
                    <div className="text-gray-400 text-sm mb-1">النسبة</div>
                    <div className="text-3xl font-bold text-blue-400">{result.data?.summary?.achievedPercent ?? 0}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-6">
              {(Array.isArray(result.data?.criteria) ? result.data.criteria : []).map((crit, idx) => (
                <div key={idx} className="bg-gray-800/40 backdrop-blur border border-white/5 rounded-2xl p-6 hover:bg-gray-800/60 transition duration-300">
                  <div className="flex justify-between items-center mb-4 pb-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <span className="bg-blue-600/20 text-blue-300 px-3 py-1 rounded-lg font-mono font-bold border border-blue-500/30">{crit.code}</span>
                      <h3 className="text-lg font-bold text-gray-200">نتائج المعيار</h3>
                    </div>
                    <span className={`px-4 py-1 rounded-full font-bold text-sm ${crit.verdict === 'Achieved' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                      {crit.verdict === 'Achieved' ? 'مستوفى' : 'غير مستوفى'}
                    </span>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-blue-400 font-bold mb-2 text-sm">الملاحظات والتحليل:</h4>
                      <ul className="space-y-2">
                        {crit.reasons.map((r, i) => (
                          <li key={i} className="text-gray-300 text-sm flex gap-2">
                            <span className="text-blue-500 mt-1">•</span>
                            {typeof r === 'string' ? r : typeof r === 'object' && r !== null && 'text' in (r as object) ? String((r as any).text) : JSON.stringify(r)}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {crit.evidence.length > 0 && (
                      <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                        <h4 className="text-yellow-500 font-bold mb-2 text-sm">الدليل المقتبس:</h4>
                        {crit.evidence.map((ev, i) => <p key={i} className="text-gray-400 text-sm italic border-r-2 border-yellow-500 pr-3">"{ev.quote}"</p>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plagiarism Modal */}
        {showPlagModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowPlagModal(false)}></div>
            <div className="relative bg-gray-900 border border-gray-600 w-full max-w-3xl rounded-3xl p-8 shadow-2xl transform transition-all scale-100">
              <button type="button" onClick={() => setShowPlagModal(false)} className="absolute top-4 left-4 text-gray-400 hover:text-white">✕</button>
              <h2 className="text-2xl font-bold text-purple-400 mb-8 flex items-center gap-3"><ShieldAlert className="w-8 h-8" /> تقرير البصمة الرقمية</h2>
              {plagiarismLoading ? (
                <div className="text-center py-12"><div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p className="text-gray-400">جاري مسح البصمة الرقمية...</p></div>
              ) : plagiarismResult && (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-gray-800/50 p-6 rounded-2xl text-center border border-purple-500/20"><div className="text-gray-400 mb-2">احتمالية AI</div><div className={`text-5xl font-bold ${plagiarismResult.ai.likelihood > 50 ? 'text-red-500' : 'text-green-500'}`}>{plagiarismResult.ai.likelihood}%</div></div>
                    <div className="bg-gray-800/50 p-6 rounded-2xl text-center border border-blue-500/20"><div className="text-gray-400 mb-2">التشابه</div><div className="text-5xl font-bold text-blue-400">{plagiarismResult.similarity}%</div></div>
                  </div>
                  <div className="bg-purple-900/10 p-6 rounded-2xl border border-purple-500/20"><h3 className="font-bold text-purple-300 mb-2">تقرير الأسلوب:</h3><p className="text-gray-300 leading-relaxed">{plagiarismResult.ai.report}</p></div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}