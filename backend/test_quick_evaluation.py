# -*- coding: utf-8 -*-
"""
اختبار سريع للتقييم مع عرض مفصل للنتائج
"""

import requests
import json
from pprint import pprint

# عنوان السيرفر
BACKEND_URL = "http://127.0.0.1:8000"

# نص الواجب (مختصر)
assignment_text = """
ASSIGNMENT BRIEF
BTEC Level 3 Extended Diploma in Business

Unit: Customer Service
Assignment Title: Customer Service in a Local Company

Learning Aims:
- P1: Describe how consistent and reliable customer service contributes to customer satisfaction
- P2: Describe different types of customers and their needs and expectations
- M1: Explain the benefits of good customer service to the business and customer
- D1: Evaluate the effectiveness of customer service in a selected company

TASK:
Select a local company and analyze their customer service practices.
Provide detailed description, explanation, and evaluation as per the criteria above.
"""

# إجابة الطالب (مثال مختصر)
student_text = """
تحليل خدمة العملاء في شركة النور للإلكترونيات

المقدمة:
شركة النور للإلكترونيات هي شركة محلية متخصصة في بيع وصيانة الأجهزة الإلكترونية.

P1 - أهمية خدمة العملاء المتسقة:
تقدم شركة النور خدمة عملاء متسقة وموثوقة من خلال:
- الرد على استفسارات العملاء خلال 24 ساعة
- توفير ضمان شامل على جميع المنتجات
- فريق دعم فني متاح طوال أيام الأسبوع
هذا الاتساق يساهم في رضا العملاء ويبني الثقة بين الشركة وعملائها.

P2 - أنواع العملاء واحتياجاتهم:
تتعامل الشركة مع عدة أنواع من العملاء:
1. العملاء الأفراد: يبحثون عن منتجات عالية الجودة بأسعار معقولة
2. الشركات: تحتاج لعقود صيانة طويلة الأمد وأسعار جملة
3. كبار السن: يحتاجون لخدمة صبورة وشرح مفصل للمنتجات

M1 - فوائد خدمة العملاء الجيدة:
للشركة:
- زيادة ولاء العملاء بنسبة 40% حسب إحصائيات الشركة
- تحسين سمعة الشركة في السوق المحلي
- زيادة المبيعات من خلال التوصيات الشفهية

للعميل:
- الحصول على منتجات تناسب احتياجاتهم
- راحة البال من خلال الضمانات الشاملة
- توفير الوقت في حل المشكلات

D1 - تقييم فعالية خدمة العملاء:
بعد تحليل شامل، يمكن القول أن شركة النور تتميز في:
- نقاط القوة: سرعة الاستجابة، الضمانات الشاملة، فريق محترف
- نقاط الضعف: عدم وجود نظام إلكتروني لتتبع الشكاوى
- التوصيات: إنشاء تطبيق للهواتف الذكية لتحسين التواصل
- الخلاصة: الخدمة فعّالة بشكل عام لكن تحتاج لتطوير في الجانب التقني

النتيجة: شركة النور تقدم خدمة عملاء جيدة تحقق رضا العملاء بنسبة 85% حسب استبيان داخلي.
"""

def test_evaluation():
    """
    إرسال طلب تقييم وعرض النتائج بشكل مفصل
    """
    
    print("=" * 80)
    print("🚀 بدء اختبار التقييم...")
    print("=" * 80)
    print()
    
    # إعداد البيانات
    payload = {
        "assignment_text": assignment_text,
        "student_text": student_text
    }
    
    # إرسال الطلب
    print("📤 إرسال الطلب إلى السيرفر...")
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/v1/assessment/forensic-grade-v3",
            json=payload,
            timeout=120  # 2 دقيقة timeout
        )
        
        print(f"✅ استلام الرد - Status Code: {response.status_code}")
        print()
        
        if response.status_code == 200:
            result = response.json()
            
            # عرض النتيجة النهائية
            print("=" * 80)
            print("🎯 النتيجة النهائية")
            print("=" * 80)
            print(f"الدرجة: {result.get('final_grade', 'N/A')}")
            print()
            
            # عرض الملخص
            if 'summary' in result:
                print("=" * 80)
                print("📝 الملخص")
                print("=" * 80)
                print(result['summary'])
                print()
            
            # عرض تفاصيل المعايير
            if 'criteria' in result:
                print("=" * 80)
                print("📊 تفاصيل المعايير")
                print("=" * 80)
                
                for criterion_code, details in result['criteria'].items():
                    print(f"\n{'─' * 40}")
                    print(f"📌 المعيار: {criterion_code}")
                    print(f"{'─' * 40}")
                    print(f"الفئة: {details.get('band', 'N/A')}")
                    print(f"تحقق: {'✅ نعم' if details.get('achieved') else '❌ لا'}")
                    print(f"\nالتقييم:")
                    print(details.get('feedback', 'لا يوجد'))
                    
                    if details.get('evidence_quote'):
                        print(f"\nالدليل من إجابة الطالب:")
                        print(f"'{details['evidence_quote'][:200]}...'")
            
            print()
            print("=" * 80)
            print("✅ اكتمل التقييم بنجاح!")
            print("=" * 80)
            
            # حفظ النتيجة الكاملة في ملف
            with open("last_evaluation_result.json", "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            print("\n💾 تم حفظ النتيجة الكاملة في: last_evaluation_result.json")
            
        else:
            print(f"❌ خطأ: {response.status_code}")
            print(response.text)
            
    except requests.exceptions.Timeout:
        print("⏱️ انتهى وقت الانتظار - السيرفر يستغرق وقتاً طويلاً")
    except requests.exceptions.ConnectionError:
        print("❌ خطأ في الاتصال - تأكد من تشغيل السيرفر على http://127.0.0.1:8000")
    except Exception as e:
        print(f"❌ خطأ غير متوقع: {e}")

if __name__ == "__main__":
    test_evaluation()
