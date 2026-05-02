/**
 * TeachingStrategyEngine — منظومة الاستراتيجيات التدريسية
 *
 * مبنية على أحدث الأبحاث العالمية:
 *   • Hattie's Visible Learning (2024) — أكبر بحث تعليمي في العالم (130,000 دراسة، 400M طالب)
 *   • Vygotsky's Zone of Proximal Development (ZPD)
 *   • Carol Dweck's Growth Mindset Theory
 *   • Bloom's Mastery Learning (effect size d=2.0)
 *   • BTEC Criterion-Referenced Assessment Framework (Pearson 2024)
 *   • Socratic AI Tutoring (Georgia Tech 2025)
 *   • Cognitive Load Theory (Sweller)
 *   • Spaced Repetition & Retrieval Practice (Ebbinghaus + Roediger)
 *
 * 18 استراتيجية مصنّفة حسب: مستوى الطالب، نوع التحدي، المرحلة في BTEC (P/M/D)
 */

import { PRIORITY } from '@/constants/gestures';
import type { EmotionLabel } from '@/types/ai';

// ─── أنواع البيانات ──────────────────────────────────────────────────────────

export type StudentLevel = 'struggling' | 'developing' | 'achieving' | 'excelling';
export type StudentState = 'confused' | 'engaged' | 'bored' | 'frustrated' | 'progressing' | 'neutral';
export type BtecTarget = 'pass' | 'merit' | 'distinction' | 'unknown';
export type LearningMoment =
  | 'error_made'          // الطالب أخطأ
  | 'question_asked'      // الطالب سأل
  | 'correct_answer'      // الطالب أصاب
  | 'silence_prolonged'   // صمت طويل
  | 'confusion_signal'    // إشارات إرباك
  | 'frustration_signal'  // إشارات إحباط
  | 'breakthrough'        // لحظة فهم
  | 'criterion_attempt'   // حاول المعيار
  | 'new_topic'           // موضوع جديد
  | 'session_start'       // بداية الجلسة
  | 'revision_needed'     // يحتاج مراجعة
  | 'praise_moment';      // لحظة تشجيع

// ─── تعريف الاستراتيجية ─────────────────────────────────────────────────────

export interface TeachingStrategy {
  /** معرّف فريد */
  id: string;
  /** اسم الاستراتيجية */
  name: string;
  /** الوصف الموجز */
  description: string;
  /** حجم التأثير البحثي (Hattie d-score) */
  effectSize: number;
  /** المستويات التي تناسبها */
  targetLevels: StudentLevel[];
  /** المواقف التي تُفعَّل فيها */
  triggers: LearningMoment[];
  /** هدف BTEC المناسب */
  btecTargets?: BtecTarget[];
  /** الإيماءة المثلى للأفاتار */
  avatarGesture: string;
  /** المشاعر المصاحبة */
  avatarEmotion: EmotionLabel;
  /** الاتجاه النظري للسؤال الذي يطرحه المعلم */
  teacherPromptTemplate: string;
  /** تعليمات الجسم/الصوت */
  bodyLanguage: {
    gesture: string;
    gazeTarget: 'user' | 'think' | 'away';
    movementEnergy: number; // 0–1
    blinkStyle: 'slow' | 'normal';
  };
  /** مدة التطبيق المثالية (ثوانٍ) */
  durationSec: number;
}

// ─── المنظومة الكاملة: 18 استراتيجية عالمية ─────────────────────────────────

