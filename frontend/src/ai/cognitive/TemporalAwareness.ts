/**
 * TemporalAwareness — طبقة الوعي الزمني
 *
 * الإنسان الحقيقي يعرف:
 *   • الوقت من اليوم — وكيف يؤثر على الانتباه والطاقة
 *   • قرب الامتحان — ويرفع الأولوية بناءً عليه
 *   • مسار الطالب عبر الجلسات — التقدم أو التراجع
 *   • مدة الجلسة الحالية — يعرف متى يُنهي وأين يقف
 *   • أفضل وقت للتحدي ومتى يجب أن يُريح الطالب
 */

// ─── معلومات الوقت ─────────────────────────────────────────────────────────

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type SessionPhase = 'warmup' | 'core' | 'deepwork' | 'cooldown' | 'closing';
export type ExamProximity = 'far' | 'approaching' | 'imminent' | 'post';

export interface TemporalContext {
  timeOfDay:          TimeOfDay;
  sessionDurationMs:  number;
  sessionPhase:       SessionPhase;
  examProximity:      ExamProximity;
  daysToExam:         number | null;
  sessionTurnCount:   number;
  isFirstSession:     boolean;
  energyLevel:        number; // 0–1 estimated
  recommendation:     string;
  urgencyMessage:     string | null;
}

// ─── خريطة الطاقة عبر اليوم (Chronobiology Research) ────────────────────────

const ENERGY_BY_HOUR: Record<number, number> = {
  0: 0.2, 1: 0.1, 2: 0.1, 3: 0.15, 4: 0.2, 5: 0.35,
  6: 0.55, 7: 0.70, 8: 0.80, 9: 0.85, 10: 0.90, 11: 0.95,
  12: 0.75, 13: 0.65, 14: 0.70, 15: 0.80, 16: 0.85, 17: 0.80,
  18: 0.70, 19: 0.65, 20: 0.60, 21: 0.55, 22: 0.40, 23: 0.30,
};

// ─── رسائل الوعي الزمني للمعلم ───────────────────────────────────────────────

const EXAM_URGENCY_MESSAGES: Record<ExamProximity, string | null> = {
  far:          null,
  approaching:  'الامتحان بدأ يقترب — وقت نُسرّع',
  imminent:     'الامتحان قريب جداً — نركّز على الأهم أولاً',
  post:         'الامتحان انتهى — خليني نراجع ما تعلمناه ونبني للجولة القادمة',
};

const TIME_RECOMMENDATIONS: Record<TimeOfDay, string> = {
  morning:   'الصباح: وقت ممتاز للفهم العميق — الدماغ في قمته',
  afternoon: 'بعد الظهر: وقت جيد للتطبيق والأمثلة',
  evening:   'المساء: ركّز على المراجعة وترسيخ ما فهمته',
  night:     'الليل: جلسة مختصرة — المراجعة السريعة أفضل من الشرح الثقيل',
};

// ─── الوعي بمراحل الجلسة ─────────────────────────────────────────────────────

function getSessionPhase(turns: number, durationMs: number): SessionPhase {
  const minutes = durationMs / 60000;
  if (turns <= 2 || minutes < 3)      return 'warmup';
  if (turns <= 5 || minutes < 10)     return 'core';
  if (turns <= 12 || minutes < 25)    return 'deepwork';
  if (turns <= 16 || minutes < 35)    return 'cooldown';
  return 'closing';
}

// ─── المحرك الرئيسي ──────────────────────────────────────────────────────────

export class TemporalAwareness {
  private _sessionStartMs = Date.now();
  private _turnCount = 0;
  private _examDateMs: number | null = null;
  private _isFirstSession = true;

  setExamDate(dateMs: number): void {
    this._examDateMs = dateMs;
  }

  setNotFirstSession(): void {
    this._isFirstSession = false;
  }

  incrementTurn(): void {
    this._turnCount++;
  }

  reset(): void {
    this._sessionStartMs = Date.now();
    this._turnCount = 0;
  }

