# تقرير تشخيص اختفاء الأفاتار

## الملاحظة
الأفاتار يظهر لوهلة ثم يختفي مع تغيّر اللون والبيئة المحيطة.

---

## التحليل

### 1. مكوّن Environment (المشتبه الرئيسي)
```tsx
<Environment preset="city" environmentIntensity={0.6} />
```
- يحمّل HDR بشكل **غير متزامن**
- عند التحميل الأول: المشهد يُعرض بدون env map كامل
- عند اكتمال التحميل: يُطبَّق env map جديد → تغيّر فجائي في الإضاءة والألوان
- مواد VRM تستخدم `envMapIntensity = 1` → تتأثر بقوة بهذا التغيّر
- **الفرضية**: بعد تحميل Environment، الإضاءة الجديدة تجعل الأفاتار غير مرئي

### 2. ترتيب التحميل
1. Canvas + BoardroomContent يظهران
2. FallbackAvatar (صندوق رمادي) يظهر أثناء تحميل VRM
3. VRM يُحمَّل → الأفاتار يظهر
4. Environment يكمل تحميل HDR → تغيّر اللون → الأفاتار يختفي

### 3. مكوّنات أخرى (أقل احتمالاً)
- **CityWindow**: يستخدم `useState` للـ texture — قد يسبب إعادة رسم
- **Soundscape**: يعيد `null` — لا يؤثر على المشهد
- **HolographicPanels**: يعيد `null` — لا يؤثر
- **Chat**: فوق المشهد بـ z-10 — لا يغطي الأفاتار في المنتصف

---

## التعديلات المقترحة (تم تطبيقها)

1. **تقليل environmentIntensity** من 0.6 إلى 0.35 — لتخفيف تأثير التغيّر عند تحميل Environment
2. **إضافة مصباح أمام الأفاتار** `pointLight` عند `[0, 0, 3]` — لضمان إضاءة ثابتة للأفاتار

---

## اختبارات للتأكد من السبب

### اختبار 1: تعطيل Environment
في `BoardroomScene.tsx` السطر 164، غيّر:
```tsx
<Environment preset="city" environmentIntensity={0.35} />
```
إلى:
```tsx
{/* <Environment preset="city" environmentIntensity={0.35} /> */}
```
**إذا استمر ظهور الأفاتار** → Environment هو السبب.

### اختبار 2: تعطيل الحزم الديناميكية
علّق مؤقتاً `BrandingText` و `HolographicPanels` — إذا استمر الاختفاء، فليست هي السبب.

### اختبار 3: استخدام البديل (الكرة الزرقاء)
في `evaluate/page.tsx` السطر 182، غيّر:
```tsx
<BoardroomScene avatarRef={avatarRef} />
```
إلى:
```tsx
<BoardroomScene avatarRef={avatarRef} useSimpleAvatarFallback={true} />
```
**إذا ظهرت الكرة الزرقاء باستمرار** → المشكلة في تحميل/عرض VRM وليس في المشهد.

---

## ماذا أبلغ إذا رأيت تحسناً؟
اكتب ما يلي:
- أي اختبار قمت به
- ماذا تغيّر (مثلاً: "الأفاتار بقي ظاهراً بعد تعطيل Environment")
- أي رسائل في Console (F12)
