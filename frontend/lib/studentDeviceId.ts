/**
 * Stable per-browser id for linking assessment evaluations to the same learner
 * when JWT is absent (guest) or as fallback. Stored in localStorage.
 */
const STORAGE_KEY = 'cogni-student-device-id';

export function getOrCreateStudentDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = localStorage.getItem(STORAGE_KEY)?.trim();
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return '';
  }
}

/** Prefer logged-in user id (JWT `sub`) so Postgres rows align with WebSocket `user_uuid`. */
export function getStudentIdForEvaluation(): string {
  if (typeof window === 'undefined') return '';
  try {
    const token = localStorage.getItem('cogni_access_token');
    if (token) {
      const parts = token.split('.');
      if (parts.length === 3) {
        const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json) as { sub?: string };
        if (payload.sub && typeof payload.sub === 'string' && payload.sub.trim()) {
          return payload.sub.trim();
        }
      }
    }
  } catch {
    /* ignore */
  }
  return getOrCreateStudentDeviceId();
}
