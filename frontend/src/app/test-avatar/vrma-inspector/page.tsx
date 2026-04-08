'use client';

/**
 * /test-avatar/vrma-inspector
 * ─────────────────────────────────────────────────────────────────────────────
 * Drag & drop any .vrma file → live extraction of VRM normalized-bone rotations.
 * Shows a ready-to-paste TypeScript constants block.
 *
 * Works 100% in-browser — no server, no WebGL.  Parses the GLTF binary directly.
 */

import React, { useCallback, useRef, useState } from 'react';

// ─── Bone subset we care about ────────────────────────────────────────────────
const BONES_OF_INTEREST = new Set([
  'rightUpperArm', 'leftUpperArm',
  'rightLowerArm', 'leftLowerArm',
  'rightHand',     'leftHand',
  'rightShoulder', 'leftShoulder',
  'neck', 'head', 'hips', 'spine', 'chest',
]);

const BONE_ABBR: Record<string, string> = {
  rightUpperArm: 'RUA', leftUpperArm: 'LUA',
  rightLowerArm: 'RLA', leftLowerArm: 'LLA',
  rightHand: 'RH',     leftHand: 'LH',
  rightShoulder: 'RSHOULDER', leftShoulder: 'LSHOULDER',
  neck: 'NECK', head: 'HEAD', hips: 'HIPS', spine: 'SPINE', chest: 'CHEST',
};

// ─── Quaternion → Euler YXZ (Three.js order) ─────────────────────────────────
function quatToEulerYXZ(x: number, y: number, z: number, w: number) {
  const sqx = x * x, sqy = y * y, sqz = z * z, sqw = w * w;
  const ey = Math.atan2(2 * (x * w + y * z), sqw - sqx - sqy + sqz);
  const sinEx = 2 * (y * w - x * z);
  const ex = Math.abs(sinEx) >= 1 ? Math.sign(sinEx) * Math.PI / 2 : Math.asin(sinEx);
  const ez = Math.atan2(2 * (x * y + z * w), sqw + sqx - sqy - sqz);
  return { x: ex, y: ey, z: ez };
}

function slerp(
  [x0, y0, z0, w0]: number[],
  [x1, y1, z1, w1]: number[],
  t: number,
): [number, number, number, number] {
  const ax = x0 + (x1 - x0) * t;
  const ay = y0 + (y1 - y0) * t;
  const az = z0 + (z1 - z0) * t;
  const aw = w0 + (w1 - w0) * t;
  const len = Math.sqrt(ax * ax + ay * ay + az * az + aw * aw) || 1;
  return [ax / len, ay / len, az / len, aw / len];
}

interface BoneTrack {
  boneName: string;
  times: number[];
  quats: number[][];
}

interface ExtractionResult {
  fileName: string;
  animName: string;
  duration: number;
  bones: Array<{ boneName: string; abbr: string; x: number; y: number; z: number }>;
  bonesFound: string[];
}

// ─── Parse GLB binary ─────────────────────────────────────────────────────────
function parseGlb(buffer: ArrayBuffer): { gltf: Record<string, unknown>; bin: ArrayBuffer | null } {
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) {
    // Assume plain JSON
    const text = new TextDecoder().decode(buffer);
    return { gltf: JSON.parse(text) as Record<string, unknown>, bin: null };
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);
  const chunk0Len = view.getUint32(12, true);
  const chunk0Type = view.getUint32(16, true);
  if (chunk0Type !== 0x4E4F534A) throw new Error('Expected JSON chunk in GLB');
  const jsonBytes = new Uint8Array(buffer, 20, chunk0Len);
  const gltf = JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;

  let bin: ArrayBuffer | null = null;
  const binStart = 20 + chunk0Len;
  if (binStart + 8 < buffer.byteLength) {
    const chunk1Len = view.getUint32(binStart, true);
    const chunk1Type = view.getUint32(binStart + 4, true);
    if (chunk1Type === 0x004E4942) {
      bin = buffer.slice(binStart + 8, binStart + 8 + chunk1Len);
    }
  }
  return { gltf, bin };
}

