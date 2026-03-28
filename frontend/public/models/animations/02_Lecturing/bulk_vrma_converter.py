import bpy
import os

INPUT_DIR = r"E:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend\public\models\animations\02_Lecturing"
OUTPUT_DIR = r"E:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend\public\models\animations\vrma_output"

def convert_all():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    fbx_files = [f for f in os.listdir(INPUT_DIR) if f.endswith(".fbx")]
    
    if len(fbx_files) == 0:
        print("⚠️ لم يتم العثور على ملفات FBX في المجلد!")
        return

    print(f"🚀 جاري معالجة {len(fbx_files)} ملف...")

    for fbx_file in fbx_files:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        fbx_path = os.path.join(INPUT_DIR, fbx_file)
        vrma_path = os.path.join(OUTPUT_DIR, fbx_file.replace(".fbx", ".vrma"))

        try:
            # 1. استيراد ملف Mixamo
            bpy.ops.import_scene.fbx(filepath=fbx_path)
            
            # 2. البحث عن الهيكل العظمي وتحديده (خطوة إجبارية للتصدير)
            armature = None
            for obj in bpy.context.scene.objects:
                if obj.type == 'ARMATURE':
                    armature = obj
                    break
            
            if armature:
                bpy.context.view_layer.objects.active = armature
                armature.select_set(True)
            else:
                print(f"⚠️ تخطي {fbx_file}: لم يتم العثور على هيكل عظمي.")
                continue

            # 3. أمر التصدير الصحيح للإصدارات الحديثة
            if hasattr(bpy.ops.export_scene, 'vrma'):
                bpy.ops.export_scene.vrma(filepath=vrma_path)
                print(f"✅ تم التحويل بنجاح: {fbx_file}")
            else:
                print("❌ الأمر 'export_scene.vrma' غير موجود! تأكد من نسخة الإضافة.")
                break # نوقف اللوب إذا الأمر مش مدعوم
                
        except Exception as e:
            print(f"❌ خطأ أثناء تصدير {fbx_file}: {str(e)}")

if __name__ == "__main__":
    convert_all()