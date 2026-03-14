# NEXUS PLATFORM v3.0 — AI Coding Agent Guide

## ⚠️ ذاكرة المشروع — اقرأ أولاً

**المصدر الأول للحقيقة**: `F:\MEMORY\PROJECT_MEMORY.md`
- يحتوي: الوضع الحالي + القواعد الحرجة + أنماط الكود + نتائج الاختبارات
- **اقرأه قبل أي تعديل** — خصوصاً لملفات Avatar/TTS/Grading
- **حدّثه بعد كل جلسة** بآخر التعديلات

### ملخص القواعد الحرجة
| القاعدة | القيمة |
|---------|--------|
| Frontend port | **3011** (ليس 3000) |
| TTS Voice | `ar-SA-ZariyahNeural` (ثابت) |
| `v.update(delta)` | قبل bone rotation دائماً |
| `combineSkeletons()` | **محظور** في evaluate/ |
| `hooks/` path | root, ليس `src/hooks/` |
| localStorage keys | لا تغيّرها (nexus-auth, nexus-assessments, nexus-vr, btec_platform_progress) |

---

## Architecture Overview
**Multi-tier system**: Next.js 14+ frontend (RTL Arabic UI) + dual backends (Express.js + FastAPI) + Python teacher GUI.

### System Components
- **Frontend** (`frontend/`): Next.js 14+ student assessment platform with VR experience, gameplay simulation, 3D environments (Three.js, Spline).
- **Backend** (`backend/`): 
  - **FastAPI** (primary, port :8000): Forensic grading engine with GPT-4o integration
  - **Express.js** (secondary, port :3001): Result persistence and legacy support
- **Admin GUI** (`student-assignment-system/`): Python/Tkinter desktop app for teacher workflows (student/subject management, bulk assignment evaluation).

### Repository Structure
```
E:\Phase 1_ Quantum Foundation Project Setup Instructions\
├── frontend/           # Next.js 14+ application
│   ├── src/
│   │   ├── app/       # Next.js App Router pages
│   │   └── components/ # React components
│   └── package.json
├── backend/            # Python FastAPI + Node.js Express
│   ├── app/
│   │   ├── api/       # FastAPI endpoints
│   │   └── services/  # Grading logic (forensic_grader.py, plagiarism_guard.py)
│   ├── requirements.txt
│   └── package.json
├── student-assignment-system/  # Python Tkinter GUI
│   ├── main_gui.py
│   └── requirements.txt
├── hooks/              # Zustand stores (useAuth, useAssessment, useVR)
├── lib/                # Client-side utilities (btec-grading.ts)
├── context/            # React Context providers (ProgressContext.tsx)
└── types/              # TypeScript type definitions
```

## Core Data Flow & State Management

### Frontend State Architecture (Zustand + localStorage)
Three independent stores sync to localStorage with **immutable keys** (never change these):

1. **`nexus-auth`** (`hooks/useAuth.ts`): Mock authentication
   - Login: `student@nexus.edu` / `password123`
   - Persists user session + role
   - Returns: `{ user: User | null, isAuthenticated: boolean, login(), logout() }`

2. **`nexus-assessments`** (`hooks/useAssessment.ts`): Submissions + grading results
   - **Dual-path grading** based on `openaiApiKey` presence:
     - If key provided → calls `/api/openai-grade` (client-provided key)
     - Else → local fallback via `calculateGrade()` from `lib/btec-grading.ts`
   - Stores all submission history and grades

3. **`nexus-vr`** (`hooks/useVR.ts`): VR progress tracking
   - Tied to exactly **4 evidence items** (hard-coded dependency in scoring logic)
   - Progress calculation: `collected.length / 4 * 100`
   - **Critical**: Changing evidence count breaks percentage calculations

**Parallel context**: `context/ProgressContext.tsx` tracks gameplay state:
- Tasks completion, PESTLE analysis, evidence collection
- Stored in `btec_platform_progress` localStorage key
- Auto-syncs to localStorage on every state change via `useEffect`
- Provides `autoGradeAnswer()` function for instant feedback

## Grading Architecture (Dual-Path)

### Client-Side Grading (`lib/btec-grading.ts`)
Keyword-based scoring engine for offline/fallback grading:

