# 🔧 دليل استخدام أداة التشخيص المتقدمة - حل "مازال يقرا ملف واحد"

## 🎯 الهدف

هذه الأداة تساعدك في تحديد **بالضبط** أين المشكلة:
- هل المشكلة في الـ Frontend (الإرسال)؟
- هل المشكلة في الـ Backend (الاستقبال)؟
- أم المشكلة في التكامل بين الاثنين؟

---

## 📍 خطوات الاستخدام

### 1️⃣ افتح الأداة

**الرابط**: `http://localhost:3000/debug-multi-file`

### 2️⃣ اختر الاختبار المناسب

الأداة تملك **3 أزرار**:

#### 🔵 زر "اختبر Frontend"
```
ماذا يفعل: يرسل طلب إلى /api/evaluate-multi-file بملفين
ماذا تتوقع: 
  ✅ إذا رأيت "✅ نجح الاستقبال"
     → المشكلة في Backend أو في UI الأصلية
  ❌ إذا رأيت "❌ فشل"
     → المشكلة في الـ Frontend Route نفسه
```

#### 🟣 زر "اختبر Backend"  
```
ماذا يفعل: يرسل طلب مباشرة إلى http://127.0.0.1:8000
ماذا تتوقع:
  ✅ إذا رأيت "✅ Backend استقبل الطلب بنجاح!"
     → Backend يعمل بشكل صحيح
  ❌ إذا فشل الاتصال
     → تأكد من:
        • تشغيل الـ Backend: python app/main.py
        • أن الـ Backend على port 8000
        • لا توجد مشاكل في الشبكة
```

#### 🔵 زر "اختبار شامل"
```
ماذا يفعل: يجري جميع الاختبارات تسلسلياً
ماذا تتوقع: يجب أن ترى:
  1. قائمة ملفات النظام
  2. ملخص البيانات المتوقع إرسालها
  3. نتائج اختبار Frontend
  4. نتائج اختبار Backend
```

---

## 📊 قراءة السجلات

السجلات تستخدم **أكوان مختلفة**:

| اللون | المعنى | مثال |
|------|--------|-------|
| 🔵 **أزرق** | معلومات عامة | `🧪 ابدأ اختبار إرسال الـ Frontend` |
| ⚪ **رمادي** | عمليات عادية | `📝 نص الواجب: الواجب...` |
| 🟢 **أخضر** | النجاح | `✅ نجح الاستقبال!` |
| 🔴 **أحمر** | الأخطاء | `❌ فشل: يجب إرسال ملف واحد على الأقل` |

---

## 🎯 السيناريوهات المحتملة والحلول

### السيناريو 1: "❌ مازال يقرا ملف واحد"

**الخطوة الأولى**: اضغط على **"اختبر Frontend"**

#### إذا نجح الاختبار ✅
```
رسائل ناجحة مثل:
  ✅ نجح الاستقبال!
  📊 النتيجة: DISTINCTION
  📁 عدد الملفات المُقيّمة: 2

الحل: المشكلة في الـ UI الأصلية (حيث تستدعي الـ evaluate)
  • تأكد أن الـ UI تستخدم useEvaluateMultiFile
  • أو تستدعي /api/evaluate-multi-file مباشرة
  • وليس /api/evaluate (القديمة)
```

#### إذا فشل الاختبار ❌
```
رسائل مثل:
  ❌ فشل: يجب إرسال ملف واحد على الأقل
  ❌ خطأ من الخادم: ...

الحل: تحقق من الـ Frontend Route نفسه
  • تأكد أن frontend/src/app/api/evaluate-multi-file/route.ts موجود
  • تحقق من أن الـ NEXT_PUBLIC_API_URL صحيح
  • تأكد من توصيل الـ Backend بشكل صحيح
```

---

### السيناريو 2: "❌ لا يمكن الاتصال بـ Backend"

**الخطوة الأولى**: اضغط على **"اختبر Backend"**

#### إذا رأيت ❌
```
❌ لا يمكن الاتصال بـ Backend. تأكد من تشغيله...

الحل:
1. تأكد من تشغيل البايثون backend:
   cd backend
   call venv311\Scripts\activate.bat
   python app/main.py

2. تحقق أن الـ Backend يعمل على:
   http://127.0.0.1:8000

3. جرّب الـ Health Check:
   curl http://127.0.0.1:8000/
   يجب أن يرجع: {"status":"Online",...}

4. إذا لم يعمل، تحقق من:
   • هل port 8000 مستخدم بـ process آخر؟
   • هل OPENAI_API_KEY موجود في .env؟
```

---

### السيناريو 3: "📁 عدد الملفات: 1 (بدلاً من 2)"

**الخطوة الأولى**: اضغط على **"اختبر Frontend"** و**"اختبر Backend"**

