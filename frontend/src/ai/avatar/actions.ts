/**
 * Avatar Actions — دوال مساعدة لإطلاق أحداث الإيماءات والمشاعر على الأفاتار
 * تعمل عبر window.dispatchEvent مع الأحداث المخصصة التي يستمع إليها VRMAvatar.
 *
 * الأحداث المدعومة:
 *   avatar:gesture  → { type, side, duration, intensity }
 *   avatar:emotion  → { emotion }
 */

export type GestureType = 'wave' | 'point' | 'openHand' | 'beat' | 'sit';
export type GestureSide = 'left' | 'right' | 'both';

export interface GestureOptions {
  side?: GestureSide;
  duration?: number;   // seconds
  intensity?: number;  // 0–1
}

// ─── Gesture Dispatchers ────────────────────────────────────────────────────

/**
 * تلويح باليد — مناسب للترحيب أو الوداع
 */
export function waveArm(side: GestureSide = 'right', intensity = 1, duration = 2.5): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:gesture', {
      detail: { type: 'wave', side, duration, intensity, variance: Math.random() },
    })
  );
}

/**
 * إشارة بالإصبع — مناسبة للتنبيه أو التأكيد
 */
export function pointFinger(side: GestureSide = 'right', intensity = 1, duration = 1.5): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:gesture', {
      detail: { type: 'point', side, duration, intensity, variance: Math.random() },
    })
  );
}

/**
 * فتح الكف — مناسب للدعوة أو الشرح
 */
export function openHand(side: GestureSide = 'both', intensity = 0.9, duration = 1.8): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:gesture', {
      detail: { type: 'openHand', side, duration, intensity, variance: Math.random() },
    })
  );
}

/**
 * حركة إيقاعية — مناسبة للتشجيع أو الترحيب الدافئ
 */
export function beatGesture(side: GestureSide = 'both', intensity = 0.7, duration = 1.4): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:gesture', {
      detail: { type: 'beat', side, duration, intensity, variance: Math.random() },
    })
  );
}

/**
 * وضعية الجلوس / القرفصاء — مؤقتة لمدة 5 ثوان ثم تعود للوقوف تلقائياً
 */
export function sitGesture(duration = 5): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:gesture', {
      detail: { type: 'sit', side: 'both', duration, intensity: 1 },
    })
  );
}

/**
 * إرسال إيماءة مخصصة بناءً على نص سطر الحركة من Verona
 * يحلل الكلمات المفتاحية في النص ويختار أنسب إيماءة
 */
