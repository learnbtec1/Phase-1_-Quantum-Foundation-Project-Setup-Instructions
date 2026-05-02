'use client';

/**
 * ConversationManager.tsx — Phase 4 Turn-Taking System
 *
 * Manages the lifecycle of human-avatar conversation with strict turn-taking:
 *   1. Initial Interaction: "Start Session" overlay until user clicks
 *   2. State Machine: tracks isUserSpeaking, isAvatarSpeaking states
 *   3. Interruption Logic: When user speaks, immediately silence the avatar
 *   4. Sequential Processing: Avatar only speaks after user finishes
 *
 * Events dispatched:
 *   - 'cogni:conversation:started' when AudioContext is unlocked
 *   - 'cogni:user:speaking'        when VAD detects speech
 *   - 'cogni:user:silent'          when user stops speaking
 *   - 'cogni:avatar:interrupt'     forces avatar to stop speaking
 */

import { useEffect, useRef, useState } from 'react';
import { usePerceptionStore } from '@/store/usePerceptionStore';
import {
  resumeSharedAudioFromClick,
  getSharedAudioContext,
} from '@/lib/audio/avatarAudioContext';
import { BodyPortal } from '@/components/portal/BodyPortal';
import { Z_LAYERS } from '@/lib/z-layers';
import { cogniVerbose, cogniVerboseWarn } from '@/lib/cogniVerbose';

export interface ConversationManagerProps {
  /** Callback when initial session starts (AudioContext is unlocked) */
  onSessionStart?: () => void;
  /** Callback when user starts speaking (VAD enabled) */
  onUserSpeaking?: () => void;
  /** Callback when user stops speaking */
  onUserSilent?: () => void;
  /** Skip start overlay and attempt AudioContext unlock on mount (minimal /cognie). */
  autoUnlockOnMount?: boolean;
}

/**
 * Phase 4 Conversation Manager — handles AudioContext unlock + turn-taking
 */
export default function ConversationManager({
  onSessionStart,
  onUserSpeaking,
  onUserSilent,
  autoUnlockOnMount = false,
}: ConversationManagerProps) {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const hasInteractedRef = useRef(false);
  /** True after `avatar:speak:start` until `avatar:speak:end` — detects cleanup-only end events. */
  const avatarSpeakActiveRef = useRef(false);

  // ── Initialize AudioContext on first user gesture ──────────────────────
  const initializeAudio = async (): Promise<void> => {
    resumeSharedAudioFromClick();
    if (!hasInteractedRef.current) {
      try {
        const ctx = getSharedAudioContext();
        if (!ctx) {
          console.error('[ConversationManager] getSharedAudioContext() unavailable');
          return;
        }
        audioContextRef.current = ctx;

        hasInteractedRef.current = true;
        setSessionStarted(true);

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cogni:conversation:started'));
        }

        onSessionStart?.();

        cogniVerbose('[ConversationManager] ✅ AudioContext initialized, session started');
      } catch (err) {
        console.error('[ConversationManager] Failed to initialize AudioContext:', err);
      }
    }
  };

  useEffect(() => {
    if (!autoUnlockOnMount || typeof window === 'undefined') return;
    void initializeAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot; ref guards inside initializeAudio
  }, [autoUnlockOnMount]);

  // ── Listen for avatar speaking events ────────────────────────────────────
  useEffect(() => {
    const onAvatarSpeakStart = () => {
      avatarSpeakActiveRef.current = true;
      setIsAvatarSpeaking(true);
      cogniVerbose('[ConversationManager] Avatar is now speaking');
    };

    const onAvatarSpeakEnd = () => {
      if (!avatarSpeakActiveRef.current) {
        cogniVerboseWarn(
          '[ConversationManager] ⚠️ Ignored speak:end — no speak:start (no audible TTS / false positive blocked)',
        );
        return;
      }
      avatarSpeakActiveRef.current = false;
      setIsAvatarSpeaking(false);
      usePerceptionStore.getState().noteAvatarSpeechEnd(Date.now());
      cogniVerbose('[ConversationManager] Avatar finished speaking');
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('avatar:speak:start', onAvatarSpeakStart);
    window.addEventListener('avatar:speak:end', onAvatarSpeakEnd);

    return () => {
      window.removeEventListener('avatar:speak:start', onAvatarSpeakStart);
      window.removeEventListener('avatar:speak:end', onAvatarSpeakEnd);
    };
  }, []);

  // ── Turn-taking: real speech from VAD (not merely "mic on") ───────────────
  useEffect(() => {
    const onUserStart = () => {
      setIsUserSpeaking(true);
      if (isAvatarSpeaking) {
        // useAgentAgent runAvatarBargeIn already fades TTS + VRMA on VAD; this covers UI-only paths.
        window.dispatchEvent(new CustomEvent('cogni:avatar:interrupt'));
        cogniVerbose('[ConversationManager] User speaking — interrupt signal (TTS fade + avatar)');
      }
      onUserSpeaking?.();
    };

    const onUserStop = () => {
      setIsUserSpeaking(false);
      onUserSilent?.();
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('cogni:user:speaking', onUserStart);
    window.addEventListener('cogni:user:silent', onUserStop);

    return () => {
      window.removeEventListener('cogni:user:speaking', onUserStart);
      window.removeEventListener('cogni:user:silent', onUserStop);
    };
  }, [isAvatarSpeaking, onUserSpeaking, onUserSilent]);

  // ── Session start overlay ────────────────────────────────────────────────
  if (!sessionStarted) {
    if (autoUnlockOnMount) {
      return null;
    }
    return (
      <BodyPortal>
      <div
        className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        style={{ zIndex: Z_LAYERS.MODAL_BACKDROP }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cogni-session-start-title"
      >
        <div className="flex flex-col items-center gap-6 text-white">
          {/* Animated avatar icon */}
          <div className="text-6xl animate-bounce">🤖</div>

          {/* Call to action */}
          <div className="text-center">
            <h1 id="cogni-session-start-title" className="text-3xl font-bold mb-2">
              مرحباً بك في Cogni
            </h1>
            <p className="text-gray-300 text-sm max-w-xs">
              اضغط الزر أدناه لبدء الجلسة التعليمية مع أفاتارك الشخصي
            </p>
          </div>

          {/* Start button */}
          <button
            onClick={initializeAudio}
            className="px-8 py-3 bg-gradient-to-r from-violet-600 to-cyan-600
              text-white font-bold rounded-full text-lg
              hover:from-violet-500 hover:to-cyan-500
              active:scale-95 transition-all duration-200
              shadow-lg shadow-violet-500/50"
          >
            ▶️ ابدأ الجلسة
          </button>

          {/* Permissions info */}
          <div className="text-xs text-gray-400 text-center max-w-xs">
            <p>📍 سيطلب منك الوصول إلى الميكروفون</p>
            <p className="mt-1">الصوت والصورة مشفرة ومحمية</p>
          </div>
        </div>
      </div>
      </BodyPortal>
    );
  }

  // ── Conversation state indicators (if needed for debugging) ────────────────
  return (
    <div className="fixed bottom-4 left-4 text-xs text-gray-400 z-0 pointer-events-none">
      {/* Hidden but ready to dispatch events */}
      <div className="hidden">
        {isUserSpeaking && 'user:speaking'}
        {isAvatarSpeaking && 'avatar:speaking'}
      </div>
    </div>
  );
}
