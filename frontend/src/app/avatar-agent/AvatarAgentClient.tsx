'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAgentAgent }   from '@/hooks/useAgentAgent';
import PermissionBanner    from '@/components/PermissionBanner';
import ConversationManager from '@/components/ConversationManager';
import styles              from './AvatarCanvas.module.css';

// AvatarCanvas is loaded dynamically (SSR off) — it drives all avatar events
// via window listeners. The vrmUrl prop must remain unchanged.
const AvatarCanvas = dynamic(() => import('./AvatarCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a12] text-gray-300 text-sm">
      جاري تحميل Cogni...
    </div>
  ),
});

// ── Emotion → colour + icon ──────────────────────────────────────────────────
const EMOTION_DISPLAY: Record<string, { icon: string; colour: string }> = {
  happy:           { icon: '😊', colour: 'text-yellow-400' },
  excited:         { icon: '🤩', colour: 'text-orange-400' },
  celebrating:     { icon: '🎉', colour: 'text-pink-400' },
  celebration:     { icon: '🎉', colour: 'text-pink-400' },
  proud:           { icon: '😌', colour: 'text-violet-400' },
  curious:         { icon: '🤔', colour: 'text-sky-400' },
  thinking:        { icon: '💭', colour: 'text-blue-400' },
  encouraging:     { icon: '💪', colour: 'text-green-400' },
  empathetic:      { icon: '🤝', colour: 'text-teal-400' },
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
};