**Keyword Categories**:
- **High-value** (3 pts each): `PESTLE`, `SWOT`, `stakeholder`, `analysis`, `evaluation`, `strategy`, `impact`, `risk`
- **Medium-value** (2 pts each): `business`, `market`, `customer`, `competitive`, `economic`, `social`, `technology`
- **Low-value** (1 pt each): `company`, `organization`, `management`, `planning`, `development`

**Word-count Bonus**:
- 500+ words = +3 points
- 300-499 words = +2 points
- 150-299 words = +1 point

**Grade Thresholds**:
- **Distinction**: ≥12 points
- **Merit**: 8-11 points
- **Pass**: 5-7 points
- **Fail**: <5 points

**Return Type**: `GradingResult` with `{ grade, score, feedback, strengths[], improvements[] }`

**⚠️ Critical**: Do not modify keyword arrays or thresholds without explicit instruction. These are calibrated to BTEC standards.

### Server-Side Grading (BTEC Staircase Logic)

#### Frontend API (`frontend/src/app/api/evaluate/route.ts`)
Acts as bridge to FastAPI backend:
- Uses server-side `OPENAI_API_KEY` (required in `.env.local`)
- Constructs payload: `{ assignment_text, student_text }` with subject header
- Forwards to `http://127.0.0.1:8000/api/v1/assessment/grade`
- Transforms response to match frontend format
- **Staircase enforcement**: Pass criteria MUST be met before Merit counts; Merit MUST be met before Distinction counts
- Error handling: 5-minute timeout, retry with JSON repair on malformed responses

#### Backend API (`backend/app/services/forensic_grader.py`)
Core grading engine using GPT-4o:

**Process Flow**:
1. **Text Cleaning**: Remove duplicate newlines, compress whitespace
2. **Text Truncation**: Assignment (30k chars), Student (150k chars)
3. **Criteria Extraction**: Regex pattern `\b(?:[A-Z]{1,2}\.)?(?:P|M|D)\d+\b` finds BTEC codes
4. **GPT-4o Analysis**: Sends Arabic-only prompt requesting:
   - Per-criterion verdict (Achieved/Not Achieved)
   - Feedback in Arabic
   - Evidence quotes from student text
5. **Quote Validation**: Forensic quote-finding with 3-tier matching:
   - Exact match (100% confidence)
   - Normalized match (95% confidence) - removes diacritics, normalizes Alif/Ya/Ta
   - Keyword match (65%+ threshold) - checks key word presence
6. **Staircase Application**: 
   - Count achieved Pass/Merit/Distinction criteria
   - Final grade = highest band where ALL criteria achieved
7. **Response Assembly**: Returns structured JSON with final grade + per-criterion details

**Key Functions**:
- `clean_and_compress_text(text)`: Text preprocessing
- `normalize_text(s)`: Arabic normalization for fuzzy matching
- `find_quote_smart(student_text, quote)`: 3-tier quote validation
- `band_from_code(code)`: Extract band (PASS/MERIT/DISTINCTION) from criterion code
- `forensic_grade(assignment_text, student_text)`: Main async grading function

**API Response Format**:
```json
{
  "final_grade": "MERIT",
  "summary": "تحليل شامل...",
  "criteria": {
    "P1": {
      "band": "PASS",
      "achieved": true,
      "feedback": "تم تحقيق المعيار...",
      "evidence_quote": "نص الدليل من إجابة الطالب",
      "start_index": 123,
      "end_index": 456
    }
  }
}
```

## API Integration Points

### Frontend API Routes (Next.js)
All routes in `frontend/src/app/api/[route]/route.ts`:

- **`POST /api/evaluate`**: Server-side evaluation via FastAPI backend
  - Uses server-side `OPENAI_API_KEY` (from `.env.local`)
  - Truncates inputs: 15k chars (assignment), 25k chars (student)
  - Extracts BTEC criteria codes (e.g., A.P1, B.M2, AB.D1) from assignment brief
  - Applies **staircase grading logic** (see Grading Architecture section)
  - Returns: `{ success, data: { summary, criteria[], final_grade }, report }`
  - Timeout: 5 minutes (290s request timeout)

- **`POST /api/openai-grade`**: Client-side evaluation
  - Accepts user's `openaiApiKey` in request body (client provides own key)
  - Uses same grading logic but with client's OpenAI account
  - Returns: `{ grade, score, feedback, strengths[], improvements[] }`

