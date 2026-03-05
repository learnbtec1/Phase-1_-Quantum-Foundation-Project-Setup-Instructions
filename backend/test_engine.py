import asyncio
from app.services.forensic_grader import forensic_grade

async def run_test():
    assignment = """
    هذا واجب رسمي يحتوي على الشروط المطلوبة.
    P1: اشرح مبادئ خدمة العملاء.
    M1: حلل توقعات العملاء.
    D1: قارن بين شركتين.
    المطلوب: شركتين.
    """
    
    student = """
    إجابة الطالب هنا:
    شرحت مبادئ خدمة العملاء بشكل ممتاز (P1 مستوفى).
    وحللت توقعات العملاء بدقة (M1 مستوفى).
    ولكنني تحدثت عن شركة واحدة فقط وهي شركة آبل (D1 غير مستوفى لأنه طلب شركتين).
    """
    
    print("🚀 جاري تشغيل المحرك الماسي...")
    result = await forensic_grade(assignment, student)
    print("\nالنتيجة النهائية:", result["final_grade"])
    print("المعايير المقروءة:", list(result["criteria_results"].keys()))

if __name__ == "__main__":
    asyncio.run(run_test())