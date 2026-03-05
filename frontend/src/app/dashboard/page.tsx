"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import "../globals.css";

const DrHamzaOrb = dynamic(() => import("@/components/avatar/DrHamzaOrb"), { ssr: false });

type GradingResult = {
  final_grade: string;
  criteria: Record<string, { achieved: boolean; feedback: string }>;
};

type PlagiarismResult = {
  similarity: number;
  ai: { likelihood: number; report: string };
};

const DashboardPage = () => {
  const [assignmentText, setAssignmentText] = useState("");
  const [studentSubmission, setStudentSubmission] = useState("");
  const [loading, setLoading] = useState(false);
  const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismResult | null>(null);
  const [error, setError] = useState<string>("");

  const handleGrade = async () => {
    if (!studentSubmission.trim() || studentSubmission.trim().length < 50) {
      setError("إجابة الطالب قصيرة جداً. الحد الأدنى 50 حرف.");
      return;
    }
    if (!assignmentText.trim() || assignmentText.trim().length < 20) {
      setError("نص الواجب قصير جداً. الحد الأدنى 20 حرف.");
      return;
    }
    setLoading(true);
    setError("");
    setGradingResult(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_text: studentSubmission,
          assignment_text: `${assignmentText}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "فشل التقييم");
      }
      if (!data.success || !data.data) {
        throw new Error(data.report || "لم يُرجَع نتيجة صالحة");
      }
      const d = data.data;
      const criteriaObj: Record<string, { achieved: boolean; feedback: string }> = {};
      for (const c of d.criteria || []) {
        criteriaObj[c.code] = {
          achieved: c.verdict === "Achieved",
          feedback: (c.reasons || []).join(" ") || (c.recommendations || []).join(" ") || "—",
        };
      }
      setGradingResult({
        final_grade: d.final_grade || "PENDING",
        criteria: criteriaObj,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckPlagiarism = async () => {
    if (!studentSubmission.trim()) {
      setError("أدخل إجابة الطالب أولاً.");
      return;
    }
    setLoading(true);
    setError("");
    setPlagiarismResult(null);
    try {
      const res = await fetch("/api/plagiarism", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: studentSubmission }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "فشل فحص الانتحال");
      }
      setPlagiarismResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-500 to-purple-500 p-6" dir="rtl">
      <div className="max-w-4xl mx-auto bg-white bg-opacity-30 backdrop-blur-md rounded-lg p-6 shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-4">لوحة التحكم</h1>

        {/* ─── زر الأفاتار التفاعلي ──────────────────────────────────── */}
        <div className="flex justify-center mb-6">
          <Link
            href="/evaluate"
            className="group flex items-center gap-3 px-6 py-3 rounded-full text-white font-bold text-base shadow-lg transition-all duration-300"
            style={{
              background: 'linear-gradient(135deg, #06b6d4 0%, #7c3aed 100%)',
              boxShadow: '0 0 24px rgba(6,182,212,0.45), 0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ fontSize: '1.4rem' }}>🤖</span>
            <span>الدردشة مع د. حمزة (الأفاتار التفاعلي)</span>
            <span className="opacity-70 group-hover:opacity-100 transition-opacity">←</span>
          </Link>
        </div>

        <div className="mb-4">
          <label htmlFor="assignment-text" className="block text-sm font-medium mb-2">نص الواجب (مطلوب للتقييم)</label>
          <textarea
            id="assignment-text"
            name="assignment_text"
            autoComplete="off"
            className="w-full p-3 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-gray-900"
            rows={3}
            value={assignmentText}
            onChange={(e) => setAssignmentText(e.target.value)}
            placeholder="أدخل نص الواجب هنا (20 حرف على الأقل)"
            aria-label="نص الواجب"
          />
        </div>

        <div className="mb-4">
          <label htmlFor="student-submission" className="block text-sm font-medium mb-2">إجابة الطالب</label>
          <textarea
            id="student-submission"
            name="student_submission"
            autoComplete="off"
            className="w-full p-3 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-gray-900"
            rows={6}
            value={studentSubmission}
            onChange={(e) => setStudentSubmission(e.target.value)}
            placeholder="أدخل إجابة الطالب هنا (50 حرف على الأقل)"
            aria-label="إجابة الطالب"
          />
        </div>

        <div className="flex gap-4 mb-6">
          <button
            className="flex items-center justify-center px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 focus:outline-none"
            onClick={handleGrade}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin mr-2" /> : "تصحيح الواجب"}
          </button>
          <button
            className="flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none"
            onClick={handleCheckPlagiarism}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin mr-2" /> : "فحص الاستلال والذكاء الاصطناعي"}
          </button>
        </div>

        {error && <p className="text-red-500 text-center mb-4">{error}</p>}

        {gradingResult && (
          <div className="bg-white p-4 rounded-md shadow-md text-gray-900">
            <h2 className="text-lg font-bold mb-2">نتيجة التصحيح</h2>
            <p
              className={`text-sm font-medium ${gradingResult.final_grade === "REFER (FAIL)" || gradingResult.final_grade === "Referral"
                  ? "text-red-500"
                  : "text-green-500"
                }`}
            >
              {gradingResult.final_grade}
            </p>
            <ul className="mt-2">
              {Object.entries(gradingResult.criteria).map(([key, value]) => (
                <li key={key} className="text-sm mb-1">
                  <span className="font-bold">{key}:</span> {value.achieved ? "تم تحقيقه" : "لم يتم تحقيقه"} - {value.feedback}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plagiarismResult && (
          <div className="bg-white p-4 rounded-md shadow-md mt-4">
            <h2 className="text-lg font-bold mb-2">نتيجة فحص الاستلال</h2>
            <p className="text-sm font-medium">نسبة التشابه: {plagiarismResult.similarity}%</p>
            <p className="text-sm font-medium">احتمالية الذكاء الاصطناعي: {plagiarismResult.ai.likelihood}%</p>
            <p className="text-sm mt-2">{plagiarismResult.ai.report}</p>
          </div>
        )}
      </div>
      <DrHamzaOrb />
    </div>
  );
};

export default DashboardPage;