'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiBase, authHeaders, getAccessToken } from '@/lib/auth';

type MemRow = { id: string; memory_type: string; content: string; created_at: string | null };

export default function PrivacySettingsPage() {
  const [rows, setRows] = useState<MemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [exportJson, setExportJson] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${apiBase()}/api/v1/users/me/memory` + (filter ? `?memory_type=${encodeURIComponent(filter)}` : ''), {
        headers: { ...authHeaders() },
      });
      if (r.ok) {
        setRows((await r.json()) as MemRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportData = async () => {
    const token = getAccessToken();
    if (!token) return;
    const r = await fetch(`${apiBase()}/api/v1/users/me/export`, { headers: { ...authHeaders() } });
    if (r.ok) {
      const j = await r.json();
      setExportJson(JSON.stringify(j, null, 2));
    }
  };

  const deleteFiltered = async () => {
    const token = getAccessToken();
    if (!token) return;
    const qs = new URLSearchParams();
    if (filter) qs.set('memory_type', filter);
    const r = await fetch(`${apiBase()}/api/v1/users/me/memory?${qs}`, {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
    if (r.status === 204) void load();
  };

  return (
    <div className="min-h-screen bg-[#0a0a12] text-gray-200 p-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/avatar-agent" className="text-violet-400 text-sm hover:underline">
          ← العودة لكوجني
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-white">الخصوصية والذاكرة</h1>
        <p className="mt-2 text-sm text-gray-400">
          اطلع على ما يحفظه النظام، صدّر بياناتك، أو احذف ذاكرة محددة.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          >
            <option value="">كل الأنواع</option>
            <option value="emotional">emotional</option>
            <option value="goal">goal</option>
            <option value="lesson_plan">lesson_plan</option>
            <option value="reflection_note">reflection_note</option>
            <option value="yearly_snapshot">yearly_snapshot</option>
          </select>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500"
            onClick={() => void load()}
          >
            تحديث
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
            onClick={() => void exportData()}
          >
            تصدير JSON
          </button>
          <button
            type="button"
            className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
            onClick={() => void deleteFiltered()}
          >
            حذف المحدد بالفلتر
          </button>
        </div>

        {exportJson ? (
          <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs">
            {exportJson.slice(0, 12000)}
          </pre>
        ) : null}

        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="text-gray-500">جاري التحميل…</p>
          ) : rows.length === 0 ? (
            <p className="text-gray-500">لا توجد سجلات أو يجب تسجيل الدخول.</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                <div className="text-amber-400/90">{r.memory_type}</div>
                <div className="mt-1 whitespace-pre-wrap text-gray-300">{r.content.slice(0, 2000)}</div>
                <div className="mt-1 text-gray-600">{r.created_at}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
