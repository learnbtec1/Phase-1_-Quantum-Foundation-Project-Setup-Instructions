/**
 * IntuitionEngine — طبقة الحدس والفراسة للمعلم الرقمي
 *
 * ═══════════════════════════════════════════════════════════════════
 * الحدس البشري = تراكم أنماط محفوظة + استدلال ضمني
 * هذا المحرك يُحاكي ذلك عبر:
 *   1. تحليل الأنماط اللغوية الخفية في كلام الطالب
 *   2. كشف الإرباك قبل أن يُصرَّح به
 *   3. التنبؤ بالسؤال التالي قبل طرحه
 *   4. قراءة المزاج من طريقة الكتابة لا من المحتوى فقط
 *   5. استنتاج نقاط الضعف من ما لم يُقَل
 *
 * مصادر بحثية:
 *   • Klein's Naturalistic Decision Making (تحليل الأنماط الضمنية)
 *   • Kahneman's System 1/2 (سرعة الاستجابة الحدسية)
 *   • Linguistics: sentiment + uncertainty markers
 * ═══════════════════════════════════════════════════════════════════
 */

import type { EmotionLabel } from '@/types/ai';
import { useBrainStore } from '@/store/useBrainStore';

// ─── نتيجة الحدس ────────────────────────────────────────────────────────────

export interface IntuitionReading {
  /** درجة الثقة في الحدس (0–1) */
  confidence: number;

  /** الحالة العاطفية المُستنتجة ضمنياً */
  inferredEmotion: EmotionLabel;

  /** نقطة الضعف المخفية (إن وُجدت) */
  hiddenWeakness?: string;

  /** ما يريده الطالب فعلاً (لا ما سأل عنه) */
  realNeed?: string;

  /** السؤال المتوقع التالي */
  predictedNextQuestion?: string;

  /** مستوى اليقين في الفهم (0–1) */
  comprehensionConfidence: number;

  /** علامات التوتر/الضغط */
  stressSignals: StressSignal[];

  /** نمط الطالب المُكتشَف */
  studentPattern: StudentPattern;

  /** توصية الفراسة للمعلم */
  physiognomyAdvice: string;
}

export type StressSignal =
  | 'short_messages'     // رسائل قصيرة جداً = إحباط أو تسرّع
  | 'repeated_question'  // يكرر نفس السؤال = ما فهم فعلاً
  | 'hedging_language'   // "ربما / أعتقد / مش متأكد" = ضعف ثقة
  | 'over_explaining'    // يشرح أكثر مما يجب = يحاول يثبت نفسه
  | 'deflection'         // يغيّر الموضوع = لا يريد الإجابة
  | 'passive_voice'      // صياغة مبنية للمجهول = عدم ملكية الفكرة
  | 'question_flooding'  // أسئلة كثيرة متتالية = ارتباك عميق
  | 'silence_signal'     // رسالة قصيرة جداً بعد سؤال صعب
  | 'copy_paste_style';  // يبدو كأنه نسخ من مصدر

export type StudentPattern =
  | 'visual_learner'     // يطلب رسوم بيانية وتشبيهات
  | 'analytical_thinker' // يريد البنية والمنطق
  | 'social_learner'     // يتعلم من المناقشة
  | 'perfectionist'      // يتوقع إجابات مثالية
  | 'rushed_learner'     // يريد الجواب السريع
  | 'deep_diver'         // يريد الفهم الجذري
  | 'anxious_learner'    // خائف من الغلط
  | 'confident_explorer' // يجرب ويخطئ بثقة
  | 'unknown';

// ─── علامات الحدس اللغوي ─────────────────────────────────────────────────────

const HEDGING_PATTERNS = /ربما|أعتقد|مش متأكد|يمكن|بالنسبة لي|في رأيي|هيك بشوف|مش عارف|maybe|perhaps|i think|not sure|i guess|ممكن يكون/i;
const DEFLECTION_PATTERNS = /بس السؤال التاني|خليني أسأل|موضوع ثاني|بدي أفهم شي ثاني|على فكرة|لأ بس/i;
const CONFUSION_DEEP = /شو الفرق|ليش هيك|كيف يعني|مش فاهم كيف|بشرح تاني|ما بفهم|ما واضح|confused|what's the difference/i;
const COPY_PASTE_MARKERS = /^[A-Z].*\.$|according to|as stated|the concept of|refers to/i;
const ARABIC_FORMAL_EXCESSIVE = /يُشير إلى|يُعرَّف بأنه|وفقاً لـ|تجدر الإشارة/;
const OVER_EXPLAINING = (text: string): boolean => text.length > 400 && text.split('.').length > 5;
const QUESTION_FLOODING = (msgs: string[]): boolean => msgs.filter(m => m.includes('?') || m.includes('؟')).length >= 3;

