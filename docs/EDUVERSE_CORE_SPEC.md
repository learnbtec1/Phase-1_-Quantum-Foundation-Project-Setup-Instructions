# EDUVERSE CORE SPEC

Official team reference. **Read before making product or architecture decisions.**

*Last aligned with repo: 2026-04 — admin usage events + insights; spec text below retains original structure; see **Amendments** at the end.*

---

## PROJECT OVERVIEW

EDUVERSE is a SaaS educational platform that provides:

1. AI-powered assessment (BTEC-style grading)
2. Plagiarism detection (embedding + vector search)
3. Usage-based pricing model
4. Teacher-guided feedback system
5. Admin analytics dashboard

The system is designed to be FAIR, EDUCATIONAL, and SCALABLE.

---

## CORE PRINCIPLES (NON-NEGOTIABLE)

1. DO NOT break grading logic
2. DO NOT fake evidence
3. DO NOT over-penalize students
4. ALWAYS respect assignment requirements
5. ALWAYS keep system explainable

System must behave like a **FAIR TEACHER** — not a strict examiner.

---

## ASSESSMENT SYSTEM CAPABILITIES

- PASS 0: Assignment understanding (requirements, format, evidence)
- PASS 1: Student answer understanding
- Criteria-based grading (P / M / D)
- Minimum acceptable threshold per criterion
- Balanced scoring (not all-or-nothing)
- Confidence scoring (with reasons)
- Student feedback:
  - `why_achieved`
  - `why_not_achieved`
  - `improvement_hint`

Submission formats supported:

- `bullet_points`
- `essay`
- `slides`
- `mixed`

System adapts evaluation based on format.

---

## PLAGIARISM SYSTEM

- Uses embeddings + pgvector
- Top-K similarity search (no hard threshold)
- Handles fallback safely
- Does NOT block grading if corpus fails
- Explains when corpus is empty

---

## USAGE & PRICING MODEL

### Plans

| Plan      | Assessments | Plagiarism checks |
|-----------|------------|-------------------|
| FREE      | 10         | 5                 |
| PRO       | 200        | 100               |
| UNLIMITED | no limits  | no limits         |

### Rules

- Only successful requests count
- No double counting (corpus search excluded)
- Monthly reset via period system
- Limits enforced **BEFORE** execution

---

## BILLING SYSTEM (STRIPE)

- Stripe Checkout
- Webhook-based updates
- `verify-session` fallback
- Subscription tracking:
  - plan
  - status
  - renewal_date
  - `cancel_at_period_end`

### Security

- Plan **NEVER** set from frontend
- Only Stripe (and trusted backend webhooks) control billing state

---

## DATA & PERSISTENCE

- PostgreSQL with Docker volume (persistent)
- Backup system:
  - automatic daily backups
  - manual backup + restore
  - retention (7 days)

Restore is destructive → requires confirmation

---

## ADMIN DASHBOARD

Provides:

- `total_users`
- `active_users` (see definition in API: rolling window, e.g. 7d + `usage_events`)
- `total_revenue`
- usage metrics
- top users

Charts:

- revenue over time
- usage over time
- **daily** usage from `usage_events` (event-level, UTC)
- **monthly** bar chart from `usage_stats` (quota months)

Banners / `GET /api/v1/admin/insights` (e.g. usage spike, revenue drop, failed payment rows, no sign-ups 24h) when applicable.

---

## SYSTEM STRENGTHS

- Fair grading (not overly strict)
- Explainable results
- Supports multiple answer formats
- Scalable SaaS architecture
- Usage-based monetization
- Strong separation of logic vs UI
- Production-ready billing + backup
- Event-level usage log + admin insights (as implemented in repo)

---

## SYSTEM WEAKNESSES (IMPORTANT)

- Limited real user validation (needs beta testing)
- Conversion UX can be improved
- No growth engine yet (referrals, email automation)
- Alert rules are heuristics, not ML — tune thresholds with real traffic

*Resolved in current codebase relative to early drafts: event-level `usage_events` for accurate daily series; basic admin alert banners.*

---

## SECURITY RULES

- No direct plan modification
- All admin routes protected
- File operations must prevent path traversal
- Webhook signature verification required
- No exposure of sensitive data in admin aggregates

---

## TEAM RULES

Before writing **ANY** code:

1. Check if change breaks grading fairness
2. Check if change affects billing integrity
3. Check if change affects user trust
4. Prefer **additive** changes (not destructive)

---

## GOAL

Build a **TRUSTED** educational platform that:

- helps students improve
- helps teachers evaluate fairly
- generates sustainable revenue

---

## FINAL RULE

If a decision improves UX but breaks **fairness** → **REJECT IT**

If a decision improves revenue but harms **trust** → **REJECT IT**

**Trust > Accuracy > UX > Revenue**

---

## Amendments (implementation note)

- **Grading / billing:** unchanged principles; no shortcuts that violate the sections above.
- **Active users** and **daily charts** are driven by `usage_events` (append-on-success) + existing `usage_stats` for monthly quota totals — see backend `usage_service` and `admin_analytics_service`.
- This file is the single source of truth for intent; if code and doc diverge, **fix the code** to match principles or **update this doc** in the same PR.
