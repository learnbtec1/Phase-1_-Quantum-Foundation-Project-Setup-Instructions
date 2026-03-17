# 🧠 COGNI KNOWLEDGE ATLAS
> Generated: 2026-03-16 05:01 | Source: `F:\jimini+sonnet+deep+hamza` + `backend/data/btec_specs/`

This is Cogni's distilled reference for all physical BTEC learning assets and parsed unit specs.
Use this atlas to guide scaffolding, criterion targeting, and resource references during tutoring.

---

## ✅ Parsed Unit Specs (Cogni's Live Knowledge Base)

These units are fully loaded into Cogni's adaptive teaching engine.
Each criterion has an Arabic scaffold question for Pass / Merit / Distinction levels.

### 📘 `unit1` — Unit 1: The Business Environment
**Qualification:** BTEC Level 3 Business
**Criteria:** Pass [P1, P2, P3] | Merit [M1, M2] | Distinction [D1, D2]

| Code | Level | Description | Scaffold Question (AR) |
|------|-------|-------------|------------------------|
| `P1` | Pass | Describe the type of business, purpose and ownership of two contrastin… | صف نوع ملكية الشركتين اللتين اخترتهما — هل هما شراكة، شركة م… |
| `P2` | Pass | Describe the different stakeholders who influence the purpose of two c… | صف أصحاب المصلحة الرئيسيين — من هم ومن هم المتأثرون بقرارات … |
| `P3` | Pass | Describe the role of the government in regulating businesses and how a… | صف كيف تؤثر قوانين العمل أو حماية المستهلك على عمليات الشركة… |
| `M1` | Merit | Explain the points of view of different stakeholders seeking to influe… | قارن وجهات نظر المساهمين والموظفين والمجتمع — أين تتقاطع مصا… |
| `M2` | Merit | Compare the challenges to selected business activities within a select… | حلّل التحديات التي تواجه الشركة في بيئة اقتصادية متنامية مقا… |
| `D1` | Distinction | Evaluate the influence different stakeholders exert on one of the orga… | قيّم أي أصحاب المصلحة يمتلكون السلطة الأكبر في التأثير على ا… |
| `D2` | Distinction | Fully justify recommendations for appropriate responses by organisatio… | طوّر استراتيجية شاملة للشركة للتكيف مع تغير اقتصادي محدد — ب… |

---

### 📘 `unit25` — Unit 25: Aspects of Business
**Qualification:** BTEC Level 3 Business
**Criteria:** Pass [P1, P2, P3, P4] | Merit [M1, M2, M3] | Distinction [D1, D2]

| Code | Level | Description | Scaffold Question (AR) |
|------|-------|-------------|------------------------|
| `P1` | Pass | Explain the features of different types of business organisations | هل يمكنك شرح الفروق الأساسية بين المنظمة الربحية والغير ربحي… |
| `P2` | Pass | Describe the different stakeholders who influence the purpose of two c… | صف أصحاب المصلحة في الشركة التي تدرسها — من هم؟ وكيف يؤثر كل… |
| `P3` | Pass | Describe how two businesses are organised | صف الهيكل التنظيمي للشركة التي اخترتها — هل هو هرمي، مسطح، أ… |
| `P4` | Pass | Outline the functional areas and how they interrelate in two contrasti… | ما الأقسام الوظيفية الرئيسية في الشركة؟ كقسم التسويق والمالي… |
| `M1` | Merit | Explain how the style of organisation helps two businesses to fulfil t… | قارن: كيف يساعد الهيكل التنظيمي المسطح مقابل الهرمي على تحقي… |
| `M2` | Merit | Explain the points of view of different stakeholders seeking to influe… | حلّل: كيف تختلف مصالح المساهمين عن مصالح الموظفين والمجتمع؟ … |
| `M3` | Merit | Describe the influence of two contrasting economic environments on bus… | حلّل تأثير التضخم أو الركود الاقتصادي على قرارات الشركة التي… |
| `D1` | Distinction | Evaluate the influence different stakeholders exert on one of the orga… | قيّم: أي أصحاب المصلحة لهم التأثير الأكبر على قرارات الشركة؟… |
| `D2` | Distinction | Fully justify recommendations for appropriate responses by organisatio… | طوّر: ما التوصيات الاستراتيجية التي تقدّمها للشركة للتكيّف م… |

---

## 📂 Physical Asset Library
> Source directory: `F:\jimini+sonnet+deep+hamza`

### Top-Level Folders

| Folder | Documents | Types | Sample Files |
|--------|-----------|-------|--------------|
| `jimini+sonnet+deep+hamza` | 9 | .pdf | UNIT 3 - Unit specification - AR.pdf, UNIT 3 - Unit specification - EN.pdf, W77867_International_BTEC_Business_60408P_U1_V1.pdf |


---

## 🎓 Cogni Teaching Logic (BTEC Staircase)

The adaptive engine in `tutor.py` uses the following level-detection formula:

```
if all Pass criteria achieved AND all Merit achieved → Distinction mode
elif all Pass criteria achieved                      → Merit mode (Analytical)
else                                                 → Pass mode (Descriptive)
```

| Level | Arabic Register | Bloom Verb | Teaching Instruction |
|-------|----------------|------------|----------------------|
| Pass | شرح بسيط | اشرح / صف | Ask student to DESCRIBE and LIST facts |
| Merit | تحليل واضح | قارن / حلّل | Ask student to COMPARE and ANALYSE |
| Distinction | نقد ومنطق أكاديمي | قيّم / طوّر | Ask student to EVALUATE and JUSTIFY |

---

## 🧪 Ready Test Prompts

Use these prompts in the avatar session to test Cogni's adaptive scaffolding:

### Test: Unit 1: The Business Environment

**Scenario A — Struggling student (zero achieved):**
```
WebSocket btec_progress: {unit_id: 'unit1', achieved: []}
Expected: Pass mode → Cogni asks descriptive question about P1
```

**Scenario B — All Pass done, Merit pending:**
```
WebSocket btec_progress: {unit_id: 'unit1', achieved: ["P1", "P2", "P3"]}
Expected: Merit mode → Cogni switches to analytical questions targeting M1
```

### Test: Unit 25: Aspects of Business

**Scenario A — Struggling student (zero achieved):**
```
WebSocket btec_progress: {unit_id: 'unit25', achieved: []}
Expected: Pass mode → Cogni asks descriptive question about P1
```

**Scenario B — All Pass done, Merit pending:**
```
WebSocket btec_progress: {unit_id: 'unit25', achieved: ["P1", "P2", "P3", "P4"]}
Expected: Merit mode → Cogni switches to analytical questions targeting M1
```

---

*Atlas last regenerated: 2026-03-16 05:01*
*To update: `python scripts/knowledge_distiller.py`*