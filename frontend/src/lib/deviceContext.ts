/**
 * V28 — device / time-of-day context for Cogni (sent over WebSocket `device_context`).
 */
export function buildDeviceContextPayload(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  const ua = navigator.userAgent || '';
  let device_type = 'desktop';
  if (/Tablet|iPad/i.test(ua)) {
    device_type = 'tablet';
  } else if (/Mobi|Android/i.test(ua)) {
    device_type = 'mobile';
  }
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    timeZone = '';
  }
  const hour = new Date().getHours();
  const time_of_day = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return {
    device_type,
    timezone: timeZone,
    time_of_day,
    locale: navigator.language || '',
  };
}