// ─── الفراسة: خارطة الأنماط → توجيه ─────────────────────────────────────────

const PATTERN_ADVICE: Record<StudentPattern, string> = {
  visual_learner:     'استخدم تشبيهات بصرية — ارسم الفكرة بالكلام: "تخيّل إنك شايف..."',
  analytical_thinker: 'قدّم البنية أولاً — الهيكل العام ثم التفاصيل: "البناء هو: أولاً...ثانياً..."',
  social_learner:     'اجعله يشرح لك — "شو رأيك إيش كان ممكن يعمل؟"',
  perfectionist:      'طمّنه إن الغلط مقبول — "حتى المتخصصين بيخطئون هون"',
  rushed_learner:     'أبطئه — "الإجابة الصح أهم من الإجابة السريعة"',
  deep_diver:         'أشبع فضوله — ثم اربطه بالمعيار: "وهاد بيؤدي إلى..."',
  anxious_learner:    'أمّنه أولاً — "مكان آمن هون، كل سؤال مقبول"',
  confident_explorer: 'تحدّه — "طيّب، أعطيني مثالاً لم أذكره أنا"',
  unknown:            'لاحظ واستمع — دع الأنماط تتشكل قبل الحكم',
};

// ─── المحرك الرئيسي ──────────────────────────────────────────────────────────

export class IntuitionEngine {
  private _patternHistory: Map<StudentPattern, number> = new Map();
  private _conversationPatterns: string[] = [];
  private _lastReading: IntuitionReading | null = null;
  private _sessionStartMs = Date.now();

  /** الحدس الكامل على رسالة الطالب */
  read(userMessage: string, conversationHistory?: string[]): IntuitionReading {
    const msg = (userMessage || '').trim();
    const history = conversationHistory ?? [];
    this._conversationPatterns.push(msg);

    const stressSignals = this._detectStressSignals(msg, history);
    const comprehensionConfidence = this._estimateComprehension(msg, stressSignals);
    const studentPattern = this._inferPattern(msg, history);
    const inferredEmotion = this._inferEmotion(msg, stressSignals);
    const hiddenWeakness = this._detectHiddenWeakness(msg, history);
    const realNeed = this._inferRealNeed(msg, hiddenWeakness, stressSignals);
    const predictedNextQuestion = this._predictNextQuestion(msg, history);
    const confidence = this._scoreConfidence(stressSignals, comprehensionConfidence, msg.length);
    const physiognomyAdvice = PATTERN_ADVICE[studentPattern];

    const reading: IntuitionReading = {
      confidence,
      inferredEmotion,
      hiddenWeakness,
      realNeed,
      predictedNextQuestion,
      comprehensionConfidence,
      stressSignals,
      studentPattern,
      physiognomyAdvice,
    };

    this._lastReading = reading;
    this._updatePatternHistory(studentPattern);
    return reading;
  }

  /** الفراسة: النمط الغالب للطالب عبر الجلسة */
  getDominantPattern(): StudentPattern {
    let max = 0;
    let dominant: StudentPattern = 'unknown';
    this._patternHistory.forEach((count, pattern) => {
      if (count > max) { max = count; dominant = pattern; }
    });
    return dominant;
  }

  getLastReading(): IntuitionReading | null {
    return this._lastReading;
  }

  reset(): void {
    this._patternHistory.clear();
    this._conversationPatterns = [];
    this._lastReading = null;
    this._sessionStartMs = Date.now();
  }

  // ── خوارزميات الكشف ──────────────────────────────────────────────────────

