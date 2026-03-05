const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const nexusApi = {
  async forensicGrade(studentContent: string, assignmentText: string) {
    const response = await fetch(`${API_BASE_URL}/api/v1/assessment/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_text: studentContent, // تغيير المفتاح إلى student_text
        assignment_text: assignmentText,
        allow_criteria_extraction: true
      }),
    });
    return await response.json();
  },
  // ...
};