#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
برنامج تشغيل نظام إدارة الواجبات
تشغيل سهل مع رسالة ترحيب
"""

import tkinter as tk
from tkinter import messagebox
import sys
import os

def run_gui():
    """تشغيل الواجهة الرسومية"""
    try:
        from main_gui import main
        main()
    except ImportError as e:
        messagebox.showerror("خطأ", f"تعذر تحميل الواجهة الرسومية:\n{str(e)}")
        sys.exit(1)

def show_welcome():
    """عرض نافذة الترحيب"""
    welcome_window = tk.Tk()
    welcome_window.title("نظام إدارة واجبات الطلاب")
    welcome_window.geometry("500x400")
    welcome_window.configure(bg='#f0f0f0')
    
    # العنوان
    title_label = tk.Label(
        welcome_window,
        text="🎓 نظام إدارة واجبات الطلاب 🎓",
        font=('Arial', 18, 'bold'),
        bg='#f0f0f0',
        fg='#2c3e50'
    )
    title_label.pack(pady=20)
    
    # الوصف
    description = """مرحباً بك في نظام إدارة واجبات الطلاب!

هذا النظام يساعدك في:
• تنظيم واجبات الطلاب تلقائياً
• إنشاء مجلدات لكل طالب
• رفع الواجبات بسهولة
• إنشاء ملفات التقييم
• تنظيم الملفات تلقائياً
• متابعة تقدم الطلاب"""
    
    desc_label = tk.Label(
        welcome_window,
        text=description,
        font=('Arial', 12),
        bg='#f0f0f0',
        fg='#34495e',
        justify='left'
    )
    desc_label.pack(pady=20, padx=20)
    
    # أزرار التشغيل
    button_frame = tk.Frame(welcome_window, bg='#f0f0f0')
    button_frame.pack(pady=30)
    
    # زر الواجهة الرسومية
    gui_button = tk.Button(
        button_frame,
        text="🚀 تشغيل النظام",
        command=lambda: [welcome_window.destroy(), run_gui()],
        font=('Arial', 12, 'bold'),
        bg='#3498db',
        fg='white',
        height=2,
        width=25
    )
    gui_button.pack(pady=10)
    
    # زر الخروج
    exit_button = tk.Button(
        button_frame,
        text="❌ خروج",
        command=welcome_window.destroy,
        font=('Arial', 12),
        bg='#e74c3c',
        fg='white',
        height=2,
        width=25
    )
    exit_button.pack(pady=10)
    
    # حقوق النشر
    copyright_label = tk.Label(
        welcome_window,
        text="© 2024 نظام إدارة الواجبات المدرسية",
        font=('Arial', 10),
        bg='#f0f0f0',
        fg='#7f8c8d'
    )
    copyright_label.pack(side='bottom', pady=10)
    
    welcome_window.mainloop()

if __name__ == "__main__":
    show_welcome()
