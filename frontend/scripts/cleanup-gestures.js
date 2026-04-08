#!/usr/bin/env node
/**
 * Gesture / docs cleanup helper (safe defaults).
 *
 * Usage:
 *   node scripts/cleanup-gestures.js              # dry-run: report only
 *   node scripts/cleanup-gestures.js --apply        # execute moves/deletes (still skips README/LICENSE)
 *   node scripts/cleanup-gestures.js --md-report    # list .md under frontend/src
 *
 * Does NOT delete repository root README or legal files. Prefer archiving to _deprecated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const BACKUP_ROOT = path.join(FRONTEND_ROOT, 'backups', `gesture-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`);

const SKIP_NAMES = new Set([
  'readme.md',
  'license.md',
  'changelog.md',
  'contributing.md',
  'code_of_conduct.md',
]);

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const MD_REPORT = args.has('--md-report') || !args.has('--no-md');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === '.next' || name.name === 'dist') continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function rel(p) {
  return path.relative(FRONTEND_ROOT, p).split(path.sep).join('/');
}

function main() {
  const report = { backupDir: rel(BACKUP_ROOT), actions: [], mdUnderSrc: [] };

  ensureDir(BACKUP_ROOT);
  fs.writeFileSync(
    path.join(BACKUP_ROOT, 'MANIFEST.txt'),
    `Gesture cleanup backup\nTime: ${new Date().toISOString()}\nAPPLY=${APPLY}\n`,
    'utf8',
  );
  report.actions.push(`Created backup dir: ${rel(BACKUP_ROOT)}`);

  const srcRoot = path.join(FRONTEND_ROOT, 'src');
  if (fs.existsSync(srcRoot) && MD_REPORT) {
    const files = walk(srcRoot).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const base = path.basename(f).toLowerCase();
      if (SKIP_NAMES.has(base)) continue;
      report.mdUnderSrc.push(rel(f));
    }
  }

  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) {
    console.log('\n[cleanup-gestures] Dry-run only. Pass --apply to copy .md listed above into backup (not delete).');
    return;
  }

  // Apply = copy candidates to backup (archive), not delete — avoids breaking legal/docs the user still needs.
  for (const md of report.mdUnderSrc) {
    const abs = path.join(FRONTEND_ROOT, md);
    const dest = path.join(BACKUP_ROOT, 'md-archive', md);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(abs, dest);
    report.actions.push(`Archived: ${md}`);
  }

  fs.appendFileSync(
    path.join(BACKUP_ROOT, 'MANIFEST.txt'),
    `${report.actions.join('\n')}\n`,
    'utf8',
  );
  console.log('\n[cleanup-gestures] Apply complete — copies under backups/, source files untouched.');
}

main();
