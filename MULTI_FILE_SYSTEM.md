# 📚 نظام تقييم الملفات المتعددة - دليل الاستخدام الشامل

## 🎯 الهدف

تقييم حلول الطلاب التي **تنقسم على عدة ملفات** كملف واحد موحد.

**مثال سيناريو**:
- ✅ الواجب: قارن بين **شركتين** أو **نظامين**
- ✅ الحل: الطالب يقدم ملفين منفصلين:
  - الملف 1: وصف الشركة/النظام الأول
  - الملف 2: وصف الشركة/النظام الثاني
- ✅ النتيجة: يتم **دمج الملفات ثم التقييم معاً** كحل موحد

---

## 📊 البنية المعمارية

```
┌─────────────────────────────────────────────────────────────┐
│                     الواجهة الأمامية (Frontend)              │
│                  /app/api/evaluate-multi-file/               │
│                                                               │
│  1. استقبال طلب التقييم (assignment + solutions[])         │
│  2. التحقق من صحة البيانات                                   │
│  3. إعادة التوجيه إلى الـ Backend                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ POST 
                       │ {
                       │   "assignment_text": "...",
                       │   "solutions": [
                       │     {"file_label": "...", "file_content": "..."},
                       │     {"file_label": "...", "file_content": "..."}
                       │   ]
                       │ }
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              الخادم الخلفي (Backend - FastAPI)               │
│     /api/v1/assessment/evaluate-multi-file                  │
│                                                               │
│  1. استقبال الطلب                                            │
│  2. حفظ كل ملف بـ Label مميز                                  │
│  3. دمج الملفات مع فواصل مرئية:                              │
│     ════════════════════════════════════════════             │
│     📄 [ملف 1]                                              │
│     محتوى الملف الأول...                                    │
│     ════════════════════════════════════════════             │
│     📄 [ملف 2]                                              │
│     محتوى الملف الثاني...                                   │
│     ════════════════════════════════════════════             │
│                                                               │
│  4. استخراج معايير BTEC من الواجب                            │
│  5. استدعاء GPT-4o-mini للتقييم على النص المدمج            │
│  6. تحليل أي ملف أسهم في كل معيار                           │
│  7. إرجاع النتيجة مع توزيع الملفات                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Response
                       │ {
                       │   "final_grade": "DISTINCTION",
                       │   "files_evaluated": 2,
                       │   "file_distribution": {
                       │     "ملف 1": {"P1": true, "M1": true, "D1": true},
                       │     "ملف 2": {"P1": true, "M1": true, "D1": true}
                       │   },
                       │   ...
                       │ }
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                   الواجهة الأمامية (العرض)                   │
│                                                               │
│  1. عرض الدرجة النهائية                                       │
│  2. عرض توزيع المعايير على الملفات                           │
│  3. عرض الملخص والتفاصيل                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 كيفية الاستخدام من الكود

### 1️⃣ استخدام Hook بسيط

**Import الـ Hook**:
```typescript
import useEvaluateMultiFile from '@/hooks/useEvaluateMultiFile';
```

**الاستخدام**:
```typescript
const { evaluateMultiFile } = useEvaluateMultiFile();

const result = await evaluateMultiFile({
  assignment_text: "الواجب: قارن بين شركتين",
  solutions: [
    {
      file_label: "الشركة الأولى",
      file_content: "محتوى وصف الشركة الأولى...",
      description: "وصف اختياري"
    },
    {
      file_label: "الشركة الثانية",
      file_content: "محتوى وصف الشركة الثانية...",
      description: "وصف اختياري"
    }
  ]
});

// النتيجة
console.log(result.final_grade);           // "DISTINCTION"
console.log(result.files_evaluated);       // 2
console.log(result.file_distribution);     // { "الشركة الأولى": {...}, "الشركة الثانية": {...} }
```

### 2️⃣ استخدام الـ API المباشر

**Fetch Request**:
```javascript
const response = await fetch('/api/evaluate-multi-file', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    assignment_text: "الواجب...",
    solutions: [
      { file_label: "ملف 1", file_content: "محتوى 1" },
      { file_label: "ملف 2", file_content: "محتوى 2" }
    ]
  })
});

const result = await response.json();
```

### 3️⃣ من مكون React

```typescript
'use client';

import useEvaluateMultiFile from '@/hooks/useEvaluateMultiFile';
import { useState } from 'react';

