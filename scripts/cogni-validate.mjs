/**
 * Runs the Playwright TTS + lip-sync burst probe with production gates and JSON report.
 * Env: BASE_URL, AVATAR_PATH, TTS_PROBE_TEXT, PYTHON (optional python executable name).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const probe = path.join(repoRoot, 'scripts', 'tts_playwright_audio_probe.py');

const python =
  process.env.PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3');

const env = {
  ...process.env,
  LIP_SYNC_VALIDATE: '1',
  COGNI_VALIDATE_WRITE_JSON: '1',
};

const proc = spawnSync(python, [probe], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const reportDefault = path.join(
  repoRoot,
  'artifacts',
  'cogni-validate-report.json',
);
const reportPath = process.env.COGNI_VALIDATE_REPORT || reportDefault;
let summary = proc.status === 0 ? 'PASS' : 'FAIL';
try {
  if (fs.existsSync(reportPath)) {
    const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    summary =
      raw.overall === 'PASS' && proc.status === 0 ? 'PASS' : 'FAIL';
    console.log(`\n[cogni-validate] Report: ${reportPath}`);
    if (raw.gates) {
      console.log('[cogni-validate] gates:', JSON.stringify(raw.gates, null, 2));
    }
    if (raw.metrics_snapshot) {
      console.log(
        '[cogni-validate] metrics (subset):',
        JSON.stringify(
          {
            ttsRoundTripLatencyMsEwma: raw.metrics_snapshot.ttsRoundTripLatencyMsEwma,
            audioDurationSecLast: raw.metrics_snapshot.audioDurationSecLast,
            visemeCountLast: raw.metrics_snapshot.visemeCountLast,
            morphActivityRateEwma: raw.metrics_snapshot.morphActivityRateEwma,
            audioContextState: raw.metrics_snapshot.audioContextState,
            wsRttMsEwma: raw.metrics_snapshot.wsRttMsEwma,
            wsConnectedHint: raw.metrics_snapshot.wsConnectedHint,
          },
          null,
          2,
        ),
      );
    }
  }
} catch {
  /* ignore */
}

console.log(`\n====== cogni-validate: ${summary} (exit ${proc.status ?? -1}) ======\n`);
process.exit(proc.status ?? 1);
