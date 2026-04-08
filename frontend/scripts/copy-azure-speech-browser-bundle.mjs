/**
 * ينسخ حزمة المتصفح إلى public/vendor بعد npm install
 * (مفيد عند ترقية microsoft-cognitiveservices-speech-sdk).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(
  root,
  'node_modules',
  'microsoft-cognitiveservices-speech-sdk',
  'distrib',
  'browser',
  'microsoft.cognitiveservices.speech.sdk.bundle-min.js',
);
const destDir = path.join(root, 'public', 'vendor');
const dest = path.join(destDir, 'microsoft-speech-sdk.bundle.min.js');

if (!fs.existsSync(src)) {
  console.warn(
    '[copy-azure-speech-browser-bundle] Package not found — skip (commit public/vendor file for Docker --ignore-scripts).',
  );
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-azure-speech-browser-bundle] →', path.relative(root, dest));
