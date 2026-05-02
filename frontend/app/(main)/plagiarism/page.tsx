"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/lovable-ui/ui/table";
import { ScrollArea } from "@/components/lovable-ui/ui/scroll-area";
import { fetchWithSession, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import { Upload } from "lucide-react";
import { Textarea } from "@/components/lovable-ui/ui/textarea";
import { Label } from "@/components/lovable-ui/ui/label";
import { cn } from "@/lib/utils";
import { fetchUsageMe, isAtLimit, isNearLimit, type UsageMe } from "@/lib/usage";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/lovable-ui/ui/button";
import { consumeEduverseDraftText } from "@/lib/eduverseDraft";

type CopiedEvidenceItem = {
  text: string;
  length: number;
  confidence: number;
  source_id: string;
};

type Hit = {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  source_id: string | null;
  distance: number;
  similarity: number;
  ngram_overlap?: number | null;
  integrity_score?: number | null;
  risk?: { band: string; reasons: string[] } | null;
  risk_band?: string | null;
  copied_evidence?: CopiedEvidenceItem[];
  component_semantic?: number | null;
  component_ngram?: number | null;
  component_citation?: number | null;
  component_ai_effective?: number | null;
  component_behavioral_effective?: number | null;
  component_citation_inflation_damped?: boolean | null;
  weight_profile?: string | null;
  weights_used?: Record<string, number> | null;
};

function hitToIntegritySnapshot(r: Hit): Record<string, unknown> {
  return {
    component_semantic: r.component_semantic ?? undefined,
    component_ngram: r.component_ngram ?? undefined,
    component_citation: r.component_citation ?? undefined,
    component_ai_effective: r.component_ai_effective ?? undefined,
    component_behavioral_effective: r.component_behavioral_effective ?? undefined,
    integrity_score: r.integrity_score ?? undefined,
    risk_band: r.risk_band ?? r.risk?.band,
  };
}

type IntegritySummary = {
  max_final_score: number;
  max_risk_band: string;
  has_any_high_risk: boolean;
  integrity_version?: string;
  distribution?: {
    counts: { low: number; review: number; high_risk: number };
    percent: { low: number; review: number; high_risk: number };
  };
};

export default function PlagiarismPage() {
  const { language } = useAppTheme();
  const ar = language === "ar";
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [results, setResults] = useState<Hit[]>([]);
  const [queryCitation, setQueryCitation] = useState<number | null>(null);
  const [integritySummary, setIntegritySummary] = useState<IntegritySummary | null>(null);
  const [integrityVersion, setIntegrityVersion] = useState<string | null>(null);
  const [corpusChunkCount, setCorpusChunkCount] = useState<number | null>(null);
  const [searchFallback, setSearchFallback] = useState(false);
  const [usage, setUsage] = useState<UsageMe | null>(null);
  /** Pasted / Workspace handoff text — same vector search as an uploaded file. */
  const [pastedText, setPastedText] = useState("");
  const [teacherNote, setTeacherNote] = useState("");
  const [teacherLabel, setTeacherLabel] = useState<string>("");
  const [studentId, setStudentId] = useState("");
  const [attachFirstSnapshot, setAttachFirstSnapshot] = useState(true);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const fileInputId = useId();
  const fileInputFieldId = `plagiarism-file-${fileInputId}`;

  const loadUsage = useCallback(async () => {
    setUsage(await fetchUsageMe());
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  /** Golden Flow: auto-fill from Workspace, then clear one-shot key. */
  useEffect(() => {
    const d = consumeEduverseDraftText();
    if (d) setPastedText(d);
  }, []);

  const plagLimitBlocked = useMemo(
    () =>
      usage != null &&
      usage.plagiarism_limit >= 0 &&
      isAtLimit(usage.plagiarism_used, usage.plagiarism_limit),
    [usage]
  );
  const plagNearLimit = useMemo(
    () =>
      usage != null &&
      usage.plagiarism_limit >= 0 &&
      isNearLimit(usage.plagiarism_used, usage.plagiarism_limit) &&
      !isAtLimit(usage.plagiarism_used, usage.plagiarism_limit),
    [usage]
  );

  const runPlagiarismSearchOnText = useCallback(
    async (rawText: string, displayName: string) => {
      const fresh = await fetchUsageMe();
      if (fresh) setUsage(fresh);
      if (
        fresh &&
        fresh.plagiarism_limit >= 0 &&
        isAtLimit(fresh.plagiarism_used, fresh.plagiarism_limit)
      ) {
        toast.error(
          ar ? "تم بلوغ حد الاستخدام. يرجى ترقية الخطة." : "Usage limit reached. Please upgrade your plan."
        );
        return;
      }
      setBusy(true);
      setFileName(displayName);
      setResults([]);
      setQueryCitation(null);
      setIntegritySummary(null);
      setIntegrityVersion(null);
      setCorpusChunkCount(null);
      setSearchFallback(false);
      try {
        const q = rawText.replace(/\s+/g, " ").trim();
        if (q.length < 40) {
          toast.error(
            ar
              ? "النص قصير جداً (40 حرفاً على الأقل). أطيل النص أو استخدم ملفاً أكبر."
              : "Text is too short (at least 40 characters). Paste more or use a larger file."
          );
          return;
        }
        const snippet = q.slice(0, 12_000);
        const res = await fetchWithSession("/api/v1/vectors/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: snippet, top_k: 20 }),
        });
        if (res.status === 401) {
          const d401 = await readFastApiDetail(res);
          if (shouldSignOutOn401(d401)) {
            toast.error(ar ? "انتهت الجلسة. سجّل الدخول من جديد." : "Session expired. Please sign in.");
            signOutOnUnauthorized();
          } else {
            console.warn("401 without session-style detail:", d401);
            toast.error(d401 || (ar ? "غير مصرّح" : "Unauthorized"));
          }
          return;
        }
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { detail?: string };
          throw new Error(d.detail || (ar ? "فشل البحث" : "Search failed"));
        }
        const out = (await res.json()) as {
          results: Hit[];
          corpus_chunk_count?: number;
          query_citation_signal?: number | null;
          integrity_summary?: IntegritySummary | null;
          integrity_version?: string;
          fallback?: boolean;
        };
        const chunksInDb = typeof out.corpus_chunk_count === "number" ? out.corpus_chunk_count : null;
        setCorpusChunkCount(chunksInDb);
        setSearchFallback(!!out.fallback);
        if (out.fallback) {
          toast.message(
            ar
              ? "فشل تضمين الاستعلام (تحقق من OPENAI_API_KEY والشبكة). لم تُرجع نتائج."
              : "Embedding failed (check OPENAI_API_KEY and network). No matches returned."
          );
          setResults([]);
          return;
        }
        setResults(out.results || []);
        setQueryCitation(
          out.query_citation_signal != null && Number.isFinite(out.query_citation_signal)
            ? out.query_citation_signal
            : null
        );
        setIntegritySummary(out.integrity_summary ?? null);
        setIntegrityVersion(out.integrity_version ?? null);
        if (chunksInDb === 0) {
          toast.error(
            ar
              ? "فهرس المتجهات فارغ — ابدأ بإدخال المستندات المرجعية (راجع التعليمات أدناه)."
              : "Vector index is empty — ingest reference documents first (see on-screen steps)."
          );
        } else {
          toast.success(
            ar
              ? `وُجد ${out.results?.length ?? 0} شبه مقطع (الفهرس: ${chunksInDb} مقطع/مقاطع)`
              : `Found ${out.results?.length ?? 0} similar chunk(s) (index: ${chunksInDb} chunk(s))`
          );
        }
        void loadUsage();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : ar ? "خطأ" : "Error");
      } finally {
        setBusy(false);
      }
    },
    [loadUsage, ar]
  );

  const runCheck = useCallback(
    async (file: File) => {
      try {
        let text: string;
        const ext = file.name.toLowerCase();
        if (ext.endsWith(".txt") || ext.endsWith(".md")) {
          text = await file.text();
        } else {
          const fd = new FormData();
          fd.append("file", file);
          const pr = await fetch("/api/parse-file", { method: "POST", body: fd });
          if (!pr.ok) {
            const e = (await pr.json().catch(() => ({}))) as { error?: string };
            throw new Error(e.error || (ar ? "تعذّر قراءة الملف" : "Could not read file"));
          }
          const data = (await pr.json()) as { text?: string };
          text = data.text || "";
        }
        const q = text.replace(/\s+/g, " ").trim();
        if (q.length < 40) {
          toast.error(
            ar
              ? "النص المستخرج قصير جداً. استخدم مستنداً أطول."
              : "Extracted text is too short. Use a longer document."
          );
          return;
        }
        await runPlagiarismSearchOnText(text, file.name);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : ar ? "خطأ" : "Error");
      }
    },
    [ar, runPlagiarismSearchOnText]
  );

  const runCheckOnPasted = useCallback(() => {
    const label = ar ? "مسودة-مساحة-العمل.txt" : "workspace-draft.txt";
    void runPlagiarismSearchOnText(pastedText, label);
  }, [ar, pastedText, runPlagiarismSearchOnText]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void runCheck(f);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      void runCheck(f);
    }
    e.target.value = "";
  }

  const submitTeacherFeedback = useCallback(async () => {
    const t = teacherNote.trim();
    if (t.length < 1) {
      toast.error(
        ar ? "أضف ملاحظة قصيرة (ما يبدو خطأ أو صواباً)." : "Add a short note (what looks wrong or right).",
      );
      return;
    }
    setFeedbackBusy(true);
    try {
      const snap =
        attachFirstSnapshot && results[0] ? hitToIntegritySnapshot(results[0]) : undefined;
      const res = await fetchWithSession("/api/v1/integrity/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: t,
          student_id: studentId.trim() || undefined,
          action_taken: "note",
          teacher_label: teacherLabel.trim() || undefined,
          integrity_snapshot: snap,
        }),
      });
      if (res.status === 401) {
        const d401 = await readFastApiDetail(res);
        if (shouldSignOutOn401(d401)) signOutOnUnauthorized();
        toast.error(ar ? "انتهت الجلسة أو ليس لديك صلاحية" : "Session expired or unauthorized");
        return;
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(d.detail || (ar ? "فشل حفظ الملاحظة" : "Feedback failed"));
      }
      setTeacherNote("");
      toast.success(
        ar
          ? "تم حفظ الملاحظة (للتحسين الذاتي عند وجود تسمية + لقطة ميزات)"
          : "Feedback saved (used for self-tuning when labels + snapshot are present).",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ar ? "خطأ" : "Error");
    } finally {
      setFeedbackBusy(false);
    }
  }, [teacherNote, studentId, teacherLabel, attachFirstSnapshot, results, ar]);

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      <p className="text-sm text-muted-foreground max-w-2xl">
        {ar ? (
          <>
            تُقارن المرفوعات مع <strong>فهرس المتجهات</strong> لديك. يعيد الـ API<strong> تشابهاً دلالياً</strong> و
            <strong>تداخلاً N-gram</strong> و<strong>درجة نزاهة مركّبة</strong> (عدة إشارات، وليست نسبة «ذكاء اصطناعي»
            واحدة). للاستخدام كفرز أولي للمعلّقين — وليس حكماً قانونياً مستقلاً.
          </>
        ) : (
          <>
            Uploads are compared to your vector corpus. The API returns <strong>semantic</strong> similarity plus{" "}
            <strong>word n-gram overlap</strong> and a <strong>composite integrity score</strong> (multi-signal, not a
            single &quot;AI %&quot; verdict). Use as triage for educators — not a stand-alone legal finding.
          </>
        )}
      </p>
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>{ar ? "رفع المستند" : "Document upload"}</CardTitle>
          <CardDescription>
            {ar ? (
              <>
                اختر ملفاً من نافذة الجهاز (سطح المكتب) — PDF / DOCX / PPT / نص. يُستخرج النص عبر{" "}
                <code className="text-xs">/api/parse-file</code> ثم يُرسل للمقارنة مع الفهرس.
              </>
            ) : (
              <>
                Choose a file from your device — PDF / DOCX / PPT / text. Text is extracted via{" "}
                <code className="text-xs">/api/parse-file</code> then sent to the index.
              </>
            )}
          </CardDescription>
          {plagLimitBlocked && (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground" role="alert">
              لقد وصلتَ إلى حد فحوصات الانتحال الشهري. يرجى ترقية الخطة.
            </p>
          )}
          {plagNearLimit && !plagLimitBlocked && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm" role="status">
              ⚠️ اقتربت من الحد المسموح لفحوصات الانتحال.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="plagiarism-paste-work" className="text-foreground/90">
              {ar
                ? "أو الصق نص الحل (مثلاً من «مساحة العمل») ثم اضغط الفحص"
                : "Or paste your work (e.g. from Workspace), then run the check"}
            </Label>
            <Textarea
              id="plagiarism-paste-work"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              disabled={plagLimitBlocked}
              readOnly={busy}
              dir="auto"
              placeholder={ar ? "نص يبلغ 40 حرفاً على الأقل…" : "At least 40 characters…"}
              className="min-h-[7rem] resize-y text-sm"
            />
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              disabled={busy || plagLimitBlocked}
              onClick={runCheckOnPasted}
            >
              {busy
                ? ar
                  ? "جاري الفحص…"
                  : "Checking…"
                : ar
                  ? "فحص النص المُلصق"
                  : "Check pasted text"}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {ar ? "— أو ارفع ملفاً —" : "— or upload a file —"}
          </p>

          <label
            htmlFor={fileInputFieldId}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={plagLimitBlocked ? (e) => e.preventDefault() : onDrop}
            className={cn(
              "flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-300",
              plagLimitBlocked
                ? "pointer-events-none cursor-not-allowed opacity-50"
                : "cursor-pointer",
              !plagLimitBlocked &&
                (drag
                  ? "border-primary/80 bg-primary/10 shadow-lg shadow-primary/25 ring-2 ring-primary/20"
                  : "border-primary/30 bg-primary/[0.04] hover:border-primary/50 hover:bg-primary/[0.07] hover:shadow-md"),
            )}
          >
            <input
              id={fileInputFieldId}
              type="file"
              className="sr-only"
              accept=".pdf,.docx,.pptx,.txt,.md"
              onChange={onFile}
              disabled={plagLimitBlocked}
            />
            <Upload className="mb-2 h-12 w-12 text-primary drop-shadow-[0_0_12px_hsl(var(--primary)/0.5)]" />
            <p className="text-sm font-semibold text-foreground">اسحب الملف هنا أو انقر في المنطقة</p>
            <p className="mt-1 text-xs text-muted-foreground">نفس اختيار «اختر من الجهاز» — يفتح مربع حوار الملفات</p>
            <span className="btn-glow pointer-events-none mt-4 inline-flex">
              <Upload className="h-4 w-4" />
              اختر ملفاً من سطح المكتب
            </span>
            {fileName && (
              <p className="mt-4 text-xs text-muted-foreground">
                آخر ملف: <span className="font-mono text-foreground">{fileName}</span>{" "}
                {busy && "— جاري المعالجة…"}
              </p>
            )}
          </label>
        </CardContent>
      </Card>

      {(corpusChunkCount === 0 || searchFallback) && (
        <Card
          className={cn(
            "border-amber-500/50 bg-amber-500/5",
            searchFallback && "border-destructive/40 bg-destructive/5",
          )}
        >
          <CardHeader>
            <CardTitle className="text-base">
              {searchFallback
                ? ar
                  ? "خدمة تضمين (Embedding)"
                  : "Embedding service"
                : ar
                  ? "لا يوجد فهرس متجهات"
                  : "No vector corpus"}
            </CardTitle>
            <CardDescription className="space-y-2 text-foreground/90">
              <div className="space-y-2">
                {searchFallback ? (
                  <p>
                    {ar ? (
                      <>
                        تعذّر على الـ API إنشاء تضمين للاستعلام. عيّن <code className="text-xs">OPENAI_API_KEY</code> صالحاً
                        في الخادم، وتأكد من الحصّة/الفوترة واتصال التطبيق بـ OpenAI، ثم أعد المحاولة.
                      </>
                    ) : (
                      <>
                        The API could not create a query embedding. Set a valid <code className="text-xs">OPENAI_API_KEY</code> on
                        the backend, confirm billing/quota, and that the app can reach OpenAI. Then try again.
                      </>
                    )}
                  </p>
                ) : (
                  <>
                    <p>
                      {ar ? (
                        <>
                          <strong>صفر سجل</strong> في جدول <code className="text-xs">embedding_chunks</code> — التشابه الدلالي
                          لا يقارن رفعك بشيء، فتكون قائمة التطابقات فارغة.
                        </>
                      ) : (
                        <>
                          <strong>There are 0 rows</strong> in the <code className="text-xs">embedding_chunks</code> table. Semantic
                          similarity has nothing to compare your upload against, so the match list is empty.
                        </>
                      )}
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>
                        {ar ? (
                          <>
                            ضع PDF/DOCX/PPTX/TXT في <code className="text-xs">backend/data</code> (أو عرّف{" "}
                            <code className="text-xs">LOCAL_RAG_DIR</code> في <code className="text-xs">.env</code>).
                          </>
                        ) : (
                          <>
                            Put PDF/DOCX/PPTX/TXT under <code className="text-xs">backend/data</code> (or set{" "}
                            <code className="text-xs">LOCAL_RAG_DIR</code> in <code className="text-xs">.env</code>).
                          </>
                        )}
                      </li>
                      <li>
                        {ar ? (
                          <>
                            نفّذ سكربت الاستيراد (نفس قاعدة بيانات الـ API):{" "}
                            <code className="text-xs break-all">{"cd backend && python scripts/ingest_data.py"}</code>
                          </>
                        ) : (
                          <>
                            Run the ingest script (same DB as the API):{" "}
                            <code className="text-xs break-all">{"cd backend && python scripts/ingest_data.py"}</code>
                          </>
                        )}
                      </li>
                      <li>
                        {ar ? (
                          <>
                            استخدم نفس <code className="text-xs">OPENAI_API_KEY</code> و<code className="text-xs">DATABASE_URL</code>{" "}
                            كتشغيل الـ API (مثلاً Docker: استيراد من المضيف على منفذ Postgres المنشور).
                          </>
                        ) : (
                          <>
                            Use the same <code className="text-xs">OPENAI_API_KEY</code> and <code className="text-xs">DATABASE_URL</code>{" "}
                            as the running API (e.g. Docker: ingest from host against the published Postgres port).
                          </>
                        )}
                      </li>
                    </ol>
                  </>
                )}
              </div>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {(queryCitation != null || integritySummary) && results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{ar ? "مؤشرات على مستوى المستند" : "Document-level signals"}</CardTitle>
            <CardDescription>
              {ar
                ? "توقّع اقتباس (استدلالي) وأسوأ حالة مع التطابق"
                : "Submission-level citation heuristic and worst-case match row"}
              {integrityVersion ? (
                <span className="ml-1 font-mono text-xs text-muted-foreground/90">
                  ({ar ? "نزاهة" : "integrity"} {integrityVersion})
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            {queryCitation != null && (
              <p>
                {ar ? "صيغ شبه-اقتباس في نصك:" : "Citation-like patterns in your text:"}{" "}
                <span className="font-mono text-foreground">{(queryCitation * 100).toFixed(0)}%</span>{" "}
                {ar
                  ? "(استدلال تقريبي، ليس إثبات مراجع صحيحة)"
                  : "(heuristic, not proof of correct referencing)."}
              </p>
            )}
            {integritySummary && (
              <>
                <p>
                  {ar ? "أعلى درجة مركّبة:" : "Highest composite:"}{" "}
                  <span className="font-mono text-foreground">
                    {(integritySummary.max_final_score * 100).toFixed(1)}%
                  </span>
                  {ar ? " — أسوأ نطاق: " : " — worst band: "}
                  <span className="font-medium text-foreground">{integritySummary.max_risk_band}</span>
                  {integritySummary.has_any_high_risk && (
                    <span className="text-destructive">
                      {ar ? " (يوجد سطر high_risk على الأقل)" : " (at least one high_risk row)"}
                    </span>
                  )}
                </p>
                {integritySummary.distribution && (
                  <p>
                    {ar ? "التوزيع — أعداد: منخفض" : "Row distribution — counts: low"}{" "}
                    {integritySummary.distribution.counts.low} · {ar ? "مراجعة" : "review"}{" "}
                    {integritySummary.distribution.counts.review} · high_risk {integritySummary.distribution.counts.high_risk}
                    {integritySummary.distribution.percent && (
                      <span>
                        {" "}
                        · %: low {(integritySummary.distribution.percent.low * 100).toFixed(0)}% · review{" "}
                        {(integritySummary.distribution.percent.review * 100).toFixed(0)}% · high_risk{" "}
                        {(integritySummary.distribution.percent.high_risk * 100).toFixed(0)}%
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{ar ? "نتائج التطابق" : "Match results"}</CardTitle>
            <CardDescription>
              {ar ? (
                <>
                  Sem = جيب تمام المتجه. N-gram = أقصى تداخل متوازن. التحويل إلى «حرفي» عند n-gram &gt; 0.6. غياب
                  مكوّنات AI/السلوك يُعامل حيادياً.
                </>
              ) : (
                <>
                  Semantic = vector cosine. N-gram = balanced max(inter/|A|, inter/|B|). Weights switch to
                  &quot;literal&quot; when n-gram &gt; 0.6. AI/behavioral default to neutral when absent.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[480px] w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">{ar ? "نهائي" : "Final"}</TableHead>
                    <TableHead className="w-[70px]">N-gram</TableHead>
                    <TableHead className="w-[90px]">{ar ? "مخاطر" : "Risk"}</TableHead>
                    <TableHead className="w-[100px]">{ar ? "تشابه" : "Sem"}</TableHead>
                    <TableHead className="w-[200px]">{ar ? "ملف المصدر" : "Source file"}</TableHead>
                    <TableHead>{ar ? "التطابق + أدلة + أسباب" : "Match + evidence + reasons"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => {
                    const src =
                      (r.metadata && typeof r.metadata === "object" && "source_file" in r.metadata
                        ? String((r.metadata as { source_file?: string }).source_file)
                        : null) || r.source_id || "—";
                    const simRaw = r.similarity;
                    const simPct =
                      simRaw == null || !Number.isFinite(Number(simRaw))
                        ? "—"
                        : (Number(simRaw) * 100).toFixed(0);
                    const fin = r.integrity_score;
                    const finStr =
                      fin == null || !Number.isFinite(Number(fin)) ? "—" : (Number(fin) * 100).toFixed(0);
                    const ngr = r.ngram_overlap;
                    const ngrStr =
                      ngr == null || !Number.isFinite(Number(ngr)) ? "—" : (Number(ngr) * 100).toFixed(0);
                    const risk = (r.risk?.band ?? r.risk_band) || "—";
                    const reasons = r.risk?.reasons?.length
                      ? r.risk.reasons
                      : [];
                    const ev = (r.copied_evidence || []).filter((x) => x && x.text);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm font-medium">{finStr}%</TableCell>
                        <TableCell className="font-mono text-sm">{ngrStr}%</TableCell>
                        <TableCell className="text-xs align-top">
                          <div className="capitalize">
                            {risk === "high_risk" ? (
                              <span className="text-destructive font-medium">
                                {ar ? "خطر عالٍ" : "high"}
                              </span>
                            ) : risk === "review" ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                {ar ? "مراجعة" : "review"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{risk}</span>
                            )}
                          </div>
                          {reasons.length > 0 && (
                            <p className="mt-1 text-[10px] leading-tight text-muted-foreground break-words font-mono">
                              {reasons.join(", ")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{simPct}%</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm" title={src}>
                          {src}
                        </TableCell>
                        <TableCell className="max-w-0 text-sm text-muted-foreground">
                          <p className="line-clamp-2 whitespace-pre-wrap break-words">{r.content}</p>
                          {r.weight_profile && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                              {ar ? "مِيزان:" : "profile:"} {r.weight_profile}
                              {r.weights_used && (
                                <span className="ml-1 font-mono">
                                  sem {r.weights_used.semantic?.toFixed(2)} ngr {r.weights_used.ngram?.toFixed(2)} ai{" "}
                                  {r.weights_used.ai?.toFixed(2)} cit {r.weights_used.citation?.toFixed(2)} beh{" "}
                                  {r.weights_used.behavioral?.toFixed(2)}
                                </span>
                              )}
                            </p>
                          )}
                          {r.component_citation_inflation_damped && (
                            <p className="text-[10px] text-amber-700/90 dark:text-amber-400/90">
                              {ar
                                ? "تم تخفيف إشارة الاقتباس (اقتباس مرتفع + تشابه عالٍ جداً)"
                                : "citation signal damped (high cit + very high sim)"}
                            </p>
                          )}
                          {ev.length > 0 && (
                            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-foreground/90">
                              {ev.map((c, i) => (
                                <li key={i} title={c.source_id}>
                                  <span className="font-medium">{(c.confidence * 100).toFixed(0)}%</span> — «
                                  {c.text.length > 64 ? `${c.text.slice(0, 64)}…` : c.text}» ({c.length}{" "}
                                  {ar ? "حرف" : "chars"}, <code className="text-[10px]">{c.source_id}</code>)
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{ar ? "ملاحظة المعلّم (لتحسين المحرك)" : "Teacher feedback (improve the engine)"}</CardTitle>
          <CardDescription>
            {ar ? (
              <>
                أشر إلى صفٍ مضلّل أو أكّد حالة. مع <strong>تسمية</strong> و<strong>لقطة مكوّنات</strong> (أول تطابق) يمكن
                للنظام إضافة صف تدريب لـ <code className="text-xs">POST /api/v1/integrity/retrain</code>.
              </>
            ) : (
              <>
                Flag a misleading row or confirm a case. With a <strong>label</strong> and{" "}
                <strong>component snapshot</strong> (first match), the system can add a training row for{" "}
                <code className="text-xs">POST /api/v1/integrity/retrain</code>.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 max-w-xl">
          <div className="space-y-1.5">
            <Label htmlFor="t-note">{ar ? "ملاحظة" : "Note"}</Label>
            <Textarea
              id="t-note"
              value={teacherNote}
              onChange={(e) => setTeacherNote(e.target.value)}
              placeholder={
                ar
                  ? "مثال: يبدو سلبيّاً خاطئاً — الطالبة/الطالب أعدّا الملخصة بأنفسهما"
                  : "e.g. This is a false positive — student wrote the summary themselves."
              }
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-label">{ar ? "تسمية (اختياري، لضبط ذاتي)" : "Label (optional, for self-tuning)"}</Label>
            <select
              id="t-label"
              className="flex h-9 w-full rounded-md border border-white/10 bg-white/[0.02] px-3 py-1 text-sm text-slate-100 shadow-sm backdrop-blur-xl"
              value={teacherLabel}
              onChange={(e) => setTeacherLabel(e.target.value)}
            >
              <option value="">{ar ? "— بلا —" : "— none —"}</option>
              <option value="false_positive">false_positive</option>
              <option value="confirmed">confirmed</option>
              <option value="needs_review">needs_review</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-sid">
              {ar ? "رقم طالب/مرجع (اختياري)" : "Student / reference id (optional)"}
            </Label>
            <input
              id="t-sid"
              className="flex h-9 w-full rounded-md border border-white/10 bg-white/[0.02] px-3 py-1 text-sm text-slate-100 shadow-sm backdrop-blur-xl"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder={ar ? "معرّف محلي فقط — أنت تضبط سياسة البيانات" : "Local id only — you control PII policy"}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={attachFirstSnapshot}
              onChange={(e) => setAttachFirstSnapshot(e.target.checked)}
            />
            {ar
              ? "إرفاق أول صف تطابق كـ integrity_snapshot (ميزات لإعادة التدريب)"
              : "Attach first match row as integrity_snapshot (features for retrain)"}
          </label>
          <button
            type="button"
            disabled={feedbackBusy}
            className="btn-glow"
            onClick={() => void submitTeacherFeedback()}
          >
            {feedbackBusy ? (ar ? "جاري الإرسال…" : "Sending…") : ar ? "إرسال الملاحظة" : "Send feedback"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