// ─── Read accessor data ───────────────────────────────────────────────────────
function readAccessor(
  gltf: Record<string, unknown>,
  bin: ArrayBuffer | null,
  accessorIdx: number,
): number[][] {
  const accessors = gltf.accessors as Array<Record<string, unknown>>;
  const bufferViews = gltf.bufferViews as Array<Record<string, unknown>>;
  const acc = accessors[accessorIdx];
  const bv = bufferViews[acc.bufferView as number];
  const byteOffset = ((acc.byteOffset as number) ?? 0) + ((bv.byteOffset as number) ?? 0);
  const count = acc.count as number;
  const type = acc.type as string;
  const compType = acc.componentType as number;
  const numComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type] ?? 1;
  const stride = (bv.byteStride as number) ?? numComp * 4;

  const rawBuf = bin ?? new ArrayBuffer(0);
  const dv = new DataView(rawBuf);
  const result: number[][] = [];

  for (let i = 0; i < count; i++) {
    const base = byteOffset + i * stride;
    const item: number[] = [];
    for (let c = 0; c < numComp; c++) {
      if (compType === 5126) item.push(dv.getFloat32(base + c * 4, true));
      else if (compType === 5123) item.push(dv.getUint16(base + c * 2, true));
      else item.push(0);
    }
    result.push(item);
  }
  return result;
}

// ─── Core extraction ──────────────────────────────────────────────────────────
function extractFromGltf(
  gltf: Record<string, unknown>,
  bin: ArrayBuffer | null,
  fileName: string,
  framePercent: number,
  avgWindow: number,
  gestureName: string,
): ExtractionResult {
  const ext = (gltf.extensions as Record<string, unknown>)?.VRMC_vrm_animation as Record<string, unknown> | undefined;
  if (!ext) throw new Error('Not a valid .vrma — missing VRMC_vrm_animation extension');

  const humanBones = (ext.humanoid as Record<string, unknown>)?.humanBones as Record<string, { node: number }> ?? {};
  const nodeToBoone: Record<number, string> = {};
  for (const [name, data] of Object.entries(humanBones)) {
    nodeToBoone[data.node] = name;
  }

  const animations = gltf.animations as Array<Record<string, unknown>> | undefined;
  if (!animations?.length) throw new Error('No animations found in file');
  const anim = animations[0];
  const channels = anim.channels as Array<Record<string, unknown>>;
  const samplers = anim.samplers as Array<Record<string, unknown>>;

  const tracks: BoneTrack[] = [];
  let maxTime = 0;

  for (const ch of channels) {
    const target = ch.target as Record<string, unknown>;
    if (target.path !== 'rotation') continue;
    const nodeIdx = target.node as number;
    const boneName = nodeToBoone[nodeIdx];
    if (!boneName || !BONES_OF_INTEREST.has(boneName)) continue;

    const samp = samplers[ch.sampler as number];
    const times = readAccessor(gltf, bin, samp.input as number).map(a => a[0]);
    const quats = readAccessor(gltf, bin, samp.output as number);
    if (!times.length) continue;
    maxTime = Math.max(maxTime, times[times.length - 1]);
    tracks.push({ boneName, times, quats });
  }

  if (!tracks.length) throw new Error('No rotation tracks found for target bones');

  // Sample at target time
  const targetTime = maxTime * (framePercent / 100);

  function sampleBone(track: BoneTrack, t: number): [number, number, number, number] {
    const { times, quats } = track;
    let lo = 0;
    for (let i = 0; i < times.length - 1; i++) {
      if (times[i] <= t) lo = i;
    }
    const hi = Math.min(lo + 1, times.length - 1);
    const alpha = times[hi] === times[lo] ? 0 : (t - times[lo]) / (times[hi] - times[lo]);
    return slerp(quats[lo], quats[hi], Math.max(0, Math.min(1, alpha)));
  }

  const half = Math.floor(avgWindow / 2);
  const bones: ExtractionResult['bones'] = [];

  for (const track of tracks) {
    const { boneName, times } = track;
    const dt = maxTime / Math.max(1, times.length - 1);
    let sx = 0, sy = 0, sz = 0, sw = 0;
    for (let i = -half; i <= half; i++) {
      const [x, y, z, w] = sampleBone(track, targetTime + i * dt);
      sx += x; sy += y; sz += z; sw += w;
    }
    const n = avgWindow;
    const len = Math.sqrt(sx * sx + sy * sy + sz * sz + sw * sw) || 1;
    const euler = quatToEulerYXZ(sx / len, sy / len, sz / len, sw / len);
    bones.push({ boneName, abbr: BONE_ABBR[boneName] ?? boneName, ...euler });
  }

  return {
    fileName,
    animName: (anim.name as string) ?? 'unnamed',
    duration: maxTime,
    bones,
    bonesFound: tracks.map(t => t.boneName),
  };
}

