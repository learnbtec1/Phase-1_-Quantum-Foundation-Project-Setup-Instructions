'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAgentAgent }   from '@/hooks/useAgentAgent';
import { useVAD }          from '@/hooks/useVAD';
import { pickVrmUrl }      from '@/config/avatar';
import PermissionBanner    from '@/components/PermissionBanner';
import ConversationManager from '@/components/ConversationManager';
import styles              from './AvatarCanvas.module.css';

// تحميل الأفاتار بشكل ديناميكي لضمان أفضل أداء للفرونت إند
const AvatarCanvas = dynamic(() => import('./AvatarCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a12] text-gray-300 text-sm animate-pulse">
      جاري استدعاء كوجني... 🧑‍🏫
    </div>
  ),
});

// خريطة المشاعر والأيقونات المطورة
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

const ACTIVE_VRM = pickVrmUrl();

interface HistoryEntry {
  role: 'user' | 'teacher';
  text: string;
  emotion?: string;
}

// بناء رابط الـ WebSocket بشكل متوافق مع Docker والـ Localhost
const _apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const WS_AGENT_URL = _apiBase.replace(/^http/, 'ws') + '/ws/agent';

export default function AvatarAgentClient() {
  const [hasStarted, setHasStarted] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isSitting, setIsSitting] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [blockedAudio, setBlockedAudio] = useState<HTMLAudioElement | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // VAD hook — separate from useAgentAgent
  const { permissionDenied, micNotFound, resetPermissionDenied } = useVAD({ lang: 'ar-JO' });

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
  } = useAgentAgent({ wsUrl: WS_AGENT_URL });

  // 1. مراقبة حظر الصوت من المتصفح
  useEffect(() => {
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

  // 2. تحديث سلوك الأفاتار الفيزيائي بناءً على حالة الاستماع
  useEffect(() => {
    if (!hasStarted || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active: isListening } }));
  }, [isListening, hasStarted]);

  // 3. إدارة سجل المحادثة (تاريخ الجلسة)
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

  // 4. معالج بدء الجلسة الأقوى (تفعيل الصوت والمايكروفون)
  const handleStartSession = async () => {
    console.log('[System] 🚀 Starting secure session...');
    
    // فك قفل الصوت عبر خدعة الصوت الصامت
    try {
      const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
      await silentAudio.play();
    } catch (e) { console.warn('[Audio] Silent bypass failed:', e); }

    // [السطر السحري] تحرير نظام الصوت بالكامل للباكند والفرونت اند
    (window as any).__AUDIO_UNLOCKED__ = true;

    // استئناف محرك الصوت
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
    }

    setHasStarted(true);
  };

  const onSend = () => {
    if (!userInput.trim()) return;
    sendText(userInput.trim());
    setHistory(h => [...h.slice(-15), { role: 'user', text: userInput.trim() }]);
    setUserInput('');
    inputRef.current?.focus();
  };

  const currentEmo = EMOTION_DISPLAY[emotion] || EMOTION_DISPLAY.neutral;

  // Ensure microphone opens immediately upon session start
  useEffect(() => {
    if (hasStarted) {
      console.log('Opening microphone immediately.');
      // Logic to open microphone
    }
  }, [hasStarted]);

  return (
    <main className="relative w-full h-screen bg-[#06060c] overflow-hidden" dir="rtl">
      
      {/* شاشة الإقلاع (تظهر فقط عند البداية) */}
      {!hasStarted && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl">
          <div className="bg-[#121225] border border-violet-500/20 rounded-3xl p-12 max-w-lg text-center shadow-[0_0_50px_rgba(139,92,246,0.15)]">
            <div className="text-8xl mb-6 drop-shadow-2xl animate-bounce">🧑‍🏫</div>
            <h1 className="text-4xl font-black text-white mb-4 tracking-tight">كوجني: المعلم الذكي</h1>
            <p className="text-gray-400 mb-10 text-lg leading-relaxed">
              جاهز لرحلة تعلم BTEC فريدة؟ اضغط أدناه لتفعيل الصوت والبدء.
            </p>
            <button
              onClick={handleStartSession}
              className="w-full py-5 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white rounded-2xl text-2xl font-bold transition-all shadow-2xl active:scale-95"
            >
              🚀 ابدأ الآن
            </button>
          </div>
        </div>
      )}

      {hasStarted && (
        <>
          {/* مدير المحادثة والتبادل الصوتي */}
          <ConversationManager 
            onUserSpeaking={() => console.log('[VAD] User detected')}
            onUserSilent={() => console.log('[VAD] Silence detected')}
          />

          <PermissionBanner 
            permissionDenied={permissionDenied} 
            micNotFound={micNotFound} 
            onRetry={resetPermissionDenied} 
          />

          {/* الكانفاس الرئيسي للأفاتار */}
          <div className={`absolute inset-0 transition-all duration-1000 ${isListening ? styles.listeningPulse : ''}`}>
            <AvatarCanvas vrmUrl={ACTIVE_VRM} />
          </div>

          {/* لوحة التقدم BTEC (معطلة مؤقتاً) */}
          {false && <div className="absolute top-28 left-8">BTEC Progress unavailable</div>}

          {/* مؤشر الحالة النفسية والمشاعر */}
          <div className="absolute top-8 left-8 flex items-center gap-4 bg-black/40 backdrop-blur-md border border-cyan-500/20 rounded-2xl p-3 shadow-lg">
            <div className="relative">
              <div className="text-3xl">{currentEmo.icon}</div>
              {isProcessing && <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping" />}
            </div>
            <div>
              <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">Cogni Brain</div>
              <div className={`text-sm font-medium ${currentEmo.colour}`}>{emotion}</div>
            </div>
          </div>

          {/* سجل المحادثة الجانبي */}
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="absolute top-1/2 -translate-y-1/2 right-0 bg-violet-600 p-2 rounded-l-xl text-white z-40 shadow-2xl hover:bg-violet-500 transition-colors"
          >
            {showHistory ? '◀' : '📜'}
          </button>

          {showHistory && (
            <div className="absolute top-20 right-0 bottom-40 w-80 bg-[#0a0a12]/80 backdrop-blur-2xl border-l border-white/5 flex flex-col z-30 animate-in slide-in-from-right duration-300">
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

          {/* منطقة التحكم والـ HUD السفلي */}
          <div className="absolute bottom-0 inset-x-0 p-8 bg-gradient-to-t from-black via-black/90 to-transparent z-40">
            <div className="max-w-4xl mx-auto space-y-6">
              
              {/* أزرار الحركات السريعة (Quick Actions) */}
              <div className="flex gap-2 justify-center flex-wrap">
                {[
                  { label: '🚶 تمشي', cmd: () => emitAvatarCmd('avatar:play', { clip: 'pace' }) },
                  { label: '👋 رحب', cmd: () => emitAvatarCmd('avatar:gesture', { type: 'wave' }) },
                  { label: '👏 صفق', cmd: () => emitAvatarCmd('avatar:play', { clip: 'clap' }) },
                  { label: '🤔 فكر', cmd: () => emitAvatarCmd('avatar:play', { clip: 'think' }) },
                  { label: '🪑 اجلس', cmd: () => emitAvatarCmd('avatar:sit', { sitting: true }) },
                ].map(b => (
                  <button key={b.label} onClick={b.cmd} className="px-4 py-1.5 bg-white/5 border border-white/10 rounded-full text-white text-[11px] hover:bg-white/20 transition-all">
                    {b.label}
                  </button>
                ))}
              </div>

              {/* شريط الإدخال الرئيسي */}
              <div className="flex gap-4 items-center">
                <div className="relative flex-1 group">
                  <input
                    ref={inputRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
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

                <button 
                  onClick={toggleListening}
                  className={`p-4 rounded-2xl text-white shadow-lg transition-all active:scale-90 ${
                    isListening ? 'bg-red-600 animate-pulse' : 'bg-cyan-600 hover:bg-cyan-500'
                  }`}
                >
                  {isListening ? '⛔' : '🎤'}
                </button>
              </div>

              {/* مؤشرات الحالة الصغيرة */}
              <div className="flex justify-between items-center px-2">
                <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest">
                  <span className={isConnected ? 'text-emerald-500' : 'text-red-500'}>
                    ● {isConnected ? 'Network Online' : 'Network Offline'}
                  </span>
                  <span className="text-gray-500">● Docker: Nexus_Backend</span>
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
      )}
    </main>
  );
}