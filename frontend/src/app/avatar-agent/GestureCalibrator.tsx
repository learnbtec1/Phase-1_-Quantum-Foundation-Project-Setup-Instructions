'use client';

/**
 * Full Body Calibrator (dev only) — Feedback-based + numeric advanced.
 * Tabs: Idle → Explain → Point → Think
 * Direction pad + «جيدة» saves all poses to calibration memory (localStorage + export JSON).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { unifiedGestureEngine } from '@/ai/cognitive/UnifiedGestureEngine';
import { showGestureCalibrationUi } from '@/config/avatar';

// ─── Types ─────────────────────────────────────────────────────────────────

type GestureName = 'explain' | 'point' | 'think' | 'wave' | 'clap' | 'agree';
/** Idle → يد → ذراع (معايرة كاملة) → إيماءات */
type TabName = 'idle' | 'hand' | 'arm' | GestureName;

interface ArmPose {
  ruaX: number;
  ruaY: number;
  ruaZ: number;
  luaX: number;
  luaY: number;
  luaZ: number;
  rlaZ: number;
  llaZ: number;
  rhX: number;
  rhY: number;
  rhZ: number;
  lhX: number;
  lhY: number;
  lhZ: number;
  fingerCurl: number;
  rFingerCurl?: number;
  lFingerCurl?: number;
}

/** Full idle UI + export. Live calibration events only send the subset the runtime supports today. */
interface IdlePoseFull {
  ruaX: number;
  ruaZ: number;
  luaX: number;
  luaZ: number;
  rlaX: number;
  rlaZ: number;
  llaX: number;
  llaZ: number;
  rhX: number;
  rhZ: number;
  lhX: number;
  lhZ: number;
  fingerCurl: number;
}

type IdleCalibrationDispatch = Pick<
  IdlePoseFull,
  'ruaX' | 'ruaZ' | 'luaX' | 'luaZ' | 'rlaX' | 'rlaZ'
>;

interface SavedProfile {
  poses?: Record<GestureName, ArmPose>;
  idle?: IdlePoseFull;
  savedAt?: string;
}

type AutoDetectPhase = 'idle' | 'test_rua_x' | 'test_rua_z' | 'done';

const PROFILE_KEY = 'cogni:gestureProfile:v3-fullbody';
/** Persistent «memory» for feedback calibration + export as calibration_memory.json */
const MEMORY_KEY = 'cogni:calibrationMemory:v1-feedback';
/** Step size for the 6-way pad (scaled by intensity slider). */
const FEEDBACK_BASE_STEP = 0.1;

const TAB_ORDER: TabName[] = ['idle', 'hand', 'arm', 'explain', 'point', 'think', 'wave', 'clap', 'agree'];

/** إيماءة المعاينة/التحديث عندما التبويب «يد» أو «ذراع» وليس idle */
function calibGestureKey(tab: TabName, handTarget: GestureName, armTarget: GestureName): GestureName {
  if (tab === 'hand') return handTarget;
  if (tab === 'arm') return armTarget;
  return tab as GestureName;
}

const ALL_GESTURE_NAMES: GestureName[] = ['explain', 'point', 'think', 'wave', 'clap', 'agree'];

function mergePosesFromSaved(
  base: Record<GestureName, ArmPose>,
  saved: Partial<Record<GestureName, Partial<ArmPose>>> | undefined,
): Record<GestureName, ArmPose> {
  if (!saved) return deepCopy(base);
  const out = deepCopy(base);
  for (const k of ALL_GESTURE_NAMES) {
    if (saved[k]) out[k] = { ...base[k], ...saved[k] } as ArmPose;
  }
  return out;
}

interface CalibrationMemory {
  version: 1;
  savedAt: string;
  idle: IdlePoseFull;
  poses: Record<GestureName, ArmPose>;
  confirmedTabs?: Partial<Record<TabName, boolean>>;
}

type SimpleRegionGesture = 'rua' | 'lua' | 'rla' | 'lla' | 'rh' | 'lh' | 'fingers';
type SimpleRegionIdle = SimpleRegionGesture | 'lh';
type Dir6 = 'up' | 'down' | 'left' | 'right' | 'forward' | 'back';

interface CalibSnapshot {
  idle: IdlePoseFull;
  poses: Record<GestureName, ArmPose>;
}

const DEFAULT_POSES: Record<GestureName, ArmPose> = {
  explain: {
    ruaX: -1.4,
    ruaY: 0.4,
    ruaZ: 0.6,
    luaX: -0.8,
    luaY: -1.55,
    luaZ: 0.2,
    rlaZ: 1.4,
    llaZ: -0.2,
    rhX: 0.5,
    rhY: 0,
    rhZ: 0.0,
    lhX: 0,
    lhY: 0,
    lhZ: 0,
    fingerCurl: 0.51,
    rFingerCurl: 0.51,
    lFingerCurl: 0.51,
  },
  point: {
    ruaX: 1.4,
    ruaY: 0,
    ruaZ: 0.1,
    luaX: 0,
    luaY: 0,
    luaZ: -1.2,
    rlaZ: -0.2,
    llaZ: 0,
    rhX: 0.1,
    rhY: 0,
    rhZ: 0,
    lhX: 0,
    lhY: 0,
    lhZ: 0,
    fingerCurl: 0.42,
    rFingerCurl: 0.42,
    lFingerCurl: 0.42,
  },
  think: {
    ruaX: 0.8,
    ruaY: 0,
    ruaZ: -0.6,
    luaX: 0,
    luaY: 0,
    luaZ: -1.2,
    rlaZ: -1.0,
    llaZ: 0,
    rhX: 0.1,
    rhY: 0,
    rhZ: 0,
    lhX: 0,
    lhY: 0,
    lhZ: 0,
    fingerCurl: 0.55,
    rFingerCurl: 0.55,
    lFingerCurl: 0.55,
  },
  wave: {
    ruaX: 1.0577,
    ruaY: 0.5666,
    ruaZ: 0.7135,
    luaX: 0.9125,
    luaY: 0.8743,
    luaZ: -0.3997,
    rlaZ: 0,
    llaZ: 0,
    rhX: 0.0158,
    rhY: -0.1541,
    rhZ: -0.5157,
    lhX: -0.0898,
    lhY: -0.1956,
    lhZ: 0.3553,
    fingerCurl: 0.35,
    rFingerCurl: 0.35,
    lFingerCurl: 0.35,
  },
  clap: {
    ruaX: 0.4301,
    ruaY: 0.3918,
    ruaZ: 1.2608,
    luaX: 0.4653,
    luaY: 0.3682,
    luaZ: -1.2417,
    rlaZ: -3.0749,
    llaZ: 3.0529,
    rhX: 0.3156,
    rhY: 0.1077,
    rhZ: -0.8245,
    lhX: 0.0978,
    lhY: -0.219,
    lhZ: 0.4724,
    fingerCurl: 0.4,
    rFingerCurl: 0.4,
    lFingerCurl: 0.4,
  },
  agree: {
    ruaX: 0.7147,
    ruaY: 0.9018,
    ruaZ: 0.2801,
    luaX: 0.5473,
    luaY: 1.1386,
    luaZ: -0.0711,
    rlaZ: 0,
    llaZ: 0,
    rhX: 0.0295,
    rhY: 0.1011,
    rhZ: -0.3773,
    lhX: 0.0387,
    lhY: 0.0937,
    lhZ: 0.5897,
    fingerCurl: 0.38,
    rFingerCurl: 0.38,
    lFingerCurl: 0.38,
  },
};

const DEFAULT_IDLE: IdlePoseFull = {
  ruaX: 0,
  ruaZ: 1.4,
  luaX: 0,
  luaZ: -1.4,
  rlaX: 0.08,
  rlaZ: 0,
  llaX: 0.08,
  llaZ: 0,
  rhX: 0,
  rhZ: 0,
  lhX: 0,
  lhZ: 0,
  fingerCurl: 0,
};

// ─── Dispatch ──────────────────────────────────────────────────────────────

function pickIdleDispatch(p: IdlePoseFull): IdleCalibrationDispatch {
  return {
    ruaX: p.ruaX,
    ruaZ: p.ruaZ,
    luaX: p.luaX,
    luaZ: p.luaZ,
    rlaX: p.rlaX,
    rlaZ: p.rlaZ,
  };
}

function dispatchGestureCalibration(gesture: GestureName, pose: ArmPose | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('avatar:gesture:calibrate', { detail: { gesture, pose } }));
  if (pose) {
    window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { gesture, duration: 99_999 } }));
  }
}

function dispatchIdleCalibration(pose: IdlePoseFull): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('avatar:gesture:calibrate:idle', { detail: pickIdleDispatch(pose) }));
  window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { gesture: 'idle', duration: 0 } }));
}

// ─── Codegen ────────────────────────────────────────────────────────────────

function tc(name: string, val: number): string {
  return `const ${name.padEnd(26)} = ${val >= 0 ? ' ' : ''}${val.toFixed(3)};`;
}

function buildIdleCodegenBlock(p: IdlePoseFull): string {
  return [
    '// ─── IDLE pose (calibrated) ──────────────────────────',
    tc('IDLE_RUA_X', p.ruaX),
    tc('IDLE_RUA_Z', p.ruaZ),
    tc('IDLE_LUA_X', p.luaX),
    tc('IDLE_LUA_Z', p.luaZ),
    tc('IDLE_RLA_X', p.rlaX),
    tc('IDLE_RLA_Z', p.rlaZ),
    tc('IDLE_LLA_X', p.llaX),
    tc('IDLE_LLA_Z', p.llaZ),
    '// Optional — wire in VRMSkeletonManager idle useFrame if needed:',
    tc('IDLE_RH_X', p.rhX),
    tc('IDLE_RH_Z', p.rhZ),
    tc('IDLE_LH_X', p.lhX),
    tc('IDLE_LH_Z', p.lhZ),
    tc('IDLE_FINGER_CURL', p.fingerCurl),
  ].join('\n');
}

function buildGestureCodegenBlock(g: GestureName, p: ArmPose): string {
  const G = g.toUpperCase();
  return [
    `// ─── ${G} gesture (calibrated) ──────────────────────`,
    tc(`${G}_RUA_X`, p.ruaX),
    tc(`${G}_RUA_Y`, p.ruaY),
    tc(`${G}_RUA_Z`, p.ruaZ),
    tc(`${G}_LUA_X`, p.luaX),
    tc(`${G}_LUA_Y`, p.luaY),
    tc(`${G}_LUA_Z`, p.luaZ),
    tc(`${G}_RLA_Z`, p.rlaZ),
    tc(`${G}_LLA_Z`, p.llaZ),
    tc(`${G}_RH_X`, p.rhX),
    tc(`${G}_RH_Y`, p.rhY),
    tc(`${G}_RH_Z`, p.rhZ),
    tc(`${G}_LH_X`, p.lhX),
    tc(`${G}_LH_Y`, p.lhY),
    tc(`${G}_LH_Z`, p.lhZ),
    `// 0=open 1=fist`,
    tc(`${G}_FINGER_CURL`, p.fingerCurl),
    tc(`${G}_R_FINGER_CURL`, p.rFingerCurl ?? p.fingerCurl),
    tc(`${G}_L_FINGER_CURL`, p.lFingerCurl ?? p.fingerCurl),
  ].join('\n');
}

function buildFullConstantsBlock(idle: IdlePoseFull, poses: Record<GestureName, ArmPose>): string {
  const ts = new Date().toISOString();
  return [
    '// ═══════════════════════════════════════════════════════════════════════════════',
    `// Full Body Calibrator export — ${ts}`,
    '// Paste into frontend/src/app/avatar-agent/VRMSkeletonManager.tsx',
    '// Replace the matching const blocks (keep EXPLAIN_WAVE_*, ANT_*, POINT_MICRO_*, THINK_*, etc.).',
    '// ═══════════════════════════════════════════════════════════════════════════════',
    '',
    buildIdleCodegenBlock(idle),
    '',
    buildGestureCodegenBlock('explain', poses.explain),
    '',
    buildGestureCodegenBlock('point', poses.point),
    '',
    buildGestureCodegenBlock('think', poses.think),
    '',
    buildGestureCodegenBlock('wave', poses.wave),
    '',
    buildGestureCodegenBlock('clap', poses.clap),
    '',
    buildGestureCodegenBlock('agree', poses.agree),
    '',
    '// POINT_FINGER_CURL / THINK_FINGER_CURL appear above — wire finger lerp in VRMSkeletonManager like explain.',
    '// IDLE_RH_*/LH_* / IDLE_FINGER_CURL: add idle-branch logic in VRMSkeletonManager if needed.',
  ].join('\n');
}

// ─── UI bits ───────────────────────────────────────────────────────────────

const AXIS_CLAMP = 3;
const BASE_DIRECTION_STEP = 0.2;

function clampAxis(v: number): number {
  return Math.max(-AXIS_CLAMP, Math.min(AXIS_CLAMP, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function deepCopy<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

function loadFromStorage(): SavedProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem('cogni:gestureProfile');
      return legacy ? (JSON.parse(legacy) as SavedProfile) : null;
    }
    return JSON.parse(raw) as SavedProfile;
  } catch {
    return null;
  }
}

function loadCalibrationMemory(): CalibrationMemory | null {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CalibrationMemory;
  } catch {
    return null;
  }
}

function parseImportedMemory(data: unknown): CalibrationMemory | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (!o.idle || !o.poses) return null;
  return data as CalibrationMemory;
}