// ─── Format output ────────────────────────────────────────────────────────────
function formatConstants(result: ExtractionResult, gesture: string, framePercent: number): string {
  const G = gesture.toUpperCase();
  const lines = [
    `// ═══════════════════════════════════════════════════════════════════════`,
    `// VRMA Extraction: ${result.fileName}`,
    `// Animation: "${result.animName}" | Duration: ${result.duration.toFixed(3)}s | Sample: ${framePercent}%`,
    `// Generated: ${new Date().toISOString()}`,
    `// Paste into VRMSkeletonManager.tsx — replace the ${G}_* constants block`,
    `// ═══════════════════════════════════════════════════════════════════════`,
    '',
  ];
  for (const b of result.bones) {
    const fmt = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(4);
    lines.push(`const ${`${G}_${b.abbr}_X`.padEnd(28)} = ${fmt(b.x)};`);
    if (b.abbr !== 'RLA' && b.abbr !== 'LLA') {
      lines.push(`const ${`${G}_${b.abbr}_Y`.padEnd(28)} = ${fmt(b.y)};`);
    }
    lines.push(`const ${`${G}_${b.abbr}_Z`.padEnd(28)} = ${fmt(b.z)};`);
    lines.push('');
  }
  lines.push(`// ─── Test in browser console ─────────────────────────────────────────────`);
  lines.push(`// window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { gesture: '${gesture}', duration: 4000 } }));`);
  return lines.join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function VrmaInspectorPage() {
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [framePercent, setFramePercent] = useState(50);
  const [avgWindow, setAvgWindow] = useState(5);
  const [gesture, setGesture] = useState('think');
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    setError('');
    setResult(null);
    setCode('');
    setCopied(false);
    try {
      const buf = await file.arrayBuffer();
      const { gltf, bin } = parseGlb(buf);
      const res = extractFromGltf(gltf, bin, file.name, framePercent, avgWindow, gesture);
      setResult(res);
      setCode(formatConstants(res, gesture, framePercent));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [framePercent, avgWindow, gesture]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  }, [processFile]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = '';
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const sendGesture = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:gesture', {
        detail: { gesture, duration: 4000 },
      }));
    }
  };

  const s = (bg: string, fg: string, fs = 13): React.CSSProperties => ({
    background: bg, color: fg, border: 'none', borderRadius: 7,
    cursor: 'pointer', fontWeight: 700, fontSize: fs, padding: '10px 18px',
  });

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a15', color: '#e2e8f0',
      fontFamily: 'system-ui, sans-serif', padding: 32,
    }}>
      <h1 style={{ color: '#63b3ed', marginBottom: 4, fontSize: 22 }}>
        🎞 VRMA Bone Inspector
      </h1>
      <p style={{ color: '#718096', marginBottom: 24, fontSize: 13 }}>
        Drag & drop any <code>.vrma</code> file to extract normalized bone rotations → TypeScript constants
      </p>

      {/* Config row */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#a0aec0' }}>
          Gesture prefix:
          <select
            value={gesture}
            onChange={e => setGesture(e.target.value)}
            style={{
              marginLeft: 8, background: '#1a202c', color: '#e2e8f0',
              border: '1px solid #4a5568', borderRadius: 5, padding: '4px 8px',
            }}
          >
            {['think', 'explain', 'point', 'idle', 'wave', 'clap', 'nod'].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: '#a0aec0' }}>
          Sample at {framePercent}% of animation:
          <input
            type="range" min={0} max={100} value={framePercent}
            onChange={e => setFramePercent(Number(e.target.value))}
            style={{ marginLeft: 8, width: 100, accentColor: '#63b3ed' }}
          />
        </label>
        <label style={{ fontSize: 12, color: '#a0aec0' }}>
          Avg window: {avgWindow} frames
          <input
            type="range" min={1} max={15} value={avgWindow}
            onChange={e => setAvgWindow(Number(e.target.value))}
            style={{ marginLeft: 8, width: 80, accentColor: '#63b3ed' }}
          />
        </label>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#63b3ed' : '#4a5568'}`,
          borderRadius: 12, padding: '40px 20px', textAlign: 'center',
          cursor: 'pointer', marginBottom: 24,
          background: dragging ? 'rgba(99,179,237,0.08)' : '#1a202c',
          transition: 'all 0.2s',
        }}
      >
        {loading ? (
          <div style={{ color: '#63b3ed', fontSize: 15 }}>⏳ Parsing VRMA…</div>
        ) : (
          <>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
            <div style={{ color: '#a0aec0', fontSize: 14 }}>
              Drag & drop <strong>.vrma</strong> file here, or click to browse
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".vrma,.glb"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {error && (
        <div style={{
          background: '#2d0a0a', border: '1px solid #742a2a',
          borderRadius: 8, padding: 16, marginBottom: 20, color: '#fc8181', fontSize: 13,
        }}>
          ❌ {error}
        </div>
      )}

      {result && (
        <>
          {/* Info */}
          <div style={{
            background: '#1a202c', borderRadius: 8, padding: 16,
            marginBottom: 16, fontSize: 12, color: '#a0aec0',
            display: 'flex', gap: 24, flexWrap: 'wrap',
          }}>
            <span>📄 <strong>{result.fileName}</strong></span>
            <span>🎬 "{result.animName}"</span>
            <span>⏱ {result.duration.toFixed(3)}s</span>
            <span>🦴 {result.bonesFound.length} bones extracted</span>
          </div>

          {/* Bone table */}
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2d3748' }}>
                  {['Bone', 'Abbr', 'X (pitch)', 'Y (yaw)', 'Z (roll)'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#718096' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.bones.map(b => (
                  <tr key={b.boneName} style={{ borderBottom: '1px solid #1a202c' }}>
                    <td style={{ padding: '6px 12px', color: '#63b3ed' }}>{b.boneName}</td>
                    <td style={{ padding: '6px 12px', color: '#68d391', fontFamily: 'monospace' }}>{b.abbr}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: b.x !== 0 ? '#f6e05e' : '#4a5568' }}>{b.x.toFixed(4)}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: b.y !== 0 ? '#f6e05e' : '#4a5568' }}>{b.y.toFixed(4)}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: b.z !== 0 ? '#f6e05e' : '#4a5568' }}>{b.z.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Code output */}
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <button style={s('#2b6cb0', '#fff')} onClick={copyCode}>
              {copied ? '✅ Copied!' : '📋 Copy Constants'}
            </button>
            <button
              style={s('#276749', '#fff')}
              onClick={sendGesture}
              title="Send gesture event to the avatar on this tab (open /test-avatar in same tab)"
            >
              ▶ Fire {gesture} gesture
            </button>
          </div>
          <textarea
            readOnly
            value={code}
            style={{
              width: '100%', minHeight: 320, background: '#0d1117',
              color: '#e2e8f0', fontFamily: 'ui-monospace, monospace', fontSize: 11,
              border: '1px solid #2d3748', borderRadius: 8, padding: 16,
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />

          <div style={{ marginTop: 16, padding: 12, background: '#1a202c', borderRadius: 8, fontSize: 12, color: '#a0aec0' }}>
            <strong style={{ color: '#63b3ed' }}>Next steps:</strong><br />
            1. Copy the constants above.<br />
            2. Open <code>frontend/src/app/avatar-agent/VRMSkeletonManager.tsx</code>.<br />
            3. Find the <code>// ── {gesture.toUpperCase()} gesture</code> section and replace the <code>{gesture.toUpperCase()}_*</code> constants.<br />
            4. Save and test: <code>window.dispatchEvent(new CustomEvent(&apos;avatar:gesture&apos;, {'{'} detail: {'{'} gesture: &apos;{gesture}&apos;, duration: 4000 {'}'} {'}'}));</code>
          </div>
        </>
      )}

      {!result && !error && !loading && (
        <div style={{ marginTop: 32, padding: 20, background: '#1a202c', borderRadius: 8, fontSize: 12, color: '#718096' }}>
          <strong style={{ color: '#a0aec0' }}>CLI alternative (Node.js):</strong>
          <pre style={{ marginTop: 8, background: '#0d1117', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
{`# Place your .vrma file in public/models/animations/
node scripts/extract-vrma-bones.mjs public/models/animations/Thinking.vrma
node scripts/extract-vrma-bones.mjs public/models/animations/Pointing.vrma --gesture point --frame-percent 40
node scripts/extract-vrma-bones.mjs myfile.vrma --gesture wave --out constants.ts`}
          </pre>
        </div>
      )}
    </div>
  );
}
