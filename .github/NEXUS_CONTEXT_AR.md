# 🌌 أكاديمية نكسس - السياق العظيم للتطوير
**نموذج جاهز للنسخ واللصق قبل بدء أي تطوير مع GitHub Copilot**

---

## 📋 القالب السريع (انسخ والصق)

```
═══════════════════════════════════════════════════════════════
🎓 أكاديمية نكسس v3.0 - سياق التطوير
═══════════════════════════════════════════════════════════════

أنا أطور منصة تعليمية عالية الجودة لشهادة BTEC اسمها "أكاديمية نكسس".

📁 قواعد البنية المعمارية:
────────────────────────────────────────────────────────────────
• مسار المشروع: E:\Phase 1_ Quantum Foundation Project Setup Instructions\
• تطبيق Next.js: frontend/src/app (52 صفحة، App Router)
• موارد مشتركة: hooks/, lib/, context/, types/ في جذر المشروع
  └─ يتم الوصول إليها عبر @/ من ملفات frontend
• التصميم: Tailwind CSS v3.4 + RTL عربي + خط Cairo
• الخادم الخلفي: FastAPI على المنفذ :8000 (محرك التقييم الجنائي GPT-4o)
• إدارة الحالة: Zustand + localStorage

🔐 اتفاقيات حرجة:
────────────────────────────────────────────────────────────────
1. 'use client': إلزامي لأي مكون يستخدم hooks/state/context
2. استيراد المسارات: @/hooks, @/lib, @/context, @/types (من الجذر)
3. مفاتيح localStorage: ثابتة (nexus-auth, nexus-assessments, nexus-vr, btec_platform_progress)
4. TypeScript: استورد الأنواع من @/types فقط (مركزي)
5. لغة الواجهة: عربي مع RTL (lang="ar" dir="rtl")
6. أدلة VR: 4 أدلة بالضبط (تغييرها يكسر نسبة التقدم)
7. التقييم: مسار مزدوج (عميل: كلمات مفتاحية، خادم: GPT-4o جنائي)

📦 التبعيات الرئيسية:
────────────────────────────────────────────────────────────────
• Next.js: ^16.1.6 (Turbopack مفعّل)
• React: ^18.2.0 (مع React Three Fiber ^8.18.0)
• TypeScript: ^5.3.0
• Zustand: ^4.5.0 (مع persist middleware)
• OpenAI: ^6.17.0

🎯 المهمة:
────────────────────────────────────────────────────────────────
[اكتب هنا ما تريد تطويره]

🚫 القيود:
────────────────────────────────────────────────────────────────
• احترم البنية على مستوى الجذر (hooks/, lib/, context/, types/)
• لا تغير مفاتيح localStorage بدون استراتيجية ترحيل بيانات
• حافظ على تخطيط RTL العربي في جميع تغييرات الواجهة
• أضف دائماً 'use client' للمكونات التي تستخدم hooks
• لا شرح - فقط كود دقيق متوافق مع البنية

═══════════════════════════════════════════════════════════════
```

---

## 🎯 أمثلة للاستخدام

### مثال 1: إضافة صفحة تقييم جديدة
```
[انسخ القالب أعلاه، ثم أضف:]

🎯 المهمة:
أنشئ صفحة "تقييم سريع" تقوم بـ:
1. عرض 5 أسئلة BTEC عشوائية
2. استخدام useAssessment hook للتقييم
3. عرض النتائج بتخطيط RTL عربي
4. حفظ التقدم في localStorage
```

### مثال 2: إضافة مكون 3D جديد
```
[انسخ القالب أعلاه، ثم أضف:]

🎯 المهمة:
أضف غرفة مكتب 3D جديدة إلى MarketingSimulation.tsx:
1. استخدم React Three Fiber + Drei
2. أضف 2 شخصيات NPC جديدة مع حوار
3. اجمع دليل واحد جديد (أبقِ المجموع 4)
4. حدّث تتبع التقدم في useVR
```

### مثال 3: إنشاء نقطة API جديدة
```
[انسخ القالب أعلاه، ثم أضف:]

🎯 المهمة:
أنشئ endpoint جديد /api/generate-report يقوم بـ:
1. قبول بيانات إجابة الطالب
2. استدعاء FastAPI للحصول على ملاحظات AI
3. إرجاع رابط تحميل PDF
4. معالجة النص العربي بشكل صحيح
```

---

## 🗺️ خريطة المسارات المهمة

### 📂 المجلدات الرئيسية

```
المشروع/
│
├── frontend/src/app/          → صفحات Next.js (52 صفحة)
│   ├── page.tsx              → الصفحة الرئيسية
│   ├── layout.tsx            → التخطيط العام (عربي RTL)
│   ├── globals.css           → Tailwind + أدوات مخصصة
│   ├── api/                  → نقاط API (4 endpoints)
│   ├── dashboard/            → لوحة التحكم
│   ├── assessment/           → وحدة التقييم
│   ├── simulation/           → محاكاة الأعمال
│   ├── vr-experience/        → بيئة VR
│   └── ai-teacher/           → واجهة المعلم الذكي
│
├── components/               → مكونات مشتركة (42 ملف)
│   ├── MarketingSimulation.tsx  → المحاكاة 3D الرئيسية (40KB)
│   ├── EvidenceCollector.tsx    → نظام جمع الأدلة
│   └── PESTLEAnalyzer.tsx       → أداة تحليل PESTLE
│
├── hooks/                    → متاجر Zustand (5 ملفات)
│   ├── useAuth.ts           → متجر المصادقة
│   ├── useAssessment.ts     → متجر التقييم
│   └── useVR.ts             → تقدم VR
│
├── lib/                      → مكتبات مساعدة
│   └── btec-grading.ts      → محرك التقييم (عميل)
│
├── context/                  → موفرو السياق
│   └── ProgressContext.tsx  → حالة اللعبة
│
└── types/                    → تعريفات TypeScript
    └── index.ts             → أنواع مركزية
```