export function dispatchGestureFromActionText(action: string): void {
  if (!action || typeof window === 'undefined') return;

  // ── تجريد التشكيل (الحركات العربية) قبل المطابقة ──────────────────────────
  // GPT يُخرج أحياناً: تُلوِّح، تُشير، تُحرِّك — نجرّد الحركات حتى تعمل الـ regex
  const a = action.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g, '');

  // ── ربط الذكاء بالحركة: إذا وصف الذكاء مشياً/توقفاً → نُفعِّله فعلياً على الأفاتار ──
  if (/تمشي|تبدا.*مش|تنطلق بخطوات|تخطو.*امام|تتحرك.*امام|تمشي خطو|تسير/.test(a)) {
    window.dispatchEvent(new CustomEvent('avatar:walk', { detail: { isWalking: true } }));
    return;
  }
  if (/تتوقف عن المشي|تثبت في مكانها|تقف\b|توقف\b/.test(a)) {
    window.dispatchEvent(new CustomEvent('avatar:walk', { detail: { isWalking: false } }));
    return;
  }

  // تلويح: ترحيب، وداع، تلويح، احتفال (Verona يستخدم تُلوِّح → بعد التجريد: تلوح)
  if (/تلوح|تلوح|ترحب|تودع|تلوي يدها|تلوح بيدها|بيدها بحماس/.test(a)) {
    waveArm('right', 1, 2);
    return;
  }
  // إشارة بالإصبع: تشير، توجه، بإصبعها (لكن ليس تومئ — إيماء ≠ إشارة)
  if (/تشير|تنبه|تلفت|تحدد|تؤشر|باصبعها|بإصبعها/.test(a)) {
    pointFinger('right', 1, 1.5);
    return;
  }
  // فتح الكف: تفتح (يدها / كفها / كفيها / ذراعيها)، تمد، تعرض، تُحرِّك ذراعيها للأمام
  if (/تفتح|تمد يدها|يدها مفتوحة|بكفيها|تعرض|ذراعيها.*للامام|لامام بلطف/.test(a)) {
    openHand('both', 0.9, 1.8);
    return;
  }
  // حركة إيقاعية: تضرب، تحرك يديها بشكل إيقاعي
  if (/تضرب|إيقاع|ايقاع|تحرك يديها|تطرطق|نبضات/.test(a)) {
    beatGesture('both', 0.7, 1.4);
    return;
  }
  // ميل/لف/تدوير الرأس — حركة التفاف رأس حقيقية
  if (/يميل راسه|يميل بالراس|يلف راسه|يلتفت|يدير راسه|ينظر جانباً/.test(a)) {
    // الاتجاه الافتراضي: يمين (يمكن تطويره لاحقاً)
    window.dispatchEvent(new CustomEvent('avatar:headturn', { detail: { direction: 'right', angle: 0.5, duration: 1.2 } }));
    return;
  }
  // إيماء برأسها / ابتسام / ميل رأسها — حركة خفيفة تشجيعية (beat بشدة منخفضة)
  if (/تومئ|تبتسم|تبتسم بلطف|برفق|تهز راسها|تومئ براسها/.test(a)) {
    beatGesture('right', 0.4, 1.2);
    return;
  }
  // تشجيع عام أو حركة ذراع → فتح الكف
  if (/تحرك|حركة|ذراع|يد/.test(a)) {
    openHand('right', 0.7, 1.5);
  }
}

// ─── Emotion Dispatcher ─────────────────────────────────────────────────────

/**
 * خريطة تحويل وسوم Verona إلى حالات عاطفة الأفاتار
 */
const VERONA_TO_AVATAR_EMOTION: Record<string, string> = {
  neutral:     'neutral',
  friendly:    'friendly',
  thinking:    'thinking',
  encouraging: 'encouraging',
  strict:      'strictEvaluation',
  celebrate:   'celebration',
};

/**
 * إرسال حدث عاطفة الأفاتار من وسم Verona
 * مثال: dispatchEmotion('friendly') → avatar:emotion { emotion: 'friendly' }
 */
export function dispatchEmotion(veronaEmotionTag: string): void {
  if (typeof window === 'undefined') return;
  const avatarEmotion = VERONA_TO_AVATAR_EMOTION[veronaEmotionTag.toLowerCase()] ?? 'neutral';
  window.dispatchEvent(
    new CustomEvent('avatar:emotion', {
      detail: { emotion: avatarEmotion },
    })
  );
}

// ─── Convenience: dispatch both gesture + emotion from parsed Verona response ──

export function applyVeronaResponse(action: string, emotion: string): void {
  dispatchEmotion(emotion);
  if (action) dispatchGestureFromActionText(action);
}

// ── Walking controls ────────────────────────────────────────────────────────

export interface MovementState {
  isWalking: boolean;
  walkPhase: number;
  walkSpeed: number;
}

/** Create a fresh MovementState with sensible defaults */
export function createMovementState(): MovementState {
  return {
    isWalking: false,
    walkPhase: 0,
    walkSpeed: 1.5, // ~0.67 s per full gait cycle (left-right-left)
  };
}

/** Dispatch avatar:walk to start walking animation */
export function startWalking(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('avatar:walk', { detail: { isWalking: true } }));
}

