@echo off
REM ===========================================
REM تشغيل فحص صحة البيئة
REM ===========================================

echo.
echo 🔍 جاري فحص صحة البيئة...
echo.

REM اذهب لمجلد المشروع
cd /d "e:\Phase 1_ Quantum Foundation Project Setup Instructions"

REM تفعيل البيئة الافتراضية
call "backend\venv311\Scripts\activate.bat"

if %errorlevel% neq 0 (
    echo ❌ خطأ: لا يمكن تفعيل البيئة الافتراضية
    echo 💡 تأكد من وجود: backend\venv311\Scripts\activate.bat
    pause
    exit /b 1
)

REM تشغيل الفحص
python "backend\health_check.py"

if %errorlevel% neq 0 (
    echo.
    echo ❌ حدث خطأ أثناء الفحص
    pause
    exit /b 1
)

echo.
echo ✅ انتهى الفحص!
echo.
pause