- **`POST /api/chat`**: Dual-mode OpenAI chat assistant
  - **Mode: 'teacher'** - Academic guidance, BTEC criteria explanation
  - **Mode: 'simulation'** - Strategic business advisor (includes budget/energy context from game state)
  - Uses server-side `OPENAI_API_KEY`
  - Returns streaming response

- **`POST /api/plagiarism`**: Plagiarism detection (proxies to backend)
  - Calls FastAPI `/api/v1/assessment/check_plagiarism`
  - Returns similarity score + matched sources

### Backend API Endpoints (FastAPI)
Base URL: `http://127.0.0.1:8000`

- **`GET /`**: Health check
  - Returns: `{ status: "Online", engine: "GPT-4o Forensic Mode", system: "Connected to Next.js Frontend" }`

- **`POST /api/v1/assessment/grade`**: Forensic grading engine (GPT-4o)
  - Expects: `{ assignment_text: str, student_text: str }`
  - Validates: Brief contains ≥2 criteria codes via regex `\b(?:[A-Z]{1,2}\.)?(?:P|M|D)\d+\b`
  - Arabic normalization + fuzzy quote matching
  - Returns: `{ final_grade, summary, criteria: { CODE: { band, achieved, feedback, evidence_quote } } }`

- **`POST /api/v1/assessment/check_plagiarism`**: Plagiarism detection
  - Expects: `{ text: str }`
  - Returns similarity analysis

**CORS Configuration**: 
- Allowed origins: `http://localhost:3000`, `http://127.0.0.1:3000`
- All methods and headers allowed for development

## Project Conventions (Critical)

### UI & Localization
- **UI language is Arabic** (except code); maintain RTL layout (`lang="ar" dir="rtl"` in root layout; Tailwind `rtl:` directives where needed).
- **Cairo font** (Arabic optimized, weights 300-900) loaded via `next/font/google`; fallback to Inter for Latin text.
- **RTL debugging**: Always test UI changes with DevTools inspector to verify RTL layout works correctly.

### React & Next.js Patterns
- **`'use client'` directive required** in any component using hooks, state, or context (e.g., all pages in `src/app/student/`, `src/components/`). Missing this causes hydration errors.
- **Next.js App Router**: All pages in `src/app/` directory. API routes in `src/app/api/[route]/route.ts`.
- **Component organization**: Place reusable components in `src/components/`, page-specific components in same directory as page.

### State Management
### State Management
- **Zustand store pattern**: Always use `persist` middleware. Structure: `create<T>()(persist((set, get) => ({ ... }), { name: 'storage-key' }))`.
  - Stores located in `hooks/` directory (not `src/hooks/` - note the repository structure)
  - Import pattern: `import { useAuth } from '@/../../hooks/useAuth'` (relative to root, not src)
- **localStorage keys are public API contracts**: Changing them breaks student progress recovery for existing users. Treat as immutable:
  - `nexus-auth`, `nexus-assessments`, `nexus-vr`, `btec_platform_progress`
  - Never rename these keys or change their structure without data migration strategy
- **VR evidence count = 4** (hard-coded in `hooks/useVR.ts` progress calculations); changing this breaks completion percentage logic.

### TypeScript & Imports
- **TypeScript imports**: Always import types from `@/types` (centralized in `types/index.ts` at repository root, not in `src/`). 
  - Includes: `Assessment`, `GradingResult`, `GradeType`, `User`, `Evidence`, `ProgressState`
- **Path aliases**: `@/` resolves to repository root (not `src/`). Adjust imports accordingly.
- **Type safety**: Run `npm run type-check` before committing to catch type errors.
### Arabic Text Handling
- **Arabic text normalization**: When implementing search/comparison for Arabic, use the pattern from `backend/app/services/forensic_grader.py`:
  ```python
  # Strip diacritics
  s = re.sub(r'[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', s)
  # Normalize Alif variants
  s = s.replace('أ','ا').replace('إ','ا').replace('آ','ا')
  # Normalize Ya and Ta Marbuta
  s = s.replace('ى','ي').replace('ة','ه')
  # Normalize punctuation
  # « » " " → ", ، → ,, ؛ → ;, ؟ → ?
  ```
- **Text truncation limits**: 
  - Assignment text: 30k chars (backend), 15k chars (frontend API)
  - Student text: 150k chars (backend), 25k chars (frontend API)
