# -*- coding: utf-8 -*-
"""
اختبار التقييم المتكامل لملفات متعددة
===========================================

الحالة: طالب قسّم الحل إلى ملفين:
- TalkMateAI: شرح شركة 1
- Phase-1: شرح شركة 2

الواجب يطلب: "قارن بين شركتين"
"""

import requests
import json
from pprint import pprint

BACKEND_URL = "http://127.0.0.1:8000"

# الواجب المطلوب
assignment_text = """
ASSIGNMENT BRIEF - المشروع المتكامل
=====================================

Unit: تحليل الحلول التقنية المتكاملة
Title: مقارنة نظم التقنية بين منصتين

المطلوب:
========

قارن بين نظامين تقنيين (منصتين) من حيث:

P1: وصف كيفية عمل كل نظام وخصائصه الأساسية
   - يجب توضيح المكونات الرئيسية
   - يجب شرح الواجهات والمخرجات

M1: تحليل الفروقات بين النظامين
   - ما نقاط القوة في كل منهما؟
   - ما نقاط الضعف؟
   - كيف يتكاملان معاً؟

D1: تقييم فعالية التكامل بين النظامين
   - هل يمكن استخدامهما معاً؟
   - ما الفوائد المحتملة للمستخدم النهائي؟
   - ما التوصيات للتحسين؟

ملاحظة مهمة:
=============
يمكن تقديم الحل في ملفات متعددة:
- كل ملف يركز على نظام/منصة واحدة
- سيتم تقييم جميع الملفات معاً كحل موحد
- التقييم يفحص المقارنة والتكامل عبر **جميع** الملفات
"""

# الملف الأول: TalkMateAI
talkmate_solution = """
نظام TalkMateAI - منصة التواصل الذكية
=====================================

P1 - وصف كيفية العمل والخصائص الأساسية:

العمارة:
- Frontend: واجهة مستخدم سهلة التفاعل
- Backend: API REST مع معالجة الطلبات بسرعة
- قاعدة بيانات: تخزين محادثات وملفات المستخدم

الخصائص الأساسية:
- دعم التواصل الفوري في الوقت الحقيقي
- تشفير من طرف إلى طرف
- واجهة بديهية وسهلة الاستخدام
- دعم الملفات والوسائط المتعددة

M1 - تحليل الفروقات:

نقاط القوة:
- التصميم البسيط والنظيف
- واجهة محبة للمستخدم
- استجابة سريعة للطلبات
- أمان عالي في نقل البيانات

نقاط الضعف:
- قد لا يدعم الميزات المتقدمة
- محدود من حيث التكاملات الخارجية
- قد يحتاج تطويراً لاحقاً للميزات الجديدة

الفروقات مقارنة بـ Phase-1:
- TalkMateAI أكثر تركيزاً على تجربة المستخدم
- Phase-1 أكثر تركيزاً على المنطق والخدمات الخلفية

D1 - التقييم والتكامل:

هل يمكن استخدامهما معاً؟
نعم، TalkMateAI يمكن أن يكون الواجهة الأمامية بينما Phase-1
يكون الخدمات الخلفية (Backend Services).

الفوائد المحتملة:
- نظام متكامل يجمع بين تجربة مستخدم ممتازة وخدمات قوية
- مرونة عالية في التطوير والتوسع
- فصل الاهتمامات (Separation of Concerns)

التوصيات:
- توحيد المعايير بين النظامين
- إنشاء واجهات برمجية موحدة (APIs)
- اختبار التكامل الشامل
"""

# الملف الثاني: Phase-1
phase1_solution = """
نظام Quantum Foundation (Phase-1) - منصة الخدمات المتقدمة
=========================================================

P1 - وصف كيفية العمل والخصائص الأساسية:

العمارة:
- FastAPI Backend: معالجة متقدمة للطلبات
- Python Services: خدمات متخصصة (تقييم، معالجة نصوص، إلخ)
- قاعدة بيانات: تخزين البيانات الضخمة والتحليلات
- AI/ML Integration: نماذج ذكية للتقييم والتنبؤ

الخصائص الأساسية:
- معالجة متقدمة للنصوص والبيانات
- تقييم ذكي باستخدام AI (GPT-4o, Claude)
- دعم العربية بشكل كامل
- WebSockets للتواصل الحقيقي

M1 - تحليل الفروقات:

نقاط القوة:
- قدرات AI/ML متقدمة
- معالجة بيانات قوية وسريعة
- دعم كامل للعربية
- قابلية عالية للتوسع

نقاط الضعف:
- قد تكون العمارة معقدة للمستخدمين البسطاء
- تتطلب موارد حسابية أكثر
- قد تحتاج وثائق شاملة

الفروقات مقارنة بـ TalkMateAI:
- Phase-1 أكثر قوة من الناحية التقنية
- TalkMateAI أكثر تركيزاً على التجربة البسيطة

D1 - التقييم والتكامل:

التكامل الأمثل:
- Phase-1 يوفر الخدمات (Services Layer)
- TalkMateAI توفر الواجهة والتجربة (Presentation Layer)
- يعملان معاً بسلاسة

الفوائد المحتملة:
- منصة متكاملة وقوية
- توازن بين الأداء والسهولة
- نظام قابل للصيانة والتطوير

التوصيات:
- إنشاء نقطة اتصال واحدة (API Gateway)
- توثيق دقيق للتكامل
- اختبارات أداء شاملة
"""

