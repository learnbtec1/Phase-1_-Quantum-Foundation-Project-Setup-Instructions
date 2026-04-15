'use client';

import Link from 'next/link';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAgentAgent }   from '@/hooks/useAgentAgent';
import { agentDirector }   from '@/ai/avatar/AgentDirector';
import { unifiedGestureEngine } from '@/ai/cognitive/UnifiedGestureEngine';
import { PRIORITY }        from '@/constants/gestures';
import PermissionBanner    from '@/components/PermissionBanner';
import ConversationManager from '@/components/ConversationManager';
import AuthModal           from '@/components/AuthModal';
import DigitalHumanSettingsModal from '@/components/DigitalHumanSettingsModal';
import ResponseFeedback    from '@/components/ResponseFeedback';
import ToolSandbox         from '@/components/ToolSandbox';
import styles              from './AvatarCanvas.module.css';
import { pickVrmUrl }      from '@/config/avatar';
import { apiBase, clearAccessToken, getAccessToken, notifyAuthChanged } from '@/lib/auth';
import { BodyPortal } from '@/components/portal/BodyPortal';
import { AvatarBodyPortal } from '@/components/portal/AvatarBodyPortal';
import { Z_LAYERS } from '@/lib/z-layers';
import { recordTypingActivity } from '@/lib/behavior/anticipationLayer';
import { useCogniAvatarDebug } from '@/hooks/useCogniAvatarDebug';
import { useTTSWithVisemes } from '@/hooks/useTTSWithVisemes';
import type { VisemeCue } from '@/app/avatar-agent/LipSyncManager';
type HistoryEntry = { role: 'user' | 'teacher'; text: string; emotion?: string };
type MeUser = { name: string; email: string; role: string };

const AvatarCanvas = dynamic(() => import('./AvatarCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a12] text-gray-300 text-sm animate-pulse">
      جاري استدعاء كوجني... 🧑‍🏫
    </div>
  ),
});

const CameraPerception = dynamic(() => import('@/components/CameraPerception'), { ssr: false });

const EMOTION_DISPLAY: Record<string, { icon: string; colour: string }> = {
  happy:           { icon: '😊', colour: 'text-yellow-400' },
  excited:         { icon: '🤩', colour: 'text-orange-400' },
  celebrating:     { icon: '🎉', colour: 'text-pink-400' },
  celebration:     { icon: '🎉', colour: 'text-pink-400' },
  proud:           { icon: '😌', colour: 'text-violet-400' },
  curious:         { icon: '🤔', colour: 'text-sky-400' },
  thinking:        { icon: '💭', colour: 'text-blue-400' },
  encouraging:     { icon: '💪', colour: 'text-green-400' },
  empathetic:      { icon: '🤝', colour: 'text-rose-400' },
  concerned:       { icon: '😟', colour: 'text-amber-400' },
  sad:             { icon: '😢', colour: 'text-blue-300' },
  anxious:         { icon: '😰', colour: 'text-orange-300' },
  angry:           { icon: '😤', colour: 'text-red-400' },
  surprised:       { icon: '😲', colour: 'text-yellow-300' },
  attentive:       { icon: '👀', colour: 'text-cyan-400' },
  friendly:        { icon: '🤗', colour: 'text-green-300' },
  neutral:         { icon: '😐', colour: 'text-gray-400' },
  relax:           { icon: '😌', colour: 'text-emerald-300' },
  sleepy:          { icon: '😴', colour: 'text-indigo-300' },
  strictEvaluation:{ icon: '📋', colour: 'text-red-300' },
  // ── Phase 2: missing keys ──────────────────────────
  calm:            { icon: '😌', colour: 'text-emerald-400' },
  relaxed:         { icon: '🧘', colour: 'text-teal-400' },
  bored:           { icon: '😒', colour: 'text-gray-500' },
  confused:        { icon: '😕', colour: 'text-amber-300' },
  disappointed:    { icon: '😞', colour: 'text-slate-400' },
  motivated:       { icon: '🔥', colour: 'text-orange-400' },
  playful:         { icon: '😜', colour: 'text-pink-400' },
};

