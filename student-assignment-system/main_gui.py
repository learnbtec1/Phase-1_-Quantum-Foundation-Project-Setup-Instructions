#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
نظام إدارة واجبات الطلاب مع واجهة رسومية
واجهة سهلة الاستخدام مع أزرار لرفع الواجبات وتنظيمها تلقائياً
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import os
import json
import shutil
import datetime
from pathlib import Path
import sys

class StudentAssignmentGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("نظام إدارة واجبات الطلاب")
        self.root.geometry("1200x700")
        self.root.configure(bg='#f0f0f0')
        
        # تهيئة النظام
        self.base_path = Path("assignments")
        self.data_path = Path("data")
        self.base_path.mkdir(exist_ok=True)
        self.data_path.mkdir(exist_ok=True)
        
        # تحميل البيانات
        self.students_file = self.data_path / "students.json"
        self.subjects_file = self.data_path / "subjects.json"
        self.students = self.load_json(self.students_file)
        self.subjects = self.load_json(self.subjects_file)
        
        # إنشاء واجهة المستخدم
        self.setup_ui()
        
        # تحديث القوائم
        self.update_lists()
    
    def load_json(self, file_path):
        """تحميل بيانات JSON"""
        if file_path.exists():
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def save_json(self, file_path, data):
        """حفظ بيانات JSON"""
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    def setup_ui(self):
        """إنشاء واجهة المستخدم"""
        # إنشاء Notebook (تبويبات)
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill='both', expand=True, padx=10, pady=10)
        
        # تبويب الطلاب
        self.students_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.students_tab, text="إدارة الطلاب")
        self.setup_students_tab()
        
        # تبويب المواد
        self.subjects_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.subjects_tab, text="إدارة المواد")
        self.setup_subjects_tab()
        
        # تبويب رفع الواجبات
        self.upload_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.upload_tab, text="رفع الواجبات")
        self.setup_upload_tab()
        
        # تبويب التقييم
        self.evaluation_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.evaluation_tab, text="التقييم")
        self.setup_evaluation_tab()
        
        # تبويب التنظيم التلقائي
        self.organize_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.organize_tab, text="التنظيم التلقائي")
        self.setup_organize_tab()
        
        # تبويب التقارير
        self.reports_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.reports_tab, text="التقارير والإحصائيات")
        self.setup_reports_tab()
    
    def setup_students_tab(self):
        """إنشاء تبويب إدارة الطلاب"""
        # إطار العنوان
        title_frame = ttk.LabelFrame(self.students_tab, text="إدارة الطلاب")
        title_frame.pack(fill='x', padx=10, pady=5)
        
        # إطار إضافة طالب جديد
        add_frame = ttk.LabelFrame(title_frame, text="إضافة طالب جديد")
        add_frame.pack(fill='x', padx=10, pady=5)
        
        # حقل اسم الطالب
        ttk.Label(add_frame, text="اسم الطالب:").grid(row=0, column=0, padx=5, pady=5, sticky='w')
        self.student_name_entry = ttk.Entry(add_frame, width=40)
        self.student_name_entry.grid(row=0, column=1, padx=5, pady=5)
        
        # زر إضافة طالب
        add_button = ttk.Button(add_frame, text="إضافة طالب", command=self.add_student)
        add_button.grid(row=0, column=2, padx=5, pady=5)
        
        # زر إضافة عدة طلاب
        bulk_button = ttk.Button(add_frame, text="إضافة عدة طلاب", command=self.bulk_add_students)
        bulk_button.grid(row=0, column=3, padx=5, pady=5)
        
        # إطار قائمة الطلاب
        list_frame = ttk.LabelFrame(title_frame, text="قائمة الطلاب")
        list_frame.pack(fill='both', expand=True, padx=10, pady=5)
        
        # شريط التمرير
        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side='right', fill='y')
        
        # قائمة الطلاب
        self.students_listbox = tk.Listbox(list_frame, yscrollcommand=scrollbar.set,
                                          height=15, font=('Arial', 11))
        self.students_listbox.pack(side='left', fill='both', expand=True)
        scrollbar.config(command=self.students_listbox.yview)
        
        # أزرار التحكم
        control_frame = ttk.Frame(title_frame)
        control_frame.pack(fill='x', padx=10, pady=5)
        
        ttk.Button(control_frame, text="تحديث القائمة", 
                  command=self.update_students_list).pack(side='left', padx=5)
        ttk.Button(control_frame, text="حذف الطالب المحدد", 
                  command=self.delete_student).pack(side='left', padx=5)
        ttk.Button(control_frame, text="تصدير القائمة", 
                  command=self.export_students).pack(side='left', padx=5)
    
    def setup_subjects_tab(self):
        """إنشاء تبويب إدارة المواد"""
        # إطار العنوان
        title_frame = ttk.LabelFrame(self.subjects_tab, text="إدارة المواد الدراسية")
        title_frame.pack(fill='x', padx=10, pady=5)
        
        # إطار إضافة مادة جديدة
        add_frame = ttk.LabelFrame(title_frame, text="إضافة مادة جديدة")
        add_frame.pack(fill='x', padx=10, pady=5)
        
        # حقل اسم المادة
        ttk.Label(add_frame, text="اسم المادة:").grid(row=0, column=0, padx=5, pady=5, sticky='w')
        self.subject_name_entry = ttk.Entry(add_frame, width=30)
        self.subject_name_entry.grid(row=0, column=1, padx=5, pady=5)
        
        # حقل اسم المعلم
        ttk.Label(add_frame, text="اسم المعلم:").grid(row=0, column=2, padx=5, pady=5, sticky='w')
        self.teacher_name_entry = ttk.Entry(add_frame, width=30)
        self.teacher_name_entry.grid(row=0, column=3, padx=5, pady=5)
        
        # زر إضافة مادة
        add_button = ttk.Button(add_frame, text="إضافة مادة", command=self.add_subject)
        add_button.grid(row=0, column=4, padx=5, pady=5)
        
        # إطار تسجيل الطلاب في المواد
        enroll_frame = ttk.LabelFrame(title_frame, text="تسجيل الطلاب في المواد")
        enroll_frame.pack(fill='x', padx=10, pady=5)
        
        # اختيار المادة
        ttk.Label(enroll_frame, text="اختر المادة:").grid(row=0, column=0, padx=5, pady=5, sticky='w')
        self.subject_combo = ttk.Combobox(enroll_frame, state="readonly", width=30)
        self.subject_combo.grid(row=0, column=1, padx=5, pady=5)
        
        # اختيار الطلاب
        ttk.Label(enroll_frame, text="اختر الطلاب:").grid(row=1, column=0, padx=5, pady=5, sticky='nw')
        
        # إطار لقائمة اختيار الطلاب
        self.students_select_frame = ttk.Frame(enroll_frame)
        self.students_select_frame.grid(row=1, column=1, columnspan=3, padx=5, pady=5, sticky='w')
        
        self.student_vars = {}
        self.students_checkboxes = []
        
        # زر التسجيل
        enroll_button = ttk.Button(enroll_frame, text="تسجيل الطلاب المحددين", 
                                  command=self.enroll_students)
        enroll_button.grid(row=2, column=0, columnspan=2, padx=5, pady=10)
        
        # إطار عرض المواد
        list_frame = ttk.LabelFrame(title_frame, text="المواد الدراسية")
        list_frame.pack(fill='both', expand=True, padx=10, pady=5)
        
        # شجرة العرض
        columns = ('المادة', 'المعلم', 'عدد الطلاب')
        self.subjects_tree = ttk.Treeview(list_frame, columns=columns, show='headings', height=10)
        
        for col in columns:
            self.subjects_tree.heading(col, text=col)
            self.subjects_tree.column(col, width=200)
        
        scrollbar = ttk.Scrollbar(list_frame, orient='vertical', command=self.subjects_tree.yview)
        self.subjects_tree.configure(yscrollcommand=scrollbar.set)
        
        self.subjects_tree.pack(side='left', fill='both', expand=True)
        scrollbar.pack(side='right', fill='y')
    
    def setup_upload_tab(self):
        """إنشاء تبويب رفع الواجبات"""
        # إطار العنوان
        title_frame = ttk.LabelFrame(self.upload_tab, text="رفع واجبات الطلاب")
        title_frame.pack(fill='both', expand=True, padx=10, pady=5)
        
        # إطار اختيار المادة والطالب
        selection_frame = ttk.LabelFrame(title_frame, text="اختيار المادة والطالب")
        selection_frame.pack(fill='x', padx=10, pady=10)
        
        # اختيار المادة
        ttk.Label(selection_frame, text="المادة الدراسية:").grid(row=0, column=0, padx=10, pady=10, sticky='w')
        self.upload_subject_combo = ttk.Combobox(selection_frame, state="readonly", width=40)
        self.upload_subject_combo.grid(row=0, column=1, padx=10, pady=10)
        self.upload_subject_combo.bind('<<ComboboxSelected>>', self.on_subject_selected)
        
        # اختيار الطالب
        ttk.Label(selection_frame, text="الطالب:").grid(row=1, column=0, padx=10, pady=10, sticky='w')
        self.upload_student_combo = ttk.Combobox(selection_frame, state="readonly", width=40)
        self.upload_student_combo.grid(row=1, column=1, padx=10, pady=10)
        
        # إطار رفع الملف
        file_frame = ttk.LabelFrame(title_frame, text="اختيار ملف الواجب")
        file_frame.pack(fill='x', padx=10, pady=10)
        
        # عرض مسار الملف المختار
        self.file_path_var = tk.StringVar()
        file_label = ttk.Label(file_frame, textvariable=self.file_path_var, 
                              relief='sunken', padding=5, width=60)
        file_label.grid(row=0, column=0, padx=10, pady=10)
        
        # زر اختيار الملف
        browse_button = ttk.Button(file_frame, text="📁 اختر ملف الواجب", 
                                  command=self.browse_file)
        browse_button.grid(row=0, column=1, padx=10, pady=10)
        
        # إطار معلومات الواجب
        info_frame = ttk.LabelFrame(title_frame, text="معلومات الواجب")
        info_frame.pack(fill='x', padx=10, pady=10)
        
        ttk.Label(info_frame, text="اسم الواجب:").grid(row=0, column=0, padx=10, pady=10, sticky='w')
        self.assignment_name_entry = ttk.Entry(info_frame, width=40)
        self.assignment_name_entry.grid(row=0, column=1, padx=10, pady=10)
        
        # زر رفع الواجب (كبير وواضح)
        upload_frame = ttk.Frame(title_frame)
        upload_frame.pack(fill='x', padx=10, pady=20)
        
        self.upload_button = tk.Button(upload_frame, 
                                      text="⬆️ رفع الواجب", 
                                      command=self.upload_assignment,
                                      font=('Arial', 14, 'bold'),
                                      bg='#4CAF50',
                                      fg='white',
                                      height=2,
                                      width=20)
        self.upload_button.pack()
        
        # إطار حالة الرفع
        status_frame = ttk.LabelFrame(title_frame, text="حالة الرفع")
        status_frame.pack(fill='x', padx=10, pady=10)
        
        self.status_text = tk.Text(status_frame, height=6, width=80, state='disabled')
        scrollbar = ttk.Scrollbar(status_frame, command=self.status_text.yview)
        self.status_text.configure(yscrollcommand=scrollbar.set)
        
        self.status_text.pack(side='left', fill='both', expand=True, padx=5, pady=5)
        scrollbar.pack(side='right', fill='y')
        
        # زر تفريغ السجل
        clear_button = ttk.Button(status_frame, text="مسح السجل", command=self.clear_status)
        clear_button.pack(pady=5)
    
    def setup_evaluation_tab(self):
        """إنشاء تبويب التقييم"""
        # إطار العنوان
        title_frame = ttk.LabelFrame(self.evaluation_tab, text="تقييم واجبات الطلاب")
        title_frame.pack(fill='both', expand=True, padx=10, pady=5)
        
        # إطار اختيار المادة والطالب
        selection_frame = ttk.LabelFrame(title_frame, text="اختيار المادة والطالب")
        selection_frame.pack(fill='x', padx=10, pady=10)
        
        # اختيار المادة
        ttk.Label(selection_frame, text="المادة الدراسية:").grid(row=0, column=0, padx=10, pady=10, sticky='w')
        self.eval_subject_combo = ttk.Combobox(selection_frame, state="readonly", width=40)
        self.eval_subject_combo.grid(row=0, column=1, padx=10, pady=10)
        self.eval_subject_combo.bind('<<ComboboxSelected>>', self.on_eval_subject_selected)
        
        # اختيار الطالب
        ttk.Label(selection_frame, text="الطالب:").grid(row=1, column=0, padx=10, pady=10, sticky='w')
        self.eval_student_combo = ttk.Combobox(selection_frame, state="readonly", width=40)
        self.eval_student_combo.grid(row=1, column=1, padx=10, pady=10)
        
        # إطار بيانات التقييم
        eval_frame = ttk.LabelFrame(title_frame, text="بيانات التقييم")
        eval_frame.pack(fill='x', padx=10, pady=10)
        
        # الدرجة
        ttk.Label(eval_frame, text="الدرجة (0-100):").grid(row=0, column=0, padx=10, pady=10, sticky='w')
        self.score_spinbox = ttk.Spinbox(eval_frame, from_=0, to=100, width=10)
        self.score_spinbox.grid(row=0, column=1, padx=10, pady=10)
        self.score_spinbox.set(85)
        
        # التعليقات
        ttk.Label(eval_frame, text="تعليقات المعلم:").grid(row=1, column=0, padx=10, pady=10, sticky='w')
        self.comments_text = tk.Text(eval_frame, height=4, width=50)
        self.comments_text.grid(row=1, column=1, padx=10, pady=10, columnspan=2)
        
        # الملاحظات
        ttk.Label(eval_frame, text="ملاحظات إضافية:").grid(row=2, column=0, padx=10, pady=10, sticky='w')
        self.notes_entry = ttk.Entry(eval_frame, width=50)
        self.notes_entry.grid(row=2, column=1, padx=10, pady=10, columnspan=2)
        
        # زر إنشاء التقييم
        eval_button_frame = ttk.Frame(title_frame)
        eval_button_frame.pack(fill='x', padx=10, pady=20)
        
        create_eval_button = tk.Button(eval_button_frame, 
                                      text="📝 إنشاء ملف التقييم", 
                                      command=self.create_evaluation,
                                      font=('Arial', 12),
                                      bg='#2196F3',
                                      fg='white',
                                      height=2,
                                      width=20)
        create_eval_button.pack()
    
    def setup_organize_tab(self):
        """إنشاء تبويب التنظيم التلقائي"""
        # إطار العنوان
        title_frame = ttk.LabelFrame(self.organize_tab, text="التنظيم التلقائي لملفات التقييم")
        title_frame.pack(fill='both', expand=True, padx=10, pady=5)
        
        # إطار اختيار المادة
        subject_frame = ttk.LabelFrame(title_frame, text="اختيار المادة")
        subject_frame.pack(fill='x', padx=10, pady=10)
        
        ttk.Label(subject_frame, text="المادة الدراسية:").grid(row=0, column=0, padx=10, pady=10, sticky='w')
        self.organize_subject_combo = ttk.Combobox(subject_frame, state="readonly", width=40)
        self.organize_subject_combo.grid(row=0, column=1, padx=10, pady=10)
        
        # إطار اختيار المجلد
        folder_frame = ttk.LabelFrame(title_frame, text="اختيار مجلد ملفات التقييم")
        folder_frame.pack(fill='x', padx=10, pady=10)
        
        self.folder_path_var = tk.StringVar()
        folder_label = ttk.Label(folder_frame, textvariable=self.folder_path_var, 
                                relief='sunken', padding=5, width=60)
        folder_label.grid(row=0, column=0, padx=10, pady=10)
        
        browse_folder_button = ttk.Button(folder_frame, text="📁 اختر المجلد", 
                                         command=self.browse_folder)
        browse_folder_button.grid(row=0, column=1, padx=10, pady=10)
        
        # زر التنظيم التلقائي
        organize_frame = ttk.Frame(title_frame)
        organize_frame.pack(fill='x', padx=10, pady=20)
        
        organize_button = tk.Button(organize_frame, 
                                   text="🔄 تنظيم الملفات تلقائياً", 
                                   command=self.auto_organize,
                                   font=('Arial', 12),
                                   bg='#FF9800',
                                   fg='white',
                                   height=2,
                                   width=25)
        organize_button.pack()
        
        # إطار النتائج
        results_frame = ttk.LabelFrame(title_frame, text="نتائج التنظيم")
        results_frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        self.results_text = tk.Text(results_frame, height=10, width=80, state='disabled')
        results_scrollbar = ttk.Scrollbar(results_frame, command=self.results_text.yview)
        self.results_text.configure(yscrollcommand=results_scrollbar.set)
        
        self.results_text.pack(side='left', fill='both', expand=True, padx=5, pady=5)
        results_scrollbar.pack(side='right', fill='y')
    
    def setup_reports_tab(self):
        """إنشاء تبويب التقارير"""
        # إطار العنوان
        title_frame = ttk.LabelFrame(self.reports_tab, text="التقارير والإحصائيات")
        title_frame.pack(fill='both', expand=True, padx=10, pady=5)
        
        # إطار الإحصائيات العامة
        stats_frame = ttk.LabelFrame(title_frame, text="الإحصائيات العامة")
        stats_frame.pack(fill='x', padx=10, pady=10)
        
        # عرض الإحصائيات
        self.stats_text = tk.Text(stats_frame, height=8, width=80, state='disabled')
        stats_scrollbar = ttk.Scrollbar(stats_frame, command=self.stats_text.yview)
        self.stats_text.configure(yscrollcommand=stats_scrollbar.set)
        
        self.stats_text.pack(side='left', fill='both', expand=True, padx=5, pady=5)
        stats_scrollbar.pack(side='right', fill='y')
        
        # زر تحديث الإحصائيات
        refresh_button = ttk.Button(stats_frame, text="تحديث الإحصائيات", 
                                   command=self.update_stats)
        refresh_button.pack(pady=5)
        
        # إطار تقدم الطلاب
        progress_frame = ttk.LabelFrame(title_frame, text="تقدم الطلاب")
        progress_frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        ttk.Label(progress_frame, text="اختر الطالب:").pack(side='left', padx=10, pady=10)
        self.progress_student_combo = ttk.Combobox(progress_frame, state="readonly", width=30)
        self.progress_student_combo.pack(side='left', padx=10, pady=10)
        
        show_progress_button = ttk.Button(progress_frame, text="عرض التقدم", 
                                         command=self.show_student_progress)
        show_progress_button.pack(side='left', padx=10, pady=10)
        
        # إطار عرض التقدم
        self.progress_text = tk.Text(title_frame, height=10, width=80, state='disabled')
        progress_scrollbar = ttk.Scrollbar(title_frame, command=self.progress_text.yview)
        self.progress_text.configure(yscrollcommand=progress_scrollbar.set)
        
        self.progress_text.pack(side='bottom', fill='both', expand=True, padx=10, pady=10)
        progress_scrollbar.pack(side='right', fill='y')
    
    def update_lists(self):
        """تحديث جميع القوائم المنسدلة والقوائم"""
        self.update_students_list()
        self.update_subjects_list()
        self.update_comboboxes()
        self.update_stats()
    
    def update_students_list(self):
        """تحديث قائمة الطلاب"""
        self.students_listbox.delete(0, tk.END)
        for student in self.students.keys():
            self.students_listbox.insert(tk.END, student)
        
        # تحديث متغيرات الطلاب في تبويب المواد
        self.update_student_checkboxes()
    
    def update_subjects_list(self):
        """تحديث قائمة المواد"""
        # تحديث شجرة المواد
        for item in self.subjects_tree.get_children():
            self.subjects_tree.delete(item)
        
        for subject, info in self.subjects.items():
            teacher = info.get('teacher', 'غير محدد')
            students_count = len(info.get('students', []))
            self.subjects_tree.insert('', tk.END, values=(subject, teacher, students_count))
    
    def update_comboboxes(self):
        """تحديث جميع القوائم المنسدلة"""
        # تحديث قائمة المواد في جميع التبويبات
        subjects_list = list(self.subjects.keys())
        
        self.subject_combo['values'] = subjects_list
        self.upload_subject_combo['values'] = subjects_list
        self.eval_subject_combo['values'] = subjects_list
        self.organize_subject_combo['values'] = subjects_list
        
        # تحديث قائمة الطلاب في تقارير التقدم
        students_list = list(self.students.keys())
        self.progress_student_combo['values'] = students_list
        
        if subjects_list:
            self.subject_combo.current(0)
            self.upload_subject_combo.current(0)
            self.eval_subject_combo.current(0)
            self.organize_subject_combo.current(0)
        
        if students_list:
            self.progress_student_combo.current(0)
    
    def update_student_checkboxes(self):
        """تحديث صناديق اختيار الطلاب"""
        # مسح الصناديق الحالية
        for widget in self.students_checkboxes:
            widget.destroy()
        self.students_checkboxes = []
        self.student_vars = {}
        
        # إنشاء صناديق جديدة
        row = 0
        col = 0
        
        for i, student in enumerate(self.students.keys()):
            var = tk.BooleanVar()
            self.student_vars[student] = var
            
            cb = ttk.Checkbutton(self.students_select_frame, text=student, variable=var)
            cb.grid(row=row, column=col, padx=5, pady=2, sticky='w')
            self.students_checkboxes.append(cb)
            
            col += 1
            if col > 2:  # 3 أعمدة
                col = 0
                row += 1
    
    def on_subject_selected(self, event):
        """عند اختيار مادة في تبويب رفع الواجبات"""
        subject = self.upload_subject_combo.get()
        if subject in self.subjects:
            students = self.subjects[subject].get('students', [])
            self.upload_student_combo['values'] = students
            if students:
                self.upload_student_combo.current(0)
    
    def on_eval_subject_selected(self, event):
        """عند اختيار مادة في تبويب التقييم"""
        subject = self.eval_subject_combo.get()
        if subject in self.subjects:
            students = self.subjects[subject].get('students', [])
            self.eval_student_combo['values'] = students
            if students:
                self.eval_student_combo.current(0)
    
    def add_student(self):
        """إضافة طالب جديد"""
        student_name = self.student_name_entry.get().strip()
        
        if not student_name:
            messagebox.showwarning("تحذير", "يرجى إدخال اسم الطالب")
            return
        
        if student_name in self.students:
            messagebox.showwarning("تحذير", "الطالب موجود بالفعل!")
            return
        
        # إضافة الطالب
        self.students[student_name] = {
            "subjects": [],
            "registration_date": datetime.datetime.now().isoformat(),
            "total_assignments": 0,
            "completed_assignments": 0
        }
        
        # إنشاء مجلد الطالب
        student_path = self.base_path / "Students" / student_name
        student_path.mkdir(parents=True, exist_ok=True)
        
        # حفظ البيانات
        self.save_json(self.students_file, self.students)
        
        # تحديث الواجهة
        self.update_lists()
        self.student_name_entry.delete(0, tk.END)
        
        messagebox.showinfo("نجاح", f"تمت إضافة الطالب '{student_name}' بنجاح")
    
    def bulk_add_students(self):
        """إضافة عدة طلاب دفعة واحدة"""
        dialog = tk.Toplevel(self.root)
        dialog.title("إضافة عدة طلاب")
        dialog.geometry("500x300")
        dialog.transient(self.root)
        dialog.grab_set()
        
        ttk.Label(dialog, text="أدخل أسماء الطلاب (سطر لكل طالب):").pack(padx=10, pady=10)
        
        text_widget = tk.Text(dialog, height=10, width=50)
        text_widget.pack(padx=10, pady=10)
        
        def save_students():
            content = text_widget.get("1.0", tk.END).strip()
            student_names = [name.strip() for name in content.split('\n') if name.strip()]
            
            added = 0
            skipped = 0
            
            for student_name in student_names:
                if student_name and student_name not in self.students:
                    self.students[student_name] = {
                        "subjects": [],
                        "registration_date": datetime.datetime.now().isoformat(),
                        "total_assignments": 0,
                        "completed_assignments": 0
                    }
                    
                    # إنشاء مجلد الطالب
                    student_path = self.base_path / "Students" / student_name
                    student_path.mkdir(parents=True, exist_ok=True)
                    
                    added += 1
                else:
                    skipped += 1
            
            if added > 0:
                self.save_json(self.students_file, self.students)
                self.update_lists()
                messagebox.showinfo("نجاح", f"تمت إضافة {added} طالب، وتخطي {skipped} طالب موجودين مسبقاً")
            else:
                messagebox.showinfo("معلومة", "لم تتم إضافة أي طلاب جدد")
            
            dialog.destroy()
        
        button_frame = ttk.Frame(dialog)
        button_frame.pack(pady=10)
        
        ttk.Button(button_frame, text="حفظ", command=save_students).pack(side='left', padx=5)
        ttk.Button(button_frame, text="إلغاء", command=dialog.destroy).pack(side='left', padx=5)
    
    def delete_student(self):
        """حذف طالب"""
        selection = self.students_listbox.curselection()
        if not selection:
            messagebox.showwarning("تحذير", "يرجى اختيار طالب للحذف")
            return
        
        student_name = self.students_listbox.get(selection[0])
        
        if messagebox.askyesno("تأكيد", f"هل أنت متأكد من حذف الطالب '{student_name}'؟"):
            # حذف الطالب من المواد
            for subject in self.subjects.values():
                if 'students' in subject and student_name in subject['students']:
                    subject['students'].remove(student_name)
            
            # حذف الطالب من القائمة
            del self.students[student_name]
            
            # حذف مجلد الطالب
            student_path = self.base_path / "Students" / student_name
            if student_path.exists():
                shutil.rmtree(student_path)
            
            # حذف مجلدات الطالب من المواد
            for subject_name in self.subjects.keys():
                subject_student_path = self.base_path / subject_name / student_name
                if subject_student_path.exists():
                    shutil.rmtree(subject_student_path)
            
            # حفظ البيانات
            self.save_json(self.students_file, self.students)
            self.save_json(self.subjects_file, self.subjects)
            
            # تحديث الواجهة
            self.update_lists()
            
            messagebox.showinfo("نجاح", f"تم حذف الطالب '{student_name}' بنجاح")
    
    def export_students(self):
        """تصدير قائمة الطلاب"""
        file_path = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
        )
        
        if file_path:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write("قائمة الطلاب\n")
                f.write("=" * 30 + "\n")
                for student in self.students.keys():
                    info = self.students[student]
                    reg_date = info.get('registration_date', 'غير معروف')
                    f.write(f"الاسم: {student}\n")
                    f.write(f"تاريخ التسجيل: {reg_date}\n")
                    f.write(f"المواد: {', '.join(info.get('subjects', []))}\n")
                    f.write(f"الواجبات: {info.get('completed_assignments', 0)}/{info.get('total_assignments', 0)}\n")
                    f.write("-" * 30 + "\n")
            
            messagebox.showinfo("نجاح", f"تم تصدير القائمة إلى {file_path}")
    
    def add_subject(self):
        """إضافة مادة جديدة"""
        subject_name = self.subject_name_entry.get().strip()
        teacher_name = self.teacher_name_entry.get().strip()
        
        if not subject_name:
            messagebox.showwarning("تحذير", "يرجى إدخال اسم المادة")
            return
        
        if subject_name in self.subjects:
            messagebox.showwarning("تحذير", "المادة موجودة بالفعل!")
            return
        
        # إضافة المادة
        self.subjects[subject_name] = {
            "teacher": teacher_name,
            "created_date": datetime.datetime.now().isoformat(),
            "students": []
        }
        
        # إنشاء مجلد المادة
        subject_path = self.base_path / subject_name
        subject_path.mkdir(exist_ok=True)
        
        # حفظ البيانات
        self.save_json(self.subjects_file, self.subjects)
        
        # تحديث الواجهة
        self.update_lists()
        self.subject_name_entry.delete(0, tk.END)
        self.teacher_name_entry.delete(0, tk.END)
        
        messagebox.showinfo("نجاح", f"تمت إضافة المادة '{subject_name}' بنجاح")
    
    def enroll_students(self):
        """تسجيل الطلاب في مادة"""
        subject_name = self.subject_combo.get()
        if not subject_name:
            messagebox.showwarning("تحذير", "يرجى اختيار مادة")
            return
        
        # الحصول على الطلاب المحددين
        selected_students = [student for student, var in self.student_vars.items() if var.get()]
        
        if not selected_students:
            messagebox.showwarning("تحذير", "يرجى اختيار طلاب للتسجيل")
            return
        
        # تسجيل الطلاب
        enrolled = 0
        for student_name in selected_students:
            if student_name not in self.subjects[subject_name]["students"]:
                self.subjects[subject_name]["students"].append(student_name)
                enrolled += 1
            
            # إضافة المادة للطالب
            if subject_name not in self.students[student_name]["subjects"]:
                self.students[student_name]["subjects"].append(subject_name)
            
            # إنشاء مجلد الطالب داخل مجلد المادة
            student_subject_path = self.base_path / subject_name / student_name
            student_subject_path.mkdir(exist_ok=True)
        
        # حفظ البيانات
        self.save_json(self.subjects_file, self.subjects)
        self.save_json(self.students_file, self.students)
        
        # تحديث الواجهة
        self.update_subjects_list()
        
        messagebox.showinfo("نجاح", f"تم تسجيل {enrolled} طالب في المادة '{subject_name}'")
    
    def browse_file(self):
        """فتح نافذة اختيار الملف"""
        file_path = filedialog.askopenfilename(
            title="اختر ملف الواجب",
            filetypes=[
                ("جميع الملفات", "*.*"),
                ("مستندات PDF", "*.pdf"),
                ("مستندات Word", "*.docx *.doc"),
                ("ملفات نصية", "*.txt"),
                ("صور", "*.jpg *.jpeg *.png")
            ]
        )
        
        if file_path:
            self.file_path_var.set(file_path)
            # اقتراح اسم الواجب من اسم الملف
            file_name = Path(file_path).stem
            self.assignment_name_entry.delete(0, tk.END)
            self.assignment_name_entry.insert(0, file_name)
    
    def browse_folder(self):
        """فتح نافذة اختيار المجلد"""
        folder_path = filedialog.askdirectory(title="اختر مجلد ملفات التقييم")
        
        if folder_path:
            self.folder_path_var.set(folder_path)
    
    def upload_assignment(self):
        """رفع واجب الطالب"""
        # التحقق من البيانات
        subject_name = self.upload_subject_combo.get()
        student_name = self.upload_student_combo.get()
        file_path = self.file_path_var.get()
        assignment_name = self.assignment_name_entry.get().strip()
        
        if not all([subject_name, student_name, file_path]):
            messagebox.showwarning("تحذير", "يرجى ملء جميع الحقول واختيار ملف")
            return
        
        if not assignment_name:
            assignment_name = "واجب"
        
        # التحقق من وجود الملف
        if not os.path.exists(file_path):
            messagebox.showerror("خطأ", "الملف المحدد غير موجود!")
            return
        
        # التحقق من تسجيل الطالب في المادة
        if subject_name not in self.subjects:
            messagebox.showerror("خطأ", "المادة غير موجودة!")
            return
        
        if student_name not in self.students:
            messagebox.showerror("خطأ", "الطالب غير موجود!")
            return
        
        if student_name not in self.subjects[subject_name]["students"]:
            messagebox.showerror("خطأ", f"الطالب {student_name} غير مسجل في المادة {subject_name}!")
            return
        
        try:
            # إنشاء اسم الملف
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            subject_path = self.base_path / subject_name / student_name
            file_extension = Path(file_path).suffix
            destination_filename = f"{assignment_name}_{timestamp}{file_extension}"
            destination_path = subject_path / destination_filename
            
            # نسخ الملف
            shutil.copy2(file_path, destination_path)
            
            # تحديث سجلات الطالب
            self.students[student_name]["total_assignments"] += 1
            self.save_json(self.students_file, self.students)
            
            # تحديث سجل الحالة
            self.log_status(f"✅ تم رفع واجب بنجاح!")
            self.log_status(f"   الطالب: {student_name}")
            self.log_status(f"   المادة: {subject_name}")
            self.log_status(f"   اسم الواجب: {assignment_name}")
            self.log_status(f"   تم الحفظ في: {destination_path}")
            self.log_status("-" * 50)
            
            # تفريغ الحقول
            self.file_path_var.set("")
            self.assignment_name_entry.delete(0, tk.END)
            
            # تحديث الإحصائيات
            self.update_stats()
            
            messagebox.showinfo("نجاح", "تم رفع الواجب بنجاح!")
            
        except Exception as e:
            self.log_status(f"❌ خطأ في رفع الواجب: {str(e)}")
            messagebox.showerror("خطأ", f"فشل رفع الواجب: {str(e)}")
    
    def log_status(self, message):
        """تسجيل رسالة في سجل الحالة"""
        self.status_text.configure(state='normal')
        self.status_text.insert(tk.END, message + "\n")
        self.status_text.see(tk.END)
        self.status_text.configure(state='disabled')
    
    def clear_status(self):
        """مسح سجل الحالة"""
        self.status_text.configure(state='normal')
        self.status_text.delete("1.0", tk.END)
        self.status_text.configure(state='disabled')
    
    def create_evaluation(self):
        """إنشاء ملف تقييم"""
        # التحقق من البيانات
        subject_name = self.eval_subject_combo.get()
        student_name = self.eval_student_combo.get()
        
        if not all([subject_name, student_name]):
            messagebox.showwarning("تحذير", "يرجى اختيار المادة والطالب")
            return
        
        try:
            score = int(self.score_spinbox.get())
            if score < 0 or score > 100:
                raise ValueError
        except:
            messagebox.showwarning("تحذير", "يرجى إدخال درجة صحيحة بين 0 و 100")
            return
        
        comments = self.comments_text.get("1.0", tk.END).strip()
        notes = self.notes_entry.get().strip()
        
        # التحقق من وجود المادة والطالب
        if subject_name not in self.subjects:
            messagebox.showerror("خطأ", "المادة غير موجودة!")
            return
        
        if student_name not in self.students:
            messagebox.showerror("خطأ", "الطالب غير موجود!")
            return
        
        if student_name not in self.subjects[subject_name]["students"]:
            messagebox.showerror("خطأ", f"الطالب {student_name} غير مسجل في المادة {subject_name}!")
            return
        
        try:
            # محتوى ملف التقييم
            evaluation_content = f"""تقييم الواجب الدراسي
=================================
المادة: {subject_name}
الطالب: {student_name}
التاريخ: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
---------------------------------
درجة الواجب: {score}/100
تعليقات المعلم:
{comments}
---------------------------------
ملاحظات:
{notes}
================================="""
            
            # إنشاء ملف التقييم
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            subject_path = self.base_path / subject_name / student_name
            evaluation_filename = f"تقييم_{student_name}_{timestamp}.txt"
            evaluation_path = subject_path / evaluation_filename
            
            with open(evaluation_path, 'w', encoding='utf-8') as f:
                f.write(evaluation_content)
            
            # تحديث سجلات الطالب
            self.students[student_name]["completed_assignments"] += 1
            self.save_json(self.students_file, self.students)
            
            # تفريغ الحقول
            self.comments_text.delete("1.0", tk.END)
            self.notes_entry.delete(0, tk.END)
            
            # تحديث الإحصائيات
            self.update_stats()
            
            messagebox.showinfo("نجاح", f"تم إنشاء ملف التقييم بنجاح!\n\nتم حفظه في:\n{evaluation_path}")
            
        except Exception as e:
            messagebox.showerror("خطأ", f"فشل إنشاء ملف التقييم: {str(e)}")
    
    def auto_organize(self):
        """تنظيم ملفات التقييم تلقائياً"""
        subject_name = self.organize_subject_combo.get()
        folder_path = self.folder_path_var.get()
        
        if not all([subject_name, folder_path]):
            messagebox.showwarning("تحذير", "يرجى اختيار المادة والمجلد")
            return
        
        if subject_name not in self.subjects:
            messagebox.showerror("خطأ", "المادة غير موجودة!")
            return
        
        if not os.path.exists(folder_path):
            messagebox.showerror("خطأ", "المجلد المحدد غير موجود!")
            return
        
        # مسح النتائج السابقة
        self.results_text.configure(state='normal')
        self.results_text.delete("1.0", tk.END)
        
        try:
            folder = Path(folder_path)
            moved_files = 0
            error_files = 0
            
            # البحث عن ملفات التقييم
            for eval_file in folder.glob("*.txt"):
                try:
                    with open(eval_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # البحث عن اسم الطالب في الملف
                    student_name = None
                    for student in self.subjects[subject_name]["students"]:
                        if student in content:
                            student_name = student
                            break
                    
                    if student_name:
                        # نقل الملف إلى مجلد الطالب المناسب
                        destination_folder = self.base_path / subject_name / student_name
                        destination_folder.mkdir(exist_ok=True)
                        
                        destination_path = destination_folder / eval_file.name
                        shutil.move(str(eval_file), str(destination_path))
                        
                        self.results_text.insert(tk.END, f"✅ {eval_file.name} → {student_name}\n")
                        moved_files += 1
                    else:
                        self.results_text.insert(tk.END, f"❌ {eval_file.name}: لم يتم العثور على اسم طالب\n")
                        error_files += 1
                
                except Exception as e:
                    self.results_text.insert(tk.END, f"❌ {eval_file.name}: خطأ - {str(e)}\n")
                    error_files += 1
            
            # عرض النتائج
            self.results_text.insert(tk.END, "\n" + "="*50 + "\n")
            self.results_text.insert(tk.END, f"النتيجة: تم نقل {moved_files} ملف، {error_files} أخطاء\n")
            
            if moved_files > 0:
                messagebox.showinfo("نجاح", f"تم تنظيم {moved_files} ملف بنجاح!")
            else:
                messagebox.showinfo("معلومة", "لم يتم نقل أي ملفات")
        
        except Exception as e:
            self.results_text.insert(tk.END, f"❌ خطأ عام: {str(e)}\n")
            messagebox.showerror("خطأ", f"فشل التنظيم: {str(e)}")
        
        finally:
            self.results_text.see(tk.END)
            self.results_text.configure(state='disabled')
    
    def update_stats(self):
        """تحديث الإحصائيات"""
        self.stats_text.configure(state='normal')
        self.stats_text.delete("1.0", tk.END)
        
        # حساب الإحصائيات
        total_students = len(self.students)
        total_subjects = len(self.subjects)
        total_assignments = sum(student.get('total_assignments', 0) for student in self.students.values())
        completed_assignments = sum(student.get('completed_assignments', 0) for student in self.students.values())
        
        # حساب نسبة الإنجاز
        completion_rate = 0
        if total_assignments > 0:
            completion_rate = (completed_assignments / total_assignments) * 100
        
        # عرض الإحصائيات
        stats = f"""📊 الإحصائيات العامة
{'='*40}
عدد الطلاب: {total_students}
عدد المواد: {total_subjects}
إجمالي الواجبات: {total_assignments}
الواجبات المكتملة: {completed_assignments}
نسبة الإنجاز: {completion_rate:.1f}%

المواد الدراسية:
{'='*40}"""
        
        for subject, info in self.subjects.items():
            teacher = info.get('teacher', 'غير محدد')
            students_count = len(info.get('students', []))
            stats += f"\n📚 {subject}"
            stats += f"\n   المعلم: {teacher}"
            stats += f"\n   عدد الطلاب: {students_count}"
            stats += f"\n   {'─'*30}"
        
        self.stats_text.insert(tk.END, stats)
        self.stats_text.see(tk.END)
        self.stats_text.configure(state='disabled')
    
    def show_student_progress(self):
        """عرض تقدم طالب محدد"""
        student_name = self.progress_student_combo.get()
        
        if not student_name:
            messagebox.showwarning("تحذير", "يرجى اختيار طالب")
            return
        
        if student_name not in self.students:
            messagebox.showerror("خطأ", "الطالب غير موجود!")
            return
        
        student_data = self.students[student_name]
        
        self.progress_text.configure(state='normal')
        self.progress_text.delete("1.0", tk.END)
        
        # حساب تقدم الطالب
        subjects = student_data.get('subjects', [])
        total_assignments = student_data.get('total_assignments', 0)
        completed_assignments = student_data.get('completed_assignments', 0)
        
        completion_rate = 0
        if total_assignments > 0:
            completion_rate = (completed_assignments / total_assignments) * 100
        
        # عرض التقدم
        progress = f"""🎓 تقدم الطالب: {student_name}
{'='*40}
المواد المسجل فيها: {', '.join(subjects) if subjects else 'لا يوجد'}
عدد المواد: {len(subjects)}
الواجبات المسلمة: {completed_assignments} / {total_assignments}
نسبة الإنجاز: {completion_rate:.1f}%

تفاصيل الواجبات حسب المادة:
{'='*40}"""
        
        # حساب الواجبات لكل مادة (تقريبي)
        if subjects:
            avg_per_subject = total_assignments / len(subjects) if len(subjects) > 0 else 0
            for subject in subjects:
                progress += f"\n📘 {subject}"
                progress += f"\n   عدد الواجبات التقريبي: {avg_per_subject:.1f}"
                progress += f"\n   {'─'*30}"
        else:
            progress += "\nلا يوجد مواد مسجلة"
        
        self.progress_text.insert(tk.END, progress)
        self.progress_text.see(tk.END)
        self.progress_text.configure(state='disabled')

def main():
    """الدالة الرئيسية لتشغيل البرنامج"""
    root = tk.Tk()
    app = StudentAssignmentGUI(root)
    root.mainloop()

if __name__ == "__main__":
    main()