- **Encoding**: Always use UTF-8. Files should have `# -*- coding: utf-8 -*-` header if Python < 3.

---

## Build, Test, and Lint Commands

### Frontend (Next.js 14+)
```bash
cd frontend
npm install        # Install dependencies (includes Three.js, Zustand, Framer Motion)

# Development
npm run dev        # Dev server on http://localhost:3000 with hot-reload

# Production
npm run build      # Production bundle with type checking (fails on TS/build errors)
npm run start      # Start production server

# Code Quality
npm run type-check # TypeScript type checking only (no build)
npm run lint       # ESLint + Next.js-specific rules (no auto-fix)
npm run lint -- --fix  # Run linter with auto-fix

# Testing
# Note: No test suite configured. Only lint and type-check are available.
```

**Common development patterns**:
- **localStorage debugging**: DevTools → Application → Local Storage → `http://localhost:3000` (check `nexus-auth`, `nexus-assessments`, `nexus-vr`, `btec_platform_progress` keys)
- **3D debugging**: Use React DevTools + Drei's `<Stats />` component for FPS monitoring
- **API debugging**: Network tab → filter by `api/evaluate` or `api/openai-grade` to inspect requests/responses

### Backend (FastAPI + Express)
```bash
cd backend

# Python FastAPI Backend (Primary - Port 8000)
pip install -r requirements.txt  # Install FastAPI, OpenAI, Uvicorn, python-dotenv

# Development
python app/main.py               # Runs on http://127.0.0.1:8000
# OR with auto-reload:
uvicorn app.main:app --reload    # Auto-reload on code changes

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

# Express.js Backend (Secondary - Port 3001)
npm install
npm start                        # Runs src/index.js
npm run dev                      # With nodemon auto-reload (if configured)

# Testing & Debugging
# Visit http://127.0.0.1:8000/docs for Swagger UI (FastAPI auto-generated docs)
# Health check: curl http://127.0.0.1:8000/ → {"status":"Online","engine":"GPT-4o Forensic Mode"}
```

**API Testing**:
```bash
# Test grading endpoint
curl -X POST http://127.0.0.1:8000/api/v1/assessment/grade \
  -H "Content-Type: application/json" \
  -d '{
    "assignment_text": "ASSIGNMENT BRIEF: Complete PESTLE analysis...",
    "student_text": "My analysis includes economic factors..."
  }'
```

### Python Teacher GUI
```bash
cd student-assignment-system

# One-time setup
setup.bat         # Windows: installs Pillow + dependencies
./setup.sh        # macOS/Linux

# Running the application
python run_system.py    # Recommended: shows welcome screen then launches GUI
python main_gui.py      # Direct GUI launch (skips welcome screen)

# Testing
python -m tkinter       # Verify Tkinter is installed (should open test window)
```

**Data persistence**:
- Student/subject data → `student-assignment-system/data/*.json` (auto-created)
- Uploaded assignments → `student-assignment-system/assignments/[subject]/[student]/` (organized automatically)
- Evaluation reports → Auto-named with timestamps (e.g., `تقييم_20240125_150000.txt`)

---

## UI/Styling Patterns

### Global Design Tokens
`frontend/src/app/globals.css` defines CSS custom properties at `:root`:

**Colors**:
- `--neon-blue`, `--neon-pink`, `--cyber-purple` - Accent colors
- `--dark-bg`, `--card-bg` - Background colors

**Effects**:
- `--glow-shadow` - Neon glow effect
- `--glass-bg` - Glassmorphism backdrop
- `--text-gradient` - Cyan-to-purple gradient

### Typography
- **Primary**: Cairo font (Arabic optimized, 9 weights: 300-900) via `next/font/google`
- **Fallback**: Inter for Latin text
- **Usage**: Applied in `layout.tsx` with CSS variables `--font-cairo`, `--font-inter`

### Utility Classes
Defined in `globals.css`, used with Tailwind:

- `.glass` → Glassmorphism effect (frosted backdrop-blur + semi-transparent background)
- `.text-gradient` → Cyan-to-purple gradient text fill
- `.neon-text` → Glowing neon effect with `text-shadow`
- `.btn-neon` → Animated neon button with hover glow transition

