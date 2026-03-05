# تفعيل الشخصية الثلاثية الأبعاد (VRM) في /evaluate

## ما تم تنفيذه

1. **next.config.js**
   - إضافة `transpilePackages: ['@pixiv/three-vrm']` لضمان تحويل الحزمة بشكل صحيح مع Next.js.

2. **VRMAvatar.tsx**
   - توحيد استدعاء المسجّل مع واجهة @pixiv/three-vrm 3.x:  
     `loader.register((parser) => new VRMLoaderPlugin(parser))`.
   - المكون يعتمد على `useEffect` و `useRef` لتحميل النموذج على العميل فقط.

3. **صفحة /evaluate**
   - استبدال `lazy()` بـ `dynamic()` من `next/dynamic` مع `ssr: false` لتحميل الأفاتار على العميل فقط وتجنب أخطاء SSR مع three.js و three-vrm.
   - إضافة `loading` لعارض التحميل أثناء جلب المكون.
   - توافق التدفق مع الباكند: دعم `parsed.result` و `type: "final"` و `type: "status"`.

4. **مجلد النماذج**
   - إنشاء `public/models/` مع ملف `README.txt` يوضح كيفية إضافة ملف VRM (مثل `Furina.vrm`).

## التبعيات

- `package.json` يحتوي على `three: ^0.182.0` و `@pixiv/three-vrm: ^3.5.0` (متوافقان مع three >= 0.137).

إذا ظهر تعارض (مثلاً three@0.128 في القفل):

```bash
cd frontend
rm -rf node_modules .next package-lock.json
npm install
npm run dev
```

ثم افتح: http://localhost:3000/evaluate

## ظهور الشخصية

- الصفحة تتوقع الملف: **`public/models/Furina.vrm`**.
- ضع ملف `.vrm` في `public/models/` (مثلاً باسم `Furina.vrm`) أو غيّر المسار في الصفحة إلى اسم ملفك، مثال:
  - `<VRMAvatar vrmUrl="/models/اسم_الملف.vrm" ... />`
- يمكن استخدام نماذج تجريبية من [vrm-specification/samples](https://github.com/vrm-c/vrm-specification/tree/master/samples) (مع مراعاة الرخصة).

## ملاحظة

- مسار التقييم الحالي (`/api/evaluate`) يستدعي نقطة **دفعة واحدة** (batch) وليس التدفق (stream). عرض النتائج يعمل؛ إذا أردت استخدام التدفق المباشر من الباكند فستحتاج لتعديل route الـ API لاستدعاء `/forensic-grade-v3/stream` وتمرير الاستجابة كتدفق.
