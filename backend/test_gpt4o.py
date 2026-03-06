#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Quick test for grading engine with GPT-4o
"""
import requests
import json

print("=" * 70)
print("🧪 اختبار محرك التقييم (GPT-4o)")
print("=" * 70)

# Test endpoint
url = "http://127.0.0.1:8000/api/v1/assessment/grade"

# Sample data
payload = {
    "assignment_text": """
ASSIGNMENT BRIEF: تقرير عن شركة محلية
المعايير:
P1: اذكر اسم الشركة ونشاطها الرئيسي
P2: حدد الموقع الجغرافي للشركة
    """,
    "student_text": """
الشركة: شركة النور للإلكترونيات
النشاط: تبيع أجهزة كمبيوتر وموبايلات وإكسسوارات
تأسست سنة 2020 في مدينة الرياض، المملكة العربية السعودية
لديها 3 فروع في المنطقة الوسطى
    """
}

print("\n⏳ إرسال طلب التقييم...")
print(f"   الهدف: {url}")

try:
    response = requests.post(url, json=payload, timeout=60)
    
    if response.status_code == 200:
        result = response.json()
        
        print("\n✅ التقييم تم بنجاح!")
        print(f"   الدرجة النهائية: {result.get('final_grade', 'N/A')}")
        print(f"   الملخص: {result.get('summary', 'N/A')[:150]}...")
        
        # Print criteria details
        criteria = result.get('criteria', {})
        print(f"\n📊 المعايير ({len(criteria)} معيار):")
        for code, details in criteria.items():
            status = "✅" if details.get('achieved') else "❌"
            print(f"   {status} {code}: {details.get('feedback', 'N/A')[:80]}...")
        
        print("\n" + "=" * 70)
        print("✅ النظام يعمل بشكل صحيح مع GPT-4o!")
        print("=" * 70)
        
    else:
        print(f"\n❌ خطأ في الاستجابة!")
        print(f"   HTTP Status: {response.status_code}")
        print(f"   الرد: {response.text[:500]}")
        
except requests.exceptions.RequestException as e:
    print(f"\n❌ خطأ في الاتصال!")
    print(f"   التفاصيل: {str(e)}")
    print("\n💡 تأكد من:")
    print("   1. السيرفر يعمل على http://127.0.0.1:8000")
    print("   2. OPENAI_API_KEY موجود في .env")
    print("   3. GRADER_MODEL=gpt-4o")