  private _detectStressSignals(msg: string, history: string[]): StressSignal[] {
    const signals: StressSignal[] = [];
    if (msg.length < 15 && msg.includes('؟')) signals.push('short_messages');
    if (HEDGING_PATTERNS.test(msg))           signals.push('hedging_language');
    if (DEFLECTION_PATTERNS.test(msg))        signals.push('deflection');
    if (COPY_PASTE_MARKERS.test(msg) || ARABIC_FORMAL_EXCESSIVE.test(msg)) signals.push('copy_paste_style');
    if (OVER_EXPLAINING(msg))                 signals.push('over_explaining');
    if (QUESTION_FLOODING([...history, msg]))  signals.push('question_flooding');
    // Repeated question = same keywords appear 2+ times in last 4 msgs
    const recent = [...history.slice(-3), msg];
    const allText = recent.join(' ').toLowerCase();
    const keywords = msg.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const repeated = keywords.some(k => (allText.match(new RegExp(k, 'g')) ?? []).length >= 3);
    if (repeated) signals.push('repeated_question');
    return signals;
  }

  private _estimateComprehension(msg: string, signals: StressSignal[]): number {
    let score = 0.7; // baseline
    if (signals.includes('hedging_language'))  score -= 0.20;
    if (signals.includes('repeated_question')) score -= 0.25;
    if (signals.includes('copy_paste_style'))  score -= 0.30;
    if (signals.includes('question_flooding')) score -= 0.15;
    if (CONFUSION_DEEP.test(msg))              score -= 0.20;
    // Positive signals
    if (msg.length > 80 && !signals.includes('copy_paste_style')) score += 0.10;
    if (/بالضبط|عرفت|فهمت|واضح|clear|got it/.test(msg)) score += 0.20;
    return Math.max(0.05, Math.min(1, score));
  }

  private _inferPattern(msg: string, history: string[]): StudentPattern {
    const scores: Partial<Record<StudentPattern, number>> = {};
    const addScore = (p: StudentPattern, v: number) => { scores[p] = (scores[p] ?? 0) + v; };
    if (/مثل|مثال|تشبيه|صورة|رسم|كيف يبدو|تخيّل/.test(msg)) addScore('visual_learner', 2);
    if (/ليش|سبب|منطق|كيف يشتغل|من الأساس|structure|logic/.test(msg)) addScore('analytical_thinker', 2);
    if (/رأيك|شو بتفكر|بيختلف|حكينا|اتفق/.test(msg)) addScore('social_learner', 2);
    if (/صح|مظبوط|أكيد|تأكيد|sure|correct|accurate/.test(msg)) addScore('perfectionist', 2);
    if (msg.length < 20 && (msg.includes('؟') || msg.includes('?'))) addScore('rushed_learner', 2);
    if (/لماذا أصلاً|من أين جاء|الأصل|historically|deep/.test(msg)) addScore('deep_diver', 2);
    if (HEDGING_PATTERNS.test(msg)) addScore('anxious_learner', 2);
    if (/جرّبت|اقترح|ممكن نعمل|what if|let me try/.test(msg)) addScore('confident_explorer', 2);
    // History contribution
    const histStr = history.join(' ');
    if ((histStr.match(/تشبيه|مثال/g) ?? []).length > 2) addScore('visual_learner', 1);
    if ((histStr.match(/ليش|لماذا/g) ?? []).length > 3) addScore('analytical_thinker', 1);

    let best: StudentPattern = 'unknown';
    let bestScore = 0;
    (Object.keys(scores) as StudentPattern[]).forEach(k => {
      if ((scores[k] ?? 0) > bestScore) { bestScore = scores[k] ?? 0; best = k; }
    });
    return best;
  }

