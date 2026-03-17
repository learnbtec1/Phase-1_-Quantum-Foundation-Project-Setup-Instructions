/**
 * VOICE_CONFIG — إعدادات مركزية للمايك وكشف الصوت (VAD).
 *
 * autoStartVADOnWSConnect: إذا كانت false (الافتراضي) لا يُشغَّل المايك
 *   تلقائياً بعد اتصال WebSocket — يتطلب ضغطة زر صريحة من المستخدم.
 *   ضعها true في بيئة PROD إذا أردت السلوك القديم (opt-in).
 *
 * requestMicOnMount: إذا كانت false (الافتراضي) لا يُطلب إذن المايك
 *   عند mount الهوك مباشرةً.
 *
 * micPermissionTimeoutMs: مهلة انتظار استجابة طلب الإذن (ms).
 */
export const VOICE_CONFIG = {
  autoStartVADOnWSConnect:
    process.env.NEXT_PUBLIC_AUTO_START_VAD === 'true' ? true : false,
  requestMicOnMount: false,
  micPermissionTimeoutMs: 8_000,
} as const;
