#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Debug script to test grading engine directly
"""
import sys
import os
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir / "app" / "services"))

import asyncio
from dotenv import load_dotenv
load_dotenv()

print("=" * 60)
print("اختبار محرك التقييم المباشر")
print("=" * 60)

# Load configuration directly from forensic_engine
import forensic_engine

MODEL = forensic_engine.MODEL
openai_client = forensic_engine.openai_client
anthropic_client = forensic_engine.anthropic_client
evaluate_one = forensic_engine.evaluate_one

print(f"\n📌 النموذج: {MODEL}")
print(f"🔑 OpenAI: {'✅' if openai_client else '❌'}")
print(f"🔑 Anthropic: {'✅' if anthropic_client else '❌'}")

# Test evaluation
print("\n" + "=" * 60)
print("إرسال طلب تقييم تجريبي...")
print("=" * 60)

test_code = "P1"
test_desc = "وصف الشركة وأهدافها"
test_assignment = """
الواجب: اكتب تقريرًا عن شركة محلية.
المعايير:
P1: اذكر اسم الشركة ونشاطها الرئيسي
"""
test_student = """
الشركة: شركة النور للإلكترونيات
النشاط: تبيع أجهزة كمبيوتر وموبايلات
تأسست سنة 2020 في الرياض
"""

async def test_grading():
    try:
        code, result = await evaluate_one(
            code=test_code,
            desc=test_desc,
            assignment=test_assignment,
            student=test_student,
            adv_constraints={}
        )
        
        print(f"\n✅ التقييم نجح!")
        print(f"   المعيار: {code}")
        print(f"   تحقق: {result.get('achieved')}")
        print(f"   السبب: {result.get('reasoning', 'N/A')[:200]}...")
        
        return True
    except Exception as e:
        print(f"\n❌ التقييم فشل!")
        print(f"   الخطأ: {type(e).__name__}")
        print(f"   التفاصيل: {str(e)}")
        
        # Print full traceback
        import traceback
        print("\n📋 Traceback الكامل:")
        traceback.print_exc()
        
        return False

# Run test
print("\n⏳ جاري اختبار الاتصال بـ API...")
success = asyncio.run(test_grading())

print("\n" + "=" * 60)
if success:
    print("✅ النظام يعمل بشكل صحيح!")
else:
    print("❌ هناك مشكلة في الاتصال بـ API")
print("=" * 60)
