'use client';

import React from 'react';
import { ensureMicOpen } from '@/utils/micManager';
import { BodyPortal } from '@/components/portal/BodyPortal';
import { Z_LAYERS } from '@/lib/z-layers';

type PermState = 'granted' | 'prompt' | 'denied' | 'unknown';

export default function PermissionBanner(): React.ReactElement | null {
  const [visible, setVisible] = React.useState(false);
  const [state,   setState  ] = React.useState<PermState>('unknown');
  const [busy,    setBusy   ] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    (async () => {
      try {
        const q = await (navigator.permissions as any)?.query?.({ name: 'microphone' as PermissionName });
        if (!mounted) return;
        const st: PermState = (q?.state as PermState) ?? 'unknown';
        setState(st);
        // Only show the banner when the user has explicitly DENIED access.
        // Do NOT show for 'prompt' (= not asked yet) — that is the normal initial state.
        setVisible(st === 'denied');
        q?.addEventListener?.('change', () => {
          if (!mounted) return;
          setState(q.state as PermState);
          setVisible(q.state === 'denied');
        });
      } catch {
        // Permissions API not supported — show banner only when 'mic:needs-user-gesture' fires.
      }
    })();

    const onNeedGesture = (): void => setVisible(true);
    window.addEventListener('mic:needs-user-gesture', onNeedGesture);

    return (): void => {
      mounted = false;
      window.removeEventListener('mic:needs-user-gesture', onNeedGesture);
    };
  }, []);

  if (!visible) return null;

  return (
    <BodyPortal>
    <div
      className="fixed inset-x-0 bottom-0 pointer-events-none"
      style={{ zIndex: Z_LAYERS.PERMISSION_STRIP }}
    >
      <div className="mx-auto max-w-3xl m-3 rounded-xl bg-slate-900/95 ring-1 ring-slate-600 p-4 text-white shadow-2xl pointer-events-auto backdrop-blur-sm">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <span className="text-2xl mt-0.5" aria-hidden>🎙️</span>

          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm mb-1">
              تم رفض الإذن للوصول إلى الميكروفون
            </p>
            <p className="text-xs text-slate-300 leading-relaxed">
              الرجاء السماح بالمايك من إعدادات المتصفح ثم اضغط «تشغيل الآن».
              <br />
              <span className="opacity-75">
                كروم / إيدج: 🔒 في شريط العنوان ← الأذونات ← الميكروفون ← سماح.
                ويندوز: الإعدادات ← الخصوصية والأمان ← الميكروفون ← سماح.
              </span>
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await ensureMicOpen();
                    setVisible(false);
                  } catch {
                    alert('تعذّر تشغيل المايك — تأكد من الإعدادات ثم أعد المحاولة.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                {busy ? '⏳ جارٍ المحاولة…' : '🔄 تشغيل الآن'}
              </button>

              <button
                onClick={() => setVisible(false)}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                إغلاق
              </button>

              <span className="text-xs text-slate-500 mr-auto">
                الحالة: <code className="text-slate-400">{state}</code>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
}