export default function MyComponent() {
  const { evaluateMultiFile } = useEvaluateMultiFile();
  const [result, setResult] = useState(null);

  const handleEvaluate = async () => {
    const res = await evaluateMultiFile({
      assignment_text: "الواجب...",
      solutions: [
        { file_label: "ملف 1", file_content: "محتوى 1" },
        { file_label: "ملف 2", file_content: "محتوى 2" }
      ]
    });
    
    if (res.success) {
      setResult(res);
    } else {
      console.error('خطأ:', res.error);
    }
  };

  return <button onClick={handleEvaluate}>تقييم</button>;
}
```

---

## 🧪 الاختبار

### ✅ اختبار البيانات من الـ UI

افتح الرابط: `http://localhost:3000/test-multi-file`

هذه صفحة اختبار تفاعلية توضح:
1. كيفية إرسال ملفات متعددة
2. كيفية استقبال النتيجة
3. عرض توزيع المعايير على كل ملف

### ✅ اختبار من سطر الأوامر

**اختبار الـ Backend مباشرة** (بدون Frontend):

```bash
cd backend
python test_integrated_multi_file.py
```

**النتيجة المتوقعة**:
```
✅ النتيجة النهائية: DISTINCTION
عدد الملفات المقيّمة: 2
📊 توزيع المعايير:
📁 TalkMateAI: ✅ P1, ✅ M1, ✅ D1
📁 Phase-1: ✅ P1, ✅ M1, ✅ D1
```

### ✅ اختبار مع curl

```bash
curl -X POST http://localhost:3000/api/evaluate-multi-file \
  -H "Content-Type: application/json" \
  -d '{
    "assignment_text": "قارن بين نظامين",
    "solutions": [
      {
        "file_label": "النظام الأول",
        "file_content": "وصف النظام الأول..."
      },
      {
        "file_label": "النظام الثاني", 
        "file_content": "وصف النظام الثاني..."
      }
    ]
  }'
```

---

## ✅ التحقق من أن النظام يعمل بشكل صحيح

### 1️⃣ تحقق من وجود جميع الملفات

```bash
# الـ Hook
test -f hooks/useEvaluateMultiFile.ts && echo "✅ Hook موجود"

# الـ Frontend Route
test -f "frontend/src/app/api/evaluate-multi-file/route.ts" && echo "✅ Frontend Route موجود"

# الـ Backend Service  
test -f "backend/app/services/integrated_grader.py" && echo "✅ Backend Service موجود"

# الـ UI Components
test -f components/MultiFileEvaluationExample.tsx && echo "✅ Example Component موجود"
test -f "app/test-multi-file/page.tsx" && echo "✅ Test Page موجود"
```

### 2️⃣ تحقق من الـ Backend Endpoint

```bash
# ابدأ الـ Backend
cd backend
call venv311\Scripts\activate.bat
python app/main.py

# في نافذة أخرى
curl -X POST http://127.0.0.1:8000/ \
  -H "Content-Type: application/json" \
  -d '{"assignment_text":"test","solutions":[{"file_label":"f1","file_content":"test content here for testing"}]}'
```

### 3️⃣ تحقق من وجود Edge Cases

**الحالة 1: ملف واحد فقط**
```json
{
  "assignment_text": "الواجب",
  "solutions": [
    {"file_label": "الملف الوحيد", "file_content": "محتوى..."}
  ]
}
```
✅ يجب أن يعمل (لا يوجد متطلب لـ N ملفات)

**الحالة 2: ملفات بدون وصف**
```json
{
  "solutions": [
    {"file_label": "ملف 1", "file_content": "محتوى..."},
    {"file_label": "ملف 2", "file_content": "محتوى..."}
  ]
}
```
✅ يجب أن يعمل (الـ description اختياري)

**الحالة 3: محتوى فارغ**
```json
{
  "solutions": [
    {"file_label": "ملف 1", "file_content": ""}
  ]
}
```
❌ يجب أن يرفع (محتوى < 50 حرف)

---

## 🔍 كيفية تشخيص المشاكل

### المشكلة: "مازال يقرا ملف واحد"

**الخطوة 1: تحقق من Network Tab**

```
في DevTools:
1. افتح Console
2. Network tab
3. ابحث عن طلب '/api/evaluate-multi-file'
4. شوف الـ Request Body - هل يحتوي على solutions array؟
5. شوف الـ Response - هل يحتوي على file_distribution؟
```

**الخطوة 2: تفعيل السجلات**

في `hooks/useEvaluateMultiFile.ts` مضاف بالفعل logging:
```
📁 تقييم متكامل لـ X ملف(ات)
✅ التقييم مكتمل - النتيجة: [GRADE]
📊 عدد الملفات: X
```