export const TEACHING_STRATEGIES: TeachingStrategy[] = [

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 1: السقالات التعليمية (Scaffolded Instruction)
  // Vygotsky ZPD — d=0.82 ← أعلى تأثير في الأبحاث
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'scaffolding_zpd',
    name: 'السقالات التعليمية — ZPD',
    description: 'ابدأ من ما يعرفه الطالب وارفع التحدي تدريجياً حتى حافة قدرته',
    effectSize: 0.82,
    targetLevels: ['struggling', 'developing'],
    triggers: ['confusion_signal', 'error_made', 'new_topic', 'question_asked'],
    btecTargets: ['pass', 'merit'],
    avatarGesture: 'explain',
    avatarEmotion: 'encouraging',
    teacherPromptTemplate: `
    طبّق استراتيجية السقالات التعليمية:
    1. ابدأ بسؤال: "شو اللي تعرفه عن {{topic}} من قبل؟"
    2. ابنِ على ما ذكره: "تمام! هاد أساس قوي — الخطوة التالية هي..."
    3. قسّم الفكرة لخطوات صغيرة: أولاً → ثانياً → ثالثاً
    4. أعطِ مثالاً بسيطاً أولاً ثم مثالاً معقداً
    5. بعد كل خطوة: "وين وصلنا؟ شو اللي فهمته لهلأ؟"
    `,
    bodyLanguage: { gesture: 'explain', gazeTarget: 'user', movementEnergy: 0.6, blinkStyle: 'normal' },
    durationSec: 90,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 2: الحوار السقراطي (Socratic Questioning)
  // Georgia Tech 2025: أهم اكتشاف في الذكاء الاصطناعي التعليمي — d=0.82
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'socratic_method',
    name: 'الحوار السقراطي',
    description: 'لا تعطِ الإجابة أبداً — اقودها بأسئلة تصاعدية حتى يكتشف الطالب الحقيقة بنفسه',
    effectSize: 0.82,
    targetLevels: ['developing', 'achieving', 'excelling'],
    triggers: ['question_asked', 'confusion_signal', 'criterion_attempt'],
    btecTargets: ['merit', 'distinction'],
    avatarGesture: 'think',
    avatarEmotion: 'curious',
    teacherPromptTemplate: `
    طبّق الحوار السقراطي — لا تعطِ الإجابة مباشرة:
    سؤال 1 (استكشاف): "شو بتتوقع يحدث لو..."
    سؤال 2 (تعمق): "وليش بالضبط؟ شو اللي يثبت هاد؟"
    سؤال 3 (تحدي): "بس لو كان X موجود — بتعتقد نفس الجواب؟"
    سؤال 4 (توليف): "كيف بتوصل هاد لـ BTEC {{criterion}}؟"
    تذكر: الغاية هي أن يقول الطالب الإجابة هو، مش أنت.
    `,
    bodyLanguage: { gesture: 'think', gazeTarget: 'think', movementEnergy: 0.5, blinkStyle: 'slow' },
    durationSec: 120,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 3: التغذية الراجعة الفورية (Immediate Feedback)
  // Hattie: d=0.70–0.79 ← أقوى استراتيجية منفردة في كل الأبحاث
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'formative_feedback',
    name: 'التغذية الراجعة الفورية',
    description: 'تغذية راجعة محددة، فورية، وذات توجيه للتطوير — أقوى أداة تعليمية موجودة',
    effectSize: 0.79,
    targetLevels: ['struggling', 'developing', 'achieving', 'excelling'],
    triggers: ['error_made', 'criterion_attempt', 'correct_answer', 'question_asked'],
    btecTargets: ['pass', 'merit', 'distinction'],
    avatarGesture: 'point',
    avatarEmotion: 'encouraging',
    teacherPromptTemplate: `
    قدّم تغذية راجعة وفق صيغة WWW+EBI:
    What Went Well (إيش انحكى صح):
    - "صح جداً أنك قلت {{correct_part}}"
    Even Better If (وشو لو أضفنا):  
    - "لو أضفت {{missing_element}} — بيصير الجواب أقوى بكثير"
    Next step (الخطوة):
    - "بتقدر تجرب تكتب {{specific_action}}؟"
    لا تستخدم كلمات: "خطأ / غلط / لا" — استخدم: "قريب / تقريباً / بس لو..."
    `,
    bodyLanguage: { gesture: 'point', gazeTarget: 'user', movementEnergy: 0.7, blinkStyle: 'normal' },
    durationSec: 60,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 4: التعلم التحصيلي (Mastery Learning)
  // Bloom 1984: d=2.0 ← أعلى تأثير موثّق في التاريخ لمنهج واحد
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'mastery_learning',
    name: 'التعلم التحصيلي — Mastery',
    description: 'لا تنتقل للمعيار التالي حتى يتحقق الفهم الكامل — 80% كحد أدنى',
    effectSize: 0.57,
    targetLevels: ['struggling', 'developing'],
    triggers: ['error_made', 'revision_needed', 'criterion_attempt'],
    btecTargets: ['pass', 'merit'],
    avatarGesture: 'agree',
    avatarEmotion: 'calm',
    teacherPromptTemplate: `
    طبّق نظام التعلم التحصيلي لـ BTEC:
    1. حدّد المعيار بوضوح: "علشان تكمل P1، لازم تفهم {{core_concept}} بشكل كامل"
    2. اقيس الفهم الحالي: "على مقياس 1–10 — كيف بتحكي على فهمك لهاد؟"
    3. إذا أقل من 7: "خليني نرجع لنقطة واحدة ونبنيها مع بعض"
    4. إذا 7 وأكثر: "ممتاز! هلأ بننتقل لخطوة أعلى"
    الهدف: لا يُترك الطالب خلف — كل طالب يصل للـ Pass على الأقل.
    `,
    bodyLanguage: { gesture: 'agree', gazeTarget: 'user', movementEnergy: 0.4, blinkStyle: 'slow' },
    durationSec: 90,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 5: التكرار المتباعد (Spaced Repetition)
  // Ebbinghaus Forgetting Curve — d=0.71
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'spaced_repetition',
    name: 'التكرار المتباعد',
    description: 'راجع المعلومة في فترات متزايدة: الآن → 10 دقائق → 1 يوم → أسبوع',
    effectSize: 0.71,
    targetLevels: ['struggling', 'developing', 'achieving'],
    triggers: ['revision_needed', 'session_start', 'new_topic'],
    btecTargets: ['pass', 'merit', 'distinction'],
    avatarGesture: 'think',
    avatarEmotion: 'thinking',
    teacherPromptTemplate: `
    طبّق التكرار المتباعد:
    "بدنا نرجع لـ {{previous_topic}} اللي اشتغلنا عليه — بعض الشي اتحكى قبل"
    سؤال استرجاع: "بدون ما تبص لأي شي — شو تتذكر عن {{concept}}؟"
    بعد الإجابة: "ممتاز! هاد هو الأساس. هلأ بنضيف عليه..."
    الهدف: كل جلسة تبدأ بمراجعة سريعة (2–3 دقائق) لما سبق.
    `,
    bodyLanguage: { gesture: 'think', gazeTarget: 'think', movementEnergy: 0.5, blinkStyle: 'slow' },
    durationSec: 120,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 6: ممارسة الاسترجاع (Retrieval Practice)
  // Roediger & Butler 2011 — d=0.72 — "اختبر نفسك لتتذكر"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'retrieval_practice',
    name: 'ممارسة الاسترجاع',
    description: 'الاختبار الذاتي أقوى من إعادة القراءة بثلاثة أضعاف',
    effectSize: 0.72,
    targetLevels: ['developing', 'achieving', 'excelling'],
    triggers: ['revision_needed', 'session_start', 'praise_moment'],
    btecTargets: ['pass', 'merit', 'distinction'],
    avatarGesture: 'think',
    avatarEmotion: 'curious',
    teacherPromptTemplate: `
    طبّق استرجاع النقاط الرئيسية بدون نظر:
    "هلأ — من غير ما تبص لأي شي — أخبرني بـ 3 نقاط رئيسية عن {{topic}}"
    انتظر (10–15 ثانية للتفكير — مهم!)
    بعد الإجابة: قارن مع المعلومة الصحيحة وقدّم التغذية الراجعة
    "ممتاز أنك تذكرت {{correct}} — وهاد اللي ناقص هو {{missing}}"
    الاسترجاع الصعب = تعلم أعمق وأبقى.
    `,
    bodyLanguage: { gesture: 'think', gazeTarget: 'think', movementEnergy: 0.5, blinkStyle: 'normal' },
    durationSec: 90,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 7: إطار العقلية النامية (Growth Mindset Framing)
  // Carol Dweck — يحوّل الطلاب الخائفين إلى متحمسين للتعلم
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'growth_mindset',
    name: 'إطار العقلية النامية',
    description: '"لسّه ما وصلت" بدل "غلطت" — الدماغ يتعلم من الخطأ أكثر من الصح',
    effectSize: 0.65,
    targetLevels: ['struggling', 'developing'],
    triggers: ['error_made', 'frustration_signal', 'confusion_signal'],
    btecTargets: ['pass', 'merit'],
    avatarGesture: 'agree',
    avatarEmotion: 'encouraging',
    teacherPromptTemplate: `
    استخدم إطار العقلية النامية — بدّل لغتك:
    بدل "غلط/خطأ" → قل: "لسّه ما وصلنا — بس احنا في الطريق الصح"
    بدل "ما تعرف" → قل: "هاد بس يعني لسّه ما اتعلمت — وهاد طبيعي ومقبول"
    بدل "شاطر" (مديح الذكاء) → قل: "شاطر لأنك اشتغلت عليها" (مديح الجهد)
    الجملة الذهبية: "الغلط = الدماغ بيتعلم. كيف تعتقد الأشخاص الناجحين تعلموا؟"
    `,
    bodyLanguage: { gesture: 'agree', gazeTarget: 'user', movementEnergy: 0.5, blinkStyle: 'normal' },
    durationSec: 60,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 8: الأمثلة المعملة تنازلياً (Worked Examples → Fading)
  // Sweller's Cognitive Load Theory — d=0.57
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'worked_examples_fading',
    name: 'الأمثلة الكاملة ثم التلاشي',
    description: 'أولاً مثال كامل → ثانياً مثال ناقص → ثالثاً الطالب يكمل وحده',
    effectSize: 0.57,
    targetLevels: ['struggling', 'developing'],
    triggers: ['new_topic', 'confusion_signal', 'question_asked'],
    btecTargets: ['pass', 'merit'],
    avatarGesture: 'explain',
    avatarEmotion: 'calm',
    teacherPromptTemplate: `
    طبّق استراتيجية تلاشي المثال:
    المرحلة 1 — مثال كامل: "خليني أريك مثال كامل: {{full_example}}"
    "شو لاحظت في هاد المثال؟"
    المرحلة 2 — مثال ناقص: "هلأ عندك مثال ناقص — تقدر تكمله؟ {{partial_example}}"
    المرحلة 3 — استقلالية: "عظيم! هلأ حاول تعمل مثالك الخاص عن {{new_context}}"
    الغاية: الطالب يصير مستقلاً تدريجياً.
    `,
    bodyLanguage: { gesture: 'explain', gazeTarget: 'user', movementEnergy: 0.55, blinkStyle: 'normal' },
    durationSec: 180,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 9: التدريس بالتدريس (Peer Teaching / Protégé Effect)
  // Feynman Technique — d=0.55 — "علّم غيرك تتعلم أنت أكثر"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'feynman_teach_back',
    name: 'أسلوب فاينمان — علّمني',
    description: 'اطلب من الطالب يشرح لك — من يشرح يتعلم أكثر بكثير من من يسمع',
    effectSize: 0.55,
    targetLevels: ['developing', 'achieving', 'excelling'],
    triggers: ['breakthrough', 'correct_answer', 'praise_moment'],
    btecTargets: ['merit', 'distinction'],
    avatarGesture: 'beckon',
    avatarEmotion: 'curious',
    teacherPromptTemplate: `
    طبّق أسلوب فاينمان للتعلم العميق:
    "هلأ أنا مش فاهم — تقدر تشرح لي {{concept}} كأنك المعلم؟"
    "اشرح لي بكلامك أنت — مش من الكتاب"
    بعد الشرح:
    - إذا صح: "ممتاز! هاد يعني فهمت فعلاً — لما بتشرح بتتأكد إنك فاهم"
    - إذا ناقص: "شو بتتوقع رح يسأل عنه طالب ثاني لو ما فهم {{part}}؟"
    الهدف: الطالب يصير واثقاً ومتقناً.
    `,
    bodyLanguage: { gesture: 'beckon', gazeTarget: 'user', movementEnergy: 0.65, blinkStyle: 'normal' },
    durationSec: 120,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 10: الاستفسار التوضيحي (Elaborative Interrogation)
  // "لماذا؟" × 5 — d=0.43 — يبني الفهم العميق وليس السطحي
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'elaborative_interrogation',
    name: 'الاستفسار التوضيحي — لماذا؟',
    description: '"لماذا؟" خمس مرات — يصل للسبب الجذري ويبني الفهم العميق',
    effectSize: 0.43,
    targetLevels: ['achieving', 'excelling'],
    triggers: ['correct_answer', 'criterion_attempt', 'breakthrough'],
    btecTargets: ['merit', 'distinction'],
    avatarGesture: 'think',
    avatarEmotion: 'curious',
    teacherPromptTemplate: `
    طبّق الاستفسار التوضيحي لبناء فهم عميق:
    بعد أي إجابة: "وليش بالضبط؟"
    بعد الجواب الثاني: "وليش هاد المبدأ شغال هون؟"
    بعد الجواب الثالث: "كيف بيرتبط هاد بـ {{btec_concept}}؟"
    بعد الجواب الرابع: "ووين بتشوف هاد في الحياة الحقيقية؟"
    الهدف: وصول الطالب للمعرفة بدل حفظها — فهم السبب وراء القاعدة.
    `,
    bodyLanguage: { gesture: 'think', gazeTarget: 'think', movementEnergy: 0.6, blinkStyle: 'slow' },
    durationSec: 90,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 11: التعلم الممزوج (Interleaved Practice)
  // Rohrer & Taylor 2007 — d=0.40 — ربط المفاهيم يحسّن التطبيق
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'interleaved_practice',
    name: 'الممارسة الممزوجة',
    description: 'امزج موضوعين أو أكثر في نفس الجلسة — يبني الفهم العابر للمواد',
    effectSize: 0.40,
    targetLevels: ['achieving', 'excelling'],
    triggers: ['praise_moment', 'breakthrough', 'new_topic'],
    btecTargets: ['distinction'],
    avatarGesture: 'wave',
    avatarEmotion: 'excited',
    teacherPromptTemplate: `
    ربط {{topic1}} بـ {{topic2}} لبناء فهم متكامل:
    "هلأ خلينا نشوف — كيف بيرتبط SWOT اللي اشتغلنا عليه بـ PESTLE؟"
    "إذا شركة عملت SWOT ولاحظت Weakness — كيف بتستخدم PESTLE تفهم ليش؟"
    "هاد النوع من التفكير هو اللي بيفرق بين Merit وDistinction في BTEC"
    الهدف: الطالب يرى الصورة الكاملة لـ BTEC وليس أجزاء منفصلة.
    `,
    bodyLanguage: { gesture: 'wave', gazeTarget: 'user', movementEnergy: 0.75, blinkStyle: 'normal' },
    durationSec: 120,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 12: الميتا-معرفة (Metacognitive Coaching)
  // Hattie & Yates 2014 — d=0.69 — "كيف تتعلم؟" أهم من "ماذا تعلم"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'metacognitive_coaching',
    name: 'تدريب الميتا-معرفة',
    description: 'علّم الطالب كيف يراقب فهمه الخاص — "أنا فاهم؟ وين توقفت؟"',
    effectSize: 0.69,
    targetLevels: ['developing', 'achieving', 'excelling'],
    triggers: ['question_asked', 'confusion_signal', 'new_topic', 'revision_needed'],
    btecTargets: ['merit', 'distinction'],
    avatarGesture: 'think',
    avatarEmotion: 'thinking',
    teacherPromptTemplate: `
    طبّق التدريب الميتا-معرفي:
    "قبل ما نكمل — خليك تسأل نفسك: على مقياس 1–5 كيف فهمي لهاد؟"
    "وين بالضبط توقف فهمك؟ أي جملة أو نقطة؟"
    "شو اللي بتحتاجه عشان توصل لـ 5؟"
    "لمّا طالب ما بفهم الـ Merit — عادة اللي ناقص هو..."
    الهدف: الطالب يصير مستقلاً في مراقبة فهمه ولا يحتاج معلماً دائماً.
    `,
    bodyLanguage: { gesture: 'think', gazeTarget: 'think', movementEnergy: 0.4, blinkStyle: 'slow' },
    durationSec: 90,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 13: رسم الخرائط المفاهيمية (Concept Mapping)
  // Hattie — d=0.60 — يُظهر الروابط الخفية بين الأفكار
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'concept_mapping',
    name: 'الخريطة المفاهيمية',
    description: 'اطلب من الطالب يرسم علاقات بين المفاهيم — يكشف الثغرات في الفهم',
    effectSize: 0.60,
    targetLevels: ['developing', 'achieving'],
    triggers: ['confusion_signal', 'new_topic', 'revision_needed'],
    btecTargets: ['pass', 'merit'],
    avatarGesture: 'explain',
    avatarEmotion: 'curious',
    teacherPromptTemplate: `
    استخدم الخريطة المفاهيمية الشفهية:
    "خليني أرسم بكلامي — {{concept_a}} → يؤثر على → {{concept_b}} → لأن..."
    "هلأ أنت: كيف بتربط {{topic1}} بـ {{topic2}} بجملة واحدة؟"
    "إذا رسمنا خريطة للـ BTEC Unit {{unit}} — شو بيكون في المركز؟"
    بعد الإجابة: "ممتاز! هاد بيكشف إنك فاهم البنية الأساسية"
    الهدف: فهم الصورة الكاملة وليس تفاصيل منفصلة.
    `,
    bodyLanguage: { gesture: 'explain', gazeTarget: 'user', movementEnergy: 0.6, blinkStyle: 'normal' },
    durationSec: 90,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 14: التعلم القائم على الحالة الحقيقية (Case-Based Learning)
  // BTEC-specific — الأكثر ملاءمة لـ Business وإدارة الأعمال
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'case_based_learning',
    name: 'التعلم القائم على الحالة الحقيقية',
    description: 'ربط كل معيار BTEC بشركة أو حالة حقيقية من العالم العربي',
    effectSize: 0.58,
    targetLevels: ['developing', 'achieving', 'excelling'],
    triggers: ['new_topic', 'question_asked', 'criterion_attempt'],
    btecTargets: ['pass', 'merit', 'distinction'],
    avatarGesture: 'point',
    avatarEmotion: 'excited',
    teacherPromptTemplate: `
    استخدم حالة حقيقية من العالم العربي:
    "خليني آخذ مثال حقيقي: شركة {{real_company}} في {{country}}"
    "لمّا {{company}} عملت {{business_action}} — كيف بتطبق عليها معيار {{criterion}}؟"
    الربط بـ BTEC: "هاد بالضبط ما بتحتاج تحلله في مهمتك — بس بمثالك أنت"
    الأمثلة المقترحة: Zain الأردن، Aramco، Amazon ME، Majid Al Futtaim، إلخ
    الهدف: BTEC مش نظري — هو مهارات حياة وعمل حقيقي.
    `,
    bodyLanguage: { gesture: 'point', gazeTarget: 'user', movementEnergy: 0.75, blinkStyle: 'normal' },
    durationSec: 120,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 15: سلّم BTEC — P إلى D (BTEC Criterion Ladder)
  // استراتيجية مبتكرة خاصة بـ BTEC — لا توجد في الأدبيات العامة
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'btec_criterion_ladder',
    name: 'سلّم BTEC — من P إلى D',
    description: 'وضّح الفرق بين Pass/Merit/Distinction بأمثلة ملموسة وتدرّج واضح',
    effectSize: 0.65,
    targetLevels: ['developing', 'achieving', 'excelling'],
    triggers: ['criterion_attempt', 'question_asked', 'new_topic'],
    btecTargets: ['pass', 'merit', 'distinction'],
    avatarGesture: 'clap',
    avatarEmotion: 'encouraging',
    teacherPromptTemplate: `
    استخدم سلّم P → M → D بوضوح:
    Pass (الحد الأدنى): "صف {{concept}} بكلماتك — ايش هو؟"
    Merit (التحليل): "وضّح ليش {{concept}} مهم — ما هي تأثيراته؟"
    Distinction (التقييم النقدي): "ناقد {{concept}} — ما هي محدوديته؟ متى لا يشتغل؟"
    
    الجملة التحفيزية: "أنت هلأ عند Pass — خطوة واحدة بتخليك Merit"
    "المعلومة نفسها — بس طريقة تقديمها وتحليلها هي اللي بتفرق"
    الهدف: الطالب يفهم أن الفرق بين P/M/D ليس المعلومة — بل العمق.
    `,
    bodyLanguage: { gesture: 'clap', gazeTarget: 'user', movementEnergy: 0.7, blinkStyle: 'normal' },
    durationSec: 120,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 16: بروتوكول انتظار الفكرة (Wait Time Protocol)
  // Mary Budd Rowe 1986 — زيادة وقت الانتظار من 1 إلى 5 ثوانٍ يضاعف جودة الإجابات
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'wait_time_protocol',
    name: 'بروتوكول وقت الانتظار',
    description: 'انتظر 5–10 ثوانٍ بعد السؤال — الصمت المريح يُنتج إجابات أعمق',
    effectSize: 0.55,
    targetLevels: ['struggling', 'developing', 'achieving', 'excelling'],
    triggers: ['question_asked', 'silence_prolonged', 'confusion_signal'],
    btecTargets: ['pass', 'merit', 'distinction'],
    avatarGesture: 'think',
    avatarEmotion: 'calm',
    teacherPromptTemplate: `
    طبّق بروتوكول الانتظار المدروس:
    1. اطرح السؤال بوضوح: "{{question}}"
    2. قل بصوت هادئ: "خذ وقتك — 10 ثوانٍ للتفكير"
    3. انتظر في صمت (أظهر إيماءة think — لا تتدخل!)
    4. إذا لم يأتِ جواب: "ابدأ بـ... ما أول فكرة بتيجي في بالك؟"
    5. أي إجابة (حتى ناقصة): "ممتاز أنك فكرت! هاد الجزء صح — والجزء الناقص هو..."
    ملاحظة: الصمت ليس فشلاً — هو تفكير عميق.
    `,
    bodyLanguage: { gesture: 'think', gazeTarget: 'think', movementEnergy: 0.3, blinkStyle: 'slow' },
    durationSec: 60,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 17: التعلم العاطفي-الاجتماعي (Social-Emotional Learning)
  // CASEL Framework — يبني الثقة والانتماء الضروريَّين للتعلم
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'social_emotional_learning',
    name: 'التعلم العاطفي-الاجتماعي',
    description: 'الطالب لا يتعلم لحين يشعر بالأمان والانتماء — ابنِ العلاقة أولاً',
    effectSize: 0.68,
    targetLevels: ['struggling', 'developing'],
    triggers: ['session_start', 'frustration_signal', 'silence_prolonged'],
    btecTargets: ['pass', 'merit'],
    avatarGesture: 'wave',
    avatarEmotion: 'empathetic',
    teacherPromptTemplate: `
    ابدأ ببناء الأمان العاطفي:
    "كيف حالك اليوم؟ مستعد نشتغل مع بعض؟"
    إذا بدا مترددًا: "لا بأس — المكان هون آمن ومحكي أي سؤال"
    إذا بدا محبطاً: "أنا شايف إنك تعبت شوي — خليني أساعدك نفهم هاد مع بعض"
    "ما في سؤال غبي هون — كل سؤال بيقربنا للـ Distinction"
    الجملة المفتاحية: "أنا معك في كل خطوة — مش هنا عشان أحكم، هنا عشان أساعد"
    `,
    bodyLanguage: { gesture: 'wave', gazeTarget: 'user', movementEnergy: 0.4, blinkStyle: 'slow' },
    durationSec: 60,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // الاستراتيجية 18: تقييم الذاكرة المتعددة (Multi-Pass Assessment)
  // BTEC criterion compliance + Bloom's taxonomy integration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'multi_pass_assessment',
    name: 'التقييم المتعدد المحاور',
    description: 'قيّم الطالب من زوايا مختلفة — ذاكرة + فهم + تطبيق + تحليل + تقييم',
    effectSize: 0.65,
    targetLevels: ['achieving', 'excelling'],
    triggers: ['praise_moment', 'criterion_attempt', 'breakthrough'],
    btecTargets: ['merit', 'distinction'],
    avatarGesture: 'clap',
    avatarEmotion: 'proud',
    teacherPromptTemplate: `
    قيّم وفق هرم Bloom المُعدَّل لـ BTEC:
    مستوى 1 (ذاكرة/Remember): "عرّف لي {{term}}"
    مستوى 2 (فهم/Understand): "اشرح {{concept}} بمثال"
    مستوى 3 (تطبيق/Apply): "كيف بتطبق {{concept}} على شركة {{company}}؟"
    مستوى 4 (تحليل/Analyse): "ليش {{factor}} أكثر تأثيراً من {{other_factor}}؟"
    مستوى 5 (تقييم/Evaluate): "نقّد {{approach}} — ما هي محدوديته؟"
    مستوى 6 (إبداع/Create): "ابتكر استراتيجية جديدة تجمع {{concept1}} و{{concept2}}"
    `,
    bodyLanguage: { gesture: 'clap', gazeTarget: 'user', movementEnergy: 0.8, blinkStyle: 'normal' },
    durationSec: 150,
  },
];

