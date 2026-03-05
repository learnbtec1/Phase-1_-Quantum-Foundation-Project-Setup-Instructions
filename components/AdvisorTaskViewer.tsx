"use client";
import React, { useEffect, useState } from "react";

export default function AdvisorTaskViewer() {
  const [task, setTask] = useState<any | null>(null);
  useEffect(() => {
    fetch("/data/advisor_agriculture_task.json")
      .then((r) => r.json())
      .then(setTask)
      .catch((err) => {
        // keep console error for developer debugging
        // avoid throwing to keep UI stable
        // eslint-disable-next-line no-console
        console.error("Failed to load advisor task JSON:", err);
      });
  }, []);

  if (!task)
    return (
      <div className="p-6 text-center text-gray-500">جارٍ تحميل مهمة المستشار...</div>
    );

  return (
    <div className="p-6 bg-white rounded-md shadow-md max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">{task.title}</h2>
      <div className="text-sm text-gray-600 mb-4">{task.intro}</div>

      <section className="mb-4">
        <h3 className="font-semibold mb-2">ملفات الشركات</h3>
        <ul className="list-disc ml-5">
          {task.companies.map((c: any) => (
            <li key={c.name} className="mb-1">
              <strong>{c.name}</strong> — {c.size} — {c.scope}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-4">
        <h3 className="font-semibold mb-2">مقارنة مختصرة</h3>
        <ul className="space-y-1">
          {task.comparison.map((cmp: any, i: number) => (
            <li key={i}>
              <strong>{cmp.aspect}:</strong> {cmp.A} | {cmp.B}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-4">
        <h3 className="font-semibold mb-2">تحليل PESTLE (مقتطف)</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(task.pestle_analysis).map(([k, v]: any) => (
            <div key={k} className="p-3 border rounded bg-gray-50">
              <div className="font-medium">{v.title}</div>
              <div className="text-sm text-gray-700">{v.description}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">التوصيات النهائية</h3>
        <ol className="list-decimal ml-5 space-y-1">
          {task.final_recommendations.map((r: string, i: number) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </section>

      <div className="mt-4 text-xs text-gray-500">تاريخ الملف: {task.date}</div>
    </div>
  );
}


// Printable certificate helper (simple client-side print)
export function AdvisorCertificate({ task }: { task: any }) {
  return (
    <div className="p-6 bg-white rounded-md shadow-md max-w-3xl mx-auto">
      <div className="text-center mb-4">
        <h3 className="text-xl font-bold">{task.certificate.title}</h3>
        <div className="text-sm text-gray-600">{task.certificate.platform} — {task.certificate.date}</div>
      </div>
      <div className="mb-4">إلى: <strong>{task.certificate.issued_to}</strong></div>
      <ul className="list-disc ml-5 mb-4">
        {task.certificate.skills.map((s: string, i: number) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <div className="text-sm text-gray-700">{task.certificate.note}</div>
    </div>
  );
}

export function printCertificate(task: any) {
  try {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<html><head><title>شهادة الإتمام</title></head><body>');
    w.document.write('<pre>' + JSON.stringify(task.certificate, null, 2) + '</pre>');
    w.document.write('</body></html>');
    w.document.close();
    w.focus();
    w.print();
    w.close();
  } catch (e) {
    // ignore
    // eslint-disable-next-line no-console
    console.error('Print failed', e);
  }
}
