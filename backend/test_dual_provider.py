#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test script to verify dual-provider setup
Run: python test_dual_provider.py
"""

import os
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv()

print("=" * 60)
print("محرك التقييم المزدوج — فحص التهيئة")
print("=" * 60)

# Check environment variables
grader_model = os.getenv("GRADER_MODEL", "not set")
openai_key = os.getenv("OPENAI_API_KEY", "")
anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")

print(f"\n📌 النموذج المحدد: {grader_model}")
print(f"🔑 OpenAI API Key: {'✅ موجود' if openai_key and openai_key != 'your-openai-key-here' else '❌ غير موجود'}")
print(f"🔑 Anthropic API Key: {'✅ موجود' if anthropic_key and anthropic_key != 'sk-ant-your-key-here' else '❌ غير موجود'}")

# Try importing the module
print("\n" + "=" * 60)
print("اختبار استيراد forensic_engine...")
print("=" * 60)

try:
    from app.services.forensic_engine import (
        MODEL, 
        MODEL_NAME, 
        openai_client, 
        anthropic_client,
        client
    )
    
    print("\n✅ الاستيراد نجح!")
    print(f"\n📊 حالة المزودين:")
    print(f"   • النموذج الفعلي: {MODEL}")
    print(f"   • OpenAI client: {'✅ جاهز' if openai_client else '❌ غير مهيّأ'}")
    print(f"   • Anthropic client: {'✅ جاهز' if anthropic_client else '❌ غير مهيّأ'}")
    print(f"   • Client الافتراضي: {'✅ جاهز' if client else '❌ غير جاهز'}")
    
    # Determine which provider is active
    if MODEL.startswith("claude-") and anthropic_client:
        print(f"\n🎯 المزود النشط: Anthropic Claude ({MODEL})")
        print("   💡 للتبديل إلى OpenAI: اضبط GRADER_MODEL=gpt-4o في .env")
    elif (MODEL.startswith("gpt-") or MODEL.startswith("o1-")) and openai_client:
        print(f"\n🎯 المزود النشط: OpenAI ({MODEL})")
        print("   💡 للتبديل إلى Claude: اضبط GRADER_MODEL=claude-sonnet-4-5 في .env")
    else:
        print(f"\n⚠️  لم يتم تفعيل أي مزود!")
        print("   تأكد من:")
        print("   1. تعيين GRADER_MODEL بشكل صحيح")
        print("   2. وجود مفتاح API المناسب في .env")
        print("   3. تثبيت المكتبة المطلوبة (pip install openai أو anthropic)")

except ImportError as e:
    print(f"\n❌ فشل الاستيراد: {e}")
    print("\nتأكد من تثبيت المتطلبات:")
    print("   pip install -r requirements.txt")
except Exception as e:
    print(f"\n❌ خطأ غير متوقع: {e}")

print("\n" + "=" * 60)
print("انتهى الفحص")
print("=" * 60)
