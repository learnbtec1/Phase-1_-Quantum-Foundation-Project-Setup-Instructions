# 🏥 فحص صحة الخادم (Backend Health Check)

## 🚨 المشكلة المحتملة

```
الأعراض:
❌ "مازال يقرا ملف واحد"
❌ System يعمل بـ "اسوأ" من قبل
❌ كان يعمل مسبقا، الآن تدهور الأداء

السبب المحتمل:
🔴 Backend غير مشغل بشكل صحيح
🔴 API Key غير مصحح
🔴 اسم النموذج غير صحيح
🔴 المتطلبات لم تُثبَّت بشكل صحيح
```

---

## ⚡ فحص سريع (2 دقيقة)

### الخطوة 1: تحقق من Backend

```bash
# افتح Terminal وجرّب:
curl http://127.0.0.1:8000/

# يجب أن تشاهد:
{"status":"Online","engine":"GPT-4o Forensic Mode",...}

# إذا فشل (Connection refused):
→ Backend غير مشغل
```

### الخطوة 2: تحقق من التوافقية

```bash
# في cmd/PowerShell
cd backend

# تأكد من البيئة الافتراضية
call venv311\Scripts\activate.bat

# جرّب استيراد المكتبات
python -c "import fastapi; print('FastAPI OK')"
python -c "import openai; print('OpenAI OK')"
python -c "import anthropic; print('Anthropic OK')"

# يجب أن ترى: OK لكل واحد
```

### الخطوة 3: تحقق من API Keys

```bash
# في نفس Terminal
cd backend

# اعرض المفاتيح (احذر من نسخها)
type .env | find "API_KEY"

# يجب أن ترى:
# OPENAI_API_KEY=sk-...
# أو
# ANTHROPIC_API_KEY=sk-ant-...
```

---

## 🔧 إصلاح البيئة (5 دقائق)

### إذا كان Backend لا يعمل:

```bash
# 1️⃣ افتح Terminal جديد
# 2️⃣ اذهب للمشروع
cd backend

# 3️⃣ فعّل البيئة الافتراضية
call venv311\Scripts\activate.bat

# 4️⃣ تثبيت المتطلبات (للتأكد)
pip install -r requirements.txt

# 5️⃣ شغّل الخادم
python app/main.py

# تأكد أن ترى:
# INFO:     Uvicorn running on http://127.0.0.1:8000

# إذا رأيت هذه الرسالة → ✅ نجح!
```

### إذا حدثت أخطاء:

```bash
# خطأ "ModuleNotFoundError"
→ pip install -r requirements.txt

# خطأ "OPENAI_API_KEY not found"
→ تحقق من backend/.env

# خطأ "Port 8000 already in use"
→ امنح الـ Process هذا:
   netstat -ano | find "8000"
   taskkill /PID <PID> /F
```

---

## 🎯 فحص النموذج (Model)

### اعرض النموذج المستخدم الحالي

```bash
# في backend/.env ابحث عن:
GRADER_MODEL=???

# يجب أن يكون واحد من:
✅ gpt-4o
✅ gpt-4o-mini
✅ claude-3-5-sonnet-20241022
```

### إذا كان النموذج خاطئ:

```bash
# ملف backend/.env

# ❌ خطأ شائع:
GRADER_MODEL=claude-4-6-sonnet-latest

# ✅ صحيح:
GRADER_MODEL=claude-3-5-sonnet-20241022
```

---

## 🧪 اختبار شامل (في Terminal)

### اختبر الـ Backend مباشرة

```bash
# 1️⃣ تأكد أن Backend يعمل
curl http://127.0.0.1:8000/
# يجب أن يرجع JSON

# 2️⃣ اختبر endpoint التقييم
curl -X POST http://127.0.0.1:8000/api/v1/assessment/evaluate-multi-file ^
  -H "Content-Type: application/json" ^
  -d "{\"assignment_text\":\"الواجب\",\"solutions\":[{\"file_label\":\"ملف\",\"file_content\":\"هذا نص تجريبي للاختبار. \"}]}"

# 3️⃣ شاهد الرسالة
# إذا رأيت خطأ مثل:
# "final_grade": "FAIL"
# → ✅ Backend يعمل!

# إذا رأيت:
# "error": "...API key..."
# → ❌ مشكلة في API Key
```

---

## 📋 قائمة التحقق السريعة

```
☑️ هل Backend مشغل؟
   curl http://127.0.0.1:8000/
   يجب أن يستجيب

☑️ هل البيئة الافتراضية فعّالة؟
   pip show fastapi
   يجب أن يرى المكتبات

☑️ هل API Key موجود؟
   type backend\.env | find API_KEY
   يجب أن يظهر مفتاح

☑️ هل اسم النموذج صحيح؟
   type backend\.env | find GRADER_MODEL
   يجب أن يكون من القائمة الصحيحة

☑️ هل يمكن الاتصال بـ OpenAI/Anthropic؟
   python test_env_loading.py
   يجب أن ينجح
```

---

## 🚨 إذا ظلت المشكلة

### أعد تثبيت كل شيء:

```bash
# 1️⃣ احذف البيئة الافتراضية القديمة
rmdir /s backend\venv311

# 2️⃣ أنشئ بيئة جديدة
python -m venv backend\venv311

# 3️⃣ فعّلها
cd backend
call venv311\Scripts\activate.bat

# 4️⃣ ثبّت المتطلبات من جديد
pip install -r requirements.txt

# 5️⃣ شغّل الخادم
python app/main.py
```

---

## 💡 نصيحة ذهبية

```
إذا قال النظام "مازال يقرا ملف واحد"
و Backend يستجيب بـ 200 OK في اختبارك

→ المشكلة 99% في الـ Frontend (الـ UI)
→ وليس في الـ Backend

الحل: اتبع UPGRADE_GUIDE.md
```

---

## 📞 الأعراض والحلول السريعة

| العرض | السبب | الحل |
|------|------|------|
| `Connection refused` | Backend لا يعمل | شغّل: `python app/main.py` |
| `Invalid model name` | اسم نموذج خاطئ | تحقق من `backend/.env` |
| `API key invalid` | مفتاح غير صحيح | تحقق من المفتاح وساريته |
| `Timeout` | خادم بطيء | زيادة معامل TIMEOUT |
| `Rate limit` | عدد طلبات كثير | قلل العدد أو انتظر ساعة |

---

**الخطوة التالية**: شغّل الخادم واختبره الآن! 🚀
