# 🔄 دليل الترقية السريعة - من API القديم إلى الجديد

## ⚡ الملخص الفوري

```
❌ قديم:  /api/evaluate (ملف واحد)
✅ جديد:  /api/evaluate-multi-file (ملفات متعددة)

الفرق الوحيد: تمرير مصفوفة بدلاً من نص واحد
```

---

## 🔀 المقارنة السريعة

### الطريقة القديمة ❌
```typescript
// قديم
const response = await fetch('/api/evaluate', {
  method: 'POST',
  body: JSON.stringify({
    student_text: "محتوى الحل"  // ملف واحد
  })
});

const result = await response.json();
console.log(result.grade);  // الدرجة
```

### الطريقة الجديدة ✅
```typescript
// جديد
const response = await fetch('/api/evaluate-multi-file', {
  method: 'POST',
  body: JSON.stringify({
    assignment_text: "نص الواجب",
    solutions: [  // ملفات متعددة
      { file_label: "ملف 1", file_content: "محتوى 1" },
      { file_label: "ملف 2", file_content: "محتوى 2" }
    ]
  })
});

const result = await response.json();
console.log(result.data.final_grade);      // الدرجة
console.log(result.data.file_distribution); // توزيع الملفات
```

---

## 📝 خطوات الترقية البسيطة

### خطوة 1: ابحث عن الكود القديم
```bash
# في VS Code
Ctrl+Shift+F
ابحث عن: "/api/evaluate"

يجب أن تجد شيء مثل:
- fetch('/api/evaluate')
- useAssessment().evaluate()
```

### خطوة 2: حدّد نوع الكود

#### نوع A: fetch مباشر
```typescript
❌ القديم:
await fetch('/api/evaluate', {
  method: 'POST',
  body: JSON.stringify({ student_text: content })
})

✅ الجديد:
await fetch('/api/evaluate-multi-file', {
  method: 'POST',
  body: JSON.stringify({
    assignment_text: assignmentText,
    solutions: [
      { file_label: "ملف", file_content: content }
    ]
  })
})
```

#### نوع B: useAssessment Hook
```typescript
❌ القديم:
const { evaluate } = useAssessment();
await evaluate(studentText);

✅ الجديد:
const { evaluateMultiFile } = useEvaluateMultiFile();
await evaluateMultiFile({
  assignment_text: assignmentText,
  solutions: [
    { file_label: "ملف", file_content: studentText }
  ]
});
```

---

## 🛠️ أنماط الترقية الشهيرة

### النمط 1: Component بسيط
```typescript
// ❌ قديم
export default function Assessment() {
  const [content, setContent] = useState('');
  
  const handleEvaluate = async () => {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({ student_text: content })
    });
    const data = await res.json();
    alert(data.grade);
  };
  
  return (
    <>
      <textarea value={content} onChange={e => setContent(e.target.value)} />
      <button onClick={handleEvaluate}>تقييم</button>
    </>
  );
}
```

```typescript
// ✅ جديد
export default function Assessment() {
  const [content, setContent] = useState('');
  const { evaluateMultiFile } = useEvaluateMultiFile();
  
  const handleEvaluate = async () => {
    const res = await evaluateMultiFile({
      assignment_text: "الواجب",
      solutions: [
        { file_label: "الحل", file_content: content }
      ]
    });
    if (res.success) alert(res.final_grade);
  };
  
  return (
    <>
      <textarea value={content} onChange={e => setContent(e.target.value)} />
      <button onClick={handleEvaluate}>تقييم</button>
    </>
  );
}
```

---