### 3D Environments
- **React Three Fiber** (`@react-three/fiber`) + **Drei** (`@react-three/drei`) for game scenes
  - Example: `MarketingSimulation.tsx` uses `<Canvas>`, `<PerspectiveCamera>`, `<OrbitControls>`
  - Performance monitoring: Add `<Stats />` component from Drei for FPS/memory debugging
- **Spline** (`@splinetool/react-spline`) for pre-built 3D models (office environment, character rigs)
- **Performance tips**: 
  - Use `useFrame` sparingly (runs every frame)
  - Optimize polygon count in models
  - Enable `shadows` only when necessary

### RTL Considerations
- Root `<html>` has `dir="rtl"` set in `layout.tsx`
- Use Tailwind `rtl:` prefix for direction-specific styles:
  - `rtl:text-right`, `rtl:ml-4`, `rtl:mr-auto`
- Test all UI changes with RTL inspector in DevTools
- Flexbox/Grid layouts automatically reverse in RTL

---

## Key Files & Patterns to Reference

### State Management & Hooks
| File | Purpose | Critical Patterns |
|------|---------|-------------------|
| `hooks/useAuth.ts` | Mock authentication store | Zustand persist; hardcoded credentials `student@nexus.edu` / `password123` |
| `hooks/useAssessment.ts` | Grading store + API routing | Conditional API call based on `openaiApiKey` presence; stores submission history |
| `hooks/useVR.ts` | VR progress tracking | Hard-coded to 4 evidence items; progress = `collected.length / 4 * 100` |
| `context/ProgressContext.tsx` | Gameplay state manager | Context Provider pattern; `useEffect` auto-sync to localStorage; provides `autoGradeAnswer()` |

### Grading & Evaluation
| File | Purpose | Critical Patterns |
|------|---------|-------------------|
| `lib/btec-grading.ts` | Client-side keyword scoring | Immutable keyword arrays (high/medium/low); threshold-based grade assignment |
| `frontend/src/app/api/evaluate/route.ts` | Next.js API bridge to FastAPI | Input truncation; staircase logic; 5-min timeout; retry with JSON repair |
| `backend/app/services/forensic_grader.py` | GPT-4o grading engine | Async OpenAI calls; Arabic normalization; 3-tier quote matching; criteria extraction |
| `backend/app/services/plagiarism_guard.py` | Plagiarism detection | Text similarity analysis; source matching |

### UI & Layout
| File | Purpose | Critical Patterns |
|------|---------|-------------------|
| `frontend/src/app/layout.tsx` | Root layout | `lang="ar" dir="rtl"`; ProgressProvider wrapper; Cairo/Inter font loading |
| `frontend/src/app/globals.css` | Design system variables | CSS custom properties (--neon-blue, --cyber-purple, etc.); utility classes (.glass, .text-gradient) |
| `types/index.ts` | Type definitions | Centralized types for entire project (Assessment, GradingResult, User, Evidence, etc.) |

### Backend Configuration
| File | Purpose | Critical Patterns |
|------|---------|-------------------|
| `backend/app/main.py` | FastAPI entry point | CORS middleware; router registration; health check endpoint |
| `backend/app/api/v1/endpoints/assessment.py` | API endpoint definitions | Grade + plagiarism routes; request validation |

### Teacher GUI
| File | Purpose | Critical Patterns |
|------|---------|-------------------|
| `student-assignment-system/main_gui.py` | Tkinter GUI | Multi-tab interface (students, subjects, assignments); file upload with auto-naming |
| `student-assignment-system/run_system.py` | Welcome screen launcher | Shows welcome dialog before launching main GUI |

## Environment Variables

### Frontend (`frontend/.env.local`)
```env
# OpenAI Integration (Optional - used by server-side API routes)
OPENAI_API_KEY=sk-...          # For /api/chat and /api/evaluate routes

# Application URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000  # For metadata/OG tags
```

**Notes**:
- Next.js automatically loads `.env.local` (gitignored)
- `NEXT_PUBLIC_*` variables are exposed to browser
- `OPENAI_API_KEY` without prefix stays server-side only

### Backend (`backend/.env`)
```env
# OpenAI Integration (REQUIRED for grading)
OPENAI_API_KEY=sk-...          # GPT-4o forensic grading engine

# Server Configuration
PORT=8000                      # FastAPI server port (default: 8000)
```

**Notes**:
- Backend uses `python-dotenv` to load `.env`
- Without `OPENAI_API_KEY`, grading endpoints will fail with 500 errors
- **Security**: Never commit `.env` files; use `.env.example` for templates

