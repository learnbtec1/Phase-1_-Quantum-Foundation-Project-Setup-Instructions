'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { flattenSubjectLabels } from '@/lib/academicSubjects';

const TARGET_OPTIONS = [
  { value: 'pass', label: 'Pass' },
  { value: 'merit', label: 'Merit' },
  { value: 'distinction', label: 'Distinction' },
  { value: 'quick_review', label: 'Quick Review' },
] as const;

export default function DeepLinkGenerator() {
  const subjects = useMemo(() => flattenSubjectLabels(), []);
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState<string>('pass');
  const [subject, setSubject] = useState('');
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (unit) setSubject(unit);
  }, [unit]);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams();
    const u = unit.trim();
    const t = target.trim();
    const s = (subject.trim() || u).trim();
    if (u) params.set('unit', u);
    if (t) params.set('target', t);
    if (s) params.set('subject', s);
    const q = params.toString();
    return `${window.location.origin}/dashboard${q ? `?${q}` : ''}`;
  }, [unit, target, subject]);

  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      /* ignore */
    }
  }, [shareUrl]);

  const downloadQr = useCallback(() => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `cogni-dashboard-qr-${target}.png`;
    a.click();
  }, [target]);

  return (
    <section
      className="mb-8 rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/40 to-black/50 p-6 shadow-lg"
      dir="rtl"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">روابط التوجيه السريع + QR</h2>
          <p className="mt-1 text-xs text-gray-400 max-w-xl">
            أنشئ رابطاً يفتح لوحة الطالب مع وحدة وهدف محددين (Pass / Merit / Distinction / مراجعة سريعة). انسخ الرابط أو
            حمّل رمز QR للصفحة.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">الوحدة / الموضوع (من المنهج)</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full max-w-xl rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white"
            >
              <option value="">— اختر وحدة —</option>
              {subjects.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">الهدف</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white"
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">المادة (نص حر — يُعبأ تلقائياً من الوحدة)</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full max-w-xl rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-gray-600"
              placeholder="مثال: الغرض من إنشاء شركة"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              disabled={!shareUrl}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              نسخ الرابط
            </button>
            <button
              type="button"
              onClick={downloadQr}
              disabled={!shareUrl}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40"
            >
              تنزيل QR
            </button>
          </div>

          {shareUrl && (
            <p className="break-all rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-cyan-200/90">
              {shareUrl}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white p-4 shadow-inner">
          <span className="text-[10px] font-medium text-gray-600">معاينة QR</span>
          <div ref={qrRef} className="rounded-lg bg-white p-1">
            {shareUrl ? (
              <QRCodeCanvas value={shareUrl} size={160} level="M" includeMargin />
            ) : (
              <div className="flex h-[160px] w-[160px] items-center justify-center text-center text-[10px] text-gray-400">
                اختر وحدة
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