function emitAvatarCmd(type: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

/** Primary VRM — file lives at frontend/public/models/teach.vrm.
 *  Rename/replace with verona.vrm and update this constant when the model is ready. */
const VERONA_VRM = '/models/teach.vrm';
const TEACH_VRM  = '/models/teach.vrm';

// ── Session history entry ────────────────────────────────────────────────────
interface HistoryEntry { role: 'user' | 'teacher'; text: string; emotion?: string }

// Resolve WebSocket URL from env so Docker containers use the service name
// instead of the hardcoded 127.0.0.1. Falls back safely for native dev.
// NEXT_PUBLIC_API_URL is set in docker-compose.yml → "http://backend:8000"
// In native dev (.env.local) it is "http://127.0.0.1:8000" or left unset.
const _apiBase = (
  process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'
).replace(/\/$/, '');
const WS_AGENT_URL = _apiBase.replace(/^http/, 'ws') + '/ws/agent';

export default function AvatarAgentClient() {
  const {
    isConnected,
    isProcessing,
    isListening,
    lastTranscript,
    lastDialogue,
    emotion,
    personaLevel,
    setPersonaLevel,
    btecProgress,
    error,
    micNotFound,
    permissionDenied,
    resetPermissionDenied,
    toggleListening,
    sendText,
    clearHistory,
  } = useAgentAgent({ wsUrl: WS_AGENT_URL });

  const [userInput,  setUserInput]  = useState('');
  const [history,    setHistory]    = useState<HistoryEntry[]>([]);
  const [isSitting,  setIsSitting]  = useState(false);
  const [showHistory,setShowHistory]= useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [blockedAudio, setBlockedAudio] = useState<HTMLAudioElement | null>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const historyRef     = useRef<HTMLDivElement>(null);

  // Show/hide the "click to unmute" banner when browser blocks autoplay
  useEffect(() => {
    const onBlocked = (e: Event): void => {
      const evt = e as CustomEvent;
      setAudioBlocked(true);
      setBlockedAudio(evt.detail?.audio ?? null);
    };
    const onUnblock = (): void => {
      setAudioBlocked(false);
      setBlockedAudio(null);
    };
    window.addEventListener('cogni:autoplay-blocked', onBlocked);
    window.addEventListener('avatar:speak:start',    onUnblock);
    return () => {
      window.removeEventListener('cogni:autoplay-blocked', onBlocked);
      window.removeEventListener('avatar:speak:start',    onUnblock);
    };
  }, []);

  // ── Wire isListening → avatar physical behavior (phase state machine) ────
  // Dispatches avatar:listening so AvatarCanvas.tsx can adapt posture,
  // breathing amplitude, and head bias without requiring WS coupling.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('avatar:listening', { detail: { active: isListening } }),
    );
  }, [isListening]);

  // ── AudioContext auto-resume on first user interaction ───────────────────
  // Browser autoplay policy suspends AudioContext until a user gesture fires.
  // A single click anywhere on the page resumes it, unblocking all audio.
  useEffect(() => {
    const resumeAudio = () => {
      const ctx = (window as typeof window & { __AUDIO_CTX__?: AudioContext }).__AUDIO_CTX__;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    window.addEventListener('click', resumeAudio, { once: true });
    return () => window.removeEventListener('click', resumeAudio);
  }, []);

  // Accumulate session history from transcript + dialogue
  useEffect(() => {
    if (lastTranscript) {
      setHistory(h => [...h.slice(-11), { role: 'user', text: lastTranscript }]);
    }
  }, [lastTranscript]);
  useEffect(() => {
    if (lastDialogue) {
      setHistory(h => [...h.slice(-11), { role: 'teacher', text: lastDialogue, emotion }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDialogue]);

  // Auto-scroll history
  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [history]);

  const onSend = () => {
    if (!userInput.trim()) return;
    sendText(userInput.trim());
    setHistory(h => [...h.slice(-11), { role: 'user', text: userInput.trim() }]);
    setUserInput('');
    inputRef.current?.focus();
  };

  const emo = EMOTION_DISPLAY[emotion] ?? EMOTION_DISPLAY.neutral;

  // ── Avatar direct-control commands ──────────────────────────────────────
  const cmdWalk      = () => { emitAvatarCmd('avatar:walk',    { duration: 4 });                           console.log('[AvatarCmd] walk'); };
  const cmdWave      = () => { emitAvatarCmd('avatar:gesture', { type:'wave', side:'right', duration:3 }); console.log('[AvatarCmd] wave'); };
  const cmdNod       = () => { emitAvatarCmd('avatar:nod',     { duration: 1.5, intensity: 0.35 });        console.log('[AvatarCmd] nod'); };
  const cmdThink     = () => { emitAvatarCmd('avatar:emotion', { emotion:'thinking' });                    console.log('[AvatarCmd] think'); };
  const cmdSit       = () => {
    setIsSitting(v => !v);
    emitAvatarCmd('avatar:sit', { sitting: !isSitting });
    console.log('[AvatarCmd] sit:', !isSitting);
  };
  const cmdClap      = () => { emitAvatarCmd('avatar:play',    { clip:'clap' });      console.log('[AvatarCmd] clap'); };
  const cmdSad       = () => { emitAvatarCmd('avatar:play',    { clip:'sad' });       console.log('[AvatarCmd] sad'); };
  const cmdAngry     = () => { emitAvatarCmd('avatar:play',    { clip:'angry' });     console.log('[AvatarCmd] angry'); };
  const cmdCheer     = () => { emitAvatarCmd('avatar:play',    { clip:'cheer' });     console.log('[AvatarCmd] cheer'); };
  const cmdGoodbye   = () => { emitAvatarCmd('avatar:play',    { clip:'goodbye' });   console.log('[AvatarCmd] goodbye'); };
  const cmdPoint     = () => { emitAvatarCmd('avatar:play',    { clip:'point' });     console.log('[AvatarCmd] point'); };
  const cmdSurprise  = () => { emitAvatarCmd('avatar:play',    { clip:'surprise' });  console.log('[AvatarCmd] surprise'); };
  const cmdPace      = () => { emitAvatarCmd('avatar:play',    { clip:'pace' });      console.log('[AvatarCmd] pace'); };
  const cmdSitPoint  = () => { emitAvatarCmd('avatar:play',    { clip:'sitPoint' });  console.log('[AvatarCmd] sitPoint'); };
  const cmdJumpHigh  = () => { emitAvatarCmd('avatar:play',    { clip:'jumpHigh' });  console.log('[AvatarCmd] jumpHigh'); };
  const cmdClear = () => {
    clearHistory();
    setHistory([]);
  };

  return (
    <main className="relative w-full h-screen bg-[#0a0a12] overflow-hidden" dir="rtl">

      {/* ── Phase 4 Conversation Manager — initial interaction overlay + turn-taking ── */}
      <ConversationManager
        onSessionStart={() => {
          console.log('[AvatarAgentClient] Session started, ready for conversation');
        }}
        onUserSpeaking={() => {
          console.log('[AvatarAgentClient] User is speaking — may interrupt avatar');
        }}
        onUserSilent={() => {
          console.log('[AvatarAgentClient] User finished speaking');
        }}
      />

      {/* ── Permission banner (microphone/camera) ────────────────────────── */}
      <PermissionBanner
        permissionDenied={permissionDenied}
        micNotFound={micNotFound}
        onRetry={resetPermissionDenied}
      />

      {/* ── Audio unlock banner — shown when browser blocks autoplay ──────── */}
      {audioBlocked && (
        <div className="absolute top-0 inset-x-0 z-50 flex justify-center pointer-events-auto">
          <div className="mt-3 bg-amber-900/90 backdrop-blur-md border border-amber-500/60
              rounded-full px-6 py-2 text-amber-200 text-xs font-medium shadow-lg flex items-center gap-3">
            <span>🔇 تم حجب الصوت — </span>
            {blockedAudio ? (
              <button
                onClick={() => {
                  if (blockedAudio) {
                    blockedAudio.muted = false;
                    blockedAudio.play().catch(err => console.warn('Unmute failed:', err));
                    setAudioBlocked(false);
                    setBlockedAudio(null);
                  }
                }}
                className="px-3 py-1 bg-amber-500 text-amber-900 rounded-full font-semibold text-xs
                  hover:bg-amber-400 transition active:scale-95"
              >
                🔊 شغّل الصوت
              </button>
            ) : (
              <span>انقر في أي مكان لتفعيل الصوت</span>
            )}
          </div>
        </div>
      )}

      {/* ── Thinking indicator — prominent floating banner when LLM is processing */}
      {isProcessing && (
        <div className="absolute top-16 inset-x-0 z-40 flex justify-center pointer-events-none">
          <div className="bg-blue-950/80 backdrop-blur-md border border-blue-400/50
              rounded-full px-5 py-2 text-blue-200 text-sm font-medium shadow-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            <span>💭 Cogni يفكر...</span>
          </div>
        </div>
      )}

      {/* ── Avatar canvas — fills screen ──────────────────────────────────── */}
      <div className={`absolute inset-0 ${isListening ? styles.listeningPulse : ''}`}>
        <AvatarCanvas vrmUrl={VERONA_VRM} fallbackVrmUrl={TEACH_VRM} />
      </div>

      {/* ── Triple-Persona glow overlay (passive ring showing active level) ── */}
      <div className={`absolute inset-0 pointer-events-none ${
        personaLevel === 'merit'       ? styles.personaMerit :
        personaLevel === 'distinction' ? styles.personaDistinction : ''
      }`} />

      {/* ── Top-left: persona badge ───────────────────────────────────────── */}
      <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 backdrop-blur-md
          border border-violet-500/40 rounded-full px-3 py-1 text-xs text-white shadow-lg">
        <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
        <span className="text-violet-300 font-bold">Cogni</span>
        <span className="text-violet-500">|</span>
        <span className="text-gray-300">إيدوفيرس التعليمية</span>
      </div>

      {/* ── BTEC Level switcher (Triple-Persona) ───────────────────────────────── */}
      <div className="absolute top-12 right-4 flex items-center gap-1.5 bg-black/40 backdrop-blur-md
          border border-white/10 rounded-full px-2 py-1 text-[10px] shadow">
        {(['pass', 'merit', 'distinction'] as const).map(lvl => (
          <button
            key={lvl}
            onClick={() => setPersonaLevel(lvl)}
            className={`px-2 py-0.5 rounded-full font-medium transition-all ${
              personaLevel === lvl
                ? lvl === 'pass'        ? 'bg-blue-600  text-white'
                : lvl === 'merit'       ? 'bg-yellow-500 text-black'
                :                         'bg-red-600    text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {lvl === 'pass' ? 'P' : lvl === 'merit' ? 'M' : 'D'}
          </button>
        ))}
      </div>
      {/* ── BTEC criterion progress bar (shown when server has sent btec_progress_ack) */}
      {btecProgress?.unit_id && (
        <div className="absolute top-32 left-4 bg-black/60 backdrop-blur-md border border-violet-500/30
            rounded-lg px-3 py-2 text-xs text-white shadow-lg min-w-[170px] z-20">
          <div className="flex justify-between mb-1.5">
            <span className="text-violet-400 font-bold uppercase text-[10px] tracking-wide">
              {btecProgress.unit_id.toUpperCase()}
            </span>
            <span className={`font-bold text-[10px] ${
              btecProgress.current_level === 'distinction' ? 'text-red-400' :
              btecProgress.current_level === 'merit'       ? 'text-yellow-400' :
                                                            'text-blue-400'
            }`}>
              {btecProgress.current_level?.toUpperCase()}
            </span>
          </div>
          {(['pass', 'merit', 'distinction'] as const).map(lvl => {
            const s = btecProgress.summary?.[lvl];
            if (!s || s.total === 0) return null;
            return (
              <div key={lvl} className="mb-1.5">
                <div className="flex justify-between text-[9px] text-gray-400 mb-0.5">
                  <span className="uppercase">{lvl}</span>
                  <span>{s.achieved}/{s.total}</span>
                </div>
                <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`${styles.btecBar} ${
                      lvl === 'distinction' ? 'bg-red-500' :
                      lvl === 'merit'       ? 'bg-yellow-500' :
                                             'bg-blue-500'
                    }`}
                    {...{ style: { '--btec-pct': `${(s.achieved / s.total) * 100}%` } as React.CSSProperties }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* ── Top-left: scaffolding level indicator ────────────────────────── */}
      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md border border-cyan-500/30
          rounded-lg px-3 py-2 text-xs text-white shadow-lg min-w-[140px]">
        <div className="text-cyan-400 font-bold mb-1">🧠 Cogni</div>
        <div className="flex items-center gap-1 text-gray-300">
          <span className={emo.colour + ' text-sm'}>{emo.icon}</span>
          <span className={emo.colour}>{emotion}</span>
        </div>
        <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r from-cyan-500 to-violet-500 rounded-full transition-all duration-700 ${
              isProcessing ? 'w-5/6' : isListening ? 'w-2/5' : 'w-1/5'
            }`}
          />
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">
          {isProcessing ? 'يفكر ويحلل...' : isListening ? 'يستمع...' : 'ينتظر'}
        </div>
      </div>

      {/* ── Right side: session history panel (toggle) ───────────────────── */}
      <button
        onClick={() => setShowHistory(v => !v)}
        className="absolute top-1/2 -translate-y-1/2 right-0 bg-black/60 border border-white/10
          text-gray-300 text-xs px-2 py-3 rounded-l-lg hover:bg-black/80 transition z-10"
        title="سجل المحادثة"
      >
        {showHistory ? '◀' : '📜'}
      </button>

      {showHistory && (
        <div className="absolute top-16 right-0 bottom-48 w-80 bg-black/70 backdrop-blur-xl
            border-l border-white/10 flex flex-col shadow-2xl z-10" dir="rtl">
          <div className="px-3 py-2 border-b border-white/10 text-xs text-gray-400 font-bold">
            📜 سجل الجلسة
          </div>
          <div ref={historyRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {history.length === 0 && (
              <div className="text-center text-gray-600 text-xs mt-4">لا يوجد سجل بعد</div>
            )}
            {history.map((h, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-xs max-w-[90%] ${h.role === 'user'
                  ? 'bg-blue-900/50 text-blue-200 self-end mr-auto'
                  : 'bg-violet-900/50 text-violet-200 self-start ml-auto'}`}
              >
                {h.role === 'teacher' && h.emotion && (
                  <span className="text-[10px] text-violet-400 block mb-0.5">
                    {EMOTION_DISPLAY[h.emotion]?.icon ?? '🤖'} {h.emotion}
                  </span>
                )}
                {h.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bottom HUD ───────────────────────────────────────────────────── */}
      <div className="absolute bottom-0 inset-x-0 p-4 flex flex-col gap-3
          bg-black/50 backdrop-blur-xl border-t border-white/10 shadow-2xl z-20">

        {/* Avatar direct-control buttons */}
        <div className="flex gap-2 text-xs justify-center flex-wrap">
          {([
            { label: '🚶 مشي',       fn: cmdWalk,     title: 'يمشي' },
            { label: '👋 تحية',      fn: cmdWave,     title: 'يلوّح' },
            { label: '🙏 إيماءة',    fn: cmdNod,      title: 'إيماءة رأس' },
            { label: '💭 تفكير',    fn: cmdThink,    title: 'تعبير تفكير' },
            { label: isSitting ? '🧍 وقوف' : '🪑 جلوس', fn: cmdSit, title: isSitting ? 'يقف' : 'يجلس' },
            { label: '👏 تصفيق',    fn: cmdClap,     title: 'يصفق' },
            { label: '😢 حزن',      fn: cmdSad,      title: 'حزين' },
            { label: '😡 غضب',      fn: cmdAngry,    title: 'غاضب' },
            { label: '🎉 ابتهاج',   fn: cmdCheer,    title: 'يبتهج' },
            { label: '👋 وداع',     fn: cmdGoodbye,  title: 'يودّع' },
            { label: '👉 إشارة',    fn: cmdPoint,    title: 'يشير' },
            { label: '😲 مفاجأة',   fn: cmdSurprise, title: 'مفاجأة' },
            { label: '📱 مكالمة',   fn: cmdPace,     title: 'يتمشى ويتحدث بالهاتف' },
            { label: '🪑 إشارة جالس', fn: cmdSitPoint, title: 'جالس ويشير' },
            { label: '⬆️ قفز عالي', fn: cmdJumpHigh, title: 'يقفز عالياً' },
          ] as { label: string; fn: () => void; title: string }[]).map(({ label, fn, title }) => (
            <button
              key={label}
              onClick={fn}
              title={title}
              className="px-3 py-1.5 bg-white/10 text-white border border-white/20 rounded-full
                hover:bg-white/20 transition text-[11px] select-none"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status row */}
        <div className="flex items-center justify-between text-xs">
          <span className={isConnected ? 'text-emerald-400' : 'text-red-400'}>
            {isConnected ? '🟢 متصل' : '🔴 غير متصل'}
          </span>

          <div className="flex items-center gap-2">
            {isListening && (
              <span className="flex gap-0.5 items-end">
                <span className="w-1 h-2.5 rounded-full bg-cyan-400 animate-bounce delay-0" />
                <span className="w-1 h-3.5 rounded-full bg-cyan-400 animate-bounce delay-150" />
                <span className="w-1 h-4.5 rounded-full bg-cyan-400 animate-bounce delay-300" />
              </span>
            )}
            <span className={isListening ? 'text-cyan-400' : isProcessing ? 'text-yellow-400' : 'text-gray-400'}>
              {isListening ? 'يستمع...' : isProcessing ? 'يفكر...' : 'جاهز'}
            </span>
          </div>

          <span className={emo.colour + ' flex items-center gap-1'}>
            <span>{emo.icon}</span>
            <span className="text-[11px]">{emotion}</span>
          </span>
        </div>

        {/* Microphone not found banner */}
        {micNotFound && (
          <div className="text-xs text-amber-300 bg-amber-950/60 border border-amber-500/40 rounded px-3 py-2 flex items-center gap-2">
            <span>🎤</span>
            <span>لم يتم العثور على ميكروفون — يرجى توصيل ميكروفون وإعادة تحميل الصفحة.</span>
          </div>
        )}

        {/* Microphone permission denied — handled by PermissionBanner (fixed bottom overlay) */}

        {/* General error display */}
        {error && (
          <div className="text-xs text-red-400 bg-red-950/50 rounded px-3 py-1">
            ⚠️ {error}
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSend()}
            className="flex-1 px-3 py-2 text-sm bg-white/10 text-white border border-white/20 rounded-md
              focus:outline-none focus:border-cyan-500 placeholder-gray-500"
            placeholder="اكتب رسالة لـ Cogni..."
          />
          <button
            onClick={onSend}
            disabled={!isConnected || !userInput.trim() || isProcessing}
            className="px-4 py-2 bg-violet-600 text-white rounded-md text-sm
              disabled:opacity-40 disabled:cursor-not-allowed hover:bg-violet-500 transition"
          >
            إرسال
          </button>
          <button
            onClick={toggleListening}
            className={`px-4 py-2 text-white rounded-md text-sm transition ${
              isListening ? 'bg-red-600 hover:bg-red-500' : 'bg-cyan-600 hover:bg-cyan-500'
            }`}
            title={isConnected ? (isListening ? 'إيقاف الاستماع' : 'ابدأ التحدث') : 'الميكروفون يعمل — الباكند غير متصل'}
          >
            {isListening ? '⛔' : '🎤'}
          </button>
          <button
            onClick={cmdClear}
            className="px-3 py-2 bg-gray-700 text-white rounded-md text-sm hover:bg-gray-600 transition"
            title="مسح السجل"
          >
            🗑
          </button>
        </div>

        {/* Quick-prompt chips */}
        <div className="flex gap-1.5 text-[11px] flex-wrap">
          {['شو هو PESTLE؟', 'كيف أكتب P1؟', 'شرحلي SWOT', 'شو الفرق بين MERIT و DISTINCTION؟'].map(q => (
            <button
              key={q}
              onClick={() => { setUserInput(q); inputRef.current?.focus(); }}
              className="px-2.5 py-1 bg-violet-900/40 text-violet-300 border border-violet-500/30
                rounded-full hover:bg-violet-900/60 transition"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* ── Microphone permission banner (fixed bottom overlay) ──────────── */}
      <PermissionBanner />

    </main>
  );
}