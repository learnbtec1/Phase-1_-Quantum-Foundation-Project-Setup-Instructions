import os
from pathlib import Path

def create_project_map(source_path: str, output_filename: str = "project_map.txt"):
    """
    يقوم بمسح المجلد المصدري واستخراج المسارات باستخدام تقنية (Tree Pruning)
    لتجنب أخطاء نظام التشغيل مع الـ Symlinks والمجلدات المحمية.
    """
    base_dir = Path(source_path).resolve()
    output_path = base_dir / output_filename

    # المجلدات التي سيتم حظر الدخول إليها نهائياً
    EXCLUDED_DIRS = {
        '.git', 'node_modules', '__pycache__', 'venv', '.venv',
        '.next', 'dist', 'build', '.vscode', '.idea'
    }

    files_found = 0
    print(f"🔍 جاري مسح المشروع في: {base_dir} ...")

    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(f"# خريطة مشروع كوجني\n")
            f.write(f"# المسار الأساسي: {base_dir}\n")
            f.write(f"# قم بمسح السطر الخاص بأي ملف لا ترغب بنسخه\n")
            f.write(f"{'-'*60}\n")

            # استخدام os.walk للتحكم الكامل بمسار البحث
            for root, dirs, files in os.walk(base_dir):
                
                # 🛑 التكتيك الهندسي (Tree Pruning):
                # هنا نقوم بمسح المجلدات المستثناة من قائمة dirs في نفس اللحظة
                # هذا يمنع os.walk من الدخول إلى venv أو node_modules نهائياً
                dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

                root_path = Path(root)

                for file_name in files:
                    file_path = root_path / file_name
                    
                    # استخراج المسار النسبي
                    relative_path = file_path.relative_to(base_dir)

                    # منع السكربت من نسخ نفسه أو الخريطة
                    if relative_path.name in [output_filename, "mapper.py"]:
                        continue

                    f.write(f"{relative_path}\n")
                    files_found += 1

        print(f"✅ تمت العملية بنجاح!")
        print(f"📄 عدد الملفات الصافية التي تم رصدها: {files_found}")
        print(f"📍 تم حفظ الخريطة في: {output_path}")

    except Exception as e:
        print(f"❌ حدث خطأ غير متوقع: {e}")

if __name__ == "__main__":
    TARGET_DIRECTORY = "." 
    create_project_map(TARGET_DIRECTORY)