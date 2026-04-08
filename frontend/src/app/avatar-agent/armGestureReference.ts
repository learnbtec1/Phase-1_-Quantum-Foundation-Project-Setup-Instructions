/**
 * مرجع واحد: وضعية الذراعين/الساعدين/المعصمين في idle + إزاحات كل إيماءة عنها.
 * يستورده VRMSkeletonManager و MouseGestureCalibrator — تعديل idle هنا يحدّث كل الإيماءات عند التركيب.
 */

export type ArmGestureId = 'explain' | 'point' | 'think' | 'clap' | 'wave' | 'agree';

/** أويلر محلي YXZ لكل عظمة (نفس ترتيب slerpArmEuler في VRMSkeletonManager). */
export type ArmEulerOffset = {
  ruaX: number;
  ruaY: number;
  ruaZ: number;
  luaX: number;
  luaY: number;
  luaZ: number;
  rlaX: number;
  rlaZ: number;
  llaX: number;
  llaZ: number;
  rhX: number;
  rhY: number;
  rhZ: number;
  lhX: number;
  lhY: number;
  lhZ: number;
};

export const ARM_IDLE: ArmEulerOffset = {
  ruaX: 0.0,
  ruaY: 0.0,
  ruaZ: 1.4,
  luaX: 0.0,
  luaY: 0.0,
  luaZ: -1.4,
  rlaX: 0.08,
  rlaZ: 0.0,
  llaX: 0.08,
  llaZ: 0.0,
  rhX: 0.0,
  rhY: 0.0,
  rhZ: 0.0,
  lhX: 0.0,
  lhY: 0.0,
  lhZ: 0.0,
};

/**
 * إزاحات عن ARM_IDLE (المطلق السابق − idle).
 * clap: يطابق الوضعية الأمامية المبسّطة الحالية في VRMSkeletonManager.
 */
/**
 * إزاحات IK — مُشتقّة من وضعية think (المرجع المعتمد، يد اليمين قرب الذقن):
 *   think: ruaX=+0.64 (إلى الأمام)، ruaY=+0.91 (دوران داخلي)، ruaZ=1.133 (قليلاً مرفوع)، rlaZ=0.79 (كوع مثني)
 * محاور المعصم: X+ = إلى الأمام، ruaZ=1.4 → تدلّي، ruaZ↓ → ذراع مرفوعة.
 * المرايا للذراع الأيسر: luaX = ±ruaX، luaY = −ruaY، luaZ = −ruaZ.
 */