// ─── محرك اختيار الاستراتيجية ──────────────────────────────────────────────

export interface StrategyContext {
  studentLevel: StudentLevel;
  studentState: StudentState;
  btecTarget: BtecTarget;
  learningMoment: LearningMoment;
  topicKeyword?: string;
  criterionCode?: string; // e.g. "P1", "M2", "D3"
  sessionTurnCount: number;
}

/**
 * اختار أفضل استراتيجية للموقف الحالي.
 * يُرجع الاستراتيجية الأعلى حجم تأثير المناسبة لهذا السياق.
 */
export function selectBestStrategy(ctx: StrategyContext): TeachingStrategy {
  const eligible = TEACHING_STRATEGIES.filter(s =>
    s.targetLevels.includes(ctx.studentLevel) &&
    s.triggers.includes(ctx.learningMoment) &&
    (!s.btecTargets || s.btecTargets.includes(ctx.btecTarget)),
  );

  if (eligible.length === 0) {
    return TEACHING_STRATEGIES.find(s => s.id === 'formative_feedback')!;
  }

  // sort by effect size descending, pick top
  eligible.sort((a, b) => b.effectSize - a.effectSize);

  // Anti-repeat: if session has many turns, avoid same strategy
  if (ctx.sessionTurnCount > 6) {
    const top3 = eligible.slice(0, 3);
    return top3[Math.floor(Math.random() * top3.length)];
  }

  return eligible[0];
}