  private _inferEmotion(msg: string, signals: StressSignal[]): EmotionLabel {
    if (/!|يا سلام|رائع|ممتاز|عظيم|فخور|نجحت/.test(msg)) return 'excited';
    if (/ما فهمت|مش واضح|confused|صعب جداً/.test(msg)) return 'concerned';
    if (signals.includes('hedging_language') || signals.includes('question_flooding')) return 'anxious';
    if (/شكراً|مشكور|عفارم|thank/.test(msg)) return 'happy';
    if (/ما أقدر|صعب|يصعب|can't|impossible|hard/.test(msg)) return 'sad';
    if (/مش عارف ليش|بستغرب|عجيب|weird/.test(msg)) return 'surprised';
    if (/بدي أفهم|أيش يعني|what does|explain/.test(msg)) return 'curious';
    return 'neutral';
  }

  private _detectHiddenWeakness(msg: string, history: string[]): string | undefined {
    const all = [...history, msg].join(' ').toLowerCase();
    if (/swot.*pestle|pestle.*swot/.test(all) && CONFUSION_DEEP.test(msg))
      return 'يخلط بين SWOT (داخلي/خارجي) وPESTLE (خارجي فقط)';
    if (/pass.*merit|merit.*pass/.test(msg) && HEDGING_PATTERNS.test(msg))
      return 'لا يفهم الفرق النوعي بين P/M/D — يعتقده كمّي فقط';
    if (/مثال|example/.test(msg) && (all.match(/مثال/g) ?? []).length > 3)
      return 'يطلب أمثلة كثيرة = لا يثق بفهمه الذاتي للمفهوم';
    if (COPY_PASTE_MARKERS.test(msg))
      return 'يحفظ ولا يفهم — يحتاج تكسير الحفظ وبناء الفهم';
    if (signals_check(msg, ['hedging_language', 'repeated_question']))
      return 'عدم ثقة بالنفس يمنعه من الإجابة برغم امتلاكه المعلومة';
    return undefined;

    function signals_check(m: string, sigs: StressSignal[]): boolean {
      return HEDGING_PATTERNS.test(m) && m.includes('؟');
    }
  }

  private _inferRealNeed(
    msg: string,
    hiddenWeakness?: string,
    signals?: StressSignal[],
  ): string | undefined {
    if (hiddenWeakness) return `معالجة: ${hiddenWeakness}`;
    if (signals?.includes('copy_paste_style')) return 'إعادة بناء الفهم الحقيقي من الصفر';
    if (signals?.includes('anxious_learner' as StressSignal)) return 'بناء الثقة قبل المحتوى';
    if (/give me|أعطيني|أريد الإجابة|الحل مباشرة/.test(msg))
      return 'الطالب مُرهَق — قد يحتاج تبسيطاً كبيراً أو استراحة مفاهيمية';
    return undefined;
  }

  private _predictNextQuestion(msg: string, history: string[]): string | undefined {
    if (/swot/i.test(msg) && !/pestle/i.test(msg))
      return 'على الأرجح سيسأل: "وشو الفرق عن PESTLE؟"';
    if (/pass/i.test(msg) && !/merit/i.test(msg))
      return 'على الأرجح سيسأل: "كيف أرفع الدرجة للـ Merit؟"';
    if (/مثال/i.test(msg))
      return 'على الأرجح سيطلب: "أعطيني مثالاً ثانياً"';
    if (CONFUSION_DEEP.test(msg))
      return 'على الأرجح سيسأل: "طيّب — كيف أطبّق هاد في مهمتي؟"';
    return undefined;
  }

  private _scoreConfidence(signals: StressSignal[], comprehension: number, msgLen: number): number {
    let c = 0.5 + comprehension * 0.3;
    if (msgLen > 60) c += 0.1;
    if (signals.length === 0) c += 0.15;
    if (signals.length > 3) c -= 0.2;
    return Math.max(0.1, Math.min(1, c));
  }

  private _updatePatternHistory(pattern: StudentPattern): void {
    this._patternHistory.set(pattern, (this._patternHistory.get(pattern) ?? 0) + 1);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────
export const intuitionEngine = new IntuitionEngine();

/** طبقة الفراسة: توصيف مختصر للمعلم عن الطالب */
export function getPhysiognomySummary(reading: IntuitionReading): string {
  const lines: string[] = [];
  if (reading.hiddenWeakness) lines.push(`⚠️ ضعف خفي: ${reading.hiddenWeakness}`);
  if (reading.realNeed)       lines.push(`🎯 الحاجة الحقيقية: ${reading.realNeed}`);
  if (reading.predictedNextQuestion) lines.push(`🔮 السؤال التالي المتوقع: ${reading.predictedNextQuestion}`);
  if (reading.stressSignals.length > 0)
    lines.push(`📡 علامات ضغط: ${reading.stressSignals.join(', ')}`);
  lines.push(`🎭 نمط التعلم: ${reading.studentPattern} (ثقة ${Math.round(reading.confidence * 100)}%)`);
  lines.push(`💡 نصيحة الفراسة: ${reading.physiognomyAdvice}`);
  return lines.join('\n');
}
