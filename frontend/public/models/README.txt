تعليمات ضرورية لظهور الشخصية في /cognie (مسكن كوجني؛ التوجيه القديم من /avatar-agent)
==========================================================

يجب وضع ملف VRM هنا حتى تظهر الشخصية ثلاثية الأبعاد.

  التسلسل الافتراضي (VRM_FALLBACKS في src/config/avatar.ts):
    1) NEXT_PUBLIC_AVATAR_VRM_URL إن وُجد في .env.local
    2) public/models/cogni_final.vrm (النموذج الافتراضي T-pose)
    3) public/models/teach.vrm

  صفحة المعلم الافتراضي (قديم): teacher.vrm — public/models/teacher.vrm

إذا لم يكن الملف موجوداً، ستظهر كرة زرقاء بديلة (Placeholder) ولن تظهر الشخصية ثلاثية الأبعاد.

يمكنك تنزيل نماذج VRM من:
- https://github.com/vrm-c/vrm-specification/tree/master/samples
- أو أي مصدر VRM متوافق (رخصة الاستخدام تطبق حسب المصدر)

بعد وضع الملف، أعد تحميل صفحة /evaluate