/** Dispatch avatar:walk to stop walking animation */
export function stopWalking(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('avatar:walk', { detail: { isWalking: false } }));
  window.dispatchEvent(new CustomEvent('avatar:stop'));
}

// ─── reactToUserInput — رد جسدي فوري على رسالة المستخدم ─────────────────────
/**
 * يُحلِّل رسالة المستخدم قبل إرسالها للـ API ويُطلق رد جسدي فوري من الأفاتار.
 * يُحاكي ردّ فعل الإنسان الطبيعي:
 *   تحية     → تلويح + ابتسامة
 *   شكر/مدح  → إيماء رأس + موافقة
 *   وداع     → تلويح وداعي هادئ
 *   سؤال     → وضعية تفكير
 *   نص طويل  → إيشارة استماع
 */
export function reactToUserInput(text: string): void {
  if (!text?.trim() || typeof window === 'undefined') return;
  const stripped = text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g, '');
  const dispatch = (type: string) =>
    window.dispatchEvent(new CustomEvent('avatar:userreact', { detail: { type } }));

  if (/السلام|وعليكم|مرحبا|اهلا|هلا والله|صباح|مساء|كيفك|كيف حالك|حياك/i.test(stripped)) {
    dispatch('greeting'); return;
  }
  if (/شكرا|شكراً|جزاك الله|ممتاز|رائع|احسنت|أحسنت|ماشاء الله|تسلم|برافو|واو/i.test(stripped)) {
    dispatch('praise'); return;
  }
  if (/مع السلامة|وداعا|وداعاً|الى اللقاء|باي|bye|إلى اللقاء/i.test(stripped)) {
    dispatch('farewell'); return;
  }
  if (/هل |لماذا |كيف |ماذا |ما هو|ما هي|من هو|أين |متى |كم |ما الفرق|ما معنى|اشرح|وضح/i.test(stripped) || /[؟?]/.test(text)) {
    dispatch('question'); return;
  }
  if (stripped.length > 40) {
    dispatch('listening');
  }
}

// ── خريطة ردود التحيات الجاهزة (بدون API) ───────────────────────────────────
export const GREETING_REPLIES: Record<string, string[]> = {
  salam: [
    'وعليكم السلام ورحمة الله! *تلوح بيدها بحرارة وتبتسم ابتسامة واسعة* [EMOTION: friendly]',
    'وعليكم السلام! *ترفع يدها وتلوح بحماس مع ابتسامة دافئة* [EMOTION: friendly]',
    'أهلاً وسهلاً! وعليكم السلام ورحمة الله وبركاته *تلوح بيدها وتومئ برأسها بود* [EMOTION: friendly]',
  ],
  marhaba: [
    'أهلاً وسهلاً! *تلوح بيدها بحرارة وتبتسم بترحيب* [EMOTION: friendly]',
    'مرحباً بك! *تفتح يدها بلطف وتبتسم* [EMOTION: friendly]',
    'هلا والله! *تلوح بحماس وتتأرجح بخفة من الفرح* [EMOTION: friendly]',
  ],
  morning: [
    'صباح النور والسرور! *تلوح بيدها وتبتسم بإشراق* [EMOTION: friendly]',
    'صباح الخير عليك! *تتأرجح بخفة وتلوح بيدها بدفء* [EMOTION: friendly]',
  ],
  evening: [
    'مساء النور عليك! *تلوح بيدها بهدوء وتبتسم بدفء* [EMOTION: friendly]',
    'مساء الخير! *تومئ برأسها بلطف وتبتسم* [EMOTION: friendly]',
  ],
  farewell: [
    'مع السلامة! *تلوح بيدها ببطء وتبتسم بدفء* [EMOTION: friendly]',
    'إلى اللقاء! أتمنى لك يوماً رائعاً *تلوح بيدها بحرارة* [EMOTION: friendly]',
    'في أمان الله! *تلوح بيدها وتومئ برأسها بلطف* [EMOTION: friendly]',
  ],
};

/** يختار رداً عشوائياً */
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