function emitAvatarCmd(type: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

const ACTIVE_VRM = pickVrmUrl();

/** يطابق AgentDirector: عند التفعيل يتخطى speakWithTTS ويُشغّل الصوت عبر `onAgentSpeak` (Azure في المتصفح). */
const USE_AGENT_MESSAGE_AZURE_TTS =
  process.env.NEXT_PUBLIC_USE_AGENT_MESSAGE_AZURE_TTS === 'true';

/** Mic control always shown in UI (env no longer hides it — avoids missing 🎤 in dev). */
const COGNI_MIC_UI_ENABLED = true;

const _apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const WS_AGENT_URL = _apiBase.replace(/^http/, 'ws') + '/ws/agent';

function normalizeDeepLinkTarget(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (['quick_review', 'quick-review', 'quick', 'review', 'revision'].includes(s)) return 'quick_review';
  return raw.trim();
}

/** Mission badge for teacher deep links (URL: initialUnit / initialTarget / initialSubject). */
function formatDeepLinkBadge(unit: string, target: string, subject?: string): string {
  const u = unit.trim() || '—';
  const nt = normalizeDeepLinkTarget(target);
  if (nt === 'quick_review') {
    return `🎯 Quick Review: Unit ${u}`;
  }
  const t = target.trim()
    ? target.trim().charAt(0).toUpperCase() + target.trim().slice(1).toLowerCase()
    : '—';
  let line = `🎯 Unit ${u} – Target: ${t}`;
  const sub = (subject || '').trim();
  if (sub) line += ` — ${sub}`;
  return line;
}

export type AvatarGradeNudge = {
  grade: string;
  subject?: string;
  unit?: string;
  ts?: string;
};

export type AvatarAgentClientProps = {
  /** ADDED: teacher deep-link ?unit= */
  initialUnit?: string;
  /** ADDED: teacher deep-link ?target= (pass|merit|distinction) */
  initialTarget?: string;
  /** ADDED: teacher deep-link ?subject= */
  initialSubject?: string;
  /** Manual topic chip on student dashboard (clears deep-link context when set). */
  focusSubject?: string | null;
  gradeNudge?: AvatarGradeNudge | null;
  /** Narrow layout when embedded beside assessment (student dashboard). */
  embedVariant?: 'default' | 'dashboard';
};

/** One-time wipe of any stale VRM/avatar cached state from the browser.
 *  Runs on first render after a new avatar version stamp is detected. */
const COGNI_VRM_VERSION = 'cogni-v1';
function clearStaleAvatarCache(): void {
  if (typeof window === 'undefined') return;
  const key = '__cogni_vrm_ver__';
  if (localStorage.getItem(key) === COGNI_VRM_VERSION) return;
  // Stale version detected — wipe ALL avatar/VRM/gesture calibration storage keys.
  // IMPORTANT: gesture calibration keys (mouse-gesture-arm-offsets-v1,
  // cogni:gestureProfile:*, cogni:calibrationMemory:*) were tuned for VRM 0.x
  // and will cause distortion on VRM 1.0 if not cleared.
  const keysToRemove = [
    'avatarBindPose', 'vrmBindPose', 'cogniAvatarState', 'vrm_cache_v',
    'avatarFloorY', 'avatarStandY', 'cogni_foot_calib',
    // VRM 0.x gesture calibration — must clear on VRM 1.0 upgrade
    'mouse-gesture-arm-offsets-v1',
    'cogni:gestureProfile:v3-fullbody',
    'cogni:calibrationMemory:v1-feedback',
    'cogni:gestureProfile',  // legacy key
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));
  // Wipe stale IndexedDB caches
  ['VRMCache', 'cogni-vrm-cache', 'vrm-model-cache'].forEach(db => {
    try { indexedDB.deleteDatabase(db); } catch { /* ignore */ }
  });
  localStorage.setItem(key, COGNI_VRM_VERSION);
  console.log('[AvatarAgentClient] ✅ VRM 0.x gesture calibration cleared for VRM 1.0:', COGNI_VRM_VERSION);
}