  /** الحصول على السياق الزمني الكامل */
  getContext(): TemporalContext {
    const now = new Date();
    const hour = now.getHours();
    const sessionDurationMs = Date.now() - this._sessionStartMs;

    const timeOfDay: TimeOfDay =
      hour >= 5 && hour < 12 ? 'morning'
      : hour >= 12 && hour < 17 ? 'afternoon'
      : hour >= 17 && hour < 21 ? 'evening'
      : 'night';

    const energyLevel = ENERGY_BY_HOUR[hour] ?? 0.5;
    const sessionPhase = getSessionPhase(this._turnCount, sessionDurationMs);

    let daysToExam: number | null = null;
    let examProximity: ExamProximity = 'far';
    if (this._examDateMs) {
      daysToExam = Math.round((this._examDateMs - Date.now()) / 86400000);
      if (daysToExam < 0)         examProximity = 'post';
      else if (daysToExam <= 3)   examProximity = 'imminent';
      else if (daysToExam <= 14)  examProximity = 'approaching';
    }

    return {
      timeOfDay,
      sessionDurationMs,
      sessionPhase,
      examProximity,
      daysToExam,
      sessionTurnCount: this._turnCount,
      isFirstSession:   this._isFirstSession,
      energyLevel,
      recommendation:   TIME_RECOMMENDATIONS[timeOfDay],
      urgencyMessage:   EXAM_URGENCY_MESSAGES[examProximity],
    };
  }

  /** توصية تدريسية بناءً على السياق الزمني */
  getTeachingRecommendation(ctx: TemporalContext): string {
    const parts: string[] = [];

    // Phase recommendations
    if (ctx.sessionPhase === 'warmup')
      parts.push('ابدأ بسؤال تفاعلي خفيف — لا تدخل في الشرح الثقيل بعد');
    else if (ctx.sessionPhase === 'deepwork')
      parts.push('الدماغ منتبه — هاد هو وقت الفهم العميق والتحدي');
    else if (ctx.sessionPhase === 'cooldown')
      parts.push('ابدأ بتلخيص ما تعلمناه — الدماغ بحاجة لترسيخ');
    else if (ctx.sessionPhase === 'closing')
      parts.push('وقت الإغلاق بنهاية قوية — خطاف للجلسة القادمة');

    // Energy level
    if (ctx.energyLevel < 0.4)
      parts.push('طاقة منخفضة — استخدم أسلوب القصة والمثال العملي لا الشرح النظري');
    else if (ctx.energyLevel > 0.8)
      parts.push('طاقة عالية — مثالي للتحدي والتفكير النقدي');

    // Exam urgency
    if (ctx.urgencyMessage)
      parts.push(ctx.urgencyMessage);

    // First session
    if (ctx.isFirstSession)
      parts.push('جلسة أولى — ركّز على بناء الثقة والعلاقة قبل المحتوى');

    return parts.join(' | ');
  }

  /** بناء suffix للـ LLM يعكس السياق الزمني */
  buildTemporalSuffix(ctx: TemporalContext): string {
    const durationMin = Math.round(ctx.sessionDurationMs / 60000);
    const parts: string[] = [
      `الوقت: ${ctx.timeOfDay} | الطاقة المتوقعة: ${Math.round(ctx.energyLevel * 100)}%`,
      `مرحلة الجلسة: ${ctx.sessionPhase} (${durationMin} دقيقة، ${ctx.sessionTurnCount} دور)`,
    ];
    if (ctx.urgencyMessage) parts.push(`⚡ عاجل: ${ctx.urgencyMessage}`);
    if (ctx.daysToExam !== null && ctx.daysToExam > 0)
      parts.push(`📅 الامتحان بعد ${ctx.daysToExam} يوم`);
    if (ctx.sessionPhase === 'closing')
      parts.push('⏰ أنهِ الجلسة بخطاف قوي وتشجيع حقيقي — Peak-End Rule');
    const rec = this.getTeachingRecommendation(ctx);
    if (rec) parts.push(`توجيه زمني: ${rec}`);

    return `\n=== السياق الزمني ===\n${parts.join('\n')}\n===`;
  }
}

export const temporalAwareness = new TemporalAwareness();
