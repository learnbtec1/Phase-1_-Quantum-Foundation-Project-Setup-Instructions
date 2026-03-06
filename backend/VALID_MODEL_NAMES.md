# أسماء النماذج الصحيحة (Valid Model Names)

## ⚠️ تحذير مهم
استخدم **الأسماء الرسمية فقط** للنماذج. أي اسم غير صحيح سيؤدي إلى خطأ API.

---

## 🤖 Anthropic Claude (الافتراضي الموصى به)

| النموذج | اسم API الصحيح | الملاحظات |
|---|---|---|
| **Claude 3.5 Sonnet (أحدث)** | `claude-3-5-sonnet-20241022` | ✅ **موصى به** — الأقوى والأحدث |
| **Claude 3.5 Sonnet (قديم)** | `claude-3-5-sonnet-20240620` | نسخة سابقة |
| **Claude 3 Opus** | `claude-3-opus-20240229` | أقوى لكن أغلى وأبطأ |
| **Claude 3 Sonnet** | `claude-3-sonnet-20240229` | نسخة قديمة |
| **Claude 3 Haiku** | `claude-3-haiku-20240307` | الأسرع والأرخص |

### استخدام في .env:
```env
GRADER_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

---

## 🧠 OpenAI GPT

| النموذج | اسم API الصحيح | الملاحظات |
|---|---|---|
| **GPT-4o** | `gpt-4o` | قوي ومتوازن |
| **GPT-4o mini** | `gpt-4o-mini` | أسرع وأرخص (موصى به للتطوير) |
| **GPT-4 Turbo** | `gpt-4-turbo` | نسخة قديمة |
| **GPT-3.5 Turbo** | `gpt-3.5-turbo` | قديم جداً |
| **o1-preview** | `o1-preview` | للاستدلال العميق |
| **o1-mini** | `o1-mini` | استدلال أسرع |

### استخدام في .env:
```env
GRADER_MODEL=gpt-4o
OPENAI_API_KEY=sk-proj-xxxxx
```

---

## ❌ أسماء خاطئة شائعة

| الاسم الخاطئ | لماذا خطأ؟ | الاسم الصحيح |
|---|---|---|
| `claude-4-6-sonnet-latest` | لا يوجد Claude 4 بعد | `claude-3-5-sonnet-20241022` |
| `claude-sonnet-4-5` | صيغة غير رسمية | `claude-3-5-sonnet-20241022` |
| `claude-sonnet-latest` | `latest` غير مدعوم | `claude-3-5-sonnet-20241022` |
| `gpt4o` | بدون شرطة | `gpt-4o` |
| `gpt-4-turbo-preview` | اسم قديم | `gpt-4-turbo` |

---

## 🔍 كيف تتحقق من الاسم؟

### Anthropic
راجع: https://docs.anthropic.com/en/docs/about-claude/models

### OpenAI
راجع: https://platform.openai.com/docs/models

---

## 🚨 استكشاف أخطاء اسم النموذج

إذا ظهرت لك رسالة:
> تقييم غير متاح حالياً. يرجى التحقق من إعدادات GRADER_MODEL...

**السبب:** اسم النموذج في `.env` غير صحيح أو المفتاح غير مُعيَّن.

**الحل:**
1. افتح `backend/.env`
2. تأكد من الاسم الصحيح (من الجداول أعلاه)
3. تأكد من وجود المفتاح المناسب:
   - Claude → `ANTHROPIC_API_KEY`
   - GPT → `OPENAI_API_KEY`
4. أعد تشغيل السيرفر

---

**آخر تحديث:** 6 مارس 2026  
**المرجع:** Anthropic Claude 3.5 Sonnet + OpenAI GPT-4o
