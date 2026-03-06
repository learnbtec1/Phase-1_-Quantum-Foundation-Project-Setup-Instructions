@echo off
echo Starting Nexus Backend Server...
cd /d "%~dp0"
call venv311\Scripts\activate.bat
python app_simple.py
pause
