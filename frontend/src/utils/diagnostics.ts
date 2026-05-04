/**
 * Structured console diagnostics for WS / mic / audio pipelines.
 * Enable with `NEXT_PUBLIC_COGNI_BOOT_DIAGNOSTICS=true` (never on by default).
 */

export type DiagnosticStep =
  | 'WS_CONNECT'
  | 'MIC_ACCESS'
  | 'AUDIO_CONTEXT'
  | 'VAD_START'
  | 'TTS_PLAY';

export type DiagnosticStatus = 'START' | 'SUCCESS' | 'FAIL';

export function isCogniDiagnosticsEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  const v = (process.env.NEXT_PUBLIC_COGNI_BOOT_DIAGNOSTICS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function logStep(
  step: DiagnosticStep,
  status: DiagnosticStatus,
  data?: unknown,
): void {
  const time = new Date().toISOString();

  if (status === 'START') {
    console.log(`🟡 [${time}] [${step}] START`, data !== undefined ? data : '');
  } else if (status === 'SUCCESS') {
    console.log(`🟢 [${time}] [${step}] SUCCESS`, data !== undefined ? data : '');
  } else if (status === 'FAIL') {
    console.error(`🔴 [${time}] [${step}] FAIL`);

    if (data instanceof Error) {
      console.error('Message:', data.message);
      console.error('Stack:', data.stack);
    } else {
      console.error('Detail:', data);
    }
  }
}

/** Optional hooks when `NEXT_PUBLIC_COGNI_BOOT_DIAGNOSTICS` — wire from VAD/TTS without noisy prod logs */
export function diagVad(status: DiagnosticStatus, data?: unknown): void {
  if (!isCogniDiagnosticsEnabled()) return;
  logStep('VAD_START', status, data);
}

export function diagTts(status: DiagnosticStatus, data?: unknown): void {
  if (!isCogniDiagnosticsEnabled()) return;
  logStep('TTS_PLAY', status, data);
}