### النمط 2: تقييم ملفات متعددة
```typescript
// ✅ جديد - الميزة الرئيسية
export default function MultiFileAssessment() {
  const [files, setFiles] = useState([
    { label: 'ملف 1', content: '' },
    { label: 'ملف 2', content: '' }
  ]);
  const { evaluateMultiFile } = useEvaluateMultiFile();
  
  const handleEvaluate = async () => {
    const solutions = files.map(f => ({
      file_label: f.label,
      file_content: f.content
    }));
    
    const res = await evaluateMultiFile({
      assignment_text: "قارن بين نظامين",
      solutions: solutions
    });
    
    if (res.success) {
      console.log('الدرجة:', res.final_grade);
      console.log('توزيع الملفات:', res.file_distribution);
    }
  };
  
  return (
    <div>
      {files.map((file, idx) => (
        <textarea
          key={idx}
          value={file.content}
          onChange={e => {
            const updated = [...files];
            updated[idx].content = e.target.value;
            setFiles(updated);
          }}
          placeholder={file.label}
        />
      ))}
      <button onClick={handleEvaluate}>تقييم</button>
    </div>
  );
}
```

---

### النمط 3: Hook معقد (useAssessment القديم)
```typescript
// ❌ قديم
export default function MyComponent() {
  const { evaluate, assessment } = useAssessment();
  
  const handleSubmit = async () => {
    await evaluate(studentAnswer);
    console.log(assessment.grade);
  };
}

// ✅ جديد
export default function MyComponent() {
  const { evaluateMultiFile } = useEvaluateMultiFile();
  
  const handleSubmit = async () => {
    const result = await evaluateMultiFile({
      assignment_text: assignment,
      solutions: [
        { file_label: 'إجابة الطالب', file_content: studentAnswer }
      ]
    });
    
    if (result.success) {
      console.log(result.final_grade);
      console.log(result.consolidated_summary);
    }
  };
}
```

---

## 🔀 جدول التحويل السريع

| العنصر | القديم ❌ | الجديد ✅ |
|--------|---------|--------|
| **API Endpoint** | `/api/evaluate` | `/api/evaluate-multi-file` |
| **حقول الطلب** | `{ student_text }` | `{ assignment_text, solutions[] }` |
| **Hook** | `useAssessment()` | `useEvaluateMultiFile()` |
| **دالة الاستدعاء** | `evaluate(text)` | `evaluateMultiFile({...})` |
| **حقول النتيجة** | `{ grade, feedback }` | `{ final_grade, file_distribution }` |
| **ملفات متعددة** | غير مدعوم ❌ | مدعوم ✅ |

---

## ⚡ أسرع طرق الترقية (Copy-Paste)

### السيناريو 1: ملف واحد فقط
```typescript
// قبل التعديل
const res = await fetch('/api/evaluate', {
  method: 'POST',
  body: JSON.stringify({ student_text: myText })
});

// بعد التعديل (ببساطة استبدل)
const res = await fetch('/api/evaluate-multi-file', {
  method: 'POST',
  body: JSON.stringify({
    assignment_text: "الواجب",
    solutions: [{ file_label: "الحل", file_content: myText }]
  })
});
```

### السيناريو 2: الحصول على النتيجة
```typescript
// قبل
const data = await res.json();
console.log(data.grade);

// بعد (لاحظ: data.data)
const data = await res.json();
console.log(data.data.final_grade);  // اضيفنا .data.
```

### السيناريو 3: استخدام Hook
```typescript
// قبل
const hook = useAssessment();
hook.evaluate(text);

// بعد
const { evaluateMultiFile } = useEvaluateMultiFile();
evaluateMultiFile({ assignment_text, solutions: [{...}] });
```

---

## 🧪 اختبر الترقية

### اختبار سريع
```typescript
// اضف في component
useEffect(() => {
  const test = async () => {
    const { evaluateMultiFile } = useEvaluateMultiFile();
    const res = await evaluateMultiFile({
      assignment_text: "الواجب: اكتب شيء",
      solutions: [
        { file_label: "Test", file_content: "هذا نص اختبار" + "x".repeat(100) }
      ]
    });
    console.log('✅ نجحت الترقية!', res.final_grade);
  };
  test();
}, []);

// انظر في Console
// يجب أن تشاهد: ✅ نجحت الترقية! [GRADE]
```

---

## ⚠️ أشياء يجب الانتباه لها

