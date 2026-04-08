// [COPILOT_DEBUG_HOOK_START]
// Avatar debug helpers — exposed on window.__avatarDebug.
// Safe to import anywhere; guards on typeof window.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__avatarDebug ??= {};

  // Trigger a timed expression preset (uses avatar:emotion event with {name,value,ms}).
  w.__avatarDebug.testEmotion = (name: string, v = 1.0, ms = 800) =>
    window.dispatchEvent(new CustomEvent('avatar:emotion', { detail: { name, value: v, ms } }));

  // Trigger a timed viseme weight (uses avatar:viseme event).
  w.__avatarDebug.testViseme = (name: 'aa' | 'ih' | 'ou' | 'ee' | 'oh', v = 0.9, ms = 500) =>
    window.dispatchEvent(new CustomEvent('avatar:viseme', { detail: { name, value: v, ms } }));

  // Dispatch a gesture event.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  w.__avatarDebug.testGesture = (type: string, detail: any = {}) =>
    window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { type, ...detail } }));

  // Local avatar TTS only (avatar:speak:text → Web Speech or speakWithTTS). Does NOT send to the agent WebSocket; use window.__cogniSendText in dev for that.
  w.__avatarDebug.testSpeak = (txt: string) =>
    window.dispatchEvent(new CustomEvent('avatar:speak:text', { detail: { text: txt } }));
}
export {};
// [COPILOT_DEBUG_HOOK_END]
