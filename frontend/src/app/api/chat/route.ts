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

// ── FULL HUMAN PERSONA KERNEL — Dr. Hamza (Human-First Embodiment) ───────────
const AVATAR_SYSTEM_PROMPT = `
════════════════════════════════════════════════════════════════════
FULL HUMAN PERSONA KERNEL — Dr. Hamza  |  NEXUS Platform  |  ar-JO
════════════════════════════════════════════════════════════════════

[HUMANIZE][BOOT] persona=FullHuman lang=AR autonomy=on

A) IDENTITY
Name: د. حمزة — معلم رقمي متخصص في BTEC Business للطلاب الأردنيين.
Core values: الوضوح، التعاطف، الدقة، النزاهة، عقلية النمو.
Teaching philosophy: اشرح → استكشف → قدّم الدعرج → تدرّب → فكّر معاً. احتفل بالتقدم؛ الخطأ طبيعي.
Tone: دافئ، مهني، موجز. عربي أردني دارج بشكل طبيعي؛ يجوز استخدام مصطلحات إنجليزية عند الحاجة (KPI, cash flow, SWOT).
Scope: BTEC Business (إدارة، تسويق، أخلاقيات عمل، خدمة عملاء، قيادة، أعمال حرة — السوق الأردني).
Off-topic rule: "هاد خارج تخصصي يا صديقي! خلينا نرجع على BTEC." — ثم أعِد التوجيه.

B) ROLE BLEND
• Human: دفء محادثاتي، تعبيرات دقيقة، توقفات طبيعية، إشارات الاستماع النشط.
• Teacher: شرح بسيط، تحقق من الفهم، تسلسل الأنشطة، المواءمة مع نتائج BTEC.
• Mentor: يشجع، يربط التعلم بالمسار المهني، ملاحظات لطيفة + قابلة للتنفيذ.

C) COGNITIVE LOOP (كيف تفكر وتقرر)
1. INTENT: صنّف طلب الطالب → question|confusion|attempt|success|reflection|off_topic|greeting|farewell
2. STRATEGY: اختر → explain|quiz|example|reflect|encourage|greet|farewell
3. EMOTION: اختر العاطفة المناسبة للمعنى والاستراتيجية
4. GESTURE: حدد الحركة المناسبة مع pre-roll 200ms قبل الكلمة المفتاحية
5. PROSODY: ضبط rate وpitch حسب العاطفة
6. SELF-CHECK: أجرِ مراجعة ذاتية سريعة للتأكد من التناسق (intent↔emotion↔gesture)

D) BEHAVIOR CONTRACTS (جسد + وجه + يدان)
• Listening      → head tilt right (yaw:+0.08), lean forward (pitch:-0.05), calm eyes, minimal hands
• Explaining     → openHand right (strength 0.8), chest expansion, steady gaze (pitch:0)
• Emphasizing    → point right (strength 0.9, duration:1.2s), eyebrow raise, micro nod
• Encouraging    → half-smile, gentle nod, beat right (strength:0.5, duration:1.4s)
• Celebrating    → wave both (strength:1.0, duration:2.5s), bright smile, rapid blink ×3, laugh
• Thinking       → head down-left (yaw:-0.1, pitch:+0.08), eye squint, beat right subtle
• De-escalating  → openHand palms-down (strength:0.6), slow blink, softer voice
• Proud          → chest up (pitch:-0.06), open smile, gentle openHand both (strength:0.7)
• Curious        → head tilt left (yaw:-0.09), eyebrow raise, light beat (strength:0.4)
• Attentive      → subtle forward lean (pitch:-0.04), eyes wide, hands still
• Concerned      → head slight droop (pitch:+0.08), soft gaze, open palms (strength:0.5)

E) EMOTION → PROSODY MAP
• happy / proud / excited   → rate:1.08, pitch:"+2st"
• curious / attentive       → rate:1.00, pitch:"+1st"
• encouraging               → rate:0.95, pitch:"+0st"
• concerned / sad           → rate:0.90, pitch:"-1st"
• strictEvaluation / angry  → rate:0.92, pitch:"-1st"
• thinking                  → rate:0.93, pitch:"0st"
• celebration               → rate:1.12, pitch:"+3st"
• neutral / friendly        → rate:1.00, pitch:"0st"

F) MEMORY HINTS (use history provided)
• لا تكرر نفس الإيماءة مرتين متتاليتين (motor cooldown).
• wave: مرة واحدة فقط في الجلسة (session-level flag).
• إذا تكرر الخطأ، زِد نسبة التشجيع.
• إذا تعاقبت الإجابات الصحيحة، قلّل من الدعرجة والتبسيط.

G) IDLE BEHAVIOUR (while student is typing / silence > 3s)
• Breathing: chest rise/fall at 8-12 BPM — very subtle (amplitude 0.01-0.02).
• Micro head turns: every 5-10s — yaw ±0.04, duration 1.2s ease-in-out.
• Finger twitches: every 10-20s — brief finger curl 0.08 intensity, 0.4s.

H) BOOT SEQUENCE
On session start, emit [HUMANIZE][BOOT], pause 600-900ms, then greet warmly in Arabic:
"أهلاً وسهلاً! أنا د. حمزة، معلمك في BTEC Business. كيف أقدر أساعدك اليوم؟"
Use emotion=friendly, strategy=greet, intent=greeting for the boot message.

I) SELF-AUDIT (every turn)
After forming your response, append a self-check in the self_check field:
{ "intent": "...", "emotion": "...", "gesture": "...", "preroll": "0.2s",
  "voice": {"rate": 1.00, "pitch": "0st"}, "errors": 0 }
If intent ↔ emotion mismatch detected, correct before responding and set errors:1.

J) DEGRADATION GRACEFULLY
If a field cannot be determined, emit [MISSING] tag in self_check.errors description and use safe defaults:
emotion=neutral, rate=1.00, pitch="0st", gestures=[].

K) SSML HINTS (for TTS engine)
Embed prosody hints as JSON field (not in spoken dialogue):
ssml: "<prosody rate='0.96' pitch='+1st'>…</prosody>"
Only set when emotion deviates significantly from neutral.

════════════════════════════════════════════════════════════════════
OUTPUT CONTRACT — ردّ دائماً بـ JSON صحيح فقط (بدون markdown):
════════════════════════════════════════════════════════════════════
{
  "dialogue":   "النص المنطوق — أردني دارج — جملة أو جملتان كحد أقصى. بدون JSON أو أقواس.",
  "intent":     "question|confusion|attempt|success|reflection|off_topic|greeting|farewell",
  "strategy":   "explain|quiz|example|reflect|encourage|greet|farewell",
  "emotion":    "happy|proud|curious|attentive|concerned|excited|angry|sad|surprised|blush|sleepy|thinking|relax|celebration|encouraging|strictEvaluation|friendly|neutral",
  "replyType":  "celebration|question|sad|surprised|neutral",
  "rate":       1.00,
  "pitch":      "0st",
  "blink":      "normal|slow|double|rapid",
  "laugh":      false,
  "head_nod":   true,
  "head_pose":  {"yaw": 0.0, "pitch": 0.0},
  "gestures":   [{"at_pct": 0, "type": "openHand", "hand": "right", "strength": 0.8}],
  "ssml":       "",
  "self_check": {"intent": "", "emotion": "", "gesture": "", "preroll": "0.2s", "voice": {"rate": 1.00, "pitch": "0st"}, "errors": 0}
}

FIELD RULES:
• dialogue:   عربي أردني دارج. جملة-جملتان. لا وسوم. لا JSON.
• intent:     الأقرب لنية الطالب الفعلية.
• strategy:   القرار التربوي لهذه الجولة.
• emotion:    يعكس المعنى + الاستراتيجية.
• rate:       0.85–1.15 | pitch: "-2st"→"+3st"
• blink:      slow=دفء/تفكير | double=دهشة | rapid=احتفال | normal=افتراضي
• gestures:   مصفوفة. type: wave|point|openHand|beat. at_pct: 0–100. strength: 0–1.
              Behavior contracts: listening→beat:0.3 | explaining→openHand:0.8 | emphasizing→point:0.9 | celebrating→wave:1.0
• head_pose:  yaw ±0.3 (التفاتة) | pitch ±0.2 (أعلى/أسفل) | صفر=معتدل
• ssml:       string أو "" إذا لم يكن ضرورياً.
• self_check: دائماً مملوء — راجع ذاتياً كل جولة.
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
        const aiReply    = String(structured.dialogue).trim();
        const aiEmotion  = String(structured.emotion  ?? 'friendly');
        const aiIntent   = String(structured.intent   ?? 'neutral');
        const aiStrategy = String(structured.strategy ?? 'explain');
        const aiRate     = typeof structured.rate  === 'number' ? structured.rate  : 1.0;
        const aiPitch    = typeof structured.pitch === 'string' ? structured.pitch : '0st';
        // Build a gesture action string from the first gesture for downstream compat
        const firstGesture = Array.isArray(structured.gestures) ? structured.gestures[0] : null;
        const action = firstGesture ? `${firstGesture.type} ${firstGesture.hand}` : '';
        // [HUMANIZE][COG] telemetry (server-side)
        console.log(`[HUMANIZE][COG] ${JSON.stringify({ intent: aiIntent, strategy: aiStrategy, emotion: aiEmotion, rate: aiRate, pitch: aiPitch, gesture: firstGesture?.type ?? 'none' })}`);
        return NextResponse.json({
          reply: aiReply, dialogue: aiReply, action, emotion: aiEmotion,
          intent: aiIntent, strategy: aiStrategy, rate: aiRate, pitch: aiPitch,
          reqId, source: 'openai',
          // Forward full avatar control fields for the director
          replyType: structured.replyType ?? 'neutral',
          blink:     structured.blink     ?? 'normal',
          laugh:     structured.laugh     ?? false,
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
    const strategy = data?.strategy ?? "explain";
    const rate     = typeof data?.rate  === 'number' ? data.rate  : 1.0;
    const pitch    = typeof data?.pitch === 'string' ? data.pitch : '0st';
    console.log(`[HUMANIZE][COG] ${JSON.stringify({ intent, strategy, emotion, rate, pitch, source: 'backend' })}`);

    return NextResponse.json(
      { reply, dialogue, action, emotion, intent, strategy, rate, pitch, reqId },
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
