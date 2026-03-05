"use client";

import { useMemo, useState } from "react";
import {
  evaluateWithRubric,
  getDefaultRubric,
  type RubricConfig,
  type StrictEvaluationResult,
} from "@/lib/strict-evaluation";

export default function StrictEvaluationPage() {
  const [strictMode, setStrictMode] = useState(true);
  const [answer, setAnswer] = useState("");
  const [rubric, setRubric] = useState<RubricConfig>(getDefaultRubric());
  const [result, setResult] = useState<StrictEvaluationResult | null>(null);
  const [error, setError] = useState("");

  const canEvaluate = useMemo(() => answer.trim().length > 0 && rubric.criteria.length > 0, [answer, rubric]);

  const handleRubricImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as RubricConfig;

      if (!parsed.rubricId || !Array.isArray(parsed.criteria)) {
        throw new Error("صيغة ملف rubric غير صحيحة.");
      }

      setRubric(parsed);
      setResult(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "تعذر قراءة ملف rubric.");
    } finally {
      event.target.value = "";
    }
  };

  const handleEvaluate = () => {
    setError("");
    setResult(evaluateWithRubric(answer, rubric, strictMode));
  };

  return (
    <div className="p-8 md:p-10 space-y-6 text-white">
      <header className="space-y-2">
        <h1 className="text-3xl font-black">التقييم الصارم (Strict Evaluation)</h1>
        <p className="text-gray-400 text-sm">
          تقييم محلي يعتمد على rubric، مع وضع صارم يمنع النجاح الجزئي إلا إذا كان مسموحًا داخل المعيار.
        </p>
      </header>

      <section className="glass-nexus p-5 rounded-2xl border border-white/10 space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold">وضع صارم</label>
            <button
              type="button"
              onClick={() => setStrictMode((currentValue) => !currentValue)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition ${
                strictMode ? "bg-emerald-500 text-black" : "bg-white/10 text-white"
              }`}
            >
              {strictMode ? "ON" : "OFF"}
            </button>
          </div>

          <label className="text-sm font-semibold cursor-pointer bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition">
            استيراد Rubric JSON
            <input type="file" accept="application/json" className="hidden" onChange={handleRubricImport} />
          </label>
        </div>

        <div className="text-xs text-gray-400">
          Rubric الحالي: {rubric.rubricId} v{rubric.version} — {rubric.title}
        </div>

        {error ? <p className="text-red-400 text-sm">{error}</p> : null}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="glass-nexus p-5 rounded-2xl border border-white/10 space-y-3">
          <h2 className="text-lg font-bold">إجابة الطالب</h2>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className="w-full min-h-[240px] bg-black/30 border border-white/10 rounded-xl p-4 text-sm outline-none focus:border-cyan-500/60"
            placeholder="الصق إجابة الطالب هنا..."
          />
          <button
            type="button"
            disabled={!canEvaluate}
            onClick={handleEvaluate}
            className="w-full py-3 rounded-xl font-bold bg-cyan-500 text-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            تنفيذ التقييم
          </button>
        </div>

        <div className="glass-nexus p-5 rounded-2xl border border-white/10 space-y-3 overflow-auto">
          <h2 className="text-lg font-bold">جدول المعايير</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-right py-2">Code</th>
                <th className="text-right py-2">Level</th>
                <th className="text-right py-2">Keywords</th>
                <th className="text-right py-2">Partial</th>
              </tr>
            </thead>
            <tbody>
              {rubric.criteria.map((criterion) => (
                <tr key={criterion.code} className="border-b border-white/5 align-top">
                  <td className="py-2 font-bold">{criterion.code}</td>
                  <td className="py-2">{criterion.level}</td>
                  <td className="py-2 text-gray-300">{criterion.keywords.join(", ")}</td>
                  <td className="py-2">{criterion.allowPartialCredit === false ? "No" : "Yes"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {result ? (
        <section className="glass-nexus p-5 rounded-2xl border border-white/10 space-y-4">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <h2 className="text-lg font-bold">نتيجة التقييم</h2>
            <div className="text-sm text-gray-300">
              Band: <span className="font-black text-emerald-400">{result.overallBand}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Strict Mode" value={result.strictMode ? "ON" : "OFF"} />
            <Stat label="Achieved" value={`${result.achievedCount}/${result.totalCriteria}`} />
            <Stat label="Percent" value={`${result.achievedPercent}%`} />
            <Stat label="Rubric" value={`${result.rubricId} v${result.version}`} />
          </div>

          <div className="space-y-3">
            {result.criteria.map((criterion) => (
              <div key={criterion.code} className="rounded-xl bg-black/30 border border-white/10 p-4 space-y-2">
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <div className="font-bold">{criterion.code} — {criterion.level}</div>
                  <div className={`text-xs font-bold px-2 py-1 rounded ${criterion.achieved ? "bg-emerald-500 text-black" : "bg-red-500 text-white"}`}>
                    {criterion.achieved ? "Achieved" : "Not Achieved"}
                  </div>
                </div>
                <p className="text-sm text-gray-300">{criterion.feedback}</p>
                <p className="text-xs text-gray-400">Matched: {criterion.matchedKeywords.join(", ") || "—"}</p>
                <p className="text-xs text-gray-400">Missed: {criterion.missedKeywords.join(", ") || "—"}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/30 border border-white/10 rounded-xl p-3">
      <div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="font-bold text-white">{value}</div>
    </div>
  );
}
