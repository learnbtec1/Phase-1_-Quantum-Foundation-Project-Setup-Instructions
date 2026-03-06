# نظام التقييم المزدوج (Dual-Provider Grading System)

## نظرة عامة

تم تحديث محرك التقييم ليدعم **كلاً من OpenAI و Anthropic Claude** كمقيّمين. النظام يختار المزود تلقائياً بناءً على اسم النموذج المحدد في متغيرات البيئة.

---

## المزودون المدعومون

| المزود | اسم النموذج | يُستخدم عندما | المفتاح المطلوب |
|---|---|---|---|
| **Anthropic Claude** | `claude-sonnet-4-5` | `GRADER_MODEL` يبدأ بـ `claude-` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini` | `GRADER_MODEL` يبدأ بـ `gpt-` أو `o1-` | `OPENAI_API_KEY` |

---

## الإعداد (Setup)

### 1. تثبيت المكتبات المطلوبة

```bash
cd backend
pip install -r requirements.txt
```

يتضمن `requirements.txt` كلاً من:
- `openai>=1.0.0`
- `anthropic>=0.40.0`

### 2. إعداد متغيرات البيئة

في ملف `backend/.env`:

```env
# ===== استخدام Anthropic Claude (افتراضي) =====
GRADER_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here

# ===== للتبديل إلى OpenAI =====
# GRADER_MODEL=gpt-4o
# OPENAI_API_KEY=sk-your-openai-key-here

# ===== إعدادات التقييم =====
GRADER_MAX_TOKENS=3000
GRADER_MAX_CONCURRENT=2
GRADER_DELAY_SEC=1.5
```

---

## الاستخدام

### تفعيل Claude Sonnet (الافتراضي)

```env
GRADER_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

### التبديل إلى OpenAI

```env
GRADER_MODEL=gpt-4o
OPENAI_API_KEY=sk-proj-xxxxx
```

### التبديل إلى gpt-4o-mini (أسرع وأرخص)

```env
GRADER_MODEL=gpt-4o-mini
```

---

## كيف يعمل النظام؟

1. **عند بدء التشغيل**:
   - يقرأ النظام قيمة `GRADER_MODEL` من `.env`
   - إذا كان الاسم يبدأ بـ `claude-` → يهيئ `anthropic_client`
   - إذا كان الاسم يبدأ بـ `gpt-` أو `o1-` → يهيئ `openai_client`

2. **عند كل عملية تقييم**:
   - يختار النظام `active_client` المناسب حسب اسم النموذج
   - يُرسل الـ prompt إلى المزود المختار
   - يُحلل الرد بنفس الطريقة (JSON format)

3. **في حالة فقدان المفتاح**:
   - يُعيد النظام رسالة خطأ واضحة للطالب
   - يُسجل الخطأ في الـ logs

---

## الميزات الرئيسية

✅ **تبديل سلس** بدون تغيير الكود — فقط تعديل `.env`  
✅ **دعم Fallback** — إذا فشل مزود، يمكنك التبديل فوراً إلى الآخر  
✅ **نفس Prompt** — كلا المزودين يستخدمان نفس منهجية التقييم الصارمة لـ BTEC  
✅ **تهيئة ذكية** — لا تحتاج لتثبيت كلا المكتبتين (يعمل مع أي منهما)  

---

## التحقق من التهيئة

لرؤية أي مزود تم تفعيله، شغّل السيرفر وانظر للـ logs:

```bash
cd backend
python -m app.main
```

ستظهر رسالة مثل:
```
✅ Initialized Anthropic client for model: claude-sonnet-4-5
```

أو:
```
✅ Initialized OpenAI client for model: gpt-4o
```

---

## أسئلة شائعة

**س: هل يمكنني استخدام كلا المزودين في نفس الوقت؟**  
ج: نعم! ضع مفتاحي API في `.env`، ثم غيّر `GRADER_MODEL` فقط بدون إعادة تشغيل.

**س: أي مزود أفضل لمعايير BTEC؟**  
ج: Claude Sonnet 4.5 أفضل في **التقييم العميق** و**الفهم السياقي العربي**، بينما GPT-4o أسرع وأرخص.

**س: هل تتغير جودة التقييم بين المزودين؟**  
ج: الـ prompt مصمم لكليهما، لكن Claude يميل لإعطاء تحليل أكثر تفصيلاً.

**س: ماذا لو نسيت تعيين المفتاح؟**  
ج: سيظهر خطأ واضح في الـ logs: `⚠️ ANTHROPIC_API_KEY غير مُعيَّن` (أو مشابه لـ OpenAI).

---

## استكشاف الأخطاء

| المشكلة | السبب | الحل |
|---|---|---|
| `No module named 'anthropic'` | المكتبة غير مثبتة | `pip install anthropic>=0.40.0` |
| `No module named 'openai'` | المكتبة غير مثبتة | `pip install openai>=1.0.0` |
| `⚠️ ANTHROPIC_API_KEY غير مُعيَّن` | المفتاح غير موجود في `.env` | أضف `ANTHROPIC_API_KEY=sk-ant-...` |
| `❌ Unknown model provider` | اسم النموذج غير مدعوم | استخدم `claude-*` أو `gpt-*` |

---

## إعدادات الأداء الموصى بها

### للسرعة القصوى
```env
GRADER_MODEL=gpt-4o-mini
GRADER_MAX_CONCURRENT=5
GRADER_DELAY_SEC=0.5
```

### للدقة القصوى (موصى به لـ BTEC)
```env
GRADER_MODEL=claude-sonnet-4-5
GRADER_MAX_TOKENS=3000
GRADER_MAX_CONCURRENT=2
GRADER_DELAY_SEC=1.5
```

---

**تم التحديث:** 6 مارس 2026  
**الإصدار:** Forensic Engine v5.0 — Dual-Provider Edition