async function fetchBootstrapMemory(): Promise<CalibrationMemory | null> {
  try {
    const r = await fetch('/data/calibration_memory.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, unknown>;
    if (j.idle == null || j.poses == null) return null;
    return parseImportedMemory(j);
  } catch {
    return null;
  }
}

function Slider({
  label,
  value,
  min = -3,
  max = 3,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <span style={{ width: 54, fontSize: 11, color: '#a0aec0', fontFamily: 'monospace' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ flex: 1, cursor: 'pointer', accentColor: '#63b3ed' }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span
        style={{
          width: 46,
          textAlign: 'right',
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#f6e05e',
        }}
      >
        {value >= 0 ? '+' : ''}
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function DirBtn({
  label,
  onClick,
  variant = 'neutral',
}: {
  label: string;
  onClick: () => void;
  variant?: 'neutral' | 'primary';
}) {
  const bg = variant === 'primary' ? '#2c5282' : '#2d3748';
  const fg = variant === 'primary' ? '#bee3f8' : '#e2e8f0';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        border: '1px solid #4a5568',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 10,
        fontWeight: 700,
        padding: '7px 4px',
        background: bg,
        color: fg,
        lineHeight: 1.2,
      }}
    >
      {label}
    </button>
  );
}

function Panel({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 10,
        padding: 10,
        background: '#1a202c',
        borderRadius: 8,
        border: `1px solid ${accent}`,
      }}
    >
      <div style={{ color: accent, fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function MouseEditPad({
  label,
  active,
  enabled,
  onActivate,
  onMouseDown,
}: {
  label: string;
  active: boolean;
  enabled: boolean;
  onActivate: () => void;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onActivate}
        style={{
          width: '100%',
          border: '1px solid #4a5568',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 700,
          padding: '6px 8px',
          background: active ? '#2c5282' : '#2d3748',
          color: active ? '#bee3f8' : '#e2e8f0',
          marginBottom: 6,
        }}
      >
        {active ? '🔘 نشط' : '⚪ تفعيل'} {label}
      </button>
      <div
        onMouseDown={enabled ? onMouseDown : undefined}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          border: `1px dashed ${active ? '#63b3ed' : '#4a5568'}`,
          borderRadius: 8,
          padding: '12px 10px',
          background: active ? 'rgba(44,82,130,0.24)' : '#111827',
          color: '#cbd5e0',
          fontSize: 10,
          textAlign: 'center',
          cursor: enabled ? 'grab' : 'not-allowed',
          lineHeight: 1.5,
        }}
      >
        اسحب بالماوس: X/Y
        <br />
        زر يمين + سحب: Z
        <br />
        سكرول: كوع/أصابع
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export function GestureCalibrator() {
  if (!showGestureCalibrationUi()) return null;

  const [tab, setTab] = useState<TabName>('idle');
  const [poses, setPoses] = useState<Record<GestureName, ArmPose>>(deepCopy(DEFAULT_POSES));
  const [idle, setIdle] = useState<IdlePoseFull>(deepCopy(DEFAULT_IDLE));
  const [minimized, setMinimized] = useState(false);
  const [nudgeIntensity, setNudgeIntensity] = useState(1);
  /** Step size for «يد» tab wrist buttons (Pitch/Yaw/Roll) */
  const [handStepIntensity, setHandStepIntensity] = useState(0.12);
  /** Target gesture when tab === 'hand' */
  const [handTarget, setHandTarget] = useState<GestureName>('clap');
  type WristAxisSign = { x: 1 | -1; y: 1 | -1; z: 1 | -1 };
  const [handAxisSign, setHandAxisSign] = useState<{ rh: WristAxisSign; lh: WristAxisSign }>({
    rh: { x: 1, y: 1, z: 1 },
    lh: { x: 1, y: 1, z: 1 },
  });
  /** تبويب «ذراع»: إيماءة الهدف + شدة خطوة لكل المفاصل */
  const [armTarget, setArmTarget] = useState<GestureName>('clap');
  const [armStepIntensity, setArmStepIntensity] = useState(0.18);
  type ArmAxis3 = { x: 1 | -1; y: 1 | -1; z: 1 | -1 };
  const [armAxisSign, setArmAxisSign] = useState<{
    rua: ArmAxis3;
    lua: ArmAxis3;
    rlaZ: 1 | -1;
    llaZ: 1 | -1;
    rh: ArmAxis3;
    lh: ArmAxis3;
  }>({
    rua: { x: 1, y: 1, z: 1 },
    lua: { x: 1, y: 1, z: 1 },
    rlaZ: 1,
    llaZ: 1,
    rh: { x: 1, y: 1, z: 1 },
    lh: { x: 1, y: 1, z: 1 },
  });
  type MouseEditablePart =
    | 'rua'
    | 'lua'
    | 'rla'
    | 'lla'
    | 'rh'
    | 'lh'
    | 'rfingers'
    | 'lfingers';
  const [mouseEditEnabled, setMouseEditEnabled] = useState(false);
  const [mouseSensitivity, setMouseSensitivity] = useState(0.01);
  const [mouseEditPart, setMouseEditPart] = useState<MouseEditablePart | null>(null);
  const mouseDragRef = useRef<{ active: boolean; rightButton: boolean; x: number; y: number } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatus] = useState('');
  const [simpleRegion, setSimpleRegion] = useState<SimpleRegionIdle>('rua');
  const [simpleLayout, setSimpleLayout] = useState(true);
  const [confirmedTabs, setConfirmedTabs] = useState<Partial<Record<TabName, boolean>>>({});
  const [importErr, setImportErr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vrmaInputRef = useRef<HTMLInputElement>(null);
  const undoStackRef = useRef<CalibSnapshot[]>([]);
  const idleRef = useRef(idle);
  const posesRef = useRef(poses);

  const [adPhase, setAdPhase] = useState<AutoDetectPhase>('idle');
  const xSignRef = useRef<1 | -1>(1);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 2400);
  };

  useEffect(() => {
    idleRef.current = idle;
  }, [idle]);
  useEffect(() => {
    posesRef.current = poses;
  }, [poses]);

  useEffect(() => {
    const applyMem = (mem: CalibrationMemory) => {
      if (mem.poses) {
        setPoses(mergePosesFromSaved(DEFAULT_POSES, mem.poses));
      }
      if (mem.idle) setIdle({ ...DEFAULT_IDLE, ...mem.idle });
      if (mem.confirmedTabs) setConfirmedTabs(mem.confirmedTabs);
    };

    const mem = loadCalibrationMemory();
    const saved = loadFromStorage();
    if (mem) applyMem(mem);
    else if (saved && (saved.poses || saved.idle)) {
      applyMem({
        version: 1,
        savedAt: saved.savedAt ?? new Date().toISOString(),
        idle: { ...DEFAULT_IDLE, ...saved.idle },
        poses: saved.poses ? mergePosesFromSaved(DEFAULT_POSES, saved.poses) : deepCopy(DEFAULT_POSES),
      });
    }

    const hadLocal = !!(mem || (saved && (saved.poses || saved.idle)));
    fetchBootstrapMemory().then((boot) => {
      if (!boot || hadLocal) return;
      applyMem(boot);
    });
  }, []);

  useEffect(() => {
    if (tab === 'idle') dispatchIdleCalibration(idle);
    else {
      const g = calibGestureKey(tab, handTarget, armTarget);
      dispatchGestureCalibration(g, poses[g]);
      window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { gesture: g, duration: 99_999 } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, handTarget, armTarget, idle]);

  const step = BASE_DIRECTION_STEP * nudgeIntensity;
  const padStep = FEEDBACK_BASE_STEP * nudgeIntensity;
  const fingerStep = 0.1 * nudgeIntensity;
  const wristStep = 0.08 * nudgeIntensity;

  const pushSnapshot = useCallback(() => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-79),
      { idle: deepCopy(idleRef.current), poses: deepCopy(posesRef.current) },
    ];
  }, []);

  const undoBad = useCallback(() => {
    const st = undoStackRef.current.pop();
    if (!st) {
      flash('لا خطوة للتراجع — استخدم أزرار الاتجاهات أولاً');
      return;
    }
    setIdle(st.idle);
    setPoses(st.poses);
    if (tab === 'idle') dispatchIdleCalibration(st.idle);
    else {
      const g = calibGestureKey(tab, handTarget, armTarget);
      dispatchGestureCalibration(g, st.poses[g]);
    }
    flash('↩️ سيئة — أُلغيت آخر خطوة');
  }, [tab, handTarget, armTarget]);

  const commitGood = useCallback(() => {
    setConfirmedTabs((prev) => {
      const nextConfirmed = { ...prev, [tab]: true };
      const snapshot: CalibrationMemory = {
        version: 1,
        savedAt: new Date().toISOString(),
        idle: deepCopy(idleRef.current),
        poses: deepCopy(posesRef.current),
        confirmedTabs: nextConfirmed,
      };
      try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(snapshot));
        localStorage.setItem(
          PROFILE_KEY,
          JSON.stringify({ poses: snapshot.poses, idle: snapshot.idle, savedAt: snapshot.savedAt }),
        );
        flash('✅ جيدة — حُفظت كل الإيماءات في الذاكرة');
      } catch {
        flash('❌ فشل الحفظ');
      }
      return nextConfirmed;
    });
  }, [tab]);

  const exportMemoryJson = useCallback(() => {
    const payload: CalibrationMemory = {
      version: 1,
      savedAt: new Date().toISOString(),
      idle: deepCopy(idle),
      poses: deepCopy(poses),
      confirmedTabs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'calibration_memory.json';
    a.click();
    URL.revokeObjectURL(url);
    flash('⬇️ تم تصدير calibration_memory.json');
  }, [idle, poses, confirmedTabs]);

  const onImportMemoryFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const mem = parseImportedMemory(data);
        if (!mem) {
          setImportErr('ملف غير صالح (version: 1 + idle + poses)');
          return;
        }
        setImportErr('');
        const mergedPoses = mergePosesFromSaved(DEFAULT_POSES, mem.poses);
        const mergedIdle = { ...DEFAULT_IDLE, ...mem.idle };
        setPoses(mergedPoses);
        setIdle(mergedIdle);
        setConfirmedTabs(mem.confirmedTabs ?? {});
        localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...mem, savedAt: new Date().toISOString() }));
        localStorage.setItem(
          PROFILE_KEY,
          JSON.stringify({ poses: mergedPoses, idle: mergedIdle, savedAt: new Date().toISOString() }),
        );
        if (tab === 'idle') dispatchIdleCalibration(mergedIdle);
        else {
          const g = calibGestureKey(tab, handTarget, armTarget);
          dispatchGestureCalibration(g, mergedPoses[g]);
        }
        flash('✅ استُوردت الذاكرة');
      } catch {
        setImportErr('فشل قراءة JSON');
      }
    };
    reader.readAsText(f);
  };

  const applyPadDirection = useCallback(
    (dir: Dir6) => {
      pushSnapshot();
      const d = padStep;
      const diag = d * 0.65;
      const curlStep = FEEDBACK_BASE_STEP * nudgeIntensity;

      const nudgeIdleArmXZ = (
        next: IdlePoseFull,
        key: 'rua' | 'lua',
        dx: number,
        dz: number,
      ): IdlePoseFull => {
        const o = { ...next };
        if (key === 'rua') {
          o.ruaX = clampAxis(o.ruaX + dx);
          o.ruaZ = clampAxis(o.ruaZ + dz);
        } else {
          o.luaX = clampAxis(o.luaX + dx);
          o.luaZ = clampAxis(o.luaZ + dz);
        }
        return o;
      };

      if (tab === 'idle') {
        setIdle((prev) => {
          let next = { ...prev };
          const reg = simpleRegion;
          if (reg === 'rua' || reg === 'lua') {
            const k = reg;
            if (dir === 'forward') next = nudgeIdleArmXZ(next, k, d, 0);
            else if (dir === 'back') next = nudgeIdleArmXZ(next, k, -d, 0);
            else if (dir === 'up') next = nudgeIdleArmXZ(next, k, 0, d);
            else if (dir === 'down') next = nudgeIdleArmXZ(next, k, 0, -d);
            else if (dir === 'left') next = nudgeIdleArmXZ(next, k, -diag, diag);
            else if (dir === 'right') next = nudgeIdleArmXZ(next, k, diag, -diag);
          } else if (reg === 'rla') {
            const s = dir === 'up' || dir === 'forward' || dir === 'right' ? 1 : -1;
            next.rlaZ = clampAxis(next.rlaZ + s * d);
          } else if (reg === 'lla') {
            const s = dir === 'up' || dir === 'forward' || dir === 'right' ? 1 : -1;
            next.llaZ = clampAxis(next.llaZ + s * d);
          } else if (reg === 'rh') {
            if (dir === 'forward') next.rhX = clampAxis(next.rhX + d);
            else if (dir === 'back') next.rhX = clampAxis(next.rhX - d);
            else if (dir === 'up') next.rhZ = clampAxis(next.rhZ + d);
            else if (dir === 'down') next.rhZ = clampAxis(next.rhZ - d);
            else if (dir === 'left') {
              next.rhX = clampAxis(next.rhX - diag);
              next.rhZ = clampAxis(next.rhZ + diag);
            } else if (dir === 'right') {
              next.rhX = clampAxis(next.rhX + diag);
              next.rhZ = clampAxis(next.rhZ - diag);
            }
          } else if (reg === 'lh') {
            if (dir === 'forward') next.lhX = clampAxis(next.lhX + d);
            else if (dir === 'back') next.lhX = clampAxis(next.lhX - d);
            else if (dir === 'up') next.lhZ = clampAxis(next.lhZ + d);
            else if (dir === 'down') next.lhZ = clampAxis(next.lhZ - d);
            else if (dir === 'left') {
              next.lhX = clampAxis(next.lhX - diag);
              next.lhZ = clampAxis(next.lhZ + diag);
            } else if (dir === 'right') {
              next.lhX = clampAxis(next.lhX + diag);
              next.lhZ = clampAxis(next.lhZ - diag);
            }
          } else if (reg === 'fingers') {
            const open = dir === 'back' || dir === 'down' || dir === 'left';
            next.fingerCurl = clamp01(next.fingerCurl + (open ? -curlStep : curlStep));
          }
          dispatchIdleCalibration(next);
          return next;
        });
        return;
      }

      const g = calibGestureKey(tab, handTarget, armTarget);
      const regG = simpleRegion as SimpleRegionGesture;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (regG === 'rua') {
          if (dir === 'forward') p.ruaX = clampAxis(p.ruaX + d);
          else if (dir === 'back') p.ruaX = clampAxis(p.ruaX - d);
          else if (dir === 'left') p.ruaY = clampAxis(p.ruaY + d);
          else if (dir === 'right') p.ruaY = clampAxis(p.ruaY - d);
          else if (dir === 'up') p.ruaZ = clampAxis(p.ruaZ + d);
          else if (dir === 'down') p.ruaZ = clampAxis(p.ruaZ - d);
        } else if (regG === 'lua') {
          if (dir === 'forward') p.luaX = clampAxis(p.luaX + d);
          else if (dir === 'back') p.luaX = clampAxis(p.luaX - d);
          else if (dir === 'left') p.luaY = clampAxis(p.luaY + d);
          else if (dir === 'right') p.luaY = clampAxis(p.luaY - d);
          else if (dir === 'up') p.luaZ = clampAxis(p.luaZ + d);
          else if (dir === 'down') p.luaZ = clampAxis(p.luaZ - d);
        } else if (regG === 'rla') {
          const s = dir === 'up' || dir === 'forward' || dir === 'right' ? 1 : -1;
          p.rlaZ = clampAxis(p.rlaZ + s * d);
        } else if (regG === 'lla') {
          const s = dir === 'up' || dir === 'forward' || dir === 'right' ? 1 : -1;
          p.llaZ = clampAxis(p.llaZ + s * d);
        } else if (regG === 'rh') {
          if (dir === 'forward') p.rhX = clampAxis(p.rhX + d);
          else if (dir === 'back') p.rhX = clampAxis(p.rhX - d);
          else if (dir === 'left') p.rhY = clampAxis(p.rhY + d);
          else if (dir === 'right') p.rhY = clampAxis(p.rhY - d);
          else if (dir === 'up') p.rhZ = clampAxis(p.rhZ + d);
          else if (dir === 'down') p.rhZ = clampAxis(p.rhZ - d);
        } else if (regG === 'lh') {
          if (dir === 'forward') p.lhX = clampAxis(p.lhX + d);
          else if (dir === 'back') p.lhX = clampAxis(p.lhX - d);
          else if (dir === 'left') p.lhY = clampAxis(p.lhY + d);
          else if (dir === 'right') p.lhY = clampAxis(p.lhY - d);
          else if (dir === 'up') p.lhZ = clampAxis(p.lhZ + d);
          else if (dir === 'down') p.lhZ = clampAxis(p.lhZ - d);
        } else if (regG === 'fingers') {
          const open = dir === 'back' || dir === 'down' || dir === 'left';
          p.fingerCurl = clamp01(p.fingerCurl + (open ? -curlStep : curlStep));
        }
        const nextPose = p;
        dispatchGestureCalibration(g, nextPose);
        return { ...prev, [g]: nextPose };
      });
    },
    [tab, handTarget, armTarget, simpleRegion, padStep, nudgeIntensity, pushSnapshot],
  );

  const btn = (bg: string, fg: string, fs = 12): React.CSSProperties => ({
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: fs,
    background: bg,
    color: fg,
    padding: 0,
  });

  // ── Gesture updates ───────────────────────────────────────────────────────

  const updatePose = useCallback((g: GestureName, field: keyof ArmPose, value: number) => {
    setPoses((prev) => {
      const next = { ...prev, [g]: { ...prev[g], [field]: value } };
      dispatchGestureCalibration(g, next[g]);
      return next;
    });
  }, []);

  const bumpGestureRua = useCallback(
    (axis: 'x' | 'y' | 'z', sign: 1 | -1) => {
      const d = sign * step;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP = {
          ...p,
          ruaX: axis === 'x' ? clampAxis(p.ruaX + d) : p.ruaX,
          ruaY: axis === 'y' ? clampAxis(p.ruaY + d) : p.ruaY,
          ruaZ: axis === 'z' ? clampAxis(p.ruaZ + d) : p.ruaZ,
        };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, step],
  );

  const bumpGestureLua = useCallback(
    (axis: 'x' | 'y' | 'z', sign: 1 | -1) => {
      const d = sign * step;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP = {
          ...p,
          luaX: axis === 'x' ? clampAxis(p.luaX + d) : p.luaX,
          luaY: axis === 'y' ? clampAxis(p.luaY + d) : p.luaY,
          luaZ: axis === 'z' ? clampAxis(p.luaZ + d) : p.luaZ,
        };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, step],
  );

  const resetGestureRua = useCallback(
    (axis: 'x' | 'y' | 'z' | 'all') => {
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const def = DEFAULT_POSES[g];
        const p = prev[g];
        const nextP =
          axis === 'all'
            ? { ...p, ruaX: def.ruaX, ruaY: def.ruaY, ruaZ: def.ruaZ }
            : {
                ...p,
                ruaX: axis === 'x' ? def.ruaX : p.ruaX,
                ruaY: axis === 'y' ? def.ruaY : p.ruaY,
                ruaZ: axis === 'z' ? def.ruaZ : p.ruaZ,
              };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget],
  );

  const resetGestureLua = useCallback(
    (axis: 'x' | 'y' | 'z' | 'all') => {
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const def = DEFAULT_POSES[g];
        const p = prev[g];
        const nextP =
          axis === 'all'
            ? { ...p, luaX: def.luaX, luaY: def.luaY, luaZ: def.luaZ }
            : {
                ...p,
                luaX: axis === 'x' ? def.luaX : p.luaX,
                luaY: axis === 'y' ? def.luaY : p.luaY,
                luaZ: axis === 'z' ? def.luaZ : p.luaZ,
              };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget],
  );

  const bumpGestureRla = useCallback(
    (sign: 1 | -1) => {
      const d = sign * step;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP = { ...p, rlaZ: clampAxis(p.rlaZ + d) };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, step],
  );

  const bumpGestureLla = useCallback(
    (sign: 1 | -1) => {
      const d = sign * step;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP = { ...p, llaZ: clampAxis(p.llaZ + d) };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, step],
  );

  const resetGestureElbow = useCallback(
    (which: 'rla' | 'lla' | 'both') => {
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const def = DEFAULT_POSES[g];
        const p = prev[g];
        const nextP = { ...p, rlaZ: which === 'lla' ? p.rlaZ : def.rlaZ, llaZ: which === 'rla' ? p.llaZ : def.llaZ };
        if (which === 'both') {
          nextP.rlaZ = def.rlaZ;
          nextP.llaZ = def.llaZ;
        }
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget],
  );

  const bumpGestureRh = useCallback(
    (axis: 'x' | 'y' | 'z', sign: 1 | -1) => {
      const d = sign * wristStep;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP = {
          ...p,
          rhX: axis === 'x' ? clampAxis(p.rhX + d) : p.rhX,
          rhY: axis === 'y' ? clampAxis(p.rhY + d) : p.rhY,
          rhZ: axis === 'z' ? clampAxis(p.rhZ + d) : p.rhZ,
        };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, wristStep],
  );

  const bumpGestureLh = useCallback(
    (axis: 'x' | 'y' | 'z', sign: 1 | -1) => {
      const d = sign * wristStep;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP = {
          ...p,
          lhX: axis === 'x' ? clampAxis(p.lhX + d) : p.lhX,
          lhY: axis === 'y' ? clampAxis(p.lhY + d) : p.lhY,
          lhZ: axis === 'z' ? clampAxis(p.lhZ + d) : p.lhZ,
        };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, wristStep],
  );

  const resetGestureRh = useCallback(() => {
    setPoses((prev) => {
      const g = calibGestureKey(tab, handTarget, armTarget);
      const def = DEFAULT_POSES[g];
      const nextP = { ...prev[g], rhX: def.rhX, rhY: def.rhY, rhZ: def.rhZ };
      dispatchGestureCalibration(g, nextP);
      return { ...prev, [g]: nextP };
    });
  }, [tab, handTarget, armTarget]);

  const resetGestureLh = useCallback(() => {
    setPoses((prev) => {
      const g = calibGestureKey(tab, handTarget, armTarget);
      const def = DEFAULT_POSES[g];
      const nextP = { ...prev[g], lhX: def.lhX, lhY: def.lhY, lhZ: def.lhZ };
      dispatchGestureCalibration(g, nextP);
      return { ...prev, [g]: nextP };
    });
  }, [tab, handTarget, armTarget]);

  const bumpGestureFinger = useCallback(
    (sign: 1 | -1) => {
      const d = sign * fingerStep;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP = {
          ...p,
          fingerCurl: clamp01(p.fingerCurl + d),
          rFingerCurl: clamp01((p.rFingerCurl ?? p.fingerCurl) + d),
          lFingerCurl: clamp01((p.lFingerCurl ?? p.fingerCurl) + d),
        };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, fingerStep],
  );

  const bumpGestureFingerSide = useCallback(
    (side: 'right' | 'left', sign: 1 | -1) => {
      const d = sign * fingerStep;
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const p = prev[g];
        const nextP =
          side === 'right'
            ? {
                ...p,
                rFingerCurl: clamp01((p.rFingerCurl ?? p.fingerCurl) + d),
              }
            : {
                ...p,
                lFingerCurl: clamp01((p.lFingerCurl ?? p.fingerCurl) + d),
              };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget, fingerStep],
  );

  const resetGestureFinger = useCallback(() => {
    setPoses((prev) => {
      const g = calibGestureKey(tab, handTarget, armTarget);
      const def = DEFAULT_POSES[g];
      const nextP = {
        ...prev[g],
        fingerCurl: def.fingerCurl,
        rFingerCurl: def.rFingerCurl ?? def.fingerCurl,
        lFingerCurl: def.lFingerCurl ?? def.fingerCurl,
      };
      dispatchGestureCalibration(g, nextP);
      return { ...prev, [g]: nextP };
    });
  }, [tab, handTarget, armTarget]);

  const resetGestureFingerSide = useCallback(
    (side: 'right' | 'left') => {
      setPoses((prev) => {
        const g = calibGestureKey(tab, handTarget, armTarget);
        const def = DEFAULT_POSES[g];
        const nextP =
          side === 'right'
            ? { ...prev[g], rFingerCurl: def.rFingerCurl ?? def.fingerCurl }
            : { ...prev[g], lFingerCurl: def.lFingerCurl ?? def.fingerCurl };
        dispatchGestureCalibration(g, nextP);
        return { ...prev, [g]: nextP };
      });
    },
    [tab, handTarget, armTarget],
  );

  const nudgeHandWrist = useCallback(
    (side: 'rh' | 'lh', axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
      pushSnapshot();
      const g = handTarget;
      const inv = side === 'rh' ? handAxisSign.rh[axis] : handAxisSign.lh[axis];
      const delta = dir * handStepIntensity * inv;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (side === 'rh') {
          if (axis === 'x') p.rhX = clampAxis(p.rhX + delta);
          if (axis === 'y') p.rhY = clampAxis(p.rhY + delta);
          if (axis === 'z') p.rhZ = clampAxis(p.rhZ + delta);
        } else {
          if (axis === 'x') p.lhX = clampAxis(p.lhX + delta);
          if (axis === 'y') p.lhY = clampAxis(p.lhY + delta);
          if (axis === 'z') p.lhZ = clampAxis(p.lhZ + delta);
        }
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [handTarget, handStepIntensity, handAxisSign, pushSnapshot],
  );

  const toggleHandAxisInvert = useCallback((side: 'rh' | 'lh', axis: 'x' | 'y' | 'z') => {
    setHandAxisSign((prev) => ({
      ...prev,
      [side]: { ...prev[side], [axis]: (-prev[side][axis] as 1 | -1) },
    }));
  }, []);

  const invertLhPoseAll = useCallback(() => {
    pushSnapshot();
    const g = handTarget;
    setPoses((prev) => {
      const cur = prev[g];
      const p = {
        ...cur,
        lhX: clampAxis(-cur.lhX),
        lhY: clampAxis(-cur.lhY),
        lhZ: clampAxis(-cur.lhZ),
      };
      dispatchGestureCalibration(g, p);
      return { ...prev, [g]: p };
    });
  }, [handTarget, pushSnapshot]);

  const toggleArmPartAxisInvert = useCallback((part: 'rua' | 'lua' | 'rh' | 'lh', axis: 'x' | 'y' | 'z') => {
    setArmAxisSign((prev) => ({
      ...prev,
      [part]: { ...prev[part], [axis]: (-prev[part][axis] as 1 | -1) },
    }));
  }, []);

  const toggleArmElbowInvert = useCallback((side: 'rla' | 'lla') => {
    setArmAxisSign((prev) =>
      side === 'rla'
        ? { ...prev, rlaZ: (-prev.rlaZ as 1 | -1) }
        : { ...prev, llaZ: (-prev.llaZ as 1 | -1) },
    );
  }, []);

  const nudgeArmRua = useCallback(
    (axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
      pushSnapshot();
      const g = armTarget;
      const inv = armAxisSign.rua[axis];
      const delta = dir * armStepIntensity * inv;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (axis === 'x') p.ruaX = clampAxis(p.ruaX + delta);
        if (axis === 'y') p.ruaY = clampAxis(p.ruaY + delta);
        if (axis === 'z') p.ruaZ = clampAxis(p.ruaZ + delta);
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [armTarget, armStepIntensity, armAxisSign, pushSnapshot],
  );

  const nudgeArmLua = useCallback(
    (axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
      pushSnapshot();
      const g = armTarget;
      const inv = armAxisSign.lua[axis];
      const delta = dir * armStepIntensity * inv;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (axis === 'x') p.luaX = clampAxis(p.luaX + delta);
        if (axis === 'y') p.luaY = clampAxis(p.luaY + delta);
        if (axis === 'z') p.luaZ = clampAxis(p.luaZ + delta);
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [armTarget, armStepIntensity, armAxisSign, pushSnapshot],
  );

  const nudgeArmRla = useCallback(
    (dir: 1 | -1) => {
      pushSnapshot();
      const g = armTarget;
      const delta = dir * armStepIntensity * armAxisSign.rlaZ;
      setPoses((prev) => {
        const p = { ...prev[g], rlaZ: clampAxis(prev[g].rlaZ + delta) };
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [armTarget, armStepIntensity, armAxisSign.rlaZ, pushSnapshot],
  );

  const nudgeArmLla = useCallback(
    (dir: 1 | -1) => {
      pushSnapshot();
      const g = armTarget;
      const delta = dir * armStepIntensity * armAxisSign.llaZ;
      setPoses((prev) => {
        const p = { ...prev[g], llaZ: clampAxis(prev[g].llaZ + delta) };
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [armTarget, armStepIntensity, armAxisSign.llaZ, pushSnapshot],
  );

  const nudgeArmTabRh = useCallback(
    (axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
      pushSnapshot();
      const g = armTarget;
      const inv = armAxisSign.rh[axis];
      const delta = dir * armStepIntensity * inv;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (axis === 'x') p.rhX = clampAxis(p.rhX + delta);
        if (axis === 'y') p.rhY = clampAxis(p.rhY + delta);
        if (axis === 'z') p.rhZ = clampAxis(p.rhZ + delta);
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [armTarget, armStepIntensity, armAxisSign, pushSnapshot],
  );

  const nudgeArmTabLh = useCallback(
    (axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
      pushSnapshot();
      const g = armTarget;
      const inv = armAxisSign.lh[axis];
      const delta = dir * armStepIntensity * inv;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (axis === 'x') p.lhX = clampAxis(p.lhX + delta);
        if (axis === 'y') p.lhY = clampAxis(p.lhY + delta);
        if (axis === 'z') p.lhZ = clampAxis(p.lhZ + delta);
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [armTarget, armStepIntensity, armAxisSign, pushSnapshot],
  );

  /** مرجع أفقي: صفر على محاور الذراع/الكوع/المعصم (curl يبقى كما هو) */
  const resetArmToTPose = useCallback(
    (side: 'right' | 'left' | 'both') => {
      pushSnapshot();
      const g = armTarget;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (side === 'right' || side === 'both') {
          p.ruaX = 0;
          p.ruaY = 0;
          p.ruaZ = 0;
          p.rlaZ = 0;
          p.rhX = 0;
          p.rhY = 0;
          p.rhZ = 0;
        }
        if (side === 'left' || side === 'both') {
          p.luaX = 0;
          p.luaY = 0;
          p.luaZ = 0;
          p.llaZ = 0;
          p.lhX = 0;
          p.lhY = 0;
          p.lhZ = 0;
        }
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
      flash(side === 'both' ? '⟳ T-pose — الذراعان' : side === 'right' ? '⟳ T-pose — يمين' : '⟳ T-pose — يسار');
    },
    [armTarget, pushSnapshot],
  );

  const applyMouseEditDelta = useCallback(
    (part: MouseEditablePart, dx: number, dy: number, rightButton: boolean) => {
      const g =
        tab === 'idle'
          ? null
          : tab === 'hand'
            ? handTarget
            : tab === 'arm'
              ? armTarget
              : (tab as GestureName);
      if (!g) return;
      setPoses((prev) => {
        const p = { ...prev[g] };
        const yawDelta = dx * mouseSensitivity;
        const pitchDelta = dy * mouseSensitivity;
        if (part === 'rua') {
          if (rightButton) p.ruaZ = clampAxis(p.ruaZ + yawDelta);
          else {
            p.ruaY = clampAxis(p.ruaY + yawDelta);
            p.ruaX = clampAxis(p.ruaX + pitchDelta);
          }
        } else if (part === 'lua') {
          if (rightButton) p.luaZ = clampAxis(p.luaZ + yawDelta);
          else {
            p.luaY = clampAxis(p.luaY + yawDelta);
            p.luaX = clampAxis(p.luaX + pitchDelta);
          }
        } else if (part === 'rh') {
          if (rightButton) p.rhZ = clampAxis(p.rhZ + yawDelta);
          else {
            p.rhY = clampAxis(p.rhY + yawDelta);
            p.rhX = clampAxis(p.rhX + pitchDelta);
          }
        } else if (part === 'lh') {
          if (rightButton) p.lhZ = clampAxis(p.lhZ + yawDelta);
          else {
            p.lhY = clampAxis(p.lhY + yawDelta);
            p.lhX = clampAxis(p.lhX + pitchDelta);
          }
        } else if (part === 'rla') {
          p.rlaZ = clampAxis(p.rlaZ + (rightButton ? yawDelta : pitchDelta));
        } else if (part === 'lla') {
          p.llaZ = clampAxis(p.llaZ + (rightButton ? yawDelta : pitchDelta));
        }
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [tab, handTarget, armTarget, mouseSensitivity],
  );

  const applyMouseWheelEdit = useCallback(
    (part: MouseEditablePart, wheelDelta: number) => {
      const g =
        tab === 'idle'
          ? null
          : tab === 'hand'
            ? handTarget
            : tab === 'arm'
              ? armTarget
              : (tab as GestureName);
      if (!g) return;
      const delta = wheelDelta * mouseSensitivity * 6;
      setPoses((prev) => {
        const p = { ...prev[g] };
        if (part === 'rla') p.rlaZ = clampAxis(p.rlaZ + delta);
        else if (part === 'lla') p.llaZ = clampAxis(p.llaZ + delta);
        else if (part === 'rfingers') p.rFingerCurl = clamp01((p.rFingerCurl ?? p.fingerCurl) + delta);
        else if (part === 'lfingers') p.lFingerCurl = clamp01((p.lFingerCurl ?? p.fingerCurl) + delta);
        else return prev;
        dispatchGestureCalibration(g, p);
        return { ...prev, [g]: p };
      });
    },
    [tab, handTarget, armTarget, mouseSensitivity],
  );

  const startMouseDrag = useCallback(
    (part: MouseEditablePart, e: React.MouseEvent<HTMLDivElement>) => {
      if (!mouseEditEnabled) return;
      e.preventDefault();
      e.stopPropagation();
      pushSnapshot();
      setMouseEditPart(part);
      mouseDragRef.current = {
        active: true,
        rightButton: e.button === 2,
        x: e.clientX,
        y: e.clientY,
      };
    },
    [mouseEditEnabled, pushSnapshot],
  );

  const handleMouseDragMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const drag = mouseDragRef.current;
      if (!drag?.active || !mouseEditPart) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      applyMouseEditDelta(mouseEditPart, dx, dy, drag.rightButton);
    },
    [mouseEditPart, applyMouseEditDelta],
  );

  const endMouseDrag = useCallback(() => {
    mouseDragRef.current = null;
  }, []);

  const handleMouseWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!mouseEditEnabled || !mouseEditPart) return;
      if (!['rla', 'lla', 'rfingers', 'lfingers'].includes(mouseEditPart)) return;
      e.preventDefault();
      const signed = e.deltaY > 0 ? 1 : -1;
      applyMouseWheelEdit(mouseEditPart, signed);
    },
    [mouseEditEnabled, mouseEditPart, applyMouseWheelEdit],
  );

  // ── Idle updates ──────────────────────────────────────────────────────────

  const updateIdle = useCallback((field: keyof IdlePoseFull, value: number) => {
    setIdle((prev) => {
      const next = { ...prev, [field]: value };
      dispatchIdleCalibration(next);
      return next;
    });
  }, []);

  const bumpIdle = useCallback(
    (
      part: 'rua' | 'lua' | 'rla' | 'lla' | 'rh' | 'lh',
      axis: 'x' | 'z' | 'single',
      sign: 1 | -1,
    ) => {
      const d = step;
      const dw = wristStep;
      setIdle((prev) => {
        let next = { ...prev };
        if (part === 'rua' && axis !== 'single') {
          next.ruaX = axis === 'x' ? clampAxis(next.ruaX + sign * d) : next.ruaX;
          next.ruaZ = axis === 'z' ? clampAxis(next.ruaZ + sign * d) : next.ruaZ;
        }
        if (part === 'lua' && axis !== 'single') {
          next.luaX = axis === 'x' ? clampAxis(next.luaX + sign * d) : next.luaX;
          next.luaZ = axis === 'z' ? clampAxis(next.luaZ + sign * d) : next.luaZ;
        }
        if (part === 'rla') next.rlaZ = clampAxis(next.rlaZ + sign * d);
        if (part === 'lla') next.llaZ = clampAxis(next.llaZ + sign * d);
        if (part === 'rh' && axis !== 'single') {
          next.rhX = axis === 'x' ? clampAxis(next.rhX + sign * dw) : next.rhX;
          next.rhZ = axis === 'z' ? clampAxis(next.rhZ + sign * dw) : next.rhZ;
        }
        if (part === 'lh' && axis !== 'single') {
          next.lhX = axis === 'x' ? clampAxis(next.lhX + sign * dw) : next.lhX;
          next.lhZ = axis === 'z' ? clampAxis(next.lhZ + sign * dw) : next.lhZ;
        }
        dispatchIdleCalibration(next);
        return next;
      });
    },
    [step, wristStep],
  );

  const bumpIdleFinger = useCallback(
    (sign: 1 | -1) => {
      const d = sign * fingerStep;
      setIdle((prev) => {
        const next = { ...prev, fingerCurl: clamp01(prev.fingerCurl + d) };
        dispatchIdleCalibration(next);
        return next;
      });
    },
    [fingerStep],
  );

  const resetIdleDefaults = useCallback(() => {
    const def = deepCopy(DEFAULT_IDLE);
    setIdle(def);
    dispatchIdleCalibration(def);
  }, []);

  const resetAll = () => {
    const p = deepCopy(DEFAULT_POSES);
    const i = deepCopy(DEFAULT_IDLE);
    setPoses(p);
    setIdle(i);
    if (tab === 'idle') dispatchIdleCalibration(i);
    else {
      const g = calibGestureKey(tab, handTarget, armTarget);
      dispatchGestureCalibration(g, p[g]);
    }
    flash('↺ Reset to defaults');
  };

  // ── VRMA → Calibrator loader ─────────────────────────────────────────────────
  const onLoadVrmaFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        const view = new DataView(buffer);
        const magic = view.getUint32(0, true);
        let json: Record<string, unknown>;
        let bin: ArrayBuffer | null = null;

        if (magic === 0x46546C67) {
          // GLB format
          const chunk0Len = view.getUint32(12, true);
          const jsonBytes = new Uint8Array(buffer, 20, chunk0Len);
          json = JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;
          const binStart = 20 + chunk0Len;
          if (binStart + 8 < buffer.byteLength) {
            const chunk1Len = view.getUint32(binStart, true);
            const chunk1Type = view.getUint32(binStart + 4, true);
            if (chunk1Type === 0x004E4942) bin = buffer.slice(binStart + 8, binStart + 8 + chunk1Len);
          }
        } else {
          json = JSON.parse(new TextDecoder().decode(buffer)) as Record<string, unknown>;
        }

        const vrmAnimExt = (json.extensions as Record<string, unknown>)?.VRMC_vrm_animation as Record<string, unknown> | undefined;
        if (!vrmAnimExt) { flash('❌ VRMA: VRMC_vrm_animation extension missing'); return; }

        const humanBones = ((vrmAnimExt.humanoid as Record<string, unknown>)?.humanBones ?? {}) as Record<string, { node: number }>;
        const nodeToBoone: Record<number, string> = {};
        for (const [name, data] of Object.entries(humanBones)) nodeToBoone[data.node] = name;

        const animations = json.animations as Array<Record<string, unknown>> | undefined;
        if (!animations?.length) { flash('❌ VRMA: no animations'); return; }
        const anim = animations[0];
        const channels = anim.channels as Array<Record<string, unknown>>;
        const samplers = anim.samplers as Array<Record<string, unknown>>;
        const accessors = json.accessors as Array<Record<string, unknown>>;
        const bufferViews = json.bufferViews as Array<Record<string, unknown>>;

        function readAcc(idx: number): number[][] {
          const acc = accessors[idx];
          const bv = bufferViews[acc.bufferView as number];
          const byteOffset = ((acc.byteOffset as number) ?? 0) + ((bv.byteOffset as number) ?? 0);
          const count = acc.count as number;
          const type = acc.type as string;
          const ct = acc.componentType as number;
          const nc = ({ SCALAR: 1, VEC3: 3, VEC4: 4 }[type]) ?? 1;
          const stride = (bv.byteStride as number) ?? nc * 4;
          const rawBuf = bin ?? new ArrayBuffer(0);
          const dv = new DataView(rawBuf);
          const res: number[][] = [];
          for (let i = 0; i < count; i++) {
            const base = byteOffset + i * stride;
            const item: number[] = [];
            for (let c = 0; c < nc; c++) {
              item.push(ct === 5126 ? dv.getFloat32(base + c * 4, true) : 0);
            }
            res.push(item);
          }
          return res;
        }

        function quatToEulerYXZ(x: number, y: number, z: number, w: number) {
          const sqx = x*x, sqy = y*y, sqz = z*z, sqw = w*w;
          return {
            x: Math.asin(Math.max(-1, Math.min(1, 2 * (y*w - x*z)))),
            y: Math.atan2(2*(x*w + y*z), sqw - sqx - sqy + sqz),
            z: Math.atan2(2*(x*y + z*w), sqw + sqx - sqy - sqz),
          };
        }

        let maxTime = 0;
        type Track = { boneName: string; times: number[]; quats: number[][] };
        const tracks: Track[] = [];

        for (const ch of channels) {
          const target = ch.target as Record<string, unknown>;
          if (target.path !== 'rotation') continue;
          const boneName = nodeToBoone[target.node as number];
          if (!boneName) continue;
          const samp = samplers[ch.sampler as number];
          const times = readAcc(samp.input as number).map(a => a[0]);
          const quats = readAcc(samp.output as number);
          if (!times.length) continue;
          maxTime = Math.max(maxTime, times[times.length - 1]);
          tracks.push({ boneName, times, quats });
        }

        // Sample at 50% of animation
        const targetTime = maxTime * 0.5;
        function sampleBone(track: Track): { x: number; y: number; z: number } {
          const { times, quats } = track;
          let lo = 0;
          for (let i = 0; i < times.length - 1; i++) if (times[i] <= targetTime) lo = i;
          const hi = Math.min(lo + 1, times.length - 1);
          const alpha = times[hi] === times[lo] ? 0 : (targetTime - times[lo]) / (times[hi] - times[lo]);
          const t = Math.max(0, Math.min(1, alpha));
          const [x0,y0,z0,w0] = quats[lo]; const [x1,y1,z1,w1] = quats[hi];
          const ax=x0+(x1-x0)*t, ay=y0+(y1-y0)*t, az=z0+(z1-z0)*t, aw=w0+(w1-w0)*t;
          const len = Math.sqrt(ax*ax+ay*ay+az*az+aw*aw)||1;
          return quatToEulerYXZ(ax/len,ay/len,az/len,aw/len);
        }

        const boneMap: Record<string, { x:number; y:number; z:number }> = {};
        for (const tr of tracks) boneMap[tr.boneName] = sampleBone(tr);

        const g = calibGestureKey(tab, handTarget, armTarget);
        if (tab !== 'idle' && boneMap.rightUpperArm) {
          const r = boneMap.rightUpperArm;
          const l = boneMap.leftUpperArm;
          const rla = boneMap.rightLowerArm;
          const lla = boneMap.leftLowerArm;
          const rh = boneMap.rightHand;
          const lh = boneMap.leftHand;
          const prev = poses[g];
          setPoses(prev2 => ({
            ...prev2,
            [g]: {
              ...prev,
              ruaX: r?.x ?? prev.ruaX,
              ruaY: r?.y ?? prev.ruaY,
              ruaZ: r?.z ?? prev.ruaZ,
              luaX: l?.x ?? prev.luaX,
              luaY: l?.y ?? prev.luaY,
              luaZ: l?.z ?? prev.luaZ,
              rlaZ: rla?.z ?? prev.rlaZ,
              llaZ: lla?.z ?? prev.llaZ,
              rhX: rh?.x ?? prev.rhX,
              rhY: rh?.y ?? prev.rhY,
              rhZ: rh?.z ?? prev.rhZ,
              lhX: lh?.x ?? prev.lhX,
              lhY: lh?.y ?? prev.lhY,
              lhZ: lh?.z ?? prev.lhZ,
            },
          }));
          dispatchGestureCalibration(g, { ...poses[g], ...{
            ruaX: r?.x ?? poses[g].ruaX,
            ruaY: r?.y ?? poses[g].ruaY,
            ruaZ: r?.z ?? poses[g].ruaZ,
            luaX: l?.x ?? poses[g].luaX,
            luaY: l?.y ?? poses[g].luaY,
            luaZ: l?.z ?? poses[g].luaZ,
            rlaZ: rla?.z ?? poses[g].rlaZ,
            llaZ: lla?.z ?? poses[g].llaZ,
            rhX: rh?.x ?? poses[g].rhX,
            rhY: rh?.y ?? poses[g].rhY,
            rhZ: rh?.z ?? poses[g].rhZ,
            lhX: lh?.x ?? poses[g].lhX,
            lhY: lh?.y ?? poses[g].lhY,
            lhZ: lh?.z ?? poses[g].lhZ,
          }});
          flash(`✅ VRMA loaded → ${g} (${Object.keys(boneMap).length} bones)`);
        } else if (tab === 'idle' && boneMap.rightUpperArm) {
          const r = boneMap.rightUpperArm;
          const l = boneMap.leftUpperArm;
          const rla = boneMap.rightLowerArm;
          const lla = boneMap.leftLowerArm;
          setIdle(prev => {
            const next = { ...prev,
              ruaX: r?.x ?? prev.ruaX, ruaZ: r?.z ?? prev.ruaZ,
              luaX: l?.x ?? prev.luaX, luaZ: l?.z ?? prev.luaZ,
              rlaZ: rla?.z ?? prev.rlaZ, llaZ: lla?.z ?? prev.llaZ,
            };
            dispatchIdleCalibration(next);
            return next;
          });
          flash(`✅ VRMA loaded → idle (${Object.keys(boneMap).length} bones)`);
        } else {
          flash(`⚠ VRMA: no arm bones found (found: ${Object.keys(boneMap).join(', ')})`);
        }
      } catch (err) {
        flash(`❌ VRMA parse error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const saveProfile = () => {
    try {
      const data: SavedProfile = { poses, idle, savedAt: new Date().toISOString() };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
      const mem: CalibrationMemory = {
        version: 1,
        savedAt: data.savedAt!,
        idle,
        poses,
        confirmedTabs,
      };
      localStorage.setItem(MEMORY_KEY, JSON.stringify(mem));
      flash('✅ Saved to localStorage + memory');
    } catch {
      flash('❌ Save failed');
    }
  };

  const loadProfile = () => {
    const saved = loadFromStorage();
    if (!saved) {
      flash('⚠ No profile');
      return;
    }
    if (saved.poses) {
      const merged = mergePosesFromSaved(DEFAULT_POSES, saved.poses);
      setPoses(merged);
      if (tab !== 'idle') {
        const g = calibGestureKey(tab, handTarget, armTarget);
        dispatchGestureCalibration(g, merged[g]);
      }
    }
    if (saved.idle) {
      const mergedIdle = { ...DEFAULT_IDLE, ...saved.idle };
      setIdle(mergedIdle);
      if (tab === 'idle') dispatchIdleCalibration(mergedIdle);
    }
    flash('✅ Profile loaded');
  };

  const openGenerateModal = () => {
    const block = buildFullConstantsBlock(idle, poses);
    setGeneratedCode(block);
    setShowCodeModal(true);
    setCopied(false);
  };

  const copyGenerated = () => {
    navigator.clipboard.writeText(generatedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      flash('✅ Copied to clipboard');
    });
    console.log('[FullBodyCalibrator]\n', generatedCode);
  };

  const quickCopyConstants = () => {
    const block = buildFullConstantsBlock(idle, poses);
    navigator.clipboard.writeText(block).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      flash('✅ Full block copied');
    });
  };

  const applyToProjectInfo = () => {
    window.alert(
      'المتصفح لا يستطيع استبدال الملفات على القرص تلقائياً.\n' +
        'اضغط «Generate Full Code»، ثم انسخ النص والصقه يدوياً في:\n' +
        'frontend/src/app/avatar-agent/VRMSkeletonManager.tsx',
    );
  };

  // ── Auto-detect (legacy) ─────────────────────────────────────────────────

  const startAutoDetect = () => {
    const testPose: ArmPose = {
      ruaX: 1.2,
      ruaY: 0,
      ruaZ: 0,
      luaX: 0,
      luaY: 0,
      luaZ: 0,
      rlaZ: 0,
      llaZ: 0,
      rhX: 0,
      rhY: 0,
      rhZ: 0,
      lhX: 0,
      lhY: 0,
      lhZ: 0,
      fingerCurl: 0,
    };
    dispatchGestureCalibration('explain', testPose);
    setAdPhase('test_rua_x');
    setTab('explain');
  };

  const answerX = (movedForward: boolean) => {
    xSignRef.current = movedForward ? 1 : -1;
    const testPose: ArmPose = {
      ruaX: 0,
      ruaY: 0,
      ruaZ: -1.2,
      luaX: 0,
      luaY: 0,
      luaZ: 0,
      rlaZ: 0,
      llaZ: 0,
      rhX: 0,
      rhY: 0,
      rhZ: 0,
      lhX: 0,
      lhY: 0,
      lhZ: 0,
      fingerCurl: 0,
    };
    dispatchGestureCalibration('explain', testPose);
    setAdPhase('test_rua_z');
  };

  const answerZ = (movedUp: boolean) => {
    const zUpSign: 1 | -1 = movedUp ? 1 : -1;
    const xs = xSignRef.current;
    setPoses((prev) => {
      const fix = (p: ArmPose): ArmPose => ({
        ...p,
        ruaX: Math.abs(p.ruaX) * (p.ruaX >= 0 ? xs : -xs),
        luaX: p.luaX === 0 ? 0 : Math.abs(p.luaX) * (p.luaX >= 0 ? xs : -xs),
        ruaZ: p.ruaZ === 0 ? 0 : p.ruaZ * zUpSign,
        luaZ: p.luaZ === 0 ? 0 : p.luaZ * zUpSign,
        rlaZ: p.rlaZ === 0 ? 0 : p.rlaZ * zUpSign,
        llaZ: p.llaZ === 0 ? 0 : p.llaZ * zUpSign,
      });
      const next = { ...prev };
      for (const k of ALL_GESTURE_NAMES) next[k] = fix(prev[k]);
      if (tab !== 'idle') {
        const g = calibGestureKey(tab, handTarget, armTarget);
        dispatchGestureCalibration(g, next[g]);
      }
      return next;
    });
    setIdle((prev) => {
      const next = {
        ...prev,
        ruaZ: prev.ruaZ === 0 ? 0 : prev.ruaZ * zUpSign,
        luaZ: prev.luaZ === 0 ? 0 : prev.luaZ * zUpSign,
      };
      if (tab === 'idle') dispatchIdleCalibration(next);
      return next;
    });
    setAdPhase('done');
    setTimeout(() => {
      dispatchGestureCalibration('explain', null);
      if (tab !== 'idle') {
        const ge = calibGestureKey(tab, handTarget, armTarget);
        window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { gesture: ge, duration: 2500 } }));
      }
    }, 300);
  };

  const resolvedGesture: GestureName | null =
    tab === 'idle' ? null : calibGestureKey(tab, handTarget, armTarget);
  const pose = resolvedGesture ? poses[resolvedGesture] : null;
  const isGestureTab = tab !== 'idle' && tab !== 'hand' && tab !== 'arm';
  const isHandTab = tab === 'hand';
  const isArmTab = tab === 'arm';

  const renderUpperArmGesture = () => {
    if (!pose) return null;
    return (
      <>
        <Panel title="💪 ذراع علوية يمنى (RUA)" accent="#68d391">
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: '#f6e05e',
              marginBottom: 8,
              padding: 6,
              background: '#0d1117',
              borderRadius: 6,
            }}
          >
            X {pose.ruaX >= 0 ? '+' : ''}
            {pose.ruaX.toFixed(3)} | Y {pose.ruaY >= 0 ? '+' : ''}
            {pose.ruaY.toFixed(3)} | Z {pose.ruaZ >= 0 ? '+' : ''}
            {pose.ruaZ.toFixed(3)}
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="← خلف" onClick={() => bumpGestureRua('x', -1)} />
            <DirBtn label="→ أمام" onClick={() => bumpGestureRua('x', 1)} variant="primary" />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="← يسار (Y+)" onClick={() => bumpGestureRua('y', 1)} />
            <DirBtn label="يمين (Y−) →" onClick={() => bumpGestureRua('y', -1)} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <DirBtn label="↓ أسفل" onClick={() => bumpGestureRua('z', -1)} />
            <DirBtn label="↑ أعلى" onClick={() => bumpGestureRua('z', 1)} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button type="button" onClick={() => resetGestureRua('x')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              صفر X
            </button>
            <button type="button" onClick={() => resetGestureRua('y')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              صفر Y
            </button>
            <button type="button" onClick={() => resetGestureRua('z')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              صفر Z
            </button>
            <button type="button" onClick={() => resetGestureRua('all')} style={{ ...btn('#553c9a', '#e9d8fd', 9), padding: '4px 8px' }}>
              ↺ افتراضي RUA
            </button>
          </div>
        </Panel>
        <Panel title="💪 ذراع علوية يسرى (LUA)" accent="#fc8181">
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: '#f6e05e',
              marginBottom: 8,
              padding: 6,
              background: '#0d1117',
              borderRadius: 6,
            }}
          >
            X {pose.luaX >= 0 ? '+' : ''}
            {pose.luaX.toFixed(3)} | Y {pose.luaY >= 0 ? '+' : ''}
            {pose.luaY.toFixed(3)} | Z {pose.luaZ >= 0 ? '+' : ''}
            {pose.luaZ.toFixed(3)}
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="← خلف" onClick={() => bumpGestureLua('x', -1)} />
            <DirBtn label="→ أمام" onClick={() => bumpGestureLua('x', 1)} variant="primary" />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="← يسار (Y+)" onClick={() => bumpGestureLua('y', 1)} />
            <DirBtn label="يمين (Y−) →" onClick={() => bumpGestureLua('y', -1)} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <DirBtn label="↓ أسفل" onClick={() => bumpGestureLua('z', -1)} />
            <DirBtn label="↑ أعلى" onClick={() => bumpGestureLua('z', 1)} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button type="button" onClick={() => resetGestureLua('x')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              صفر X
            </button>
            <button type="button" onClick={() => resetGestureLua('y')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              صفر Y
            </button>
            <button type="button" onClick={() => resetGestureLua('z')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              صفر Z
            </button>
            <button type="button" onClick={() => resetGestureLua('all')} style={{ ...btn('#553c9a', '#e9d8fd', 9), padding: '4px 8px' }}>
              ↺ افتراضي LUA
            </button>
          </div>
        </Panel>
      </>
    );
  };

  const renderElbowGesture = () => {
    if (!pose) return null;
    return (
      <Panel title="🦾 كوع (RLA / LLA) Z — خطوة = 0.2×شدة" accent="#fbd38d">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: '#68d391', marginBottom: 4 }}>RLA Z = {pose.rlaZ.toFixed(3)}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => bumpGestureRla(-1)} style={{ ...btn('#744210', '#fefcbf', 11), flex: 1, padding: '11px 4px' }}>
                ثني
              </button>
              <button type="button" onClick={() => bumpGestureRla(1)} style={{ ...btn('#2c5282', '#bee3f8', 11), flex: 1, padding: '11px 4px' }}>
                فرد
              </button>
            </div>
            <button type="button" onClick={() => resetGestureElbow('rla')} style={{ ...btn('#4a5568', '#e2e8f0', 9), width: '100%', marginTop: 6, padding: 5 }}>
              ↺ RLA
            </button>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#fc8181', marginBottom: 4 }}>LLA Z = {pose.llaZ.toFixed(3)}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => bumpGestureLla(-1)} style={{ ...btn('#744210', '#fefcbf', 11), flex: 1, padding: '11px 4px' }}>
                ثني
              </button>
              <button type="button" onClick={() => bumpGestureLla(1)} style={{ ...btn('#2c5282', '#bee3f8', 11), flex: 1, padding: '11px 4px' }}>
                فرد
              </button>
            </div>
            <button type="button" onClick={() => resetGestureElbow('lla')} style={{ ...btn('#4a5568', '#e2e8f0', 9), width: '100%', marginTop: 6, padding: 5 }}>
              ↺ LLA
            </button>
          </div>
        </div>
        <button type="button" onClick={() => resetGestureElbow('both')} style={{ ...btn('#553c9a', '#e9d8fd', 10), width: '100%', marginTop: 8, padding: 7 }}>
          ↺ الكوعان
        </button>
      </Panel>
    );
  };

  const renderHandGesture = () => {
    if (!pose) return null;
    return (
      <>
        <Panel title="🤚 معصم يمين (RH) — X / Y / Z" accent="#b794f4">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {pose.rhX.toFixed(3)} | Y {pose.rhY.toFixed(3)} | Z {pose.rhZ.toFixed(3)}
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="X −" onClick={() => bumpGestureRh('x', -1)} />
            <DirBtn label="X +" onClick={() => bumpGestureRh('x', 1)} variant="primary" />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="Y −" onClick={() => bumpGestureRh('y', -1)} />
            <DirBtn label="Y +" onClick={() => bumpGestureRh('y', 1)} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <DirBtn label="Z −" onClick={() => bumpGestureRh('z', -1)} />
            <DirBtn label="Z +" onClick={() => bumpGestureRh('z', 1)} />
          </div>
          <button type="button" onClick={resetGestureRh} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', padding: 6 }}>
            ↺ افتراضي RH
          </button>
        </Panel>
        <Panel title="🤚 معصم يسار (LH) — X / Y / Z" accent="#ed64a6">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {pose.lhX.toFixed(3)} | Y {pose.lhY.toFixed(3)} | Z {pose.lhZ.toFixed(3)}
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="X −" onClick={() => bumpGestureLh('x', -1)} />
            <DirBtn label="X +" onClick={() => bumpGestureLh('x', 1)} variant="primary" />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <DirBtn label="Y −" onClick={() => bumpGestureLh('y', -1)} />
            <DirBtn label="Y +" onClick={() => bumpGestureLh('y', 1)} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <DirBtn label="Z −" onClick={() => bumpGestureLh('z', -1)} />
            <DirBtn label="Z +" onClick={() => bumpGestureLh('z', 1)} />
          </div>
          <button type="button" onClick={resetGestureLh} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', padding: 6 }}>
            ↺ افتراضي LH
          </button>
        </Panel>
      </>
    );
  };

  const renderHandWristTab = () => {
    const hp = poses[handTarget];
    const invLabel = (v: 1 | -1) => (v > 0 ? '+' : '−');
    const row = (
      side: 'rh' | 'lh',
      label: string,
      axis: 'x' | 'y' | 'z',
      fwdLabel: string,
      backLabel: string,
    ) => (
      <div
        key={`${side}-${axis}`}
        style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}
      >
        <span style={{ width: 72, fontSize: 10, color: '#a0aec0' }}>{label}</span>
        <DirBtn label={backLabel} onClick={() => nudgeHandWrist(side, axis, -1)} />
        <DirBtn label={fwdLabel} onClick={() => nudgeHandWrist(side, axis, 1)} variant="primary" />
        <button
          type="button"
          onClick={() => toggleHandAxisInvert(side, axis)}
          style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}
        >
          عكس {axis.toUpperCase()} ({invLabel(side === 'rh' ? handAxisSign.rh[axis] : handAxisSign.lh[axis])})
        </button>
      </div>
    );
    return (
      <>
        <div style={{ fontSize: 11, color: '#a0aec0', marginBottom: 10, lineHeight: 1.45 }}>
          اختر الإيماءة (مثلاً clap) ثم حرّك المعصمين. «عكس X/Y/Z» يقلب اتجاه خطوة ذلك المحور فقط. «عكس كل LH» يضرب قيم معصم
          اليسار بـ −1 دفعة واحدة (مفيد لتصحيح التصفيق).
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>إيماءة الهدف</label>
          <select
            value={handTarget}
            onChange={(e) => setHandTarget(e.target.value as GestureName)}
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              background: '#1a202c',
              color: '#e2e8f0',
              border: '1px solid #4a5568',
            }}
          >
            {ALL_GESTURE_NAMES.map((gn) => (
              <option key={gn} value={gn}>
                {gn}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, marginBottom: 4 }}>شدة الخطوة: {handStepIntensity.toFixed(2)}</div>
          <input
            type="range"
            min={0.05}
            max={0.5}
            step={0.01}
            value={handStepIntensity}
            onChange={(e) => setHandStepIntensity(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: 10, padding: 8, background: '#111827', borderRadius: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 6 }}>
            <input type="checkbox" checked={mouseEditEnabled} onChange={(e) => setMouseEditEnabled(e.target.checked)} />
            تفعيل التحرير بالماوس
          </label>
          <Slider label="Mouse" value={mouseSensitivity} min={0.002} max={0.04} step={0.002} onChange={setMouseSensitivity} />
          <div style={{ fontSize: 10, color: '#718096' }}>
            الجزء النشط: {mouseEditPart ?? 'لا يوجد'}{mouseEditEnabled ? '' : ' — فعّل الخيار أولاً'}
          </div>
        </div>
        <Panel title="🤚 يمين — أمام/خلف (X) · يسار/يمين (Y) · فوق/تحت (Z)" accent="#68d391">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {hp.rhX >= 0 ? '+' : ''}
            {hp.rhX.toFixed(3)} | Y {hp.rhY >= 0 ? '+' : ''}
            {hp.rhY.toFixed(3)} | Z {hp.rhZ >= 0 ? '+' : ''}
            {hp.rhZ.toFixed(3)}
          </div>
          {row('rh', 'أمام / خلف', 'x', 'أمام', 'خلف')}
          {row('rh', 'يسار / يمين', 'y', 'يسار', 'يمين')}
          {row('rh', 'فوق / تحت', 'z', 'فوق', 'تحت')}
          <MouseEditPad
            label="تحرير RH بالماوس"
            active={mouseEditPart === 'rh'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('rh')}
            onMouseDown={(e) => startMouseDrag('rh', e)}
          />
          <button type="button" onClick={resetGestureRh} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', marginTop: 6, padding: 6 }}>
            ↺ افتراضي RH
          </button>
        </Panel>
        <Panel title="🤚 يسار — نفس المحاور + عكس سريع" accent="#fc8181">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {hp.lhX >= 0 ? '+' : ''}
            {hp.lhX.toFixed(3)} | Y {hp.lhY >= 0 ? '+' : ''}
            {hp.lhY.toFixed(3)} | Z {hp.lhZ >= 0 ? '+' : ''}
            {hp.lhZ.toFixed(3)}
          </div>
          {row('lh', 'أمام / خلف', 'x', 'أمام', 'خلف')}
          {row('lh', 'يسار / يمين', 'y', 'يسار', 'يمين')}
          {row('lh', 'فوق / تحت', 'z', 'فوق', 'تحت')}
          <MouseEditPad
            label="تحرير LH بالماوس"
            active={mouseEditPart === 'lh'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('lh')}
            onMouseDown={(e) => startMouseDrag('lh', e)}
          />
          <button type="button" onClick={invertLhPoseAll} style={{ ...btn('#805ad5', '#e9d8fd', 10), width: '100%', marginTop: 8, padding: 8 }}>
            ⟲ عكس كل LH (X/Y/Z)
          </button>
          <button type="button" onClick={resetGestureLh} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', marginTop: 6, padding: 6 }}>
            ↺ افتراضي LH
          </button>
        </Panel>
      </>
    );
  };

  const renderArmTab = () => {
    const ap = poses[armTarget];
    const inv3 = (part: 'rua' | 'lua' | 'rh' | 'lh', axis: 'x' | 'y' | 'z') =>
      armAxisSign[part][axis] > 0 ? '+' : '−';
    const armRow = (
      part: 'rua' | 'lua' | 'rh' | 'lh',
      sectionLabel: string,
      axis: 'x' | 'y' | 'z',
      negLabel: string,
      posLabel: string,
      onNudge: (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void,
    ) => (
      <div
        key={`${part}-${axis}`}
        style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}
      >
        <span style={{ width: 88, fontSize: 10, color: '#a0aec0' }}>{sectionLabel}</span>
        <DirBtn label={negLabel} onClick={() => onNudge(axis, -1)} />
        <DirBtn label={posLabel} onClick={() => onNudge(axis, 1)} variant="primary" />
        <button
          type="button"
          onClick={() => toggleArmPartAxisInvert(part, axis)}
          style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}
        >
          عكس {axis.toUpperCase()} ({inv3(part, axis)})
        </button>
      </div>
    );
    return (
      <>
        <div style={{ fontSize: 11, color: '#a0aec0', marginBottom: 10, lineHeight: 1.45 }}>
          معايرة الذراع كاملاً (علوي + كوع + معصم) لإيماءة واحدة. T-pose يضع المحاور على 0 كمرجع؛ إن لم يبدُ أفقياً على موديلك،
          زحّح بالأزرار أو استخدم «افتراضي» من إعدادات اللوحة التفصيلية.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          <button type="button" onClick={() => resetArmToTPose('right')} style={{ ...btn('#2c5282', '#bee3f8', 10), padding: '8px 10px' }}>
            ⟳ T-pose يمين
          </button>
          <button type="button" onClick={() => resetArmToTPose('left')} style={{ ...btn('#2c5282', '#bee3f8', 10), padding: '8px 10px' }}>
            ⟳ T-pose يسار
          </button>
          <button type="button" onClick={() => resetArmToTPose('both')} style={{ ...btn('#553c9a', '#e9d8fd', 10), padding: '8px 10px' }}>
            ⟳ T-pose الذراعين
          </button>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>إيماءة الهدف</label>
          <select
            value={armTarget}
            onChange={(e) => setArmTarget(e.target.value as GestureName)}
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              background: '#1a202c',
              color: '#e2e8f0',
              border: '1px solid #4a5568',
            }}
          >
            {ALL_GESTURE_NAMES.map((gn) => (
              <option key={gn} value={gn}>
                {gn}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, marginBottom: 4 }}>شدة الخطوة (ذراع/كوع/معصم): {armStepIntensity.toFixed(2)}</div>
          <input
            type="range"
            min={0.05}
            max={0.45}
            step={0.01}
            value={armStepIntensity}
            onChange={(e) => setArmStepIntensity(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: 10, padding: 8, background: '#111827', borderRadius: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 6 }}>
            <input type="checkbox" checked={mouseEditEnabled} onChange={(e) => setMouseEditEnabled(e.target.checked)} />
            تفعيل التحرير بالماوس
          </label>
          <Slider label="Mouse" value={mouseSensitivity} min={0.002} max={0.04} step={0.002} onChange={setMouseSensitivity} />
          <div style={{ fontSize: 10, color: '#718096' }}>
            Drag = X/Y ، Right-drag = Z ، Wheel = Elbow/Fingers
          </div>
        </div>

        <Panel title="💪 يمين — Upper Arm (RUA) X/Y/Z" accent="#68d391">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {ap.ruaX >= 0 ? '+' : ''}
            {ap.ruaX.toFixed(3)} | Y {ap.ruaY >= 0 ? '+' : ''}
            {ap.ruaY.toFixed(3)} | Z {ap.ruaZ >= 0 ? '+' : ''}
            {ap.ruaZ.toFixed(3)}
          </div>
          {armRow('rua', 'أمام / خلف (X)', 'x', 'خلف', 'أمام', nudgeArmRua)}
          {armRow('rua', 'يسار / يمين (Y)', 'y', 'يمين', 'يسار', nudgeArmRua)}
          {armRow('rua', 'أعلى / أسفل (Z)', 'z', 'أسفل', 'أعلى', nudgeArmRua)}
          <MouseEditPad
            label="تحرير RUA"
            active={mouseEditPart === 'rua'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('rua')}
            onMouseDown={(e) => startMouseDrag('rua', e)}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            <button type="button" onClick={() => resetGestureRua('all')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              ↺ افتراضي RUA
            </button>
          </div>
        </Panel>

        <Panel title="🦾 يمين — Lower Arm / كوع (RLA Z)" accent="#fbd38d">
          <div style={{ fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>RLA Z = {ap.rlaZ.toFixed(3)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <DirBtn label="ثني" onClick={() => nudgeArmRla(-1)} />
            <DirBtn label="فرد" onClick={() => nudgeArmRla(1)} variant="primary" />
            <button type="button" onClick={() => toggleArmElbowInvert('rla')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              عكس ({armAxisSign.rlaZ > 0 ? '+' : '−'})
            </button>
          </div>
          <MouseEditPad
            label="تحرير RLA"
            active={mouseEditPart === 'rla'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('rla')}
            onMouseDown={(e) => startMouseDrag('rla', e)}
          />
          <button type="button" onClick={() => resetGestureElbow('rla')} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', padding: 6 }}>
            ↺ افتراضي RLA
          </button>
        </Panel>

        <Panel title="🤚 يمين — Hand (RH)" accent="#b794f4">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {ap.rhX.toFixed(3)} | Y {ap.rhY.toFixed(3)} | Z {ap.rhZ.toFixed(3)}
          </div>
          {armRow('rh', 'أمام / خلف (X)', 'x', 'خلف', 'أمام', nudgeArmTabRh)}
          {armRow('rh', 'يسار / يمين (Y)', 'y', 'يمين', 'يسار', nudgeArmTabRh)}
          {armRow('rh', 'أعلى / أسفل (Z)', 'z', 'أسفل', 'أعلى', nudgeArmTabRh)}
          <MouseEditPad
            label="تحرير RH"
            active={mouseEditPart === 'rh'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('rh')}
            onMouseDown={(e) => startMouseDrag('rh', e)}
          />
          <button type="button" onClick={resetGestureRh} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', marginTop: 6, padding: 6 }}>
            ↺ افتراضي RH
          </button>
        </Panel>

        <Panel title="💪 يسار — Upper Arm (LUA)" accent="#fc8181">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {ap.luaX >= 0 ? '+' : ''}
            {ap.luaX.toFixed(3)} | Y {ap.luaY >= 0 ? '+' : ''}
            {ap.luaY.toFixed(3)} | Z {ap.luaZ >= 0 ? '+' : ''}
            {ap.luaZ.toFixed(3)}
          </div>
          {armRow('lua', 'أمام / خلف (X)', 'x', 'خلف', 'أمام', nudgeArmLua)}
          {armRow('lua', 'يسار / يمين (Y)', 'y', 'يمين', 'يسار', nudgeArmLua)}
          {armRow('lua', 'أعلى / أسفل (Z)', 'z', 'أسفل', 'أعلى', nudgeArmLua)}
          <MouseEditPad
            label="تحرير LUA"
            active={mouseEditPart === 'lua'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('lua')}
            onMouseDown={(e) => startMouseDrag('lua', e)}
          />
          <button type="button" onClick={() => resetGestureLua('all')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px', marginTop: 6 }}>
            ↺ افتراضي LUA
          </button>
        </Panel>

        <Panel title="🦾 يسار — Lower Arm (LLA Z)" accent="#ed8936">
          <div style={{ fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>LLA Z = {ap.llaZ.toFixed(3)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <DirBtn label="ثني" onClick={() => nudgeArmLla(-1)} />
            <DirBtn label="فرد" onClick={() => nudgeArmLla(1)} variant="primary" />
            <button type="button" onClick={() => toggleArmElbowInvert('lla')} style={{ ...btn('#4a5568', '#e2e8f0', 9), padding: '4px 8px' }}>
              عكس ({armAxisSign.llaZ > 0 ? '+' : '−'})
            </button>
          </div>
          <MouseEditPad
            label="تحرير LLA"
            active={mouseEditPart === 'lla'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('lla')}
            onMouseDown={(e) => startMouseDrag('lla', e)}
          />
          <button type="button" onClick={() => resetGestureElbow('lla')} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', padding: 6 }}>
            ↺ افتراضي LLA
          </button>
        </Panel>

        <Panel title="🤚 يسار — Hand (LH)" accent="#ed64a6">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
            X {ap.lhX.toFixed(3)} | Y {ap.lhY.toFixed(3)} | Z {ap.lhZ.toFixed(3)}
          </div>
          {armRow('lh', 'أمام / خلف (X)', 'x', 'خلف', 'أمام', nudgeArmTabLh)}
          {armRow('lh', 'يسار / يمين (Y)', 'y', 'يسار', 'يمين', nudgeArmTabLh)}
          {armRow('lh', 'أعلى / أسفل (Z)', 'z', 'أسفل', 'أعلى', nudgeArmTabLh)}
          <MouseEditPad
            label="تحرير LH"
            active={mouseEditPart === 'lh'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('lh')}
            onMouseDown={(e) => startMouseDrag('lh', e)}
          />
          <button type="button" onClick={resetGestureLh} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', marginTop: 6, padding: 6 }}>
            ↺ افتراضي LH
          </button>
        </Panel>
      </>
    );
  };

  const renderFingersGesture = () => {
    if (!pose) return null;
    return (
      <>
        <Panel title="✋ أصابع يمين (R Fingers)" accent="#faf089">
          <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 800, color: '#f6e05e', marginBottom: 8 }}>
            curl = {(pose.rFingerCurl ?? pose.fingerCurl).toFixed(3)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => bumpGestureFingerSide('right', -1)} style={{ ...btn('#276749', '#c6f6d5', 12), flex: 1, padding: '13px 6px' }}>
              🤚 بسط
            </button>
            <button type="button" onClick={() => bumpGestureFingerSide('right', 1)} style={{ ...btn('#742a2a', '#fed7d7', 12), flex: 1, padding: '13px 6px' }}>
              ✊ قبضة
            </button>
          </div>
          <MouseEditPad
            label="تحرير أصابع اليمين"
            active={mouseEditPart === 'rfingers'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('rfingers')}
            onMouseDown={(e) => startMouseDrag('rfingers', e)}
          />
          <button type="button" onClick={() => resetGestureFingerSide('right')} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', marginTop: 8, padding: 6 }}>
            ↺ افتراضي أصابع اليمين
          </button>
        </Panel>
        <Panel title="✋ أصابع يسار (L Fingers)" accent="#f6ad55">
          <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 800, color: '#f6e05e', marginBottom: 8 }}>
            curl = {(pose.lFingerCurl ?? pose.fingerCurl).toFixed(3)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => bumpGestureFingerSide('left', -1)} style={{ ...btn('#276749', '#c6f6d5', 12), flex: 1, padding: '13px 6px' }}>
              🤚 بسط
            </button>
            <button type="button" onClick={() => bumpGestureFingerSide('left', 1)} style={{ ...btn('#742a2a', '#fed7d7', 12), flex: 1, padding: '13px 6px' }}>
              ✊ قبضة
            </button>
          </div>
          <MouseEditPad
            label="تحرير أصابع اليسار"
            active={mouseEditPart === 'lfingers'}
            enabled={mouseEditEnabled}
            onActivate={() => setMouseEditPart('lfingers')}
            onMouseDown={(e) => startMouseDrag('lfingers', e)}
          />
          <button type="button" onClick={() => resetGestureFingerSide('left')} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', marginTop: 8, padding: 6 }}>
            ↺ افتراضي أصابع اليسار
          </button>
        </Panel>
        <Panel title="✋ أصابع — موحّد" accent="#718096">
          <div style={{ textAlign: 'center', fontSize: 12, color: '#cbd5e0', marginBottom: 8 }}>
            القيمة العامة = {pose.fingerCurl.toFixed(3)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => bumpGestureFinger(-1)} style={{ ...btn('#2f855a', '#c6f6d5', 11), flex: 1, padding: '11px 6px' }}>
              بسط الكل
            </button>
            <button type="button" onClick={() => bumpGestureFinger(1)} style={{ ...btn('#9b2c2c', '#fed7d7', 11), flex: 1, padding: '11px 6px' }}>
              قبضة الكل
            </button>
          </div>
          <button type="button" onClick={resetGestureFinger} style={{ ...btn('#4a5568', '#e2e8f0', 10), width: '100%', marginTop: 8, padding: 6 }}>
            ↺ افتراضي الأصابع كلها
          </button>
        </Panel>
      </>
    );
  };

  const renderIdleTab = () => (
    <>
      <div style={{ fontSize: 10, color: '#a0aec0', marginBottom: 8, lineHeight: 1.45 }}>
        المعاينة المباشرة: RUA / LUA / RLA فقط. بقية الحقول تُصدَّر في «Generate Full Code» للصقها يدوياً في
        VRMSkeletonManager.
      </div>
      <Panel title="💪 سكون — ذراع علوية يمنى" accent="#68d391">
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
          X {idle.ruaX.toFixed(3)} | Z {idle.ruaZ.toFixed(3)}
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <DirBtn label="← خلف" onClick={() => bumpIdle('rua', 'x', -1)} />
          <DirBtn label="→ أمام" onClick={() => bumpIdle('rua', 'x', 1)} variant="primary" />
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <DirBtn label="↓ Z−" onClick={() => bumpIdle('rua', 'z', -1)} />
          <DirBtn label="↑ Z+" onClick={() => bumpIdle('rua', 'z', 1)} />
        </div>
      </Panel>
      <Panel title="💪 سكون — ذراع علوية يسرى" accent="#fc8181">
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f6e05e', marginBottom: 8 }}>
          X {idle.luaX.toFixed(3)} | Z {idle.luaZ.toFixed(3)}
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <DirBtn label="← خلف" onClick={() => bumpIdle('lua', 'x', -1)} />
          <DirBtn label="→ أمام" onClick={() => bumpIdle('lua', 'x', 1)} variant="primary" />
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <DirBtn label="↓ Z−" onClick={() => bumpIdle('lua', 'z', -1)} />
          <DirBtn label="↑ Z+" onClick={() => bumpIdle('lua', 'z', 1)} />
        </div>
      </Panel>
      <Panel title="🦾 سكون — كوع يمين RLA (RLA X/Z في المتقدم)" accent="#fbd38d">
        <div style={{ fontFamily: 'monospace', marginBottom: 8 }}>RLA Z {idle.rlaZ.toFixed(3)}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => bumpIdle('rla', 'single', -1)} style={{ ...btn('#744210', '#fefcbf', 11), flex: 1, padding: 10 }}>
            ثني
          </button>
          <button type="button" onClick={() => bumpIdle('rla', 'single', 1)} style={{ ...btn('#2c5282', '#bee3f8', 11), flex: 1, padding: 10 }}>
            فرد
          </button>
        </div>
      </Panel>
      <Panel title="🦾 سكون — كوع يسار LLA" accent="#ed8936">
        <div style={{ fontFamily: 'monospace', marginBottom: 8 }}>LLA Z {idle.llaZ.toFixed(3)}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => bumpIdle('lla', 'single', -1)} style={{ ...btn('#744210', '#fefcbf', 11), flex: 1, padding: 10 }}>
            ثني
          </button>
          <button type="button" onClick={() => bumpIdle('lla', 'single', 1)} style={{ ...btn('#2c5282', '#bee3f8', 11), flex: 1, padding: 10 }}>
            فرد
          </button>
        </div>
      </Panel>
      <Panel title="🤚 معصم — يمنى / يسرى (تصدير فقط)" accent="#b794f4">
        <div style={{ fontSize: 10, marginBottom: 6 }}>RH {idle.rhX.toFixed(2)},{idle.rhZ.toFixed(2)} · LH {idle.lhX.toFixed(2)},{idle.lhZ.toFixed(2)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <div style={{ fontSize: 9, color: '#a0aec0', marginBottom: 4 }}>يمين RH</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <DirBtn label="X−" onClick={() => bumpIdle('rh', 'x', -1)} />
              <DirBtn label="X+" onClick={() => bumpIdle('rh', 'x', 1)} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <DirBtn label="Z−" onClick={() => bumpIdle('rh', 'z', -1)} />
              <DirBtn label="Z+" onClick={() => bumpIdle('rh', 'z', 1)} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#a0aec0', marginBottom: 4 }}>يسار LH</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <DirBtn label="X−" onClick={() => bumpIdle('lh', 'x', -1)} />
              <DirBtn label="X+" onClick={() => bumpIdle('lh', 'x', 1)} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <DirBtn label="Z−" onClick={() => bumpIdle('lh', 'z', -1)} />
              <DirBtn label="Z+" onClick={() => bumpIdle('lh', 'z', 1)} />
            </div>
          </div>
        </div>
      </Panel>
      <Panel title="✋ أصابع سكون (تصدير)" accent="#faf089">
        <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 8 }}>{idle.fingerCurl.toFixed(3)}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => bumpIdleFinger(-1)} style={{ ...btn('#276749', '#c6f6d5', 11), flex: 1, padding: 11 }}>
            بسط
          </button>
          <button type="button" onClick={() => bumpIdleFinger(1)} style={{ ...btn('#742a2a', '#fed7d7', 11), flex: 1, padding: 11 }}>
            قبضة
          </button>
        </div>
      </Panel>
    </>
  );

  const regionOptions: { id: SimpleRegionIdle; label: string }[] =
    tab === 'idle'
      ? [
          { id: 'rua', label: 'ذراع يمين' },
          { id: 'lua', label: 'ذراع يسار' },
          { id: 'rla', label: 'كوع يمين' },
          { id: 'lla', label: 'كوع يسار' },
          { id: 'rh', label: 'معصم يمين' },
          { id: 'lh', label: 'معصم يسار' },
          { id: 'fingers', label: 'أصابع' },
        ]
      : [
          { id: 'rua', label: 'ذراع يمين' },
          { id: 'lua', label: 'ذراع يسار' },
          { id: 'rla', label: 'كوع يمين' },
          { id: 'lla', label: 'كوع يسار' },
          { id: 'rh', label: 'معصم يمين' },
          { id: 'lh', label: 'معصم يسار' },
          { id: 'fingers', label: 'أصابع' },
        ];

  return (
    <div
      onMouseMove={handleMouseDragMove}
      onMouseUp={endMouseDrag}
      onMouseLeave={endMouseDrag}
      onWheel={handleMouseWheel}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        width: 400,
        maxHeight: 'min(92vh, 760px)',
        overflowY: 'auto',
        background: 'rgba(13,18,30,0.98)',
        border: '1px solid #2d3748',
        borderRadius: 12,
        color: '#e2e8f0',
        fontSize: 13,
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        zIndex: 99999,
        userSelect: 'none',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        onClick={() => setMinimized((m) => !m)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'rgba(99,179,237,0.15)',
          borderRadius: '12px 12px 0 0',
          cursor: 'pointer',
          borderBottom: minimized ? 'none' : '1px solid #2d3748',
        }}
      >
        <span style={{ fontWeight: 800, color: '#63b3ed' }}>🧍 معايرة تفاعلية — تغذية راجعة</span>
        <span style={{ color: '#718096', fontSize: 18 }}>{minimized ? '▲' : '▼'}</span>
      </div>

      {!minimized && (
        <div style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {TAB_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  ...btn(tab === t ? '#3182ce' : '#2d3748', tab === t ? '#fff' : '#a0aec0', 10),
                  flex: 1,
                  padding: '6px 0',
                  textTransform: 'capitalize',
                  fontWeight: tab === t ? 800 : 500,
                }}
              >
                {t === 'hand' ? 'يد' : t === 'arm' ? 'ذراع' : t}
              </button>
            ))}
          </div>

          <div
            style={{
              marginBottom: 10,
              padding: 10,
              background: '#0f1419',
              borderRadius: 8,
              border: '1px solid #2c5282',
              fontSize: 11,
              lineHeight: 1.5,
              color: '#cbd5e0',
            }}
          >
            <div style={{ fontWeight: 800, color: '#63b3ed', marginBottom: 6 }}>كيف تستخدم الأداة</div>
            <ol style={{ margin: 0, paddingInlineStart: 18 }}>
              <li>اختر تبويب الإيماءة (Idle / Explain / …).</li>
              <li>حدّد الجزء (ذراع، كوع، معصم، أصابع) ثم حرّك بأزرار الاتجاهات.</li>
              <li>عندما يبدو الوضع صحيحاً، اضغط «جيدة» — يُحفظ كل المشهد في الذاكرة.</li>
              <li>إذا أخطأت، اضغط «سيئة» لإلغاء آخر خطوة.</li>
              <li>في النهاية اضغط «إنشاء الكود» وانسخ النص إلى VRMSkeletonManager.tsx.</li>
            </ol>
            <div style={{ marginTop: 8, fontSize: 10, color: '#718096' }}>
              الذاكرة: localStorage ({MEMORY_KEY}) + تصدير/استيراد ملف calibration_memory.json
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSimpleLayout((v) => !v)}
            style={{
              width: '100%',
              ...btn(simpleLayout ? '#2c5282' : '#2d3748', '#bee3f8', 10),
              padding: '7px 0',
              marginBottom: 8,
              border: '1px solid #4a5568',
            }}
          >
            {simpleLayout ? '▶ إظهار كل أجزاء الجسم (واجهة تفصيلية)' : '◀ وضع بسيط — لوحة الاتجاهات فقط'}
          </button>

          <div style={{ marginBottom: 10, padding: 8, background: '#1a202c', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: '#a0aec0', marginBottom: 4, fontWeight: 700 }}>مقياس الشدة (أزرار)</div>
            <Slider label="شدة" value={nudgeIntensity} min={0.05} max={2} step={0.05} onChange={setNudgeIntensity} />
            <div style={{ fontSize: 10, color: '#718096' }}>
              لوحة الاتجاهات: خطوة {padStep.toFixed(2)} · تفصيلي ذراع: {(BASE_DIRECTION_STEP * nudgeIntensity).toFixed(2)} · معصم:{' '}
              {wristStep.toFixed(2)} · أصابع: {fingerStep.toFixed(2)}
            </div>
          </div>

          {simpleLayout && (
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                background: '#1a202c',
                borderRadius: 8,
                border: '1px solid #38a169',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: '#9ae6b4', marginBottom: 8 }}>
                لوحة الاتجاهات — {tab} · {regionOptions.find((r) => r.id === simpleRegion)?.label}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {regionOptions.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSimpleRegion(r.id)}
                    style={{
                      ...btn(simpleRegion === r.id ? '#276749' : '#2d3748', simpleRegion === r.id ? '#fff' : '#a0aec0', 9),
                      padding: '6px 8px',
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 5,
                  maxWidth: 220,
                  margin: '0 auto 10px',
                }}
              >
                <div />
                <button
                  type="button"
                  onClick={() => applyPadDirection('up')}
                  style={{ ...btn('#2d3748', '#e2e8f0', 11), padding: '10px 4px', border: '1px solid #4a5568' }}
                >
                  ⬆️ أعلى
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => applyPadDirection('left')}
                  style={{ ...btn('#2d3748', '#e2e8f0', 11), padding: '10px 4px', border: '1px solid #4a5568' }}
                >
                  ⬅️ يسار
                </button>
                <button
                  type="button"
                  onClick={() => applyPadDirection('forward')}
                  style={{ ...btn('#2c5282', '#bee3f8', 11), padding: '10px 4px', border: '1px solid #63b3ed' }}
                >
                  ⬆️⬆️ أمام
                </button>
                <button
                  type="button"
                  onClick={() => applyPadDirection('right')}
                  style={{ ...btn('#2d3748', '#e2e8f0', 11), padding: '10px 4px', border: '1px solid #4a5568' }}
                >
                  يمين ➡️
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => applyPadDirection('down')}
                  style={{ ...btn('#2d3748', '#e2e8f0', 11), padding: '10px 4px', border: '1px solid #4a5568' }}
                >
                  ⬇️ أسفل
                </button>
                <div />
              </div>
              <button
                type="button"
                onClick={() => applyPadDirection('back')}
                style={{
                  ...btn('#744210', '#fefcbf', 11),
                  width: '100%',
                  padding: '10px 4px',
                  marginBottom: 10,
                  border: '1px solid #975a16',
                }}
              >
                ⬇️⬇️ خلف
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={commitGood}
                  style={{ ...btn('#276749', '#fff', 12), flex: 1, padding: '12px 6px', fontWeight: 800 }}
                >
                  جيدة ✅
                </button>
                <button
                  type="button"
                  onClick={undoBad}
                  style={{ ...btn('#742a2a', '#fed7d7', 12), flex: 1, padding: '12px 6px', fontWeight: 800 }}
                >
                  سيئة ❌
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 10, color: '#a0aec0' }}>
                تأكيد التبويبات:{' '}
                {TAB_ORDER.map((t) => (
                  <span key={t} style={{ marginInlineEnd: 6 }}>
                    {t}
                    {confirmedTabs[t] ? ' ✓' : ' ···'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!simpleLayout && tab === 'idle' && renderIdleTab()}
          {!simpleLayout && isHandTab && renderHandWristTab()}
          {!simpleLayout && isArmTab && renderArmTab()}
          {!simpleLayout && isGestureTab && (
            <>
              {renderUpperArmGesture()}
              {renderElbowGesture()}
              {renderHandGesture()}
              {renderFingersGesture()}
            </>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              width: '100%',
              ...btn(showAdvanced ? '#2c5282' : '#2d3748', '#bee3f8', 10),
              padding: '7px 0',
              marginBottom: 8,
              border: '1px solid #4a5568',
            }}
          >
            {showAdvanced ? '▼ إخفاء المتقدم' : '▶ متقدم — منزلقات'}
          </button>

          {showAdvanced && pose && resolvedGesture && (isGestureTab || isHandTab || isArmTab) && (
            <>
              <Slider label="RUA X" value={pose.ruaX} onChange={(v) => updatePose(resolvedGesture, 'ruaX', v)} />
              <Slider label="RUA Y" value={pose.ruaY} onChange={(v) => updatePose(resolvedGesture, 'ruaY', v)} />
              <Slider label="RUA Z" value={pose.ruaZ} onChange={(v) => updatePose(resolvedGesture, 'ruaZ', v)} />
              <Slider label="LUA X" value={pose.luaX} onChange={(v) => updatePose(resolvedGesture, 'luaX', v)} />
              <Slider label="LUA Y" value={pose.luaY} onChange={(v) => updatePose(resolvedGesture, 'luaY', v)} />
              <Slider label="LUA Z" value={pose.luaZ} onChange={(v) => updatePose(resolvedGesture, 'luaZ', v)} />
              <Slider label="RLA Z" value={pose.rlaZ} onChange={(v) => updatePose(resolvedGesture, 'rlaZ', v)} />
              <Slider label="LLA Z" value={pose.llaZ} onChange={(v) => updatePose(resolvedGesture, 'llaZ', v)} />
              <Slider label="RH X" value={pose.rhX} onChange={(v) => updatePose(resolvedGesture, 'rhX', v)} />
              <Slider label="RH Y" value={pose.rhY} onChange={(v) => updatePose(resolvedGesture, 'rhY', v)} />
              <Slider label="RH Z" value={pose.rhZ} onChange={(v) => updatePose(resolvedGesture, 'rhZ', v)} />
              <Slider label="LH X" value={pose.lhX} onChange={(v) => updatePose(resolvedGesture, 'lhX', v)} />
              <Slider label="LH Y" value={pose.lhY} onChange={(v) => updatePose(resolvedGesture, 'lhY', v)} />
              <Slider label="LH Z" value={pose.lhZ} onChange={(v) => updatePose(resolvedGesture, 'lhZ', v)} />
              <Slider label="Curl" value={pose.fingerCurl} min={0} max={1} step={0.01} onChange={(v) => updatePose(resolvedGesture, 'fingerCurl', clamp01(v))} />
            </>
          )}

          {showAdvanced && tab === 'idle' && (
            <>
              <Slider label="RUA X" value={idle.ruaX} onChange={(v) => updateIdle('ruaX', v)} />
              <Slider label="RUA Z" value={idle.ruaZ} onChange={(v) => updateIdle('ruaZ', v)} />
              <Slider label="LUA X" value={idle.luaX} onChange={(v) => updateIdle('luaX', v)} />
              <Slider label="LUA Z" value={idle.luaZ} onChange={(v) => updateIdle('luaZ', v)} />
              <Slider label="RLA X" value={idle.rlaX} onChange={(v) => updateIdle('rlaX', v)} />
              <Slider label="RLA Z" value={idle.rlaZ} onChange={(v) => updateIdle('rlaZ', v)} />
              <Slider label="LLA X" value={idle.llaX} onChange={(v) => updateIdle('llaX', v)} />
              <Slider label="LLA Z" value={idle.llaZ} onChange={(v) => updateIdle('llaZ', v)} />
              <Slider label="RH X" value={idle.rhX} onChange={(v) => updateIdle('rhX', v)} />
              <Slider label="RH Z" value={idle.rhZ} onChange={(v) => updateIdle('rhZ', v)} />
              <Slider label="LH X" value={idle.lhX} onChange={(v) => updateIdle('lhX', v)} />
              <Slider label="LH Z" value={idle.lhZ} onChange={(v) => updateIdle('lhZ', v)} />
              <Slider label="Idle curl" value={idle.fingerCurl} min={0} max={1} step={0.01} onChange={(v) => updateIdle('fingerCurl', clamp01(v))} />
            </>
          )}

          <div style={{ fontSize: 10, color: '#718096', background: '#1a202c', padding: 8, borderRadius: 6, marginBottom: 8 }}>
            <strong style={{ color: '#68d391' }}>تصدير:</strong> «Generate Full Code» يولّد IDLE + كل الإيماءات (بما فيها wave / clap / agree) مع RH/LH كاملة.
          </div>

          {adPhase === 'idle' && (
            <button type="button" onClick={startAutoDetect} style={{ ...btn('#744210', '#fefcbf', 10), width: '100%', padding: 7, marginBottom: 6 }}>
              🔍 Auto-detect Axes
            </button>
          )}
          {adPhase === 'test_rua_x' && (
            <div style={{ background: '#1a202c', borderRadius: 8, padding: 10, marginBottom: 6, fontSize: 11 }}>
              <div style={{ marginBottom: 8 }}>الذراع اليمنى تحركت للأمام؟</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => answerX(true)} style={{ ...btn('#276749', '#9ae6b4', 10), flex: 1, padding: 7 }}>
                  نعم
                </button>
                <button type="button" onClick={() => answerX(false)} style={{ ...btn('#742a2a', '#fed7d7', 10), flex: 1, padding: 7 }}>
                  لا
                </button>
              </div>
            </div>
          )}
          {adPhase === 'test_rua_z' && (
            <div style={{ background: '#1a202c', borderRadius: 8, padding: 10, marginBottom: 6, fontSize: 11 }}>
              <div style={{ marginBottom: 8 }}>تحركت للأعلى؟</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => answerZ(true)} style={{ ...btn('#276749', '#9ae6b4', 10), flex: 1, padding: 7 }}>
                  نعم
                </button>
                <button type="button" onClick={() => answerZ(false)} style={{ ...btn('#742a2a', '#fed7d7', 10), flex: 1, padding: 7 }}>
                  لا
                </button>
              </div>
            </div>
          )}
          {adPhase === 'done' && (
            <div style={{ fontSize: 10, color: '#68d391', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>تم ضبط المحاور</span>
              <button type="button" onClick={() => setAdPhase('idle')} style={{ ...btn('transparent', '#718096', 10) }}>
                ×
              </button>
            </div>
          )}

          {statusMsg && (
            <div style={{ fontSize: 11, color: '#68d391', textAlign: 'center', marginBottom: 6 }}>{statusMsg}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" onClick={openGenerateModal} style={{ ...btn('#2b6cb0', '#fff', 12), padding: '11px 0', fontWeight: 800 }}>
              ⚡ إنشاء الكود / Generate Full Code
            </button>
            <div style={{ display: 'flex', gap: 5 }}>
              <button type="button" onClick={quickCopyConstants} style={{ ...btn(copied ? '#276749' : '#4a5568', '#fff', 10), flex: 1, padding: 8 }}>
                {copied ? '✅ Copied' : '📋 Copy (no modal)'}
              </button>
              <button type="button" onClick={applyToProjectInfo} style={{ ...btn('#744210', '#fefcbf', 10), flex: 1, padding: 8 }}>
                Apply…
              </button>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button type="button" onClick={saveProfile} style={{ ...btn('#2c7a7b', '#e6fffa', 10), flex: 1, padding: 8 }}>
                💾 Save
              </button>
              <button type="button" onClick={loadProfile} style={{ ...btn('#553c9a', '#e9d8fd', 10), flex: 1, padding: 8 }}>
                📂 Load
              </button>
              <button type="button" onClick={resetAll} style={{ ...btn('#742a2a', '#fed7d7', 10), flex: 1, padding: 8 }}>
                ↺ Reset
              </button>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button type="button" onClick={exportMemoryJson} style={{ ...btn('#285e61', '#e6fffa', 10), flex: 1, padding: 8 }}>
                ⬇️ تصدير calibration_memory.json
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ ...btn('#5a3aa5', '#e9d8fd', 10), flex: 1, padding: 8 }}
              >
                ⬆️ استيراد JSON
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportMemoryFile} />
            {importErr ? (
              <div style={{ fontSize: 11, color: '#fc8181', marginTop: 4 }}>{importErr}</div>
            ) : null}
            <button
              type="button"
              onClick={() => vrmaInputRef.current?.click()}
              style={{ ...btn('#553c9a', '#d6bcfa', 10), width: '100%', padding: 8, marginTop: 4 }}
              title={`Load .vrma file → auto-fill current tab (${tab}) bone values`}
            >
              🎞 Load VRMA → {tab} tab
            </button>
            <button
              type="button"
              onClick={() => {
                const g =
                  tab === 'idle' ? 'idle' : calibGestureKey(tab, handTarget, armTarget);
                void unifiedGestureEngine.playCanonical(g);
              }}
              style={{ ...btn('#2b6cb0', '#bee3f8', 10), width: '100%', padding: 8, marginTop: 4 }}
              title="يرسل حدث avatar:gesture عبر UnifiedGestureEngine (معاينة إجرائية)"
            >
              ▶ Preview procedural (UnifiedGestureEngine)
            </button>
            <input
              ref={vrmaInputRef}
              type="file"
              accept=".vrma,.glb"
              style={{ display: 'none' }}
              onChange={onLoadVrmaFile}
            />
            <div style={{ fontSize: 10, color: '#718096', marginTop: 4 }}>
              Advanced: <a href="/test-avatar/vrma-inspector" target="_blank" style={{ color: '#63b3ed' }}>
                Open VRMA Inspector ↗
              </a> — full extractor with constants output
            </div>
            {tab === 'idle' && (
              <button type="button" onClick={resetIdleDefaults} style={{ ...btn('#4a5568', '#e2e8f0', 10), padding: 7 }}>
                ↺ افتراضي Idle فقط
              </button>
            )}
          </div>
        </div>
      )}

      {showCodeModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowCodeModal(false)}
        >
          <div
            style={{
              background: '#1a202c',
              borderRadius: 12,
              border: '1px solid #4a5568',
              maxWidth: 720,
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2d3748', fontWeight: 800, color: '#63b3ed' }}>
              استبدل الكتل في VRMSkeletonManager.tsx
            </div>
            <textarea
              readOnly
              value={generatedCode}
              style={{
                flex: 1,
                minHeight: 280,
                margin: 12,
                padding: 12,
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11,
                background: '#0d1117',
                color: '#e2e8f0',
                border: '1px solid #2d3748',
                borderRadius: 8,
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}>
              <button type="button" onClick={copyGenerated} style={{ ...btn('#276749', '#fff', 11), flex: 1, padding: 10 }}>
                📋 نسخ للحافظة
              </button>
              <button type="button" onClick={() => setShowCodeModal(false)} style={{ ...btn('#4a5568', '#e2e8f0', 11), flex: 1, padding: 10 }}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