def test_multi_file_grading():
    """اختبار التقييم المتكامل للملفات المتعددة"""
    
    print("=" * 80)
    print("🧪 اختبار التقييم المتكامل لحل متعدد الملفات")
    print("=" * 80)
    print()
    
    # إعداد الطلب
    payload = {
        "assignment_text": assignment_text,
        "solutions": [
            {
                "file_label": "TalkMateAI",
                "file_content": talkmate_solution,
                "description": "منصة التواصل والواجهة الأمامية"
            },
            {
                "file_label": "Phase-1 (Quantum Foundation)",
                "file_content": phase1_solution,
                "description": "نظام الخدمات الخلفية والمعالجة المتقدمة"
            }
        ]
    }
    
    try:
        print("📤 إرسال الطلب...")
        response = requests.post(
            f"{BACKEND_URL}/api/v1/assessment/evaluate-multi-file",
            json=payload,
            timeout=180
        )
        
        if response.status_code == 200:
            result = response.json()
            
            print("\n" + "=" * 80)
            print("✅ النتيجة النهائية")
            print("=" * 80)
            print(f"الدرجة: {result.get('final_grade')}")
            print(f"عدد الملفات المقيّمة: {result.get('files_evaluated')}")
            print()
            
            # ملخص موحد
            print("=" * 80)
            print("📝 الملخص الموحد")
            print("=" * 80)
            print(result.get("consolidated_summary", ""))
            print()
            
            # توزيع المعايير عبر الملفات
            if result.get("file_distribution"):
                print("=" * 80)
                print("📊 توزيع المعايير عبر الملفات")
                print("=" * 80)
                for file_label, criteria_map in result.get("file_distribution", {}).items():
                    print(f"\n📁 {file_label}:")
                    for code, has_relevance in criteria_map.items():
                        status = "✅" if has_relevance else "❌"
                        print(f"   {status} {code}")
            
            # تفاصيل المعايير
            if result.get("criteria"):
                print("\n" + "=" * 80)
                print("📊 تفاصيل تقييم المعايير")
                print("=" * 80)
                for code, details in result.get("criteria", {}).items():
                    print(f"\n🔹 {code}:")
                    print(f"   - تحقق: {'✅' if details.get('achieved') else '❌'}")
                    print(f"   - التقييم: {details.get('reasoning', 'N/A')[:200]}...")
            
            # معلومات الملفات
            if result.get("solution_files"):
                print("\n" + "=" * 80)
                print("📄 الملفات المُقيّمة")
                print("=" * 80)
                for file_info in result.get("solution_files", []):
                    print(f"\n📌 {file_info.get('label')}")
                    if file_info.get('description'):
                        print(f"   {file_info['description']}")
                    print(f"   معاينة: {file_info.get('content_preview', '')[:100]}...")
            
            print("\n" + "=" * 80)
            print("✅ نجح الاختبار!")
            print("=" * 80)
            
            # حفظ النتيجة الكاملة
            with open("multi_file_evaluation_result.json", "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            print("\n💾 تم حفظ النتيجة الكاملة في: multi_file_evaluation_result.json")
            
        else:
            print(f"❌ خطأ: {response.status_code}")
            print(response.text)
            
    except Exception as e:
        print(f"❌ خطأ: {e}")

if __name__ == "__main__":
    print("\n" + "🚀" * 40)
    print("   اختبار التقييم المتكامل (Integrated Grading)")
    print("🚀" * 40 + "\n")
    
    test_multi_file_grading()
    
    print("\n" + "🏁" * 40)
    print("   انتهى الاختبار")
    print("🏁" * 40 + "\n")
