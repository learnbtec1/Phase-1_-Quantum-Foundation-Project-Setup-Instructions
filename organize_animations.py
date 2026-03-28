import os
import shutil

# المسار المستهدف (الذي زودتني به)
TARGET_DIR = r"E:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend\public\models\animations"
# المسار الذي توجد به الملفات حالياً (غالباً مجلد التحميلات)
SOURCE_DIR = os.path.join(os.path.expanduser("~"), "Downloads")

def organize_cogni_assets():
    print(f"--- تبدأ الآن عملية نقل وتجهيز حركات كوجني ---")
    
    # التأكد من وجود المسار المستهدف
    if not os.path.exists(TARGET_DIR):
        os.makedirs(TARGET_DIR)
        print(f"✅ تم إنشاء المسار: {TARGET_DIR}")

    # تصنيفات الحركات الـ 150 (التي ستسد نواقص الافتار)
    categories = {
        "01_Idles": ["idle", "waiting", "breathe"],
        "02_Teacher_Talk": ["explain", "talk", "lecture", "speak"],
        "03_Interaction": ["point", "gesture", "show", "hand"],
        "04_Feedback": ["nod", "shake", "correct", "wrong"],
        "05_Thinking": ["think", "ponder", "curious"]
    }

    count = 0
    for file in os.listdir(SOURCE_DIR):
        if file.endswith(".fbx"):
            # تحديد المجلد المناسب بناءً على اسم الحركة
            moved = False
            for folder, keywords in categories.items():
                if any(key in file.lower() for key in keywords):
                    dest_folder = os.path.join(TARGET_DIR, folder)
                    os.makedirs(dest_folder, exist_ok=True)
                    shutil.move(os.path.join(SOURCE_DIR, file), os.path.join(dest_folder, file))
                    print(f"🚚 نُقلت الحركة: {file} -> {folder}")
                    moved = True
                    count += 1
                    break
            
            # إذا لم يطابق أي تصنيف، وضعه في مجلد عام
            if not moved:
                general_path = os.path.join(TARGET_DIR, "00_General")
                os.makedirs(general_path, exist_ok=True)
                shutil.move(os.path.join(SOURCE_DIR, file), os.path.join(general_path, file))
                count += 1

    print(f"\n✅ تمت العملية بنجاح! تم تجهيز {count} حركة في مسار المشروع.")

if __name__ == "__main__":
    organize_cogni_assets()