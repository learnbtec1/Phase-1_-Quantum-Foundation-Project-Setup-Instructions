# 🚀 تشغيل فحص صحة البيئة

## ⚡ الطريقة السريعة (30 ثانية)

### في Command Prompt أو PowerShell:

```bash
# 1️⃣ اذهب لمجلد المشروع
cd "e:\Phase 1_ Quantum Foundation Project Setup Instructions"

# 2️⃣ شغّل الفحص
python backend/health_check.py
```

### النتيجة:
```
✅ Python موجود
✅ البيئة الافتراضية موجودة
✅ المكتبات مثبتة
✅ ملف .env موجود
❌ Backend لا يستجيب
   💡 حل: شغّل 'python app/main.py' من مجلد backend
```

---

## 📋 ماذا يفحص؟

الفحص يتحقق من:

```
✅ Python موجود
✅ البيئة الافتراضية (venv311)
✅ المكتبات المثبتة (FastAPI, OpenAI, Anthropic)
✅ ملف .env موجود
✅ API Keys موجودة
✅ اسم النموذج صحيح
✅ Backend يعمل على http://127.0.0.1:8000/
✅ استدعاء API يعمل بنجاح
```

---

## 🆘 إذا حدثت مشاكل

### مشكلة: "Backend لا يستجيب"

```bash
# ✅ الحل:
cd backend
call venv311\Scripts\activate.bat
python app/main.py

# انتظر حتى ترى:
# INFO:     Uvicorn running on http://127.0.0.1:8000
```

### مشكلة: "المكتبات غير مثبتة"

```bash
# ✅ الحل:
cd backend
call venv311\Scripts\activate.bat
pip install -r requirements.txt
```

### مشكلة: "ملف .env غير موجود"

```bash
# ✅ الحل:
# انسخ backend\\.env.example إلى backend\\.env
# أو أنشئ الملف يدويًا مع المفاتيح:

# backend\.env
GRADER_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

---

## 🎯 الخطوات الموصى بها

```
1️⃣ شغّل: python backend/health_check.py
2️⃣ اقرأ النتائج
3️⃣ صحح أي مشاكل
4️⃣ شغّل الفحص مرة أخرى
5️⃣ عندما يمر كل الفحوصات → كل شيء جاهز ✅
```

---

## 📞 للدعم السريع

| مشكلة | الحل |
|------|------|
| Port 8000 مستخدم | `netstat -ano \| find "8000"` ثم `taskkill /PID` |
| Python لا يعمل | تأكد من وجوده: `python --version` |
| venv errors | احذف `backend\venv311` وأنشئ جديدة |
| API key invalid | تحقق من صحة المفتاح في `.env` |

---

**الآن**: `python backend/health_check.py` 🚀
