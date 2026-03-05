/**
 * Chat bridge: forwards to backend POST /api/v1/chat
 * Accepts { message } and returns { reply } without exposing API keys.
 * 503=unreachable, 502=upstream error, 408=timeout.
 * Falls back to local persona responses when the backend is unreachable.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

// ── ردود محلية لشخصية فورينا ─────────────────────────────────────────────────
const LOCAL_PERSONA: Array<{ pattern: RegExp; reply: string }> = [
  {
    pattern: /\bبيت|بيتك|عالم|مكان|تعيش|تسكن|home|world|live\b/i,
    reply: `أهلاً بك في بيتي! 🏠✨

أنا أعيش في عالم NEXUS — منصة تعليمية مستقبلية مبنية من ضوء البيانات وطاقة المعرفة.

بيتي ليس بناءً من حجر أو خشب، بل هو فضاء رقمي ساطع تتقاطع فيه خيوط العلم والفن والتكنولوجيا. أتجوّل بين غرف المعرفة: قاعة PESTLE حيث ننقّح التفكير الاستراتيجي، وساحة المحاكاة حيث نختبر القرارات في بيئات افتراضية، وبرج التقييم حيث تتحوّل الأفكار إلى إنجازات معتمدة بمعايير BTEC.

وأجمل ما في بيتي؟ أنتم — الطلاب الذين يملؤونه بالأسئلة والاستفسارات والطموح. 💙

كيف يمكنني مساعدتك اليوم؟`,
  },
  {
    pattern: /\bمن أنت|من أنتِ|عرّف|تعريف|اسمك|اسمك|who are you|introduce\b/i,
    reply: `مرحباً! أنا فورينا 👩‍🏫✨

مساعدتك الافتراضية الشخصية على منصة NEXUS التعليمية. أُدرّس وأُرشد وأُقيّم وفق معايير BTEC الدولية.

أتحدث العربية بطلاقة، وأُحلّل إجاباتك بدقة، وأمنحك ملاحظات بنّاءة تساعدك على النمو. 

ما الذي تودّ تعلّمه اليوم؟`,
  },
  {
    pattern: /\bكيف تساعد|تساعدني|ماذا تفعل|capabilities|what can you\b/i,
    reply: `أستطيع مساعدتك في أشياء كثيرة! 📚

✅ **تقييم الإجابات** — أحلّل عملك وفق معايير BTEC (Pass / Merit / Distinction)
✅ **الشرح والتوضيح** — أُفسّر المفاهيم بأمثلة عملية
✅ **تحليل PESTLE & SWOT** — أرشدك خطوة بخطوة
✅ **التغذية الراجعة** — أُقدّم ملاحظات تفصيلية لتحسين عملك
✅ **المحاكاة التجارية** — أُحاكي سيناريوهات تجارية واقعية

جرّب أن تكتب سؤالاً أو تشاركني إجابة لأُقيّمها! 😊`,
  },
  {
    pattern: /\bNEXUS|نيكسس|المنصة|platform\b/i,
    reply: `NEXUS هي منصة تعليمية متطوّرة من الجيل القادم! 🚀

تجمع بين:
🎓 **التقييم الأكاديمي** — محرّك تقييم مدعوم بالذكاء الاصطناعي وفق معايير BTEC
🎮 **المحاكاة التفاعلية** — بيئات ثلاثية الأبعاد لاتخاذ القرارات التجارية  
🥽 **الواقع الافتراضي** — جمع الأدلة واستكشاف بيئات التعلم الغامرة
🤖 **المساعد الذكي (أنا!)** — فورينا، رفيقتك في كل خطوة

الهدف: تحويل التعلم من تلقٍّ سلبي إلى تجربة حيّة تفاعلية. ✨`,
  },
];

function localFallback(message: string): string | null {
  const found = LOCAL_PERSONA.find(({ pattern }) => pattern.test(message));
  return found?.reply ?? null;
}

const MAX_MESSAGE_LENGTH = 4000;
const FETCH_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const headers: Record<string, string> = { "X-Request-ID": reqId };

  try {
    const payload = await req.json();
    const raw = typeof payload?.message === "string" ? payload.message : "";
    const message = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) {
      return NextResponse.json(
        { error: "Empty message", reqId },
        { status: 400, headers }
      );
    }

    const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const upstream = process.env.CHAT_BACKEND_URL || `${base.replace(/\/$/, "")}/api/v1/chat`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": reqId },
        body: JSON.stringify({
          message,
          history: Array.isArray(payload?.history) ? payload.history : [],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const local = localFallback(message);
      if (local) return NextResponse.json({ reply: local, reqId, source: 'local' }, { headers });
      return NextResponse.json(
        { error: "Backend unreachable", reqId },
        { status: 503, headers }
      );
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "Upstream error", details: text.slice(0, 300), reqId },
        { status: 502, headers }
      );
    }

    const data = await res.json().catch(() => null);

    // Forward all structured V200 fields to the client
    const reply    = data?.reply    ?? "";
    const dialogue = data?.dialogue ?? reply;   // fallback: full text
    const action   = data?.action   ?? "";
    const emotion  = data?.emotion  ?? "friendly";
    const intent   = data?.intent   ?? "idle";

    return NextResponse.json(
      { reply, dialogue, action, emotion, intent, reqId },
      { headers },
    );
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        error: isTimeout ? "Timeout contacting upstream" : "Server error",
        reqId,
      },
      { status: isTimeout ? 408 : 500, headers }
    );
  }
}