### مشكلة 1: النتيجة تحت `data.data`
```typescript
// الرد يأتي بصيغة:
{
  "success": true,
  "data": {
    "final_grade": "MERIT",
    "files_evaluated": 1,
    ...
  }
}

// لذا صحح:
console.log(result.data.final_grade);  // صحيح ✅
console.log(result.final_grade);       // خطأ ❌
```

### مشكلة 2: solutions يجب أن تكون مصفوفة
```typescript
// ❌ خطأ
solutions: { file_label: "...", file_content: "..." }

// ✅ صحيح
solutions: [
  { file_label: "...", file_content: "..." }
]
```

### مشكلة 3: file_content يجب 50+ حرف
```typescript
// ❌ سيرفع خطأ
file_content: "قصير جداً"

// ✅ يجب على الأقل 50 حرف
file_content: "محتوى long..." // 50+ حرف
```

---

## 📋 قائمة تحقق الترقية

```
قبل الترقية:
- [ ] عثرت على الكود القديم (/api/evaluate)
- [ ] حددت نوع الكود (fetch أم Hook)
- [ ] عملت نسخة backup

أثناء الترقية:
- [ ] استبدلت الـ Endpoint
- [ ] استبدلت صيغة البيانات (solutions[])
- [ ] استبدلت طريقة إرجاع النتيجة (data.data)

بعد الترقية:
- [ ] اختبرت الـ Component
- [ ] تحققت من Console (لا توجد أخطاء)
- [ ] اختبرت من Browser Developer Tools (Network)
- [ ] تأكدت أن النتيجة تأتي بشكل صحيح
```

---

## 🎓 مثال شامل: قبل وبعد

### قبل الترقية ❌
```typescript
'use client';

import { useState } from 'react';

export default function AssessmentOld() {
  const [studentText, setStudentText] = useState('');
  const [result, setResult] = useState(null);

  const handleEvaluate = async () => {
    const response = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_text: studentText  // ملف واحد فقط
      })
    });
    
    const data = await response.json();
    setResult(data);
  };

  return (
    <div>
      <textarea value={studentText} onChange={e => setStudentText(e.target.value)} />
      <button onClick={handleEvaluate}>تقييم</button>
      {result && <p>الدرجة: {result.grade}</p>}
    </div>
  );
}
```

### بعد الترقية ✅
```typescript
'use client';

import { useState } from 'react';
import useEvaluateMultiFile from '@/hooks/useEvaluateMultiFile';

export default function AssessmentNew() {
  const [studentText, setStudentText] = useState('');
  const [result, setResult] = useState(null);
  const { evaluateMultiFile } = useEvaluateMultiFile();

  const handleEvaluate = async () => {
    const res = await evaluateMultiFile({
      assignment_text: "الواجب: اكتب إجابة",
      solutions: [
        {
          file_label: "إجابة الطالب",
          file_content: studentText  // نفس المحتوى
        }
      ]
    });
    
    if (res.success) {
      setResult(res);
    }
  };

  return (
    <div>
      <textarea value={studentText} onChange={e => setStudentText(e.target.value)} />
      <button onClick={handleEvaluate}>تقييم</button>
      {result && (
        <div>
          <p>الدرجة: {result.final_grade}</p>
          <p>عدد الملفات: {result.files_evaluated}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 📞 الدعم

### إذا فشلت الترقية
```
1. تحقق من قائمة التحقق أعلاه
2. اقرأ section "أشياء يجب الانتباه لها"
3. افتح /debug-multi-file واختبر
4. اقرأ DEBUG_GUIDE.md
```

### إذا احتجت مساعدة إضافية
```
1. تحقق من: MULTI_FILE_SYSTEM.md
2. روجع: components/MultiFileEvaluationExample.tsx
3. اختبر: app/test-multi-file/page.tsx
```

---

## 🎉 النتيجة بعد الترقية

```
✅ تدعم الآن ملفات متعددة
✅ نتائج أفضل و أدق
✅ توزيع معايير لكل ملف
✅ توافق مع النظام الجديد
✅ استعداد للمستقبل
```

---

**ملاحظة نهائية**: الترقية بسيطة جداً! فقط غيّر الـ Endpoint واستخدم صيغة البيانات الجديدة. 🚀