يجب أن ترى هذه الرسائل في Console.

**الخطوة 3: تحقق من الـ Frontend Route**

في `frontend/src/app/api/evaluate-multi-file/route.ts`:
- يجب أن يعيد undefined إذا لم يستقبل solutions array
- يجب أن يتحقق من طول كل محتوى ملف

### المشكلة: تم إرسال ملفات لكن تم تقييم ملف واحد فقط

**السبب المحتمل 1**: الـ Frontend يرسل solutions لكن كل واحد فارغ
```javascript
// ❌ خطأ
solutions: [
  { file_label: "ملف 1", file_content: "" },
  { file_label: "ملف 2", file_content: "" }
]
// سيتم تصفيتهم وتبقى 0 ملفات
```

**السبب المحتمل 2**: الـ Frontend يرسل ملف واحد فقط
```javascript
// هل يوجد loop يجمع الملفات؟
// تحقق من الكود الذي يعدّ solutions array
```

**السبب المحتمل 3**: الـ Backend يستقبل كل ملف منفصل
```javascript
// ❌ خطأ - كل ملف انفصالي
POST /api/evaluate { "student_text": "ملف 1" }
POST /api/evaluate { "student_text": "ملف 2" }

// ✅ صحيح - كل الملفات معاً
POST /api/evaluate-multi-file {
  "solutions": [
    { "file_content": "ملف 1" },
    { "file_content": "ملف 2" }
  ]
}
```

---

## 📝 ملخص الملفات المصنوعة

| الملف | الموقع | الغرض |
|------|--------|-------|
| **useEvaluateMultiFile.ts** | `hooks/` | Hook لاستدعاء API متعدد الملفات |
| **MultiFileEvaluationExample.tsx** | `components/` | مثال عملي لاستخدام النظام |
| **test-multi-file/page.tsx** | `app/` | صفحة اختبار تفاعلية |
| **integrated_grader.py** | `backend/app/services/` | خدمة دمج وتقييم الملفات |
| **evaluate-multi-file/route.ts** | `frontend/src/app/api/` | Route الـ Frontend للطلب |
| **main.py** | `backend/` | تحديثات الـ FastAPI الرئيسي |

---

## 🎓 خطوات التكامل الكاملة

### خطوة 1: للمطورين الذين يستخدمون Hook

```typescript
import useEvaluateMultiFile from '@/hooks/useEvaluateMultiFile';

const { evaluateMultiFile } = useEvaluateMultiFile();
const result = await evaluateMultiFile({...});
```

### خطوة 2: للمطورين الذين يستخدمون الـ API مباشرة

```typescript
const response = await fetch('/api/evaluate-multi-file', {
  method: 'POST',
  body: JSON.stringify({
    assignment_text: '...',
    solutions: [...]
  })
});
```

### خطوة 3: التحقق من النتيجة

```typescript
interface MultiFileEvaluationResult {
  success: boolean;
  final_grade: string;        // "DISTINCTION" | "MERIT" | "PASS" | "FAIL"
  files_evaluated: number;    // عدد الملفات المدمجة
  file_distribution: {        // أي ملف يساهم في أي معيار
    [fileLabel: string]: {
      [criterion: string]: boolean
    }
  };
  consolidated_summary: string; // الملخص الموحد
  criteria: {                   // تفاصيل كل معيار
    [code: string]: {
      achieved: boolean;
      reasoning: string;
      evidence_quote: string;
    }
  };
}
```

---

## 🚀 الخطوات التالية (Future)

1. **UI للاختيار المتعدد**: واجهة لرفع عدة ملفات
2. **معاينة الملفات**: عرض الملفات قبل الإرسال
3. **التقدم**: شريط تقدم أثناء التقييم
4. **الحفظ**: تخزين النتائج محليًا
5. **المقارنة**: مقارنة نتائج ملفات مختلفة

---

## 📞 الدعم والتوثيق

- **توثيق الـ Hook**: See `useEvaluateMultiFile.ts` (JSDoc)
- **توثيق الـ API**: See `frontend/src/app/api/evaluate-multi-file/route.ts`
- **توثيق الـ Backend**: See `backend/app/services/integrated_grader.py`
- **مثال استخدام**: See `components/MultiFileEvaluationExample.tsx`
- **اختبار تفاعلي**: Visit `http://localhost:3000/test-multi-file`

---

**آخر تحديث**: 2024
**الحالة**: ✅ جاهز للإنتاج
