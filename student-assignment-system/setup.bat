@echo off
chcp 65001 >nul
echo ============================================
echo    تثبيت نظام إدارة واجبات الطلاب
echo ============================================
echo.

echo جارٍ تثبيت المكتبات المطلوبة...
python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo ============================================
echo    التثبيت اكتمل بنجاح!
echo ============================================
echo.
echo لتشغيل النظام:
echo python run_system.py
echo.
echo أو تشغيل مباشر:
echo python main_gui.py
echo.
pause