/**
 * يُصيغ تعليمات المعلم للـ LLM مع توجيه الاستراتيجية المختارة.
 */
export function buildStrategySystemSuffix(
  strategy: TeachingStrategy,
  ctx: StrategyContext,
): string {
  let prompt = strategy.teacherPromptTemplate
    .replace(/\{\{topic\}\}/g, ctx.topicKeyword ?? 'الموضوع الحالي')
    .replace(/\{\{criterion\}\}/g, ctx.criterionCode ?? 'P1')
    .replace(/\{\{level\}\}/g, ctx.btecTarget.toUpperCase());

  return `
=== استراتيجية التدريس النشطة ===
الاستراتيجية: ${strategy.name} (حجم التأثير: d=${strategy.effectSize})
مستوى الطالب: ${ctx.studentLevel} | الحالة: ${ctx.studentState}
${prompt}
===
في ردّك: طبّق هذه الاستراتيجية بشكل طبيعي — لا تذكرها صراحةً.
`;
}

/**
 * تعليمات حركة الأفاتار المرتبطة بالاستراتيجية.
 */
export function getStrategyAvatarBehavior(strategy: TeachingStrategy): {
  gesture: string;
  emotion: EmotionLabel;
  gesturePriority: number;
  gazeTarget: 'user' | 'think' | 'away';
  movementEnergy: number;
} {
  return {
    gesture:         strategy.avatarGesture,
    emotion:         strategy.avatarEmotion,
    gesturePriority: PRIORITY.NORMAL,
    gazeTarget:      strategy.bodyLanguage.gazeTarget,
    movementEnergy:  strategy.bodyLanguage.movementEnergy,
  };
}

// ─── مشغّل مصغّر لاستخدام الاستراتيجية في الـ hook ──────────────────────────

let _lastStrategyId = '';
let _strategyRotationIdx = 0;

export function getNextStrategy(ctx: StrategyContext): TeachingStrategy {
  const best = selectBestStrategy(ctx);
  // Anti-repeat: if same strategy used last time, try second best
  if (best.id === _lastStrategyId && _strategyRotationIdx < 3) {
    _strategyRotationIdx++;
    const eligible = TEACHING_STRATEGIES.filter(s =>
      s.targetLevels.includes(ctx.studentLevel) &&
      s.triggers.includes(ctx.learningMoment) &&
      s.id !== _lastStrategyId,
    );
    if (eligible.length > 0) {
      eligible.sort((a, b) => b.effectSize - a.effectSize);
      _lastStrategyId = eligible[0].id;
      return eligible[0];
    }
  }
  _strategyRotationIdx = 0;
  _lastStrategyId = best.id;
  return best;
}
