/**
 * Opt-in structured logs for Frontend ↔ WebSocket ↔ TTS integration debugging.
 * Set NEXT_PUBLIC_COGNI_INTEGRATION_TRACE=true in .env.local (dev only).
 */
export function traceCogniIntegration(
  label: string,
  data: Record<string, unknown>,
): void {
  if (typeof process === 'undefined') return;
  if (process.env.NEXT_PUBLIC_COGNI_INTEGRATION_TRACE !== 'true') return;
  // eslint-disable-next-line no-console
  console.info(`[cogni-integration] ${new Date().toISOString()} ${label}`, data);
}