#### المشكلة المحتملة
```
الملفات لا تُجمع في مصفوفة واحدة

الحل:
1. تأكد أن الـ UI تقوم بـ:
   const solutions = [
     { file_label: "ملف 1", file_content: "..." },
     { file_label: "ملف 2", file_content: "..." }
   ];
   
   وليس:
   POST /api/evaluate { student_text: "ملف 1" }
   POST /api/evaluate { student_text: "ملف 2" }

2. تأكد أن كل ملف:
   • له file_label (اسم)
   • له file_content (محتوى > 50 حرف)
   • موجود في solutions[]
```

---

### السيناريو 4: "❌ يقول file_distribution موجود لكن ملف واحد فقط"

**الدلالة**: الـ Backend يعمل لكن يدمج الملفات كملف واحد!

```
الحل:
1. تأكد من backend/app/services/integrated_grader.py
2. تحقق من دالة combine_solution_texts()
3. تأكد أنها تأخذ جميع الملفات وتدمجها

مثال النتيجة الخاطئة:
{
  "final_grade": "MERIT",  // ❌ درجة منخفضة
  "files_evaluated": 2,
  "file_distribution": {
    "ملف 1": {"P1": true, "M1": false, "D1": false},
    "ملف 2": {"P1": false, "M1": false, "D1": false}  // ❌ كل المعايير false
  }
}

الحل المحتمل:
• تأكد أن الملفات تُدمج مع فواصل مرئية
• تأكد من أن GPT-4o يرى جميع المحتوى
• تحقق من التوكن عند دمج الملفات
```

---

## 🔍 الفحوصات المهمة

### ✅ قائمة التحقق النهائية

قبل القول "النظام مازال لا يعمل" افعل:

- [ ] اضغط على **"اختبار شامل"** وانتظر الانتهاء
- [ ] افتح Console (F12) في الـ Browser
- [ ] ابحث عن رسائل الخطأ الحمراء
- [ ] اكتب الرسالة بالضبط وافحصها
- [ ] تأكد من تشغيل الـ Backend (`http://127.0.0.1:8000`)
- [ ] اختبر الـ Health Check: `curl http://127.0.0.1:8000/`
- [ ] جرّب Frontend Route مباشرة مع curl (راجع أمثلة أدناه)

---

## 🧪 اختبارات يدوية مع curl

### اختبر Frontend Route

```bash
curl -X POST http://localhost:3000/api/evaluate-multi-file \
  -H "Content-Type: application/json" \
  -d '{
    "assignment_text": "الواجب: قارن بين نظامين",
    "solutions": [
      {
        "file_label": "System A",
        "file_content": "وصف النظام الأول. " + "x" * 200
      },
      {
        "file_label": "System B",
        "file_content": "وصف النظام الثاني. " + "y" * 200
      }
    ]
  }'
```

**النتيجة المتوقعة**: يجب أن يرجع JSON بـ `final_grade` و `files_evaluated`

### اختبر Backend Direct

```bash
curl -X POST http://127.0.0.1:8000/api/v1/assessment/evaluate-multi-file \
  -H "Content-Type: application/json" \
  -d '{
    "assignment_text": "الواجب: قارن بين منصتين",
    "solutions": [
      {
        "file_label": "Platform 1",
        "file_content": "محتوى المنصة الأولى. " + "a" * 200
      },
      {
        "file_label": "Platform 2",
        "file_content": "محتوى المنصة الثانية. " + "b" * 200
      }
    ]
  }'
```

---

## 📞 كيفية الإبلاغ عن المشكلة بدقة

إذا استمرت المشكلة، أرسل:

```
1. لقطة شاشة من أداة التشخيص
2. السجلات الكاملة (Text من القسم السفلي)
3. رسائل خطأ Console (F12 → Console)
4. نتيجة اختبار curl
5. نسخة الـ Backend و Frontend
```

---

## 📚 ملفات ذات صلة

- **Debugger**: `app/debug-multi-file/page.tsx`
- **Hook**: `hooks/useEvaluateMultiFile.ts`
- **Frontend Route**: `frontend/src/app/api/evaluate-multi-file/route.ts`
- **Backend Service**: `backend/app/services/integrated_grader.py`
- **Backend Endpoint**: `backend/app/main.py` (./api/v1/assessment/evaluate-multi-file)
- **Documentation**: `MULTI_FILE_SYSTEM.md`

---

**الملاحظة الأخيرة**: 🎯
إذا كان كل شيء يعمل في الاختبار الشامل لكن الـ UI الأصلية لا تزال تقرأ ملف واحد فقط، فالمشكلة **بنسبة 99%** أن الـ UI لا تزال تستخدم الـ `/api/evaluate` (القديم) بدلاً من `/api/evaluate-multi-file` (الجديد).
