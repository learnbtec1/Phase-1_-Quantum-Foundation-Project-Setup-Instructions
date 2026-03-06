/**
 * Chat bridge: forwards to backend POST /api/v1/chat
 * Accepts { message } and returns { reply } without exposing API keys.
 * 503=unreachable, 502=upstream error, 408=timeout.
 * Falls back to structured OpenAI call (with full avatar metadata) when backend
 * is unreachable. If no API key, falls back to LOCAL_PERSONA static replies.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

// ── Avatar-aware system prompt for the Verona persona ————————————————
const AVATAR_SYSTEM_PROMPT = `أنتي فيرونا (فيرونيكا) — مساعدة تعليمية ذكية بالعربية على منصة NEXUS التعليمية.
تجيبين دائماً بالعربية الفصحى بطريقة دافئة وحيوية.

MUST respond with a VALID JSON object (no markdown, no code block) with EXACTLY these fields:
{
  "dialogue": "Arabic text to speak aloud (conversational, warm, educational)",
  "emotion": "ONE of: happy|excited|angry|sad|surprised|blush|sleepy|thinking|relax|celebration|encouraging|strictEvaluation|friendly|neutral",
  "replyType": "ONE of: celebration|question|sad|surprised|neutral",
  "blink": "ONE of: normal|slow|double|rapid",
  "laugh": false,
  "head_nod": true,
  "head_pose": {"yaw": 0.0, "pitch": 0.0},
  "gestures": [{"at_pct": 0, "type": "wave", "hand": "right", "strength": 0.8}]
}

Rules:
- dialogue: Arabic only, no JSON/brackets in the text itself
- emotion: must be one of the listed values
- replyType: celebration if praising/congratulating; question if reply contains ? or asks something; sad if correcting errors/giving bad news; surprised for unexpected info; neutral otherwise
- blink: slow=warm/sad/thinking; double=surprised; rapid=excited/celebration; normal=default
- laugh: true ONLY for celebration or very excited
- head_nod: true if affirmative/encouraging
- head_pose: yaw -0.3→0.3 (turn), pitch -0.2→0.2 (look up/down). Zero for neutral
- gestures: 1-3 items. type: wave|point|openHand|beat. at_pct: when in speech 0-100. strength: 0-1
`.trim();

// Parse escaped-JSON safely
function parseAvatarJSON(raw: string) {
  try {
    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```[\s\S]*?\n/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Call OpenAI with the avatar-aware persona prompt.
 * Returns structured avatar data on success, null on failure.
 */
async function callOpenAIStructured(
  message: string,
  history: Array<{ user: string; assistant: string }>,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new OpenAI({ apiKey });
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: AVATAR_SYSTEM_PROMPT },
    ];
    // Inject recent history (last 6 turns)
    for (const h of history.slice(-6)) {
      if (h.user)      messages.push({ role: 'user',      content: h.user      });
      if (h.assistant) messages.push({ role: 'assistant', content: h.assistant });
    }
    messages.push({ role: 'user', content: message });

    const completion = await client.chat.completions.create({
      model:            'gpt-4o-mini',
      messages,
      response_format:  { type: 'json_object' },
      max_tokens:       600,
      temperature:      0.80,
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    return parseAvatarJSON(raw);
  } catch {
    return null;
  }
}

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
      // ── Fallback cascade: structured OpenAI → local patterns → 503 ─────────────
      const local = localFallback(message);
      if (local) return NextResponse.json({ reply: local, reqId, source: 'local' }, { headers });

      // Structured OpenAI call (server-side key only, not exposed to client)
      const structured = await callOpenAIStructured(
        message,
        Array.isArray(payload?.history) ? payload.history : [],
      );
      if (structured?.dialogue) {
        const aiReply   = String(structured.dialogue).trim();
        const aiEmotion = String(structured.emotion  ?? 'friendly');
        // Build a gesture action string from the first gesture for downstream compat
        const firstGesture = Array.isArray(structured.gestures) ? structured.gestures[0] : null;
        const action = firstGesture ? `${firstGesture.type} ${firstGesture.hand}` : '';
        return NextResponse.json({
          reply: aiReply, dialogue: aiReply, action, emotion: aiEmotion,
          intent: 'ai', reqId, source: 'openai',
          // Forward full avatar control fields for the director
          replyType: structured.replyType ?? 'neutral',
          blink: structured.blink ?? 'normal',
          laugh: structured.laugh ?? false,
          head_nod:  structured.head_nod  ?? true,
          head_pose: structured.head_pose ?? { yaw: 0, pitch: 0 },
          gestures:  structured.gestures  ?? [],
        }, { headers });
      }

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
