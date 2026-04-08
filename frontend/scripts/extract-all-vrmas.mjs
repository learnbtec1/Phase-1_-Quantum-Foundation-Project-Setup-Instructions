/**
 * extract-all-vrmas.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Batch extracts VRM bone rotations from ALL .vrma files in animations folder
 * and generates a single TypeScript file with constants for every gesture.
 *
 * Usage:
 *   node scripts/extract-all-vrmas.mjs
 *
 * Output:
 *   - frontend/src/generatedGestures.ts (TypeScript constants for all gestures)
 *   - Console report showing success/failure for each file
 *
 * Options:
 *   --frame-percent <0-100>   Which point in animation to sample (default: 50)
 *   --avg-window <frames>     How many frames to average around sample (default: 5)
 *   --out <file>              Output file path (default: src/generatedGestures.ts)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Config ────────────────────────────────────────────────────────────────
const ANIMATIONS_DIR = path.resolve(__dirname, '../public/models/animations');
const DEFAULT_OUTPUT = path.resolve(__dirname, '../src/generatedGestures.ts');

const BONES_OF_INTEREST = [
  'rightUpperArm',
  'leftUpperArm',
  'rightLowerArm',
  'leftLowerArm',
  'rightHand',
  'leftHand',
  'rightShoulder',
  'leftShoulder',
  'neck',
  'head',
  'hips',
  'spine',
  'chest',
];

const BONE_MAP = {
  rightUpperArm: 'RUA',
  leftUpperArm:  'LUA',
  rightLowerArm: 'RLA',
  leftLowerArm:  'LLA',
  rightHand:     'RH',
  leftHand:      'LH',
  rightShoulder: 'RSHOULDER',
  leftShoulder:  'LSHOULDER',
  neck:          'NECK',
  head:          'HEAD',
  hips:          'HIPS',
  spine:         'SPINE',
  chest:         'CHEST',
};

// ─── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let framePercent = 50;
let avgWindow = 5;
let outFile = DEFAULT_OUTPUT;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--frame-percent') framePercent = Number(args[++i] ?? framePercent);
  else if (args[i] === '--avg-window') avgWindow = Number(args[++i] ?? avgWindow);
  else if (args[i] === '--out') outFile = args[++i];
  else if (args[i] === '--help') {
    console.log(`Usage: node scripts/extract-all-vrmas.mjs [options]
Options:
  --frame-percent <n>     0-100 position in animation (default: 50)
  --avg-window <n>        Frames to average (default: 5)
  --out <file>            Output file (default: src/generatedGestures.ts)
`);
    process.exit(0);
  }
}

// ─── Gesture name normalization ────────────────────────────────────────────
function normalizeGestureName(filename) {
  let base = path.basename(filename, '.vrma');
  
  // Handle special cases and mappings
  const mappings = {
    'Thinking': 'THINK',
    'Pointing': 'POINT',
    'Waving': 'WAVING',
    'Agreeing': 'AGREEING',
    'Clapping': 'CLAPPING',
    'Beckoning': 'BECKONING',
    'Goodbye': 'GOODBYE',
    'Jump': 'JUMP',
    'Walking': 'WALKING',
    'Idle1': 'IDLE1',
    'Idle2': 'IDLE2',
    'Idle3': 'IDLE3',
    'Idle4': 'IDLE4',
    'Acknowledging': 'ACKNOWLEDGING',
    'Angry': 'ANGRY',
    'Blush': 'BLUSH',
    'Sad': 'SAD',
    'Surprised': 'SURPRISED',
    'Sleepy': 'SLEEPY',
    'Relax': 'RELAX',
    'Typing': 'TYPING',
  };
  
  if (mappings[base]) return mappings[base];
  
  // Auto-normalize: remove spaces, dashes, underscores → uppercase
  return base
    .replace(/[-_\s.]/g, '_')
    .replace(/[^A-Z0-9_]/gi, '')
    .toUpperCase();
}

// ─── Load GLTF from GLB or JSON ────────────────────────────────────────────
function loadGltf(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.readUInt32LE(0);
  if (magic === 0x46546C67) {
    return parseGlb(buf, filePath);
  }
  const gltf = JSON.parse(buf.toString('utf-8'));
  gltf.__vrmaPath = filePath;
  return gltf;
}

function parseGlb(buf, filePath) {
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);
  const chunk0Length = buf.readUInt32LE(12);
  const chunk0Type = buf.readUInt32LE(16);
  if (chunk0Type !== 0x4E4F534A) throw new Error('Expected JSON chunk first in GLB');
  const jsonBuf = buf.slice(20, 20 + chunk0Length);
  const gltf = JSON.parse(jsonBuf.toString('utf-8'));
  gltf.__vrmaPath = filePath;
  const binStart = 20 + chunk0Length;
  if (binStart < buf.length) {
    const chunk1Length = buf.readUInt32LE(binStart);
    const chunk1Type = buf.readUInt32LE(binStart + 4);
    if (chunk1Type === 0x004E4942) {
      gltf.__binBuffer = buf.slice(binStart + 8, binStart + 8 + chunk1Length);
    }
  }
  return gltf;
}

// ─── Quaternion → Euler (YXZ) ──────────────────────────────────────────────
function quatToEulerYXZ(x, y, z, w) {
  const sqx = x * x, sqy = y * y, sqz = z * z, sqw = w * w;
  const ey = Math.atan2(2 * (x * w + y * z), sqw - sqx - sqy + sqz);
  const sinEx = 2 * (y * w - x * z);
  const ex = Math.abs(sinEx) >= 1 ? Math.sign(sinEx) * Math.PI / 2 : Math.asin(sinEx);
  const ez = Math.atan2(2 * (x * y + z * w), sqw + sqx - sqy - sqz);
  return { x: ex, y: ey, z: ez };
}

// ─── Resolve buffer data ───────────────────────────────────────────────────
function getAccessorData(gltf, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bv = gltf.bufferViews[accessor.bufferView];
  const byteOffset = (accessor.byteOffset ?? 0) + (bv.byteOffset ?? 0);

  let rawBuffer;
  if (gltf.__binBuffer) {
    rawBuffer = gltf.__binBuffer;
  } else {
    const bufDef = gltf.buffers[bv.buffer];
    if (bufDef.uri) {
      if (!gltf.__vrmaPath) {
        throw new Error('gltf.__vrmaPath not set for external buffer resolution');
      }
      const uriPath = path.resolve(path.dirname(gltf.__vrmaPath), bufDef.uri);
      rawBuffer = fs.readFileSync(uriPath);
    } else {
      throw new Error('Buffer has no URI and no embedded GLB bin chunk');
    }
  }

  const componentType = accessor.componentType;
  const count = accessor.count;
  const type = accessor.type;

  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type] ?? 1;
  const stride = bv.byteStride ?? components * 4;
  const result = [];

  for (let i = 0; i < count; i++) {
    const base = byteOffset + i * stride;
    const item = [];
    for (let c = 0; c < components; c++) {
      if (componentType === 5126) {
        item.push(rawBuffer.readFloatLE(base + c * 4));
      } else if (componentType === 5123) {
        item.push(rawBuffer.readUInt16LE(base + c * 2));
      } else {
        item.push(0);
      }
    }
    result.push(components === 1 ? item[0] : item);
  }
  return result;
}

// ─── Sample quaternion from animation track ────────────────────────────────
function sampleQuat(boneTrack, tSec, maxTime) {
  const { times, quats } = boneTrack;
  let lo = 0;
  for (let i = 0; i < times.length - 1; i++) {
    if (times[i] <= tSec) lo = i;
  }
  const hi = Math.min(lo + 1, times.length - 1);
  const tLo = times[lo];
  const tHi = times[hi];
  const alpha = tHi === tLo ? 0 : Math.min(1, Math.max(0, (tSec - tLo) / (tHi - tLo)));
  const [x0, y0, z0, w0] = quats[lo];
  const [x1, y1, z1, w1] = quats[hi];
  const ax = x0 + (x1 - x0) * alpha;
  const ay = y0 + (y1 - y0) * alpha;
  const az = z0 + (z1 - z0) * alpha;
  const aw = w0 + (w1 - w0) * alpha;
  const len = Math.sqrt(ax * ax + ay * ay + az * az + aw * aw) || 1;
  return [ax / len, ay / len, az / len, aw / len];
}

function averageSamples(boneTrack, tSec, windowCount, maxTime) {
  const dt = maxTime / Math.max(1, (boneTrack.times.length - 1));
  let sumX = 0, sumY = 0, sumZ = 0, sumW = 0;
  for (let i = -Math.floor(windowCount / 2); i <= Math.floor(windowCount / 2); i++) {
    const [x, y, z, w] = sampleQuat(boneTrack, tSec + i * dt, maxTime);
    sumX += x; sumY += y; sumZ += z; sumW += w;
  }
  const len = Math.sqrt(sumX * sumX + sumY * sumY + sumZ * sumZ + sumW * sumW) || 1;
  return [sumX / len, sumY / len, sumZ / len, sumW / len];
}

// ─── Extract gesture data from single VRMA file ────────────────────────────
function extractGestureFromFile(vrmaPath) {
  try {
    const gltf = loadGltf(vrmaPath);
    
    const vrmAnimExt = gltf.extensions?.VRMC_vrm_animation;
    if (!vrmAnimExt) {
      return { error: 'No VRMC_vrm_animation extension' };
    }

    const humanBones = vrmAnimExt.humanoid?.humanBones ?? {};
    const nodeIndexToBone = {};
    for (const [boneName, boneData] of Object.entries(humanBones)) {
      if (typeof boneData.node === 'number') {
        nodeIndexToBone[boneData.node] = boneName;
      }
    }

    const animation = gltf.animations?.[0];
    if (!animation) {
      return { error: 'No animations found' };
    }

    let maxTime = 0;
    const boneData = {};

    for (const channel of animation.channels) {
      const nodeIdx = channel.target.node;
      const boneName = nodeIndexToBone[nodeIdx];
      if (!boneName) continue;
      if (channel.target.path !== 'rotation') continue;
      if (!BONES_OF_INTEREST.includes(boneName)) continue;

      const sampler = animation.samplers[channel.sampler];
      const times = getAccessorData(gltf, sampler.input);
      const quats = getAccessorData(gltf, sampler.output);

      if (times.length === 0) continue;
      maxTime = Math.max(maxTime, times[times.length - 1]);
      boneData[boneName] = { times, quats };
    }

    if (Object.keys(boneData).length === 0) {
      return { error: 'No rotation tracks found' };
    }

    const targetTime = maxTime * (framePercent / 100);
    const extracted = {};

    for (const boneName of BONES_OF_INTEREST) {
      const track = boneData[boneName];
      if (!track) continue;
      const [x, y, z, w] = averageSamples(track, targetTime, avgWindow, maxTime);
      const euler = quatToEulerYXZ(x, y, z, w);
      extracted[boneName] = euler;
    }

    return {
      success: true,
      data: extracted,
      duration: maxTime,
      boneCount: Object.keys(extracted).length,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Main batch processing ─────────────────────────────────────────────────
console.log(`\n🚀 VRMA Batch Extractor`);
console.log(`📁 Scanning: ${ANIMATIONS_DIR}`);
console.log(`📊 Sample: ${framePercent}% | Window: ${avgWindow} frames\n`);

// Find all .vrma files
const vrmaFiles = [];
function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.name.endsWith('.vrma')) {
      vrmaFiles.push(fullPath);
    }
  }
}

if (!fs.existsSync(ANIMATIONS_DIR)) {
  console.error(`❌ Animations directory not found: ${ANIMATIONS_DIR}`);
  process.exit(1);
}

walkDir(ANIMATIONS_DIR);

console.log(`✅ Found ${vrmaFiles.length} VRMA files\n`);

// Extract data from all files
const results = {};
const errors = [];

for (const vrmaPath of vrmaFiles) {
  const filename = path.basename(vrmaPath);
  const gestureName = normalizeGestureName(filename);
  process.stdout.write(`🔍 ${filename.padEnd(40)} → ${gestureName.padEnd(20)} ... `);
  
  const result = extractGestureFromFile(vrmaPath);
  
  if (result.error) {
    console.log(`❌ ${result.error}`);
    errors.push({ file: filename, gesture: gestureName, error: result.error });
  } else {
    console.log(`✅ ${result.boneCount} bones (${result.duration.toFixed(2)}s)`);
    results[gestureName] = {
      filename,
      data: result.data,
      duration: result.duration,
    };
  }
}

console.log(`\n📊 Results: ${Object.keys(results).length} succeeded, ${errors.length} failed\n`);

if (errors.length > 0) {
  console.log(`⚠️  Failed extractions:`);
  for (const err of errors) {
    console.log(`   - ${err.file} (${err.gesture}): ${err.error}`);
  }
  console.log('');
}

// ─── Generate TypeScript output ────────────────────────────────────────────
const lines = [
  `/**`,
  ` * generatedGestures.ts`,
  ` * ─────────────────────────────────────────────────────────────────────────`,
  ` * Auto-generated gesture constants from VRMA files`,
  ` * Generated: ${new Date().toISOString()}`,
  ` * Source: ${path.relative(path.dirname(outFile), ANIMATIONS_DIR)}`,
  ` * Sample: ${framePercent}% | Window: ${avgWindow} frames`,
  ` * ─────────────────────────────────────────────────────────────────────────`,
  ` * DO NOT EDIT MANUALLY — regenerate with: node scripts/extract-all-vrmas.mjs`,
  ` */`,
  ``,
  `export interface GestureData {`,
  `  filename: string;`,
  `  duration: number;`,
  `  rightUpperArm?: { x: number; y: number; z: number };`,
  `  leftUpperArm?: { x: number; y: number; z: number };`,
  `  rightLowerArm?: { x: number; z: number };`,
  `  leftLowerArm?: { x: number; z: number };`,
  `  rightHand?: { x: number; y: number; z: number };`,
  `  leftHand?: { x: number; y: number; z: number };`,
  `  rightShoulder?: { x: number; y: number; z: number };`,
  `  leftShoulder?: { x: number; y: number; z: number };`,
  `  neck?: { x: number; y: number; z: number };`,
  `  head?: { x: number; y: number; z: number };`,
  `  hips?: { x: number; y: number; z: number };`,
  `  spine?: { x: number; y: number; z: number };`,
  `  chest?: { x: number; y: number; z: number };`,
  `}`,
  ``,
  `export const GESTURE_CONSTANTS: Record<string, GestureData> = {`,
];

// Add each gesture as an object
const sortedGestures = Object.keys(results).sort();
for (let i = 0; i < sortedGestures.length; i++) {
  const gestureName = sortedGestures[i];
  const result = results[gestureName];
  
  lines.push(`  ${gestureName}: {`);
  lines.push(`    filename: '${result.filename}',`);
  lines.push(`    duration: ${result.duration.toFixed(4)},`);
  
  for (const [boneName, euler] of Object.entries(result.data)) {
    const camelCase = boneName.charAt(0).toLowerCase() + boneName.slice(1);
    const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(4);
    
    if (boneName === 'rightLowerArm' || boneName === 'leftLowerArm') {
      lines.push(`    ${camelCase}: { x: ${fmt(euler.x)}, z: ${fmt(euler.z)} },`);
    } else {
      lines.push(`    ${camelCase}: { x: ${fmt(euler.x)}, y: ${fmt(euler.y)}, z: ${fmt(euler.z)} },`);
    }
  }
  
  lines.push(`  }${i < sortedGestures.length - 1 ? ',' : ''}`);
}

lines.push(`};`);
lines.push(``);

// ─── Generate individual constants (for copy-paste) ────────────────────────
lines.push(`// ═══════════════════════════════════════════════════════════════════════════`);
lines.push(`// Individual Constants (for copy-paste into VRMSkeletonManager.tsx)`);
lines.push(`// ═══════════════════════════════════════════════════════════════════════════`);
lines.push(``);

for (const gestureName of sortedGestures) {
  const result = results[gestureName];
  
  lines.push(`// ─── ${gestureName} gesture (from ${result.filename}) ──────────────────────`);
  
  for (const [boneName, abbr] of Object.entries(BONE_MAP)) {
    const euler = result.data[boneName];
    if (!euler) continue;
    
    const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(4);
    lines.push(`const ${`${gestureName}_${abbr}_X`.padEnd(35)} = ${fmt(euler.x)};  // ${boneName} pitch`);
    
    if (abbr !== 'RLA' && abbr !== 'LLA') {
      lines.push(`const ${`${gestureName}_${abbr}_Y`.padEnd(35)} = ${fmt(euler.y)};  // ${boneName} yaw`);
    }
    
    lines.push(`const ${`${gestureName}_${abbr}_Z`.padEnd(35)} = ${fmt(euler.z)};  // ${boneName} roll`);
    lines.push(``);
  }
  
  lines.push(``);
}

// ─── Add usage instructions ────────────────────────────────────────────────
lines.push(`// ═══════════════════════════════════════════════════════════════════════════`);
lines.push(`// Usage Instructions`);
lines.push(`// ═══════════════════════════════════════════════════════════════════════════`);
lines.push(`//`);
lines.push(`// Option 1: Use GESTURE_CONSTANTS object directly in code`);
lines.push(`//   import { GESTURE_CONSTANTS } from './generatedGestures';`);
lines.push(`//   const waving = GESTURE_CONSTANTS.WAVING;`);
lines.push(`//`);
lines.push(`// Option 2: Copy individual constants to VRMSkeletonManager.tsx`);
lines.push(`//   - Scroll up to find the gesture constants block`);
lines.push(`//   - Copy the const declarations (e.g., WAVING_RUA_X, WAVING_RUA_Y, ...)`);
lines.push(`//   - Paste into VRMSkeletonManager.tsx gesture constants section`);
lines.push(`//   - Add a case in the gesture switch statement to use these values`);
lines.push(`//`);
lines.push(`// Option 3: Fine-tune with GestureCalibrator`);
lines.push(`//   - Load the gesture in the app`);
lines.push(`//   - Open GestureCalibrator UI`);
lines.push(`//   - Adjust values in real-time and export calibrated pose`);
lines.push(`//`);
lines.push(`// Available gestures: ${sortedGestures.join(', ')}`);
lines.push(``);

// Write output file
const output = lines.join('\n');
fs.writeFileSync(outFile, output, 'utf-8');

console.log(`✅ Generated: ${path.relative(process.cwd(), outFile)}`);
console.log(`📦 Exported ${Object.keys(results).length} gestures`);
console.log(`\n💡 Next steps:`);
console.log(`   1. Import gesture constants: import { GESTURE_CONSTANTS } from './generatedGestures'`);
console.log(`   2. Or copy individual constants to VRMSkeletonManager.tsx`);
console.log(`   3. Fine-tune with GestureCalibrator UI if needed`);
console.log(`\n🎯 Available gestures: ${sortedGestures.slice(0, 10).join(', ')}${sortedGestures.length > 10 ? `, +${sortedGestures.length - 10} more` : ''}`);
console.log('');
