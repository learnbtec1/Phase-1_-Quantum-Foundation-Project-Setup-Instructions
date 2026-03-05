#!/bin/bash

echo "============================================"
echo "   تثبيت نظام إدارة واجبات الطلاب"
echo "============================================"
echo

echo "جارٍ تثبيت المكتبات المطلوبة..."
python3 -m pip install --upgrade pip
pip3 install -r requirements.txt

echo
echo "============================================"
echo "    التثبيت اكتمل بنجاح!"
echo "============================================"
echo
echo "لتشغيل النظام:"
echo "python3 run_system.py"
echo
echo "أو تشغيل مباشر:"
echo "python3 main_gui.py"
echo