export default function AvatarAgentClient({
  initialUnit = '',
  initialTarget = '',
  initialSubject = '',
  focusSubject = null,
  gradeNudge = null,
  embedVariant = 'default',
}: AvatarAgentClientProps) {
  const [hasStarted, setHasStarted] = useState(false);

  // Run cache-clear once on first mount (before any 3D scene initializes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { clearStaleAvatarCache(); }, []);

  useCogniAvatarDebug(hasStarted);

  // Defensive: remove stray `window.cogni` if present (legacy experiments / extensions) so loaders stay on same-origin paths.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const w = window as Window & { cogni?: unknown };
      if (w.cogni != null) {
        Reflect.deleteProperty(w, 'cogni');
        if (process.env.NODE_ENV === 'development') {
          console.info('[AvatarAgentClient] Removed stray window.cogni global.');
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Dev bridge: optional live BTEC criteria for AvatarCanvas HUD (`window.__btecCriteria = [...]`).
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      (window as any).__btecCriteria = (window as any).__btecCriteria ?? null;
    }
  }, []);

  const [userInput, setUserInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isSitting, setIsSitting] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [blockedAudio, setBlockedAudio] = useState<HTMLAudioElement | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [me, setMe] = useState<MeUser | null>(null);
  const [dhSettingsOpen, setDhSettingsOpen] = useState(false);
  const [camOptIn, setCamOptIn] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [ttsSecondaryNotice, setTtsSecondaryNotice] = useState<string | null>(null);
  const [btecTrainOpen, setBtecTrainOpen] = useState(false);
  const [btecTrainTopic, setBtecTrainTopic] = useState('المصالح المعنية stakeholders');
  const [btecTrainDifficulty, setBtecTrainDifficulty] = useState<'pass' | 'merit' | 'distinction'>('merit');
  const [missionDismissed, setMissionDismissed] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const visemeCueQueueRef = useRef<VisemeCue[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const { speak: speakAzureWithVisemes } = useTTSWithVisemes(visemeCueQueueRef, audioElementRef);

  const onAgentSpeakAzure = useCallback(
    (text: string) => {
      void speakAzureWithVisemes(text);
    },
    [speakAzureWithVisemes],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onAzureClientTts = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; voice?: string; language?: string }>).detail;
      if (typeof d?.text === 'string' && d.text.trim()) {
        void speakAzureWithVisemes(d.text, {
          voice: typeof d.voice === 'string' ? d.voice : undefined,
          language: typeof d.language === 'string' ? d.language : undefined,
        });
      }
    };
    window.addEventListener('cogni:azure-client-tts', onAzureClientTts as EventListener);
    return () =>
      window.removeEventListener('cogni:azure-client-tts', onAzureClientTts as EventListener);
  }, [speakAzureWithVisemes]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadMe = async () => {
      const token = getAccessToken();
      if (!token) {
        setMe(null);
        return;
      }
      try {
        const r = await fetch(`${apiBase()}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          setMe(null);
          return;
        }
        setMe((await r.json()) as MeUser);
      } catch {
        setMe(null);
      }
    };
    void loadMe();
    const onAuth = () => void loadMe();
    window.addEventListener('cogni:auth-changed', onAuth);
    return () => window.removeEventListener('cogni:auth-changed', onAuth);
  }, []);

  useEffect(() => {
    try {
      setCamOptIn(typeof window !== 'undefined' && localStorage.getItem('cogni_camera_opt_in') === '1');
    } catch {
      setCamOptIn(false);
    }
  }, [dhSettingsOpen]);

  const {
    isConnected,
    isProcessing,
    isListening,
    lastTranscript,
    lastDialogue,
    emotion,
    error,
    toggleListening,
    sendText,
    clearHistory,
    sendWsPayload,
  } = useAgentAgent({ wsUrl: WS_AGENT_URL });

  // ADDED: build WebSocket payload for teacher deep-link (dashboard: URL subject wins, else chip for sync)
  const deepLinkWsPayload = useMemo(() => {
    if (missionDismissed) return null;
    const u = (initialUnit || '').trim();
    const t = (initialTarget || '').trim();
    const s = (initialSubject || '').trim();
    if (!u && !t && !s) return null;
    const subjectLine =
      embedVariant === 'dashboard'
        ? s || (focusSubject || '').trim()
        : (focusSubject || '').trim() || s;
    return { unit: u, target: t, subject: subjectLine };
  }, [initialUnit, initialTarget, initialSubject, focusSubject, embedVariant, missionDismissed]);

  const hasTeacherDeepLinkParams = Boolean(
    (initialUnit || '').trim() || (initialTarget || '').trim() || (initialSubject || '').trim(),
  );
  const studentOverrodeDeepLinkOnDashboard =
    embedVariant === 'dashboard' && Boolean((focusSubject || '').trim());
  // ADDED: show mission on standalone + dashboard whenever URL deep-link is active until manual override
  const showMissionStrip =
    hasTeacherDeepLinkParams && !studentOverrodeDeepLinkOnDashboard && !missionDismissed;

  const deepLinkConfigSentRef = useRef<string>('');
  const deepLinkParamsKey = `${(initialUnit || '').trim()}|${(initialTarget || '').trim()}|${(initialSubject || '').trim()}`;
  const prevDeepLinkParamsKeyRef = useRef(deepLinkParamsKey);
  useEffect(() => {
    if (prevDeepLinkParamsKeyRef.current !== deepLinkParamsKey) {
      prevDeepLinkParamsKeyRef.current = deepLinkParamsKey;
      setMissionDismissed(false);
    }
  }, [deepLinkParamsKey]);

  useEffect(() => {
    if (!isConnected) {
      deepLinkConfigSentRef.current = '';
      return;
    }
    if (!deepLinkWsPayload) {
      deepLinkConfigSentRef.current = '';
      return;
    }
    const key = JSON.stringify(deepLinkWsPayload);
    if (deepLinkConfigSentRef.current === key) return;
    deepLinkConfigSentRef.current = key;
    sendWsPayload({
      type: 'deep_link_config',
      v: 1.1,
      id: `dl_${Date.now()}`,
      unit: deepLinkWsPayload.unit,
      target: deepLinkWsPayload.target,
      subject: deepLinkWsPayload.subject,
    });
  }, [isConnected, deepLinkWsPayload, sendWsPayload]);

  useEffect(() => {
    if (!isConnected || !(focusSubject || '').trim()) return;
    sendWsPayload({
      type: 'set_focus_subject',
      subject: focusSubject!.trim(),
      student_override: embedVariant === 'dashboard',
    });
  }, [isConnected, focusSubject, sendWsPayload, embedVariant]);

  const lastGradeKeyRef = useRef<string>('');
  useEffect(() => {
    if (!isConnected || !gradeNudge?.grade) return;
    const key = `${gradeNudge.grade}|${gradeNudge.ts ?? ''}|${gradeNudge.subject ?? ''}|${gradeNudge.unit ?? ''}`;
    if (lastGradeKeyRef.current === key) return;
    lastGradeKeyRef.current = key;
    sendWsPayload({
      type: 'new_grade',
      grade: gradeNudge.grade,
      subject: gradeNudge.subject ?? '',
      unit: gradeNudge.unit ?? '',
      id: `grade_${Date.now()}`,
    });
  }, [isConnected, gradeNudge, sendWsPayload]);

  const lastForFeedback = useMemo(() => {
    let u = '';
    let a = '';
    for (let i = history.length - 1; i >= 0; i--) {
      if (!a && history[i].role === 'teacher') a = history[i].text;
      if (!u && history[i].role === 'user') u = history[i].text;
      if (a && u) break;
    }
    return { user: u, assistant: a };
  }, [history]);

  const onFeedback = useCallback(
    (payload: { thumbs_up: boolean; prompt: string; response: string }) => {
      sendWsPayload({
        type: 'session_feedback',
        thumbs_up: payload.thumbs_up,
        prompt: payload.prompt,
        response: payload.response,
        score: payload.thumbs_up ? 1 : 0,
      });
    },
    [sendWsPayload],
  );

  const startPractice = () => {
    sendText('', { practice: true });
  };

  const sendBtecTrainingRequest = () => {
    sendWsPayload({
      type: 'training_request',
      topic: btecTrainTopic.trim() || 'إدارة الأعمال BTEC',
      difficulty: btecTrainDifficulty,
      id: `train_ui_${Date.now()}`,
    });
    setBtecTrainOpen(false);
  };

  // 0. إشعار صوت احتياطي (Azure → edge/gTTS)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let hideTimer: number | undefined;
    const onSecondaryVoice = (e: Event): void => {
      const msg =
        (e as CustomEvent<{ message?: string }>).detail?.message ??
        'Using secondary voice engine...';
      if (hideTimer) window.clearTimeout(hideTimer);
      setTtsSecondaryNotice(msg);
      hideTimer = window.setTimeout(() => setTtsSecondaryNotice(null), 5000);
    };
    window.addEventListener('cogni:tts-secondary-voice', onSecondaryVoice as EventListener);
    return () => {
      window.removeEventListener('cogni:tts-secondary-voice', onSecondaryVoice as EventListener);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, []);

  // 1. مراقبة حظر الصوت
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onBlocked = (e: Event): void => {
      const evt = e as CustomEvent;
      setAudioBlocked(true);
      setBlockedAudio(evt.detail?.audio ?? null);
    };
    const onUnblock = () => { setAudioBlocked(false); setBlockedAudio(null); };
    
    window.addEventListener('cogni:autoplay-blocked', onBlocked);
    window.addEventListener('avatar:speak:start', onUnblock);
    return () => {
      window.removeEventListener('cogni:autoplay-blocked', onBlocked);
      window.removeEventListener('avatar:speak:start', onUnblock);
    };
  }, []);

  // 2. تحديث سلوك الأفاتار بناءً على حالة الاستماع
  useEffect(() => {
    if (!hasStarted || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active: isListening } }));
  }, [isListening, hasStarted]);

  /** Light typing fidget while WS shows processing (does not override HIGH gestures). */
  const processingTypingRef = useRef(false);
  useEffect(() => {
    if (!hasStarted) return;
    if (isProcessing && !processingTypingRef.current) {
      processingTypingRef.current = true;
      void unifiedGestureEngine.play('Typing', { priority: PRIORITY.BACKGROUND });
    }
    if (!isProcessing) processingTypingRef.current = false;
  }, [isProcessing, hasStarted]);

  // 3. سجل المحادثة
  useEffect(() => {
    if (lastTranscript) {
      setHistory(h => [...h.slice(-15), { role: 'user', text: lastTranscript }]);
    }
  }, [lastTranscript]);

  useEffect(() => {
    if (lastDialogue) {
      setHistory(h => [...h.slice(-15), { role: 'teacher', text: lastDialogue, emotion }]);
    }
  }, [lastDialogue, emotion]);

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [history]);

  // 4. بدء الجلسة
  const handleStartSession = async () => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[System] Starting secure session…');
    }
    try {
      const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
      await silentAudio.play();
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Audio] Silent bypass failed:', e);
      }
    }

    (window as any).__AUDIO_UNLOCKED__ = true;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
    }

    setHasStarted(true);
    if (process.env.NODE_ENV === 'development') {
      console.log('[AvatarAgentClient] session started — hasStarted=true (mic should be visible if COGNI_MIC_UI_ENABLED)');
    }
  };

  const onSend = () => {
    const text = userInput.trim();
    if (!text) return;
    agentDirector.processUserMessage(text);
    void unifiedGestureEngine.play('listening', { priority: PRIORITY.LOW });
    sendText(text);
    window.setTimeout(() => {
      void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.NORMAL });
    }, 500);
    setHistory(h => [...h.slice(-15), { role: 'user', text }]);
    setUserInput('');
    inputRef.current?.focus();
  };

  const currentEmo = EMOTION_DISPLAY[emotion] || EMOTION_DISPLAY.neutral;

  /* overflow-x فقط داخل العمود؛ للصفحة الكامحة الأفاتار يُحمَّل عبر BodyPortal فيتجاوز أي قصّ */
  const shellClass =
    embedVariant === 'dashboard'
      ? 'relative isolate z-50 flex h-full min-h-0 w-full flex-1 flex-col overflow-x-hidden'
      : 'relative isolate z-50 h-screen min-h-0 w-full overflow-x-hidden';

  return (
    <>
    <main className={shellClass} dir="rtl">
      {/* Solid fill behind the scene — not on the same layer as the canvas (avoids stacking paint over WebGL). */}
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-[#06060c]"
        aria-hidden
      />
      {ttsSecondaryNotice && (
        <BodyPortal>
          <div
            className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-xl border border-amber-500/40 bg-amber-950/90 px-4 py-2 text-sm text-amber-100 shadow-lg backdrop-blur-sm"
            style={{ zIndex: Z_LAYERS.MODAL_TOAST }}
            role="status"
          >
            {ttsSecondaryNotice}
          </div>
        </BodyPortal>
      )}

      {!hasStarted && (
        <BodyPortal>
          {/* fixed + body: لا يُقصّ بسبب overflow على أسلاف الـ main */}
          <div
            className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-2xl"
            style={{ zIndex: Z_LAYERS.MODAL_BACKDROP }}
          >
          <div className="bg-[#121225] border border-violet-500/20 rounded-3xl p-12 max-w-lg text-center shadow-[0_0_50px_rgba(139,92,246,0.15)]">
            <div className="text-8xl mb-6 drop-shadow-2xl animate-bounce">🧑‍🏫</div>
            <h1 className="text-4xl font-black text-white mb-4 tracking-tight">كوجني: المعلم الذكي</h1>
            <p className="text-gray-400 mb-10 text-lg leading-relaxed">
              جاهز لرحلة تعلم BTEC فريدة؟ اضغط أدناه لتفعيل الصوت والبدء.
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                type="button"
                onClick={handleStartSession}
                className="w-full py-5 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white rounded-2xl text-2xl font-bold transition-all shadow-2xl active:scale-95"
              >
                🚀 ابدأ الآن
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    await handleStartSession();
                    await toggleListening();
                  })();
                }}
                className="w-full py-4 rounded-2xl text-lg font-bold text-white bg-cyan-700 hover:bg-cyan-600 transition-all shadow-lg active:scale-95"
              >
                🎤 ابدأ والتحدث بالميكروفون
              </button>
            </div>
          </div>
        </div>
        </BodyPortal>
      )}

      {/* Mic فوق نافذة البدء — نفس سلوك الشريط السفلي؛ يبقى ظاهراً قبل hasStarted */}
      {COGNI_MIC_UI_ENABLED && !hasStarted && (
        <BodyPortal>
          <div
            className="pointer-events-auto fixed bottom-8 left-1/2 flex -translate-x-1/2 justify-center"
            style={{ zIndex: Z_LAYERS.MODAL_TOAST }}
          >
            <button
              type="button"
              onClick={() => void toggleListening()}
              title={isListening ? 'إيقاف الاستماع' : 'تحدث بالميكروفون'}
              aria-label={isListening ? 'إيقاف الاستماع' : 'تشغيل الميكروفون'}
              className={`rounded-2xl p-4 text-white shadow-lg transition-all active:scale-90 ${
                isListening ? 'animate-pulse bg-red-600' : 'bg-cyan-600 hover:bg-cyan-500'
              }`}
            >
              {isListening ? '⛔' : '🎤'}
            </button>
          </div>
        </BodyPortal>
      )}

      <>
          <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
          <DigitalHumanSettingsModal open={dhSettingsOpen} onClose={() => setDhSettingsOpen(false)} />

          {showMissionStrip && (
            <div
              className="absolute top-4 left-1/2 flex max-w-[min(92vw,28rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-cyan-500/35 bg-black/55 px-3 py-1.5 text-[11px] text-cyan-100/95 shadow-lg backdrop-blur-md"
              style={{ zIndex: Z_LAYERS.HUD_CHROME }}
              role="status"
            >
              <span className="truncate font-medium tracking-wide">
                {formatDeepLinkBadge(initialUnit, initialTarget, initialSubject)}
              </span>
              <button
                type="button"
                className="shrink-0 rounded-full px-1.5 text-gray-500 hover:bg-white/10 hover:text-white"
                aria-label="إخفاء"
                onClick={() => {
                  setMissionDismissed(true);
                  if (isConnected) {
                    sendWsPayload({ type: 'deep_link_clear', v: 1.1 });
                  }
                }}
              >
                ×
              </button>
            </div>
          )}

          {btecTrainOpen && (
            <BodyPortal>
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              style={{ zIndex: Z_LAYERS.MODAL_BACKDROP }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="btec-train-title"
            >
              <div className="w-full max-w-md rounded-2xl border border-violet-500/30 bg-[#12121f] p-6 shadow-2xl text-right">
                <h2 id="btec-train-title" className="text-lg font-bold text-white mb-1">
                  تدريب BTEC من قاعدة المعرفة
                </h2>
                <p className="text-xs text-gray-400 mb-4">
                  سؤال قصير من كتب BTEC المرفوعة؛ بعد إجابتك يصلك تقييم P / M / D.
                </p>
                <label className="block text-xs text-gray-500 mb-1">الموضوع</label>
                <input
                  value={btecTrainTopic}
                  onChange={(e) => setBtecTrainTopic(e.target.value)}
                  className="w-full mb-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
                  placeholder="مثال: تحليل PESTLE"
                />
                <label className="block text-xs text-gray-500 mb-1">المستوى المستهدف</label>
                <select
                  value={btecTrainDifficulty}
                  onChange={(e) =>
                    setBtecTrainDifficulty(e.target.value as 'pass' | 'merit' | 'distinction')
                  }
                  className="w-full mb-4 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
                >
                  <option value="pass">Pass</option>
                  <option value="merit">Merit</option>
                  <option value="distinction">Distinction</option>
                </select>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white"
                    onClick={() => setBtecTrainOpen(false)}
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={!isConnected || isProcessing}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-30 text-white"
                    onClick={sendBtecTrainingRequest}
                  >
                    ابدأ
                  </button>
                </div>
              </div>
            </div>
            </BodyPortal>
          )}

          <div
            className="pointer-events-auto absolute top-6 left-6 flex flex-wrap items-center gap-2"
            style={{ zIndex: Z_LAYERS.HUD_CHROME }}
          >
            {me ? (
              <div className="flex items-center gap-2 rounded-xl bg-black/50 border border-white/10 px-3 py-2 text-xs text-gray-200">
                <span className="max-w-[140px] truncate">{me.name || me.email}</span>
                {(me.role === 'teacher' || me.role === 'admin') && (
                  <Link href="/dashboard" className="text-cyan-400 hover:underline">
                    لوحة المعلّم
                  </Link>
                )}
                <button
                  type="button"
                  className="text-violet-300 hover:underline"
                  onClick={() => setDhSettingsOpen(true)}
                >
                  إعدادات
                </button>
                <Link href="/settings/privacy" className="text-gray-400 hover:underline text-[10px]">
                  خصوصية
                </Link>
                <button
                  type="button"
                  className="text-rose-400 hover:underline"
                  onClick={() => {
                    clearAccessToken();
                    notifyAuthChanged();
                    setMe(null);
                  }}
                >
                  خروج
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAuthOpen(true)}
                  className="rounded-xl bg-violet-600/90 hover:bg-violet-500 px-4 py-2 text-xs font-semibold text-white shadow-lg"
                >
                  تسجيل الدخول
                </button>
                <span className="text-[10px] text-amber-200/80 max-w-xs leading-relaxed">
                  الضيف: التجربة كاملة، لكن التقدم لا يُحفظ بين الجلسات.
                </span>
              </>
            )}
          </div>

          <ConversationManager
            onUserSpeaking={() => {
              if (process.env.NODE_ENV === 'development') console.log('[VAD] User detected');
            }}
            onUserSilent={() => {
              if (process.env.NODE_ENV === 'development') console.log('[VAD] Silence detected');
            }}
          />

          <PermissionBanner />

          {embedVariant === 'dashboard' ? (
            <div
              className={`pointer-events-none absolute inset-0 transition-all duration-1000 ${
                isListening ? styles.listeningPulse : ''
              }`}
              style={{ zIndex: Z_LAYERS.AVATAR_PORTAL }}
            >
              <div className="pointer-events-auto relative z-10 h-full min-h-0 w-full">
                <AvatarCanvas
                  vrmUrl={ACTIVE_VRM}
                  visemeCueQueueRef={visemeCueQueueRef}
                  audioElementRef={audioElementRef}
                  onAgentSpeak={
                    USE_AGENT_MESSAGE_AZURE_TTS ? onAgentSpeakAzure : undefined
                  }
                />
              </div>
            </div>
          ) : (
            <AvatarBodyPortal>
              <div
                className={`h-full min-h-screen w-full transition-all duration-1000 ${
                  isListening ? styles.listeningPulse : ''
                }`}
              >
                <div className="pointer-events-auto relative z-10 h-full min-h-[520px] w-full">
                  <AvatarCanvas
                    vrmUrl={ACTIVE_VRM}
                    visemeCueQueueRef={visemeCueQueueRef}
                    audioElementRef={audioElementRef}
                    onAgentSpeak={
                      USE_AGENT_MESSAGE_AZURE_TTS ? onAgentSpeakAzure : undefined
                    }
                  />
                </div>
              </div>
            </AvatarBodyPortal>
          )}

          <div
            className="pointer-events-none absolute top-8 left-8 flex items-center gap-4 rounded-2xl border border-cyan-500/20 bg-black/40 p-3 shadow-lg backdrop-blur-md"
            style={{ zIndex: Z_LAYERS.HUD_CHROME }}
          >
            <div className="relative">
              <div className="text-3xl">{currentEmo.icon}</div>
              {isProcessing && <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping" />}
            </div>
            <div>
              <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">Cogni Brain</div>
              <div className={`text-sm font-medium ${currentEmo.colour}`}>{emotion}</div>
            </div>
          </div>

          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="absolute top-1/2 right-0 -translate-y-1/2 rounded-l-xl bg-violet-600 p-2 text-white shadow-2xl transition-colors hover:bg-violet-500"
            style={{ zIndex: Z_LAYERS.HUD_CHROME }}
          >
            {showHistory ? '◀' : '📜'}
          </button>

          {showHistory && (
            <div
              className="absolute top-20 right-0 bottom-40 flex w-80 flex-col border-l border-white/5 bg-[#0a0a12]/80 backdrop-blur-2xl animate-in slide-in-from-right duration-300"
              style={{ zIndex: Z_LAYERS.HUD_CHROME }}
            >
              <div className="p-4 border-b border-white/5 text-gray-400 text-xs font-bold uppercase">سجل الجلسة الحالية</div>
              <div ref={historyRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                {history.map((h, i) => (
                  <div key={i} className={`flex ${h.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      h.role === 'user' ? 'bg-blue-600/20 text-blue-100 border border-blue-500/10' : 'bg-violet-600/20 text-violet-100 border border-violet-500/10'
                    }`}>
                      {h.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent p-8"
            style={{ zIndex: Z_LAYERS.HUD_CHROME }}
          >
            <div className="max-w-4xl mx-auto space-y-6">
              
              <div className="flex gap-2 justify-center flex-wrap items-center">
                {me && (
                  <button
                    type="button"
                    onClick={startPractice}
                    disabled={!isConnected || isProcessing}
                    className="px-4 py-1.5 bg-amber-600/90 hover:bg-amber-500 disabled:opacity-30 border border-amber-400/30 rounded-full text-white text-[11px] font-bold"
                    title="سؤال تدريبي يتناسب مع مستواك"
                  >
                    تدريب
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBtecTrainOpen(true)}
                  disabled={!isConnected || isProcessing}
                  className="px-4 py-1.5 bg-violet-700/90 hover:bg-violet-600 disabled:opacity-30 border border-violet-400/30 rounded-full text-white text-[11px] font-bold"
                  title="أسئلة من كتب BTEC (Chroma) مع تقييم P/M/D"
                >
                  تدريب BTEC
                </button>
              </div>

              <CameraPerception
                enabled={camOptIn && isConnected}
                onSample={(p) =>
                  sendWsPayload({
                    type: 'camera_frame',
                    emotion: p.emotion,
                    attention: p.attention,
                    engagement: p.engagement,
                    ts: p.ts,
                  })
                }
              />

              <ResponseFeedback
                enabled={!!me}
                onFeedback={onFeedback}
                lastUserText={lastForFeedback.user}
                lastAssistantText={lastForFeedback.assistant}
              />

              <div className="flex justify-center">
                <button
                  type="button"
                  className="text-[11px] text-gray-500 hover:text-violet-300"
                  onClick={() => setShowTools((v) => !v)}
                >
                  {showTools ? 'إخفاء الأدوات' : 'أدوات تفاعل'}
                </button>
              </div>
              {showTools && (
                <ToolSandbox
                  sendTool={(payload) =>
                    sendWsPayload({ type: 'tool_interaction', payload })
                  }
                />
              )}

              <div className="flex gap-4 items-center">
                <div className="relative flex-1 group">
                  <input
                    ref={inputRef}
                    value={userInput}
                    onChange={(e) => {
                      setUserInput(e.target.value);
                      recordTypingActivity();
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && onSend()}
                    placeholder="تحدث أو اكتب سؤالك لكوجني هنا..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-violet-500 transition-all placeholder:text-gray-600 shadow-inner"
                  />
                </div>

                <button 
                  onClick={onSend}
                  disabled={!userInput.trim() || isProcessing}
                  className="bg-violet-600 hover:bg-violet-500 p-4 rounded-2xl text-white shadow-lg shadow-violet-600/20 disabled:opacity-20 active:scale-90 transition-all"
                >
                  🚀
                </button>

                {COGNI_MIC_UI_ENABLED && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    title={isListening ? 'إيقاف الاستماع' : 'تحدث بالميكروفون'}
                    aria-label={isListening ? 'إيقاف الاستماع' : 'تشغيل الميكروفون'}
                    className={`p-4 rounded-2xl text-white shadow-lg transition-all active:scale-90 ${
                      isListening ? 'bg-red-600 animate-pulse' : 'bg-cyan-600 hover:bg-cyan-500'
                    }`}
                  >
                    {isListening ? '⛔' : '🎤'}
                  </button>
                )}
              </div>

              <div className="flex justify-between items-center px-2">
                <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest">
                  <span className={isConnected ? 'text-emerald-500' : 'text-red-500'}>
                    ● {isConnected ? 'Network Online' : 'Network Offline'}
                  </span>
                  <span className="text-gray-500">● Docker: Eduverse_Backend</span>
                </div>
                <div className="flex gap-2">
                  {['PESTLE', 'SWOT', 'BTEC P1'].map(tag => (
                    <button key={tag} onClick={() => { setUserInput(`اشرح لي ${tag}`); }} className="text-[10px] text-gray-500 hover:text-white transition-colors">#{tag}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
      </>
    </main>
    </>
  );
}