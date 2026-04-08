import { create } from 'zustand';

export interface AvatarConfig {
  /** هل يمشي الأفاتار في مكانه (تحريك الساقين)؟ */
  isWalking: boolean;
  /** سعة التمايل الجانبي للجسم */
  idleSwayAmount: number;
  /** هل يُسمح بتحريك الكاميرا بالزوم حول الأفاتار؟ */
  zoomEnabled: boolean;
}

export interface AvatarConfigStore {
  /** الإعدادات الحالية */
  config: AvatarConfig;
  /** الإعدادات الافتراضية (الحالة الحالية التي نريد القدرة على الرجوع لها) */
  defaults: AvatarConfig;
  /** تعيين إعدادات جديدة (يتم دمجها مع الحالية) */
  setConfig: (partial: Partial<AvatarConfig>) => void;
  /** إعادة كل الإعدادات إلى الافتراضية كما هي الآن */
  resetToDefaults: () => void;
}

export const AVATAR_CONFIG_DEFAULTS: AvatarConfig = {
  // افتراضياً: لا يمشي حتى يطلب المستخدم ذلك صراحةً عبر الدردشة
  isWalking: false,
  idleSwayAmount: 0.08,
  zoomEnabled: true,
};

export const useAvatarConfigStore = create<AvatarConfigStore>((set, get) => ({
  config: AVATAR_CONFIG_DEFAULTS,
  defaults: AVATAR_CONFIG_DEFAULTS,
  setConfig: (partial) =>
    set((state) => ({
      config: { ...state.config, ...partial },
    })),
  resetToDefaults: () =>
    set((state) => ({
      config: { ...state.defaults },
    })),
}));

/** Deep clone for per-user server defaults (BFF /api/avatar-config). */
export function cloneAvatarConfigDefaults(): AvatarConfig {
  return { ...AVATAR_CONFIG_DEFAULTS };
}

