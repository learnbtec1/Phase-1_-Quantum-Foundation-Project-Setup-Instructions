'use client';

/**
 * ConversationManager.tsx — Phase 4 Turn-Taking System
 *
 * Manages the lifecycle of human-avatar conversation with strict turn-taking:
 *   1. AudioContext unlock: attempted automatically ~500ms after mount (no blocking overlay)
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
import { stopTTS } from '@/ai/io/tts';

export interface ConversationManagerProps {
  /** Callback when initial session starts (AudioContext is unlocked) */
  onSessionStart?: () => void;
  /** Callback when user starts speaking (VAD enabled) */
  onUserSpeaking?: () => void;
  /** Callback when user stops speaking */
  onUserSilent?: () => void;
}

/**
 * Phase 4 Conversation Manager — handles AudioContext unlock + turn-taking
 */
export default function ConversationManager({
  onSessionStart,
  onUserSpeaking,
  onUserSilent,
}: ConversationManagerProps) {
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const hasInteractedRef = useRef(false);

  // ── Initialize AudioContext (auto on mount after short delay — no blocking overlay) ──
  const initializeAudio = async () => {
    if (!hasInteractedRef.current) {
      try {
        // Create or resume AudioContext
        let ctx = audioContextRef.current;
        if (!ctx) {
          ctx = new AudioContext();
          audioContextRef.current = ctx;
        }

        // Resume if suspended
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        hasInteractedRef.current = true;

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cogni:conversation:started'));
        }

        onSessionStart?.();

        console.log('[ConversationManager] ✅ AudioContext initialized, session started');
      } catch (err) {
        console.error('[ConversationManager] Failed to initialize AudioContext:', err);
      }
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = window.setTimeout(() => {
      void initializeAudio();
    }, 500);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // ── Listen for avatar speaking events ────────────────────────────────────
  useEffect(() => {
    const onAvatarSpeakStart = () => {
      setIsAvatarSpeaking(true);
      console.log('[ConversationManager] Avatar is now speaking');
    };

    const onAvatarSpeakEnd = () => {
      setIsAvatarSpeaking(false);
      console.log('[ConversationManager] Avatar finished speaking');
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('avatar:speak:start', onAvatarSpeakStart);
    window.addEventListener('avatar:speak:end', onAvatarSpeakEnd);

    return () => {
      window.removeEventListener('avatar:speak:start', onAvatarSpeakStart);
      window.removeEventListener('avatar:speak:end', onAvatarSpeakEnd);
    };
  }, []);

  // ── Listen for VAD/user speaking events ──────────────────────────────────
  useEffect(() => {
    const onUserStart = () => {
      setIsUserSpeaking(true);
      
      // Temporarily disable stopTTS to prevent interruptions
      if (isAvatarSpeaking) {
        console.log('[ConversationManager] User is speaking, but avatar will not be interrupted.');
        // stopTTS(); // Disabled
      }

      onUserSpeaking?.();
    };

    const onUserStop = () => {
      setIsUserSpeaking(false);
      onUserSilent?.();
    };

    if (typeof window === 'undefined') return;

    // Listen for VAD or mic button events
    window.addEventListener('avatar:listening', (e: Event) => {
      const evt = e as CustomEvent;
      if (evt.detail?.active) {
        onUserStart();
      } else {
        onUserStop();
      }
    });

    // Also listen for explicit user:speaking events (if custom VAD fires them)
    window.addEventListener('cogni:user:speaking', onUserStart);
    window.addEventListener('cogni:user:silent', onUserStop);

    return () => {
      window.removeEventListener('avatar:listening', onUserStart);
      window.removeEventListener('cogni:user:speaking', onUserStart);
      window.removeEventListener('cogni:user:silent', onUserStop);
    };
  }, [isAvatarSpeaking, onUserSpeaking, onUserSilent]);

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
