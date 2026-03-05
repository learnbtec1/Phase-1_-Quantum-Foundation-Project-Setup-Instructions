/**
 * اختبار التحقق من صحة طلبات التقييم (evaluate route validation).
 * يتحقق من أن النص القصير أو الفارغ يُرجع 400 مع رسالة مناسبة.
 */
import { POST } from '../app/api/evaluate/route';

function buildRequest(body: object): Request {
  return new Request('http://localhost/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Evaluate API validation', () => {
  it('returns 400 when assignment_text is too short', async () => {
    const req = buildRequest({
      assignment_text: 'قصير',
      student_text: 'إجابة الطالب الطويلة بما يكفي لتجاوز حد الخمسين حرفاً هنا.',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.type).toBe('error');
    expect(data.detail).toBeDefined();
  });

  it('returns 400 when student_text is too short', async () => {
    const req = buildRequest({
      assignment_text: 'نص الواجب الطويل بما يكفي ليصل إلى عشرين حرفاً على الأقل.',
      student_text: 'قصيرة',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.type).toBe('error');
  });
});
