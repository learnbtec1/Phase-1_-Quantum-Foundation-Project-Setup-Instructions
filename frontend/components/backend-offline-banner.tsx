"use client";

/**
 * Shown when `/api/v1/auth/me` fails due to network / 5xx — shell stays usable.
 */
export function BackendOfflineBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-[100] border-b border-amber-500/40 bg-amber-950/95 px-4 py-2 text-center text-sm text-amber-50 backdrop-blur-sm"
    >
      <span className="font-semibold">الخادم غير متصل أو غير مستجيب</span>
      {" · "}
      <span dir="ltr" className="opacity-90">
        Backend unreachable — start the API (e.g. docker compose up backend), match NEXT_PUBLIC_API_URL to the
        mapped port (see EDUVOR_API_PORT → http://localhost:8001). On local dev, do not set
        BACKEND_INTERNAL_URL=http://backend:8000 in .env (use NEXT_PUBLIC_* only).
      </span>
    </div>
  );
}