### 🌐 نقاط API

```typescript
// مسارات Frontend API
POST /api/chat              → دردشة المعلم/المستشار الذكي
POST /api/evaluate          → جسر إلى تقييم FastAPI
POST /api/openai-grade      → تقييم بمفتاح المستخدم
POST /api/plagiarism        → كشف الانتحال

// مسارات Backend API (FastAPI على :8000)
GET  /                      → فحص الصحة
POST /api/v1/assessment/grade           → تقييم GPT-4o الجنائي
POST /api/v1/assessment/check_plagiarism → تحليل التشابه
```

---

## 📝 أنماط الكود الشائعة

### نمط 1: إنشاء صفحة جديدة

```typescript
// الملف: frontend/src/app/new-feature/page.tsx
'use client';  // ⚠️ إلزامي للـ hooks/state

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';  // ✅ استيراد من الجذر
import type { GradingResult } from '@/types';  // ✅ أنواع مركزية

export default function NewFeaturePage() {
  const { user } = useAuth();
  const [result, setResult] = useState<GradingResult | null>(null);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-cairo text-gradient">
        عنوان الصفحة
      </h1>
      {/* محتوى الصفحة */}
    </div>
  );
}
```

### نمط 2: إنشاء متجر Zustand جديد

```typescript
// الملف: hooks/useNewFeature.ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NewFeatureState {
  data: any[];
  addData: (item: any) => void;
}

export const useNewFeatureStore = create<NewFeatureState>()(
  persist(
    (set, get) => ({
      data: [],
      addData: (item) => {
        set({ data: [...get().data, item] });
      },
    }),
    { name: 'nexus-new-feature' }  // ⚠️ اختر مفتاحاً فريداً
  )
);

export function useNewFeature() {
  return useNewFeatureStore();
}
```

### نمط 3: إضافة نقطة API

```typescript
// الملف: frontend/src/app/api/new-endpoint/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;  // 5 دقائق

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // استدعاء الخادم الخلفي FastAPI
    const response = await fetch('http://127.0.0.1:8000/api/v1/endpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json({ success: true, data });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

---

## 🔍 مرجع سريع

### ✅ استيرادات صحيحة

```typescript
// ✅ صحيح - موارد على مستوى الجذر
import { useAuth } from '@/hooks/useAuth';
import { calculateGrade } from '@/lib/btec-grading';
import { useProgress } from '@/context/ProgressContext';
import type { Assessment } from '@/types';

// ✅ صحيح - ملفات frontend src
import '@/app/globals.css';
import Component from '@/components/Component';

// ❌ خطأ - لا تستخدم مسارات نسبية للموارد الجذرية
import { useAuth } from '../../../hooks/useAuth';  // ❌
```

### 🎨 فئات CSS المخصصة

```css
.glass-nexus     /* تأثير زجاج مصنفر مع حدود نيون */
.card-nexus      /* بطاقة زجاجية مع تحجيم عند التمرير */
.text-gradient   /* نص متدرج سماوي-زمردي */
```

### 🔐 مفاتيح localStorage (ثابتة)

```typescript
// ⚠️ لا تغير هذه المفاتيح أبداً بدون ترحيل البيانات
const STORAGE_KEYS = {
  AUTH: 'nexus-auth',              // جلسة المستخدم + الدور
  ASSESSMENTS: 'nexus-assessments', // سجل التقييمات
  VR: 'nexus-vr',                  // تقدم VR (4 أدلة)
  PROGRESS: 'btec_platform_progress' // حالة اللعبة
} as const;
```

---

## 🚨 تذكيرات حرجة

### ✅ يجب فعله
- ✅ أضف `'use client'` للمكونات التي تستخدم hooks/state
- ✅ استورد الأنواع من `@/types` فقط
- ✅ استخدم استيرادات من الجذر لـ hooks/lib/context
- ✅ حافظ على تخطيط RTL العربي
- ✅ اختبر استمرارية localStorage بعد تغييرات الحالة

### ❌ يجب تجنبه
- ❌ تغيير مفاتيح localStorage بدون استراتيجية ترحيل
- ❌ تعديل عدد أدلة VR من 4
- ❌ استخدام مسارات نسبية للموارد الجذرية
- ❌ نسيان توجيه `'use client'`
- ❌ استيراد أنواع من مصادر متعددة

---

## 📚 موارد إضافية

- **الدليل الكامل**: `.github/copilot-instructions.md`
- **تعريفات الأنواع**: `types/index.ts`
- **منطق التقييم**: `lib/btec-grading.ts` (عميل) + `backend/app/services/forensic_grader.py` (خادم)
- **لقطة المشروع**: `PROJECT_SNAPSHOT_20260217_014828.txt`

---

**💡 نصيحة احترافية**: احفظ هذا الملف وانسخ القالب قبل كل جلسة Copilot للحصول على كود متسق ودقيق متوافق مع بنية أكاديمية نكسس.

---

## 🔗 روابط سريعة

| الموضوع | الملف | الوصف |
|---------|-------|--------|
| 🇬🇧 نسخة إنجليزية | `NEXUS_CONTEXT.md` | السياق الكامل بالإنجليزية |
| 🇸🇦 نسخة عربية | `NEXUS_CONTEXT_AR.md` | هذا الملف |
| 📖 دليل كامل | `copilot-instructions.md` | تعليمات شاملة للـ AI |
| 📊 لقطة المشروع | `../PROJECT_SNAPSHOT_*.txt` | حالة المشروع الحالية |