export const ARM_OFFSETS: Record<ArmGestureId, ArmEulerOffset> = {
  /**
   * explain — كلا الذراعين إلى الأمام على مستوى الصدر، كفان مفتوحتان.
   * IK: من think (يد عند الذقن)، قلّل الدوران الداخلي (Y: 0.91→0.15)،
   *      ارفع الذراع أكثر (ruaZ offset: -0.65 → مُركَّب 0.75 rad)،
   *      كوع نصف-مثني (rlaZ: 0.50).
   */
  explain: {
    ruaX:  0.50,  // إلى الأمام (X+ = أمام، مثبت من think)
    ruaY:  0.15,  // دوران داخلي خفيف
    ruaZ: -0.65,  // مُركَّب = 1.4-0.65 = 0.75 (مستوى الصدر/الكتف)
    luaX:  0.50,  // نفس الأمام
    luaY: -0.15,  // مرآة
    luaZ:  0.65,  // مُركَّب = -1.4+0.65 = -0.75
    rlaX: -0.03,
    rlaZ:  0.50,  // كوع مثني ≈29°
    llaX: -0.03,
    llaZ: -0.50,  // مرآة
    rhX:   0.25,  // معصم منحنٍ قليلاً (كف مفتوح)
    rhY:   0.08,
    rhZ:  -0.25,
    lhX:   0.25,
    lhY:  -0.08,
    lhZ:   0.25,  // مرآة
  },
  /**
   * point — الذراع اليمنى ممتدة إلى الأمام، مفتوحة تقريباً، أصبع السبابة للأمام.
   * IK: رفع ذروي (ruaZ: -1.30 → مُركَّب 0.10 ≈ أفقي)، بلا دوران داخلي،
   *      ساعد شبه مستقيم (rlaZ: -0.20).
   * الذراع اليسرى: تبقى عند idle.
   */
  point: {
    ruaX:  1.40,  // قوة أمامية (يد منبسطة إلى الأمام)
    ruaY:  0.00,
    ruaZ: -1.30,  // مُركَّب = 0.10 (أفقي تقريباً، يد على مستوى الكتف)
    luaX:  0.00,  // يسار عند idle
    luaY:  0.00,
    luaZ:  0.00,
    rlaX: -0.08,
    rlaZ: -0.20,  // ساعد شبه مستقيم
    llaX: -0.08,
    llaZ:  0.00,
    rhX:   0.10,
    rhY:   0.00,
    rhZ:  -0.15,
    lhX:   0.00,
    lhY:   0.00,
    lhZ:   0.00,
  },
  /** think — مرجع معتمد (يد اليمين قرب الذقن). لا تعدّل هذه القيم. */
  think: {
    ruaX:  0.6379,
    ruaY:  0.9114,
    ruaZ: -0.267,
    luaX: -0.0517,
    luaY:  0.5104,
    luaZ:  0.082,
    rlaX:  0.7971,
    rlaZ:  0.7888,
    llaX: -1.4619,
    llaZ: -1.3574,
    rhX:   0.3678,
    rhY:  -0.2189,
    rhZ:  -0.2274,
    lhX:  -0.1787,
    lhY:   0.1313,
    lhZ:   0.0649,
  },
  /**
   * clap — كلا اليدين تلتقيان أمام الصدر.
   * IK: من think (يد عند المركز-الذقن) قلّل الدوران الداخلي (Y: 0.91→0.75)،
   *      اخفض قليلاً (ruaZ offset: -0.40 → مُركَّب 1.00)،
   *      كوع أكثر انثناءً (rlaZ: 0.90) لتلاقي اليدين.
   */
  clap: {
    ruaX:  0.55,  // إلى الأمام
    ruaY:  0.75,  // دوران داخلي قوي (يد نحو المنتصف)
    ruaZ: -0.40,  // مُركَّب = 1.00 (مستوى الصدر)
    luaX:  0.55,  // مرآة
    luaY: -0.75,
    luaZ:  0.40,  // مُركَّب = -1.00
    rlaX: -0.08,
    rlaZ:  0.90,  // كوع مثني كثيراً (يد للأمام عند المنتصف)
    llaX: -0.08,
    llaZ: -0.90,  // مرآة
    rhX:   0.10,
    rhY:   0.00,
    rhZ:   0.00,
    lhX:   0.10,
    lhY:   0.00,
    lhZ:   0.00,
  },
  /**
   * wave — الذراع اليمنى مرفوعة للتلويح، الأيسرى عند idle.
   * IK: رفع الذراع (ruaZ offset: -0.60 → مُركَّب 0.80)،
   *      دوران خارجي خفيف (ruaY: -0.45) لدفع الذراع جانباً+أمام،
   *      كوع مثني (rlaZ: 0.85).
   */
  wave: {
    ruaX:  0.70,  // إلى الأمام
    ruaY: -0.45,  // دوران خارجي (يد للجانب + أعلى)
    ruaZ: -0.60,  // مُركَّب = 0.80 (ذراع مرفوعة بوضوح)
    luaX:  0.00,  // يسار عند idle
    luaY:  0.00,
    luaZ:  0.00,
    rlaX:  0.28,
    rlaZ:  0.85,  // كوع مثني للتلويح
    llaX: -0.08,
    llaZ:  0.00,
    rhX:   0.10,
    rhY:  -0.15,
    rhZ:  -0.40,  // معصم مدوّر للتلويح
    lhX:   0.00,
    lhY:   0.00,
    lhZ:   0.00,
  },
  /**
   * agree — كلا الذراعين إلى الأمام بهدوء على مستوى البطن/الصدر، كفان مفتوحتان.
   * IK: من think، قلّل كل شيء (ruaX: 0.35، ruaY: 0.05، ruaZ offset: -0.35 → مُركَّب 1.05)،
   *      كوع شبه مستقيم (rlaZ: 0.18).
   */
  agree: {
    ruaX:  0.35,
    ruaY:  0.05,
    ruaZ: -0.35,  // مُركَّب = 1.05 (رفع خفيف من idle 1.4)
    luaX:  0.35,
    luaY: -0.05,
    luaZ:  0.35,  // مُركَّب = -1.05
    rlaX: -0.08,
    rlaZ:  0.18,
    llaX: -0.08,
    llaZ: -0.18,
    rhX:   0.08,
    rhY:   0.00,
    rhZ:   0.00,
    lhX:   0.08,
    lhY:   0.00,
    lhZ:   0.00,
  },
};

export function composeArmTargets(offset: ArmEulerOffset): ArmEulerOffset {
  return {
    ruaX: ARM_IDLE.ruaX + offset.ruaX,
    ruaY: ARM_IDLE.ruaY + offset.ruaY,
    ruaZ: ARM_IDLE.ruaZ + offset.ruaZ,
    luaX: ARM_IDLE.luaX + offset.luaX,
    luaY: ARM_IDLE.luaY + offset.luaY,
    luaZ: ARM_IDLE.luaZ + offset.luaZ,
    rlaX: ARM_IDLE.rlaX + offset.rlaX,
    rlaZ: ARM_IDLE.rlaZ + offset.rlaZ,
    llaX: ARM_IDLE.llaX + offset.llaX,
    llaZ: ARM_IDLE.llaZ + offset.llaZ,
    rhX: ARM_IDLE.rhX + offset.rhX,
    rhY: ARM_IDLE.rhY + offset.rhY,
    rhZ: ARM_IDLE.rhZ + offset.rhZ,
    lhX: ARM_IDLE.lhX + offset.lhX,
    lhY: ARM_IDLE.lhY + offset.lhY,
    lhZ: ARM_IDLE.lhZ + offset.lhZ,
  };
}

export const MOUSE_CALIB_LS_KEY = 'mouse-gesture-arm-offsets-v1';
