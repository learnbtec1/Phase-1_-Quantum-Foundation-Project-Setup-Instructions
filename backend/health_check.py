#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🏥 Backend Health Check Script
فحص شامل لصحة البيئة والخادم
"""

import os
import sys
import subprocess
import json
import time
from pathlib import Path

class HealthCheck:
    def __init__(self):
        self.results = []
        self.backend_dir = Path(__file__).parent / "backend"
        self.env_file = self.backend_dir / ".env"

    def log(self, status, message):
        """طباعة رسالة مع الحالة"""
        emoji = "✅" if status else "❌"
        symbol = "✓" if status else "✗"
        print(f"{emoji} {symbol} {message}")
        self.results.append({"status": status, "message": message})

    def check_python(self):
        """التحقق من Python"""
        try:
            version = subprocess.check_output([sys.executable, "--version"], text=True)
            self.log(True, f"Python موجود: {version.strip()}")
            return True
        except Exception as e:
            self.log(False, f"Python غير موجود: {e}")
            return False

    def check_venv(self):
        """التحقق من البيئة الافتراضية"""
        venv_path = self.backend_dir / "venv311"
        if venv_path.exists():
            self.log(True, f"البيئة الافتراضية موجودة: {venv_path}")
            return True
        else:
            self.log(False, f"البيئة الافتراضية غير موجودة: {venv_path}")
            return False

    def check_requirements(self):
        """التحقق من المكتبات المثبتة"""
        required = {
            'fastapi': 'FastAPI',
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'uvicorn': 'Uvicorn',
            'python-dotenv': 'python-dotenv'
        }
        
        for module, name in required.items():
            try:
                __import__(module)
                self.log(True, f"{name} مثبت")
            except ImportError:
                self.log(False, f"{name} غير مثبت")

    def check_env_file(self):
        """التحقق من ملف .env"""
        if not self.env_file.exists():
            self.log(False, f"ملف .env غير موجود: {self.env_file}")
            return False

        self.log(True, f"ملف .env موجود")

        # اقرأ المفاتيح المهمة
        try:
            env_vars = {}
            with open(self.env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if '=' in line and not line.startswith('#'):
                        key, value = line.strip().split('=', 1)
                        env_vars[key] = value

            # تحقق من المفاتيح المهمة
            important_keys = ['GRADER_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']
            for key in important_keys:
                if key in env_vars:
                    if key == 'GRADER_MODEL':
                        self.log(True, f"GRADER_MODEL: {env_vars[key]}")
                    else:
                        masked = env_vars[key][:10] + "..."
                        self.log(True, f"{key}: {masked}")
                else:
                    self.log(False, f"{key}: غير موجود")

            return True
        except Exception as e:
            self.log(False, f"خطأ في قراءة .env: {e}")
            return False

    def check_backend_running(self):
        """التحقق من تشغيل الخادم"""
        try:
            import requests
            response = requests.get('http://127.0.0.1:8000/', timeout=2)
            if response.status_code == 200:
                self.log(True, "Backend يعمل على http://127.0.0.1:8000/")
                return True
            else:
                self.log(False, f"Backend يرد برمز {response.status_code}")
                return False
        except requests.exceptions.ConnectionError:
            self.log(False, "Backend لا يستجيب (Connection refused)")
            self.log(False, "💡 حل: شغّل 'python app/main.py' من مجلد backend")
            return False
        except Exception as e:
            self.log(False, f"خطأ في الاتصال: {e}")
            return False

    def check_model_validity(self):
        """التحقق من صحة اسم النموذج"""
        valid_models = {
            'gpt-4o': 'OpenAI',
            'gpt-4o-mini': 'OpenAI',
            'gpt-4-turbo': 'OpenAI',
            'gpt-3.5-turbo': 'OpenAI',
            'claude-3-5-sonnet-20241022': 'Anthropic',
            'claude-3-opus-20240229': 'Anthropic',
            'claude-3-5-sonnet-20240620': 'Anthropic',
            'claude-3-haiku-20240307': 'Anthropic'
        }

        try:
            with open(self.env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.startswith('GRADER_MODEL='):
                        model = line.split('=', 1)[1].strip()
                        if model in valid_models:
                            self.log(True, f"النموذج صحيح: {model} ({valid_models[model]})")
                            return True
                        else:
                            self.log(False, f"النموذج موجود لكن قد يكون خاطئ: {model}")
                            self.log(False, f"   النماذج الصحيحة: {', '.join(list(valid_models.keys())[:3])}...")
                            return False
        except Exception as e:
            self.log(False, f"خطأ في التحقق من النموذج: {e}")
            return False

    def test_api_calls(self):
        """اختبر استدعاء API"""
        try:
            import requests
            
            payload = {
                "assignment_text": "test",
                "solutions": [
                    {"file_label": "test", "file_content": "this is a test content for checking"}
                ]
            }
            
            response = requests.post(
                'http://127.0.0.1:8000/api/v1/assessment/evaluate-multi-file',
                json=payload,
                timeout=5
            )
            
            if response.status_code == 200:
                result = response.json()
                if 'final_grade' in result or 'data' in result:
                    self.log(True, "اختبار API نجح - النموذج يعمل")
                    return True
                else:
                    self.log(False, f"رد غير صحيح: {result}")
                    return False
            else:
                self.log(False, f"خطأ في API: {response.status_code}")
                return False
                
        except Exception as e:
            self.log(False, f"فشل اختبار API: {e}")
            return False

    def run_all_checks(self):
        """تشغيل جميع الفحوصات"""
        print("\n" + "="*60)
        print(" 🏥 فحص صحة البيئة والخادم")
        print("="*60 + "\n")

        print("📋 الفحوصات الأساسية:")
        self.check_python()
        self.check_venv()
        self.check_env_file()

        print("\n📚 المكتبات المثبتة:")
        self.check_requirements()

        print("\n🌐 الخادم:")
        backend_running = self.check_backend_running()

        print("\n⚙️ الاعدادات:")
        self.check_model_validity()

        if backend_running:
            print("\n🧪 اختبار API:")
            self.test_api_calls()

        # ملخص
        print("\n" + "="*60)
        passed = sum(1 for r in self.results if r['status'])
        total = len(self.results)
        print(f"النتيجة: {passed}/{total} فحص نجح")
        print("="*60 + "\n")

        if passed == total:
            print("✅ كل شيء يعمل بشكل صحيح!")
            return True
        else:
            print("❌ يوجد مشاكل تحتاج إلى إصلاح")
            print("\n💡 التوصيات:")
            for result in self.results:
                if not result['status']:
                    if 'Backend' in result['message']:
                        print("   • شغّل الخادم: python app/main.py")
                    elif 'مثبت' in result['message']:
                        print("   • ثبّت المتطلبات: pip install -r requirements.txt")
                    elif 'env' in result['message']:
                        print("   • أنشئ ملف .env أو صحح البيانات فيه")
            return False

if __name__ == '__main__':
    checker = HealthCheck()
    success = checker.run_all_checks()
    sys.exit(0 if success else 1)
