'use client';

import { probeWebSocketHandshake } from '@/utils/wsDebug';
import { testMic } from '@/utils/micDebug';
import { testAudioContext } from '@/utils/audioDebug';
import { isCogniDiagnosticsEnabled, logStep } from '@/utils/diagnostics';

/**
 * Runs mic + shared AudioContext + WebSocket handshake probe.
 * Intended for **`NEXT_PUBLIC_COGNI_BOOT_DIAGNOSTICS`** only — not for production boot.
 *
 * Assigns `window.__cogniRunDiagnostics(url?)` in dev for manual replay from the console.
 */
export async function runFullDiagnostics(wsUrl: string): Promise<void> {
  if (typeof window === 'undefined') return;

  console.log('🚀 [Cogni] Full Diagnostics — START\n');

  let stream: MediaStream | null = null;
  try {
    stream = await testMic();
  } catch {
    /* logged inside testMic */
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  try {
    await testAudioContext();
  } catch {
    /* logged */
  }

  if (typeof wsUrl === 'string' && wsUrl.trim().length > 0) {
    try {
      await probeWebSocketHandshake(wsUrl.trim());
    } catch (err) {
      logStep('WS_CONNECT', 'FAIL', err instanceof Error ? err : new Error(String(err)));
    }
  } else {
    logStep('WS_CONNECT', 'FAIL', new Error('runFullDiagnostics: empty wsUrl'));
  }

  console.log('\n✅ [Cogni] Diagnostics — FINISHED\n');
}

if (typeof window !== 'undefined') {
  const devBundle =
    typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
  const flagOn = isCogniDiagnosticsEnabled();
  if (devBundle || flagOn) {
    (window as Window & { __cogniRunDiagnostics?: typeof runFullDiagnostics }).__cogniRunDiagnostics =
      runFullDiagnostics;
  }
}
