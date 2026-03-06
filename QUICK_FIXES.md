# 🔧 المشاكل والحلول السريعة

## 🆘 الفحص فشل

### ❌ "Python غير موجود"

```bash
# الحل: تثبيت Python 3.11
# Windows: اذهب https://python.org
# أو استخدم الموجود:
python --version
```

### ❌ "البيئة الافتراضية غير موجودة"

```bash
# الحل:
cd backend
python -m venv venv311

# أو إذا كنت تستخدم Python 3.11 بشكل مباشر:
py -3.11 -m venv venv311
```

### ❌ "المكتبات غير مثبتة"

```bash
# الحل:
cd backend
call venv311\Scripts\activate.bat
pip install -r requirements.txt

# انتظر حتى تنتهي (قد يستغرق دقائق)
```

### ❌ "ملف .env غير موجود"

```bash
# الحل 1: انسخ الملف الموجود
cd backend
copy .env.example .env

# الحل 2: أنشئ الملف يدويًا
# المحتوى الأساسي:
GRADER_MODEL=gpt-4o
OPENAI_API_KEY=sk-proj-xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
CONCURRENT=1
DELAY=2.5
MAX_TOKENS=3000
```

### ❌ "API Key غير موجود"

```bash
# الحل:
# 1. قم بزيارة https://platform.openai.com/api-keys
# 2. أنشئ مفتاح جديد
# 3. أضفه في backend/.env:
OPENAI_API_KEY=sk-proj-xxxxx
```

### ❌ "Backend لا يستجيب"

```bash
# الحل:
cd backend

# 1. فعّل البيئة الافتراضية
call venv311\Scripts\activate.bat

# 2. شغّل Backend
python app/main.py

# 3. انتظر حتى ترى:
# INFO:     Uvicorn running on http://127.0.0.1:8000

# 4. في terminal منفصل، اختبر:
# curl http://127.0.0.1:8000/
```

---

## 🆘 الاختبار فشل

### ❌ "صفحة debug-multi-file لا تفتح"

```bash
# الحل 1: تأكد من تشغيل Frontend
cd frontend
npm run dev

# الحل 2: تأكد من البورت الصحيح
# يجب أن يكون: http://localhost:3000/debug-multi-file
```

### ❌ "API call يفشل (HTTP 500)"

```bash
# المشكلة غالباً: Backend لا يعمل أو API Key خاطئ

# الحل 1: شغّل Backend
cd backend
call venv311\Scripts\activate.bat
python app/main.py

# الحل 2: تحقق من API Key
# افتح backend/.env
# تأكد من: OPENAI_API_KEY=sk-proj-xxxxx
```

### ❌ "API call يفشل (Timeout)"

```bash
# المشكلة: Backend بطيء أو معلق

# الحل:
# 1. اقتل البروسيس:
taskkill /F /IM python.exe

# 2. شغّل Backend مرة أخرى:
cd backend
call venv311\Scripts\activate.bat
python app/main.py
```

### ❌ "API call يفشل (401 Unauthorized)"

```bash
# المشكلة: API Key خاطئ

# الحل:
# 1. تحقق من المفتاح:
# https://platform.openai.com/api-keys

# 2. اسخه بدقة:
# OPENAI_API_KEY=sk-proj-xxxxx

# 3. احفظ الملف وأعد تشغيل Backend
```

### ❌ "API call يفشل (Model not found)"

```bash
# المشكلة: اسم النموذج خاطئ

# الحل 1: استخدم نماذج معروفة:
GRADER_MODEL=gpt-4o            # OpenAI
# أو
GRADER_MODEL=claude-3-5-sonnet-20241022  # Anthropic

# الحل 2: تحقق من اسم النموذج:
# OpenAI: https://platform.openai.com/docs/models
# Anthropic: https://docs.anthropic.com/models
```

---

## 🆘 مشاكل الأداء

### 🐢 "Backend بطيء جداً"

```bash
# المشكلة: الطلبات تأخذ وقت طويل

# الحلول:
# 1. استخدم نموذج أسرع:
GRADER_MODEL=gpt-4o-mini  # أسرع من gpt-4o

# 2. قلل حجم الملفات:
# Backend يقص الملفات تلقائياً إلى:
# - Assignment: 30,000 حرف
# - Student: 150,000 حرف

# 3. تحقق من الاتصال بالإنترنت
ping 8.8.8.8
```

### 🐢 "Frontend بطيء"

```bash
# الحل:
# 1. تأكد من npm run dev يعمل
npm run dev

# 2. امسح cache:
rm -rf .next
npm run dev
```

---

## 🆘 مشاكل الملفات

### ❌ "ملف project.txt غير موجود"

```bash
# الحل:
# هذا ملف اختياري فقط
# تجاهله! لا تحتاجه
```

### ❌ "هل أحتاج لملف database؟"

```bash
# لا! النظام الحالي لا يستخدم قاعدة بيانات
# كل شيء في الذاكرة أو API
```

---

## 📱 مشاكل Port

### ❌ "Port 3000 مستخدم (Frontend)"

```bash
# المشكلة: تطبيق آخر يستخدم نفس البورت

# الحل 1: اقتل البروسيس
# Windows:
netstat -ano | findstr :3000
taskkill /PID xxxxx /F

# الحل 2: استخدم port مختلف
# في frontend/.env.local:
PORT=3001
npm run dev
```

### ❌ "Port 8000 مستخدم (Backend)"

```bash
# المشكلة: Backend قديم يعمل

# الحل 1: اقتل البروسيس
# Windows:
netstat -ano | findstr :8000
taskkill /PID xxxxx /F

# الحل 2: استخدم port مختلف
# في backend/app/main.py:
# if __name__ == "__main__":
#     uvicorn.run(..., port=8001)
```

---

## 🆘 مشاكل الترميز

### ❌ "أخطاء في النصوص العربية"

```bash
# الحل: تأكد من encoding UTF-8
# في أعلى ملفات Python:
# -*- coding: utf-8 -*-

# في ملفات JSON:
# استخدم UTF-8 encoding
```

---

## 📞 عند الفشل الكامل

```bash
# 1. اقرأ رسالة الخطأ بحذر
# 2. ابحث فيها في أعلاه
# 3. إذا لم تجد حل:

# أعد تعيين كل شيء:
cd backend
rmdir /s /q venv311  # احذف البيئة القديمة
python -m venv venv311  # أنشئ جديدة
call venv311\Scripts\activate.bat
pip install -r requirements.txt

# ثم حاول مرة أخرى:
python health_check.py
```

---

## ✅ كيفية التحقق من الحل

بعد أي إصلاح:

```bash
# 1. شغّل الفحص مرة أخرى:
python backend/health_check.py

# 2. تحقق من النتائج:
# ✅ = نجاح
# ❌ = فشل

# 3. إذا كان كل شيء ✅:
# انتقل للاختبار التالي
```

---

**مشكلتك قد لا تكون هنا؟** اقرأ `BACKEND_HEALTH_CHECK.md` 📖
