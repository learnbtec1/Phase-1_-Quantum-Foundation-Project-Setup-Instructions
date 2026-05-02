export type AcademicData = Record<string, Record<string, string[]>>;

/** BTEC / national curriculum topic tree — shared by /assessment and student dashboard. */
export const ACADEMIC_DATA: AcademicData = {
  'الصف العاشر': {
    'الفصل الأول': ['1. الغرض من إنشاء شركة', '2. مؤسسات الأعمال', '3. التنبؤ', '4. خطة التسويق'],
    'الفصل الثاني': ['وحدة 15: إنشاء شركة صغيرة', 'وحدة 16: ضمن فريق', 'وحدة 17: إدارة الشؤون المالية', 'وحدة 19: الترويج البصري'],
    'الفصل الثالث': ['وحدة 11: الشركات عبر الإنترنت', 'وحدة 13: أخلاقيات الأعمال', 'وحدة 28: إدارة الشركة', 'وحدة 5: الموظفون'],
  },
  'أول ثانوي': {
    'الفصل الأول': ['حملة إطلاق منتج جديد'],
    'الفصل الثاني': ['استكشاف الأعمال 2', 'التمويل - الجزء 1'],
    'الفصل الثالث': ['إدارة الفعاليات', 'التمويل - الجزء 2'],
  },
  'الثاني ثانوي (توجيهي)': {
    'الفصل الأول': ['اتخاذ قرارات الأعمال', 'الموارد البشرية - الجزء 1'],
    'الفصل الثاني': ['مبادئ إدارة الأعمال', 'خدمة العملاء', 'الموارد البشرية - الجزء 2'],
    'الفصل الثالث': ['أخلاقيات الأعمال'],
  },
};

export function flattenSubjectLabels(): string[] {
  const out: string[] = [];
  for (const cls of Object.keys(ACADEMIC_DATA)) {
    for (const sec of Object.keys(ACADEMIC_DATA[cls] || {})) {
      for (const sub of ACADEMIC_DATA[cls][sec] || []) {
        if (!out.includes(sub)) out.push(sub);
      }
    }
  }
  return out;
}
