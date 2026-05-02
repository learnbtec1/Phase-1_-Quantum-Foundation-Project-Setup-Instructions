"use client";

import { useMemo, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/lovable-ui/ui/dialog";
import { Button } from "@/components/lovable-ui/ui/button";
import { Input } from "@/components/lovable-ui/ui/input";
import { Label } from "@/components/lovable-ui/ui/label";
import { Textarea } from "@/components/lovable-ui/ui/textarea";
import { fetchWithSession, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import { cn } from "@/lib/utils";

const EXPORT_PATH = "/api/v1/export/btec-word";

/** Placeholder until assessment results are wired into export. */
const DUMMY_CRITERIA = [
  { criterion_id: "B.P1", achieved: "YES", feedback: "Dummy — replace when assessment is connected." },
  { criterion_id: "B.M1", achieved: "NO", feedback: "Dummy — evidence required." },
];

const DUMMY_GENERAL_FEEDBACK =
  "Dummy general feedback for template testing — connect real assessment output later.";

type GradedCriterionPayload = {
  criterion_id: string;
  achieved: string;
  feedback: string;
};

type BtecExportPayload = {
  student_reg_no: string;
  student_name: string;
  assignment_title: string;
  assessor_name: string;
  unit_title: string;
  submission_date: string;
  deadline_date: string;
  feedback_date: string;
  general_feedback: string;
  graded_criteria: GradedCriterionPayload[];
};

type Props = {
  /** Reserved for future injection of submission body into export. */
  text?: string;
  className?: string;
};

function safeFileBase(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "export";
}

export function BtecExportDialog({ className }: Props) {
  const [open, setOpen] = useState(false);
  const [studentRegNo, setStudentRegNo] = useState("");
  const [studentName, setStudentName] = useState("");
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assessorName, setAssessorName] = useState("");
  const [unitTitle, setUnitTitle] = useState("");
  const [submissionDate, setSubmissionDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [feedbackDate, setFeedbackDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [generalFeedback, setGeneralFeedback] = useState(DUMMY_GENERAL_FEEDBACK);
  const [loading, setLoading] = useState(false);

  const gradedCriteria = useMemo(() => DUMMY_CRITERIA.map((c) => ({ ...c })), []);

  const handleDownload = async () => {
    if (
      !studentRegNo.trim() ||
      !studentName.trim() ||
      !assignmentTitle.trim() ||
      !assessorName.trim() ||
      !unitTitle.trim() ||
      !submissionDate.trim() ||
      !deadlineDate.trim() ||
      !feedbackDate.trim()
    ) {
      toast.error("أكمل الحقول المطلوبة.");
      return;
    }

    const payload: BtecExportPayload = {
      student_reg_no: studentRegNo.trim(),
      student_name: studentName.trim(),
      assignment_title: assignmentTitle.trim(),
      assessor_name: assessorName.trim(),
      unit_title: unitTitle.trim(),
      submission_date: submissionDate.trim(),
      deadline_date: deadlineDate.trim(),
      feedback_date: feedbackDate.trim(),
      general_feedback: (generalFeedback.trim() || DUMMY_GENERAL_FEEDBACK).trim(),
      graded_criteria: gradedCriteria,
    };

    setLoading(true);
    try {
      const response = await fetchWithSession(EXPORT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        const d = await readFastApiDetail(response);
        if (shouldSignOutOn401(d)) {
          toast.error("انتهت الجلسة — سجّل الدخول من جديد.");
          signOutOnUnauthorized();
        } else {
          toast.error(d || "غير مصرّح");
        }
        return;
      }
      if (!response.ok) {
        const d = await readFastApiDetail(response);
        throw new Error(d || "Export failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BTEC_${safeFileBase(payload.student_name)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("تم التنزيل");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          className={cn(
            "group relative flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden",
            "rounded-xl border border-emerald-500/40 px-5 py-3 text-sm font-semibold text-emerald-50",
            "bg-gradient-to-l from-emerald-900/80 to-slate-900/60",
            "shadow-[0_0_24px_rgba(16,185,129,0.3),inset_0_1px_0_rgba(255,255,255,0.08)]",
            "backdrop-blur-xl transition duration-200 ease-out hover:scale-[1.02] active:scale-[0.98]",
            className,
          )}
        >
          <FileDown className="h-5 w-5 shrink-0" aria-hidden />
          تصدير واجب BTEC
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[min(92dvh,800px)] overflow-y-auto border border-emerald-500/20 bg-slate-950/90 shadow-[0_0_48px_rgba(16,185,129,0.12)] backdrop-blur-xl sm:max-w-lg"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="text-lg text-emerald-100">تصدير سجل BTEC (docxtpl)</DialogTitle>
          <DialogDescription className="text-slate-400">
            يُملأ القالب <span className="font-mono text-slate-300">btec_record.docx</span> فقط عبر{" "}
            <strong className="text-slate-200">DocxTemplate</strong>. معايير الاختبار ثابتة (B.P1 / B.M1) حتى يُربط
            التقييم.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[55vh] gap-3 overflow-y-auto pr-1 py-2 sm:max-h-[60vh]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="btec-reg">رقم تسجيل الطالب</Label>
              <Input
                id="btec-reg"
                value={studentRegNo}
                onChange={(e) => setStudentRegNo(e.target.value)}
                className="border-white/10 bg-white/[0.04] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="btec-student">اسم الطالب</Label>
              <Input
                id="btec-student"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="border-white/10 bg-white/[0.04]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="btec-assignment">عنوان الواجب</Label>
            <Input
              id="btec-assignment"
              value={assignmentTitle}
              onChange={(e) => setAssignmentTitle(e.target.value)}
              className="border-white/10 bg-white/[0.04]"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="btec-assessor">اسم المقيّم</Label>
              <Input
                id="btec-assessor"
                value={assessorName}
                onChange={(e) => setAssessorName(e.target.value)}
                className="border-white/10 bg-white/[0.04]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="btec-unit">عنوان الوحدة</Label>
              <Input
                id="btec-unit"
                value={unitTitle}
                onChange={(e) => setUnitTitle(e.target.value)}
                className="border-white/10 bg-white/[0.04]"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="btec-sub">تاريخ التسليم</Label>
              <Input
                id="btec-sub"
                type="text"
                value={submissionDate}
                onChange={(e) => setSubmissionDate(e.target.value)}
                className="border-white/10 bg-white/[0.04]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="btec-dl">آخر أجل</Label>
              <Input
                id="btec-dl"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="border-white/10 bg-white/[0.04]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="btec-fbdate">تاريخ التغذية الراجعة (افتراضي: اليوم)</Label>
            <Input
              id="btec-fbdate"
              value={feedbackDate}
              onChange={(e) => setFeedbackDate(e.target.value)}
              className="border-white/10 bg-white/[0.04]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="btec-gen">تغذية راجعة عامة</Label>
            <Textarea
              id="btec-gen"
              value={generalFeedback}
              onChange={(e) => setGeneralFeedback(e.target.value)}
              rows={3}
              className="resize-y border-white/10 bg-white/[0.04] text-sm"
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            disabled={loading}
            onClick={() => void handleDownload()}
            className="inline-flex w-full items-center justify-center gap-2 border border-emerald-500/30 bg-emerald-600/90 text-white shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:bg-emerald-500"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                جاري توليد المستند…
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4 shrink-0" aria-hidden />
                <span className="font-bold">Download BTEC Document</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