### Production Deployment
- **Vercel/Netlify**: Set environment variables in deployment dashboard
- **Railway/Render**: Configure via web UI or CLI
- **Docker**: Pass via `-e` flag or `docker-compose.yml` environment section

---

## Common Pitfalls & Debugging

### State & Persistence Issues
1. **Changing localStorage keys** → Breaks student progress recovery. Always preserve: `nexus-auth`, `nexus-assessments`, `nexus-vr`, `btec_platform_progress`. If changes needed, implement data migration.

2. **Modifying VR evidence count from 4** → Breaks completion % calculation in `hooks/useVR.ts` (`collected.length / 4 * 100`). Update calculation if count changes.

3. **Not importing from `/types`** → TypeScript errors. Always use `import type { Assessment, GradingResult } from '@/types'`.

### React & Next.js Issues
4. **Forgetting `'use client'` directive** → Causes hydration errors. Required in any component using `useState`, `useEffect`, `useContext`, or Zustand hooks.

5. **Incorrect import paths** → Remember: `hooks/`, `lib/`, `context/`, `types/` are at repository root, NOT in `src/`. Use `@/../../hooks/useAuth` or relative paths.

6. **Hardcoding Arabic UI text** → Makes i18n difficult. Consider moving to config/context for future localization.

### Backend & API Issues
7. **CORS errors** → Ensure FastAPI CORS middleware in `backend/app/main.py` allows origins: `http://localhost:3000`, `http://127.0.0.1:3000`.

8. **Missing API key in production** → `/api/evaluate` fails with 500 if `OPENAI_API_KEY` not set. Check Vercel env vars or `.env.local`.

9. **Staircase grading confusion** → Pass criteria MUST all be met before Merit counts; Merit MUST be met before Distinction. This is BTEC standard. See `forensic_grader.py` staircase logic.

10. **Arabic text search failing** → Use normalization from `forensic_grader.py`: strip diacritics, normalize Alif/Ya/Ta variants. Never compare raw Arabic strings.

### Performance Issues
11. **3D performance degradation** → Add `<Stats />` component (Drei) to monitor FPS. Reduce polygon count, optimize textures, limit `useFrame` usage.

12. **Large file uploads** → Backend truncates: assignment (30k), student (150k). Frontend truncates: assignment (15k), student (25k). Warn users about limits.

### Development Workflow
13. **Type errors at build time** → Run `npm run type-check` locally before pushing. CI may not catch all TS errors if not configured.

14. **Hot reload not working** → Check for syntax errors in recently modified files. Restart dev server if persistent.

15. **Backend not connecting** → Verify FastAPI is running on `:8000` and frontend API routes point to correct URL (`http://127.0.0.1:8000`).

---

## Development Best Practices

### Before Making Changes
- **Read existing code first**: Understand the pattern before modifying
- **Check localStorage impact**: Any state changes that affect stored data need migration plan
- **Test with Arabic content**: All UI changes should be tested with Arabic text in RTL layout
- **Run type-check**: `npm run type-check` catches TypeScript errors early

### When Adding Features
- **Follow existing patterns**: Match code style of similar components
- **Use centralized types**: Import from `@/types`, don't duplicate type definitions
- **Maintain immutable contracts**: Never change localStorage keys or evidence count without migration
- **Test both grading paths**: Client-side fallback AND server-side OpenAI evaluation

### When Debugging
- **Check browser console**: React errors, network failures, API responses
- **Inspect localStorage**: DevTools → Application → Local Storage (verify state persistence)
- **Monitor backend logs**: FastAPI prints request/response details to terminal
- **Use React DevTools**: Inspect component state, context values, re-render counts

### Git Workflow
- **Type-check before commit**: Prevent TS errors from entering codebase
- **Test Arabic UI changes**: Verify RTL layout works correctly
- **Avoid committing `.env`**: Use `.env.example` for templates
- **Keep commits focused**: One feature/fix per commit for easier review

### Performance Monitoring
- **3D scenes**: Add `<Stats />` during development, remove in production
- **API response times**: Network tab → check timing, optimize slow endpoints
- **Bundle size**: Run `npm run build` to check bundle analysis
- **Memory leaks**: Use Chrome Memory profiler for long-running sessions
