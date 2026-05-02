/**
 * Smoke: Cogni Whisper path must pin Arabic transcription (ISO-639-1),
 * disabling OpenAI automatic language detection drift into English hallucinations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.join(__dirname, '..', 'backend', 'app', 'services', 'ws_agent_pipeline.py');

test('ws_agent_pipeline.py passes language=ar to Whisper', () => {
  const txt = fs.readFileSync(PIPE, 'utf8');
  assert.match(txt, /\blanguage\s*=\s*["']ar["']/);
});
