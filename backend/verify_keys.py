import os
import requests
from openai import OpenAI
from dotenv import load_dotenv

# 1. تحميل المفاتيح من ملف .env
load_dotenv()

def verify_all_keys():
    print("🚀 بدء فحص منظومة Pythagoras AI...\n")
    
    openai_key = os.getenv("OPENAI_API_KEY")
    google_key = os.getenv("GOOGLE_API_KEY")
    google_cx = os.getenv("GOOGLE_CX_ID")

    # --- اختبار OpenAI (كاشف الذكاء الاصطناعي) ---
    print("🧪 1. فحص مفتاح OpenAI...")
    try:
        client = OpenAI(api_key=openai_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "Say hello"}],
            max_tokens=5
        )
        print("✅ OpenAI: يعمل بنجاح! (تم الاتصال بالمحلل اللغوي)")
    except Exception as e:
        print(f"❌ OpenAI: فشل! السبب: {e}")

    print("-" * 30)

    # --- اختبار Google Search (كاشف الاستلال) ---
    print("🧪 2. فحص مفاتيح Google (API Key + CX ID)...")
    if not google_key or not google_cx:
        print("❌ Google: مفاتيح جوجل مفقودة في ملف .env")
    else:
        search_url = f"https://www.googleapis.com/customsearch/v1?q=BTEC&key={google_key}&cx={google_cx}"
        try:
            res = requests.get(search_url, timeout=10)
            if res.status_code == 200:
                print("✅ Google Search: يعمل بنجاح! (الرادار العالمي جاهز)")
            else:
                error_msg = res.json().get('error', {}).get('message', 'خطأ غير معروف')
                print(f"❌ Google Search: فشل! كود {res.status_code}: {error_msg}")
        except Exception as e:
            print(f"❌ Google Search: خطأ في الاتصال: {e}")

    print("\n" + "="*30)
    print("🏁 انتهى الفحص!")

if __name__ == "__main__":
    verify_all_keys()