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
import ChatInput, { type ChatInputHandle } from '@/components/ChatInput';
import AuthModal           from '@/components/AuthModal';
import DigitalHumanSettingsModal from '@/components/DigitalHumanSettingsModal';
import ResponseFeedback    from '@/components/ResponseFeedback';
import ToolSandbox         from '@/components/ToolSandbox';
import styles              from './AvatarCanvas.module.css';
import { pickVrmUrl }      from '@/config/avatar';
import {
  apiBase,
  clearAccessToken,
  getAccessToken,
  hasStoredAccessToken,
  isCogniGuestBrowserMode,
  notifyAuthChanged,
} from '@/lib/auth';
import { buildDefaultWsAgentUrl } from '@/lib/wsAgentUrl';
import { isCogniDiagnosticsEnabled } from '@/utils/diagnostics';
import { runFullDiagnostics } from '@/utils/runDiagnostics';
import { BodyPortal } from '@/components/portal/BodyPortal';
import { AvatarBodyPortal } from '@/components/portal/AvatarBodyPortal';
import { Z_LAYERS } from '@/lib/z-layers';
import { usePerceptionStore } from '@/store/usePerceptionStore';
import { registerInteraction as registerAwarenessInteraction } from '@/lib/avatar/awareness/studentAwarenessEngine';
import { resumeSharedAudioContext, installUserGestureAudioUnlock } from '@/lib/audio/avatarAudioContext';
import { isElevenLabsTtsProvider, setTtsPlaybackAudioElement } from '@/ai/io/tts';
import { useCogniAvatarDebug } from '@/hooks/useCogniAvatarDebug';
import type { VisemeCue } from '@/app/avatar-agent/LipSyncManager';
import AvatarCanvas from './AvatarCanvas';
type HistoryEntry = { role: 'user' | 'teacher'; text: string; emotion?: string };
type MeUser = { name: string; email: string; role: string };

const CameraPerception = dynamic(() => import('@/components/CameraPerception'), { ssr: false });

const ACTIVE_VRM = pickVrmUrl();

/** Mic control always shown in UI (env no longer hides it — avoids missing 🎤 in dev). */
const COGNI_MIC_UI_ENABLED = true;

