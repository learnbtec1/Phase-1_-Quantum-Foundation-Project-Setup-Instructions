/**
 * extract-vrma-bones.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts VRM normalized-bone rotation constants from a .vrma file WITHOUT
 * needing WebGL or a browser. Parses the GLTF binary/JSON directly.
 *
 * Usage:
 *   node scripts/extract-vrma-bones.mjs public/models/animations/Thinking.vrma
 *   node scripts/extract-vrma-bones.mjs public/models/animations/Pointing.vrma --gesture point
 *   node scripts/extract-vrma-bones.mjs myfile.vrma --frame-percent 50
 *
 * Options:
 *   --gesture <name>        Gesture prefix for output (default: think)
 *   --frame-percent <0-100> Which point in the animation to sample (default: 50)
 *   --avg-window <frames>   How many frames to average around sample point (default: 5)
 *   --out <file>            Write output to file instead of stdout
 *
 * Output: TypeScript const declarations ready to paste into VRMSkeletonManager.tsx
 *
 * Algorithm:
 *   1. Read GLTF binary (GLB) or JSON from .vrma file
 *   2. Find VRMC_vrm_animation extension → bone name map
 *   3. Parse animation tracks for each target bone
 *   4. Sample quaternion(s) around the requested time position
 *   5. Convert quaternions → Euler (YXZ order, matching VRMSkeletonManager)
 *   6. Print formatted TypeScript constants
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── VRM humanoid bone names we care about ────────────────────────────────────
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

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args[0] || args[0] === '--help') {
  console.log(`Usage: node scripts/extract-vrma-bones.mjs <file.vrma> [options]
Options:
  --gesture <name>        Output prefix (default: think)
  --frame-percent <n>     0-100 position in animation (default: 50)
  --avg-window <n>        Frames to average (default: 5)
  --out <file>            Write to file
`);
  process.exit(0);
}

const vrmaPath = path.resolve(args[0]);
let gesture = 'think';
let framePercent = 50;
let avgWindow = 5;
let outFile = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--gesture') gesture = args[++i] ?? gesture;
  else if (args[i] === '--frame-percent') framePercent = Number(args[++i] ?? framePercent);
  else if (args[i] === '--avg-window') avgWindow = Number(args[++i] ?? avgWindow);
  else if (args[i] === '--out') outFile = args[++i];
}

if (!fs.existsSync(vrmaPath)) {
  console.error(`❌ File not found: ${vrmaPath}`);
  process.exit(1);
}

// ─── Load GLTF from GLB or JSON ──────────────────────────────────────────────
function loadGltf(filePath) {
  const buf = fs.readFileSync(filePath);

  // GLB magic: 0x46546C67 = "glTF"
  const magic = buf.readUInt32LE(0);
  if (magic === 0x46546C67) {
    return parseGlb(buf);
  }
  // Assume plain JSON (.vrma can be either)
  return JSON.parse(buf.toString('utf-8'));
}

function parseGlb(buf) {
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);
  // Chunk 0: JSON
  const chunk0Length = buf.readUInt32LE(12);
  const chunk0Type = buf.readUInt32LE(16);
  if (chunk0Type !== 0x4E4F534A) throw new Error('Expected JSON chunk first in GLB');
  const jsonBuf = buf.slice(20, 20 + chunk0Length);
  const gltf = JSON.parse(jsonBuf.toString('utf-8'));
  // Chunk 1: BIN (optional)
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

// ─── Quaternion → Euler (YXZ) matching Three.js Quaternion.setFromEuler YXZ ──
function quatToEulerYXZ(x, y, z, w) {
  // Three.js setFromEuler (YXZ) inverse
  const sqx = x * x, sqy = y * y, sqz = z * z, sqw = w * w;
  const ey = Math.atan2(2 * (x * w + y * z), sqw - sqx - sqy + sqz);
  const sinEx = 2 * (y * w - x * z);
  const ex = Math.abs(sinEx) >= 1 ? Math.sign(sinEx) * Math.PI / 2 : Math.asin(sinEx);
  const ez = Math.atan2(2 * (x * y + z * w), sqw + sqx - sqy - sqz);
  return { x: ex, y: ey, z: ez };
}

// ─── Resolve buffer data ──────────────────────────────────────────────────────
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
      const uriPath = path.resolve(path.dirname(vrmaPath), bufDef.uri);
      rawBuffer = fs.readFileSync(uriPath);
    } else {
      throw new Error('Buffer has no URI and no embedded GLB bin chunk');
    }
  }

  const componentType = accessor.componentType; // 5126 = FLOAT
  const count = accessor.count;
  const type = accessor.type; // SCALAR, VEC3, VEC4

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

// ─── Main extraction ──────────────────────────────────────────────────────────
const gltf = loadGltf(vrmaPath);

// Find VRMC_vrm_animation extension
const vrmAnimExt = gltf.extensions?.VRMC_vrm_animation;
if (!vrmAnimExt) {
  console.error('❌ This file does not contain VRMC_vrm_animation extension. Is it a valid .vrma?');
  process.exit(1);
}

// Build node → bone name map
const humanBones = vrmAnimExt.humanoid?.humanBones ?? {};
const nodeIndexToBone = {}; // node_index → bone_name
for (const [boneName, boneData] of Object.entries(humanBones)) {
  if (typeof boneData.node === 'number') {
    nodeIndexToBone[boneData.node] = boneName;
  }
}

console.log(`\n✅ VRMC_vrm_animation found — ${Object.keys(humanBones).length} bones mapped`);
console.log(`📄 File: ${path.basename(vrmaPath)}`);
console.log(`🎯 Gesture prefix: ${gesture.toUpperCase()}`);

// Find animation (take the first one)
const animation = gltf.animations?.[0];
if (!animation) {
  console.error('❌ No animations found in file');
  process.exit(1);
}

console.log(`🎬 Animation: "${animation.name ?? 'unnamed'}" — ${animation.channels.length} channels`);

// Collect all time tracks to find animation duration
let maxTime = 0;
const boneData = {}; // bone_name → { times[], quats[] }

for (const channel of animation.channels) {
  const nodeIdx = channel.target.node;
  const boneName = nodeIndexToBone[nodeIdx];
  if (!boneName) continue;
  if (channel.target.path !== 'rotation') continue;
  if (!BONES_OF_INTEREST.includes(boneName)) continue;

  const sampler = animation.samplers[channel.sampler];
  const times = getAccessorData(gltf, sampler.input);   // SCALAR (seconds)
  const quats = getAccessorData(gltf, sampler.output);  // VEC4 (x,y,z,w)

  if (times.length === 0) continue;
  maxTime = Math.max(maxTime, times[times.length - 1]);
  boneData[boneName] = { times, quats };
}

if (Object.keys(boneData).length === 0) {
  console.error('❌ No rotation tracks found for target bones. Check if this vrma has rotation data.');
  process.exit(1);
}

console.log(`⏱  Duration: ${maxTime.toFixed(3)}s`);
console.log(`🔍 Bones found: ${Object.keys(boneData).join(', ')}\n`);

// ─── Sample at the requested frame-percent ────────────────────────────────────
const targetTime = maxTime * (framePercent / 100);
const halfWindow = Math.floor(avgWindow / 2);

function sampleQuat(boneTrack, tSec) {
  const { times, quats } = boneTrack;
  // Find surrounding keyframe indices
  let lo = 0;
  for (let i = 0; i < times.length - 1; i++) {
    if (times[i] <= tSec) lo = i;
  }
  const hi = Math.min(lo + 1, times.length - 1);
  const tLo = times[lo];
  const tHi = times[hi];
  const alpha = tHi === tLo ? 0 : Math.min(1, Math.max(0, (tSec - tLo) / (tHi - tLo)));
  // SLERP
  const [x0, y0, z0, w0] = quats[lo];
  const [x1, y1, z1, w1] = quats[hi];
  // Simple lerp + normalize (close enough for reading Euler)
  const ax = x0 + (x1 - x0) * alpha;
  const ay = y0 + (y1 - y0) * alpha;
  const az = z0 + (z1 - z0) * alpha;
  const aw = w0 + (w1 - w0) * alpha;
  const len = Math.sqrt(ax * ax + ay * ay + az * az + aw * aw) || 1;
  return [ax / len, ay / len, az / len, aw / len];
}

function averageSamples(boneTrack, tSec, windowCount) {
  const dt = maxTime / Math.max(1, (boneTrack.times.length - 1));
  let sumX = 0, sumY = 0, sumZ = 0, sumW = 0;
  for (let i = -Math.floor(windowCount / 2); i <= Math.floor(windowCount / 2); i++) {
    const [x, y, z, w] = sampleQuat(boneTrack, tSec + i * dt);
    sumX += x; sumY += y; sumZ += z; sumW += w;
  }
  const n = windowCount;
  const len = Math.sqrt(sumX * sumX + sumY * sumY + sumZ * sumZ + sumW * sumW) || 1;
  return [sumX / len, sumY / len, sumZ / len, sumW / len];
}

// ─── Extract and format results ───────────────────────────────────────────────
const G = gesture.toUpperCase();
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

const lines = [
  `// ═══════════════════════════════════════════════════════════════════════`,
  `// VRMA Extraction: ${path.basename(vrmaPath)}`,
  `// Gesture: ${gesture}  |  Sample: ${framePercent}% of ${maxTime.toFixed(3)}s  |  Window: ${avgWindow} frames`,
  `// Generated: ${new Date().toISOString()}`,
  `//`,
  `// Paste these constants into VRMSkeletonManager.tsx (replace ${G}_* block)`,
  `// ═══════════════════════════════════════════════════════════════════════`,
  '',
];

const extracted = {};
for (const [boneName, abbr] of Object.entries(BONE_MAP)) {
  const track = boneData[boneName];
  if (!track) continue;
  const [x, y, z, w] = averageSamples(track, targetTime, avgWindow);
  const euler = quatToEulerYXZ(x, y, z, w);
  extracted[boneName] = euler;

  const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(4);
  lines.push(`const ${`${G}_${abbr}_X`.padEnd(28)} = ${fmt(euler.x)};  // ${boneName} pitch`);
  if (abbr !== 'RLA' && abbr !== 'LLA') {
    lines.push(`const ${`${G}_${abbr}_Y`.padEnd(28)} = ${fmt(euler.y)};  // ${boneName} yaw`);
  }
  lines.push(`const ${`${G}_${abbr}_Z`.padEnd(28)} = ${fmt(euler.z)};  // ${boneName} roll`);
  lines.push('');
}

// Print a short summary table
lines.push('// ─── Summary table ──────────────────────────────────────────────────────');
for (const [boneName, euler] of Object.entries(extracted)) {
  const fmt = (v) => v.toFixed(3).padStart(7);
  lines.push(`//   ${boneName.padEnd(20)} X=${fmt(euler.x)}  Y=${fmt(euler.y)}  Z=${fmt(euler.z)}`);
}
lines.push('');
lines.push('// ─── Test command (paste in browser console on /test-avatar) ─────────────');
lines.push(`// window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { gesture: '${gesture}', duration: 4000 } }));`);

const output = lines.join('\n');
console.log(output);

if (outFile) {
  fs.writeFileSync(path.resolve(outFile), output, 'utf-8');
  console.log(`\n✅ Written to: ${outFile}`);
}
