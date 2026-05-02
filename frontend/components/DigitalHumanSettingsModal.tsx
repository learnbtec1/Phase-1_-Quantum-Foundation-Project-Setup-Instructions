'use client';

import { useCallback, useEffect, useState } from 'react';
import { authHeaders, getAccessToken } from '@/lib/auth';
import { getApiBase } from '@/lib/api';
import { BodyPortal } from '@/components/portal/BodyPortal';
import { Z_LAYERS } from '@/lib/z-layers';

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function DigitalHumanSettingsModal({ open, onClose }: Props) {
  const [dnd, setDnd] = useState(false);
  const [cam, setCam] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setMsg('سجّل الدخول لحفظ الإعدادات');
      return;
    }
    try {
      const r = await fetch(`${getApiBase()}/api/v1/auth/me`, {
        credentials: 'include',
        headers: { ...authHeaders() },
      });
      if (r.ok) {
        const u = (await r.json()) as { dnd_mode?: boolean };
        setDnd(Boolean(u.dnd_mode));
      }
    } catch {
      /* ignore */
    }
    try {
      setCam(localStorage.getItem('cogni_camera_opt_in') === '1');
    } catch {
      setCam(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const saveDnd = async (next: boolean) => {
    setDnd(next);
    const token = getAccessToken();
    if (!token) return;
    try {
      const r = await fetch(`${getApiBase()}/api/v1/users/me/preferences`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ dnd_mode: next }),
      });
      setMsg(r.ok ? 'تم الحفظ' : 'تعذّر الحفظ');
    } catch {
      setMsg('خطأ شبكة');
    }
  };

  const saveCam = (next: boolean) => {
    setCam(next);
    try {
      localStorage.setItem('cogni_camera_opt_in', next ? '1' : '0');
      setMsg('تم حفظ تفضيل الكاميرا محلياً');
    } catch {
      setMsg('تعذّر حفظ تفضيل الكاميرا');
    }
  };

  if (!open) return null;

  return (
    <BodyPortal>
      <div
        className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
        style={{ zIndex: Z_LAYERS.MODAL_BACKDROP }}
      >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1020] p-6 text-sm text-gray-200 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">إعدادات كوجني الذكية</h2>
          <button type="button" className="text-gray-400 hover:text-white" onClick={onClose}>
            ✕
          </button>
        </div>
        <label className="mb-4 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={dnd}
            onChange={(e) => void saveDnd(e.target.checked)}
          />
          <span>وضع عدم الإزعاج — لا مبادرة تلقائية من كوجني بعد الصمت</span>
        </label>
        <label className="mb-4 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={cam}
            onChange={(e) => saveCam(e.target.checked)}
          />
          <span>السماح بعيّنات الكاميرا الخفيفة (تحسين التفاعل)</span>
        </label>
        <p className="text-xs text-gray-500">
          يمكنك إدارة الذاكرة والخصوصية من صفحة{' '}
          <a href="/settings/privacy" className="text-violet-400 underline">
            الخصوصية
          </a>
          .
        </p>
        {msg ? <p className="mt-3 text-xs text-amber-300/90">{msg}</p> : null}
      </div>
    </div>
    </BodyPortal>
  );
}