const WS_AGENT_URL = buildDefaultWsAgentUrl();

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearStaleAvatarCache();
  }, []);

  /** Browser autoplay policy: resume shared AudioContext on first pointer/click/touch/key (before canvas mount). */
  useEffect(() => {
    installUserGestureAudioUnlock();
  }, []);

  /** Optional boot probe: mic + AudioContext + WS handshake (requests mic — off unless env). */
  useEffect(() => {
    if (!isCogniDiagnosticsEnabled()) return;
    void runFullDiagnostics(WS_AGENT_URL);
  }, []);

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

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [extrasOpen, setExtrasOpen] = useState(false);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Guest stack: WS + TTS work without JWT; do not nag with the login/register modal on load.
    if (isCogniGuestBrowserMode()) return;
    if (!hasStoredAccessToken()) {
      setAuthOpen(true);
      return;
    }
    if (!getAccessToken()) setAuthOpen(true);
  }, []);

  const chatInputRef = useRef<ChatInputHandle>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const visemeCueQueueRef = useRef<VisemeCue[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  /** Single shared `<audio>` for client TTS + lip-sync (`speakWithTTS` → `/api/tts-with-timing` / `audioTimeline`). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.volume = 0.94;
    audioElementRef.current = audio;
    setTtsPlaybackAudioElement(audio);
    return () => {
      setTtsPlaybackAudioElement(null);
      audioElementRef.current = null;
    };
  }, []);

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
    sttUiPhase,
    lastTranscript,
    lastDialogue,
    emotion,
    error,
    sendText,
    sendWsPayload,
    toggleListening,
  } = useAgentAgent({ wsUrl: WS_AGENT_URL, sessionActive: hasStarted });

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
      if (isElevenLabsTtsProvider()) return;
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

  // 3. سجل المحادثة (صوتي: فقط عند وصول النص من الخادم — بدون تكرار مع الإرسال اليدوي)
  useEffect(() => {
    if (!lastTranscript.trim()) return;
    setHistory((h) => {
      const last = h[h.length - 1];
      if (last?.role === 'user' && last.text === lastTranscript) return h;
      return [...h.slice(-15), { role: 'user', text: lastTranscript.trim() }];
    });
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
      const silentAudio = audioElementRef.current;
      if (silentAudio) {
        silentAudio.src =
          'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        await silentAudio.play();
        silentAudio.pause();
        silentAudio.currentTime = 0;
        silentAudio.removeAttribute('src');
      }
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Audio] Silent bypass failed:', e);
      }
    }

    (window as any).__AUDIO_UNLOCKED__ = true;

    await resumeSharedAudioContext();

    setHasStarted(true);
    if (process.env.NODE_ENV === 'development') {
      console.log('[AvatarAgentClient] session started — hasStarted=true (mic should be visible if COGNI_MIC_UI_ENABLED)');
    }
  };

  const submitMessage = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      usePerceptionStore.getState().recordUserSubmit(t.length, Date.now());
      registerAwarenessInteraction();
      agentDirector.processUserMessage(t);
      void unifiedGestureEngine.play('listening', { priority: PRIORITY.LOW });
      sendText(t);
      window.setTimeout(() => {
        void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.NORMAL });
      }, 500);
      setHistory((h) => {
        const last = h[h.length - 1];
        if (last?.role === 'user' && last.text === t) return h;
        return [...h.slice(-15), { role: 'user', text: t }];
      });
    },
    [sendText],
  );

  const sessionLocked = !hasStarted;

  /* overflow-x فقط داخل العمود؛ للصفحة الكامحة الأفاتار يُحمَّل عبر BodyPortal فيتجاوز أي قصّ */
  const shellClass =
    embedVariant === 'dashboard'
      ? 'relative isolate z-50 flex h-full min-h-0 w-full flex-1 flex-col overflow-x-hidden'
      : 'relative isolate z-50 h-screen min-h-0 w-full overflow-x-hidden';

  return (
    <>
    <main className={shellClass} dir="rtl">
      {/* Match root layout backdrop (new_env + vignette) under the WebGL layer. */}
      <div className="pointer-events-none absolute inset-0 z-0 cognie-html-env-bg" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-0 cognie-bg-overlay" aria-hidden />
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
            <p className="text-gray-400 mb-4 text-lg leading-relaxed">
              جاهز لرحلة تعلم BTEC فريدة؟ اضغط أدناه لتفعيل الصوت والبدء.
            </p>
            <p className="text-gray-500 mb-10 text-sm leading-relaxed">
              بعد البدء يفتح الميكروفون تلقائياً عندما تتكلّم (بدون زر)، ويتوقّف بعد سكون قصير. يمكنك دائماً الكتابة في المحادثة.
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
                onClick={() => void handleStartSession()}
                className="w-full py-4 rounded-2xl text-lg font-bold text-white bg-cyan-700 hover:bg-cyan-600 transition-all shadow-lg active:scale-95"
              >
                🎤 ابدأ مباشرة (صوت تلقائي)
              </button>
            </div>
          </div>
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
                  />
                </div>
              </div>
            </AvatarBodyPortal>
          )}

      <BodyPortal>
          <div
              className={`pointer-events-auto fixed flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0a0a14]/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl ${
                embedVariant === 'dashboard'
                  ? 'bottom-3 right-3 max-h-[min(68vh,34rem)] w-[min(22rem,calc(100vw-1.5rem))]'
                  : 'bottom-5 right-5 max-h-[min(72vh,38rem)] w-[min(26rem,calc(100vw-2.5rem))]'
              } ${sessionLocked ? 'opacity-50' : ''}`}
              style={{ zIndex: Z_LAYERS.CHAT_CARD }}
              aria-label="Chat"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-red-500'}`}
                    title={isConnected ? 'متصل' : 'غير متصل'}
                  />
                  <span className="truncate text-sm font-semibold text-white/95">المحادثة</span>
                  <span className="text-[10px] font-medium text-gray-400 ltr">
                    {isConnected ? 'Connected' : 'Offline'}
                  </span>
                  {isProcessing && (
                    <span className="text-[10px] font-medium text-cyan-300/90" aria-live="polite">
                      جاري الرد…
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-[11px] text-gray-400 hover:bg-white/10 hover:text-white"
                    onClick={() => setExtrasOpen((v) => !v)}
                    aria-expanded={extrasOpen}
                  >
                    {extrasOpen ? 'إغلاق الإضافات' : 'المزيد'}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  className="shrink-0 border-b border-rose-500/25 bg-rose-950/45 px-3 py-1.5 text-[11px] text-rose-100/95"
                  role="alert"
                >
                  {error}
                </div>
              )}

              {!sessionLocked && (
                <div
                  className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2"
                  role="status"
                  aria-live="polite"
                >
                  {sttUiPhase === 'converting' ? (
                    <span className="inline-flex items-center rounded-full bg-orange-600/40 px-3 py-1 text-[11px] font-semibold text-orange-50 ring-1 ring-orange-400/35">
                      Converting to text…
                    </span>
                  ) : isListening ? (
                    <span className="inline-flex items-center rounded-full bg-red-600/45 px-3 py-1 text-[11px] font-semibold text-red-50 ring-1 ring-red-400/40">
                      Listening…
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-slate-600/40 px-3 py-1 text-[11px] font-semibold text-slate-100 ring-1 ring-slate-400/25">
                      Idle
                    </span>
                  )}
                </div>
              )}

              {extrasOpen && (
                <div className="shrink-0 space-y-2 border-b border-white/10 bg-black/25 px-3 py-2 text-right">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {me && (
                      <button
                        type="button"
                        onClick={startPractice}
                        disabled={!isConnected || isProcessing}
                        className="rounded-full border border-amber-400/35 bg-amber-600/85 px-3 py-1 text-[10px] font-bold text-white disabled:opacity-30"
                        title="سؤال تدريبي يتناسب مع مستواك"
                      >
                        تدريب
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setBtecTrainOpen(true)}
                      disabled={!isConnected || isProcessing}
                      className="rounded-full border border-violet-400/35 bg-violet-700/85 px-3 py-1 text-[10px] font-bold text-white disabled:opacity-30"
                      title="أسئلة من كتب BTEC مع تقييم P/M/D"
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
                  <button
                    type="button"
                    className="text-[10px] text-gray-500 hover:text-violet-300"
                    onClick={() => setShowTools((v) => !v)}
                  >
                    {showTools ? 'إخفاء أدوات التفاعل' : 'أدوات تفاعل'}
                  </button>
                  {showTools && (
                    <ToolSandbox
                      sendTool={(payload) =>
                        sendWsPayload({ type: 'tool_interaction', payload })
                      }
                    />
                  )}
                  <div className="flex flex-wrap justify-end gap-1.5 pt-1">
                    {['PESTLE', 'SWOT', 'BTEC P1'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => chatInputRef.current?.setValue(`اشرح لي ${tag}`)}
                        className="text-[10px] text-gray-500 hover:text-white"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div
                ref={historyRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 scrollbar-hide"
              >
                {history.length === 0 && (
                  <p className="px-1 text-center text-[12px] leading-relaxed text-gray-500">
                    {sessionLocked
                      ? 'اضغط «ابدأ الآن» لتفعيل الجلسة؛ ثم يعمل الميكروفون تلقائياً عندما تتكلّم.'
                      : 'تكلّم أو اكتب هنا — الرسائل تظهر في هذا السجل.'}
                  </p>
                )}
                {history.map((h, i) => (
                  <div
                    key={`${h.role}-${i}-${h.text.slice(0, 24)}`}
                    className={`flex ${h.role === 'user' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        h.role === 'user'
                          ? 'border border-sky-500/15 bg-sky-600/18 text-sky-50'
                          : 'border border-violet-500/15 bg-violet-600/18 text-violet-50'
                      }`}
                    >
                      {h.text}
                    </div>
                  </div>
                ))}
              </div>

              <div className="shrink-0 border-t border-white/10 bg-black/20 px-3 py-3">
                <ChatInput
                  ref={chatInputRef}
                  onSend={submitMessage}
                  disabled={sessionLocked || !isConnected || isProcessing}
                  showWebSpeech={false}
                  placeholder="Speak, or type here..."
                  className="!max-w-none w-full flex-wrap gap-2"
                  trailingSlot={
                    COGNI_MIC_UI_ENABLED ? (
                      <button
                        type="button"
                        disabled={sessionLocked || !isConnected}
                        onClick={() => {
                          void toggleListening();
                        }}
                        aria-label={
                          sessionLocked
                            ? 'ابدأ الجلسة أولاً لتفعيل الميكروفون'
                            : !isConnected
                              ? 'انتظر اتصال الخادم'
                              : sttUiPhase === 'listening'
                                ? 'إيقاف الميكروفون'
                                : 'تشغيل الميكروفون'
                        }
                        title={
                          sessionLocked
                            ? 'الميكروفون بعد بدء الجلسة'
                            : !isConnected
                              ? 'انتظر الاتصال'
                              : sttUiPhase === 'converting'
                                ? 'تحويل الكلام إلى نص'
                                : sttUiPhase === 'listening'
                                  ? 'اضغط لإيقاف الميكروفون — أو يُفعَّل تلقائياً بعد تحميل المشهد'
                                  : 'اضغط لتشغيل الميكروفون (أو يُشغَّل تلقائياً بعد تحميل الأفاتار)'
                        }
                        className={`flex h-14 min-w-[3.5rem] shrink-0 cursor-pointer select-none items-center justify-center rounded-2xl text-xl text-white shadow-lg transition-transform active:scale-95 disabled:cursor-not-allowed ${
                          sessionLocked ? 'opacity-40 grayscale' : ''
                        } ${
                          sttUiPhase === 'converting'
                            ? 'animate-pulse bg-orange-500 ring-2 ring-orange-300/50'
                            : sttUiPhase === 'listening'
                              ? 'animate-pulse bg-red-600'
                              : 'bg-slate-600 hover:bg-slate-500'
                        }`}
                      >
                        {sttUiPhase === 'converting' ? '⏳' : sttUiPhase === 'listening' ? '🎤' : '🎙️'}
                      </button>
                    ) : null
                  }
                />
              </div>
            </div>
      </BodyPortal>
      </>
    </main>
    </>
  );
}