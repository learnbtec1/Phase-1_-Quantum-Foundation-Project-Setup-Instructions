'use client';

import { useState } from 'react';
import { apiBase, notifyAuthChanged, setAccessToken } from '@/lib/auth';
import { BodyPortal } from '@/components/portal/BodyPortal';
import { Z_LAYERS } from '@/lib/z-layers';

type Mode = 'login' | 'register';

export default function AuthModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const base = apiBase();
      const path = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { email, password, name };
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        token?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Request failed');
        return;
      }
      const tok =
        (typeof data.access_token === 'string' ? data.access_token.trim() : '') ||
        (typeof data.token === 'string' ? data.token.trim() : '');
      if (tok) {
        // Canonical key for WS/TTS/BFF — must match getAccessToken() / useAgentAgent pre-check.
        setAccessToken(tok);
        localStorage.setItem('cogni_access_token', tok);
        // eslint-disable-next-line no-console
        console.log('[AUTH] ✅ Token stored', tok.slice(0, 10));
        notifyAuthChanged();
        onClose();
      } else {
        setError('تم الاتصال لكن الخادم لم يُرجع رمز دخول (access_token).');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  /* Portal → body: يتجاوز overflow/stacking على أسلاف AvatarAgentClient والمنصة */
  return (
    <BodyPortal>
      <div
        className="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        style={{ zIndex: Z_LAYERS.MODAL_BACKDROP }}
      >
      <div className="w-full max-w-md rounded-2xl border border-violet-500/30 bg-[#121225] p-6 shadow-2xl text-right" dir="rtl">
        <h2 className="text-xl font-bold text-white mb-4">
          {mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}
        </h2>
        {mode === 'register' && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="الاسم الكامل"
            className="w-full mb-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-500"
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="البريد الإلكتروني"
          className="w-full mb-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-500"
          autoComplete="email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="كلمة المرور (8 أحرف على الأقل)"
          className="w-full mb-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-500"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {error && <p className="text-rose-400 text-sm mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-gray-400 hover:text-white"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-6 py-2 rounded-xl bg-violet-600 text-white font-semibold disabled:opacity-40"
          >
            {busy ? '…' : mode === 'login' ? 'دخول' : 'تسجيل'}
          </button>
        </div>
        <p className="text-center text-gray-500 text-sm mt-4">
          {mode === 'login' ? (
            <button type="button" className="text-cyan-400 hover:underline" onClick={() => setMode('register')}>
              ليس لديك حساب؟
            </button>
          ) : (
            <button type="button" className="text-cyan-400 hover:underline" onClick={() => setMode('login')}>
              لديك حساب بالفعل؟
            </button>
          )}
        </p>
      </div>
    </div>
    </BodyPortal>
  );
}
