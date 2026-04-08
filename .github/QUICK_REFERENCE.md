# 🎴 EDUVERSE QUICK REFERENCE CARD
**Keep this handy during development**

---

## ⚡ Essential Copy-Paste

### Minimal Context (للمهام البسيطة)
```
Context: Eduverse Academy v3.0 - BTEC Platform
• Root: E:\Phase 1_ Quantum Foundation Project Setup Instructions\
• Next.js: frontend/src/app (App Router)
• Shared: hooks/, lib/, context/, types/ at root (via @/ alias)
• State: Zustand + localStorage (eduverse-auth, eduverse-assessments, eduverse-vr)
• UI: Arabic RTL + Tailwind + Cairo Font
• Backend: FastAPI :8000

Task: [YOUR TASK HERE]
Constraint: 'use client' for hooks, root-level imports, maintain RTL
```

---

## 📋 File Templates

### New Page Component
```typescript
'use client';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { SomeType } from '@/types';

export default function PageName() {
  const { user } = useAuth();
  return <div className="p-8">{/* content */}</div>;
}
```

### New API Route
```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  // Logic here
  return NextResponse.json({ success: true });
}
```

### New Zustand Store
```typescript
'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create()(
  persist((set) => ({ data: [] }), { name: 'eduverse-key' })
);
```

---

## 🎯 Import Cheatsheet

```typescript
// ✅ Root-level (from frontend)
import { useAuth } from '@/hooks/useAuth';
import { calculateGrade } from '@/lib/btec-grading';
import { useProgress } from '@/context/ProgressContext';
import type { Assessment } from '@/types';

// ✅ Frontend src
import '@/app/globals.css';
import Component from '@/components/Component';

// ❌ Never use relative for root resources
import { useAuth } from '../../../hooks/useAuth';  // ❌
```

---

## 🔐 localStorage Keys (IMMUTABLE)

```typescript
'eduverse-auth'              // User session
'eduverse-assessments'       // Grading history
'eduverse-vr'                // VR progress (4 evidence items)
'btec_platform_progress'  // Gameplay state
```

---

## 🎨 CSS Classes

```css
/* Glassmorphism */
.glass-eduverse              /* Frosted glass + neon border */
.card-eduverse               /* Glass card + hover scale */

/* Text */
.text-gradient            /* Cyan-to-emerald gradient */
.font-cairo               /* Arabic font */

/* Layout */
rtl:text-right            /* RTL-specific styles */
bg-midnight               /* #020617 dark background */
text-cyan-500             /* #06b6d4 primary */
text-emerald-500          /* #10b981 success */
```

---

## 🌐 API Endpoints

### Frontend (Next.js)
```
POST /api/chat              → AI Teacher/Advisor
POST /api/evaluate          → Bridge to FastAPI
POST /api/openai-grade      → Client key grading
POST /api/plagiarism        → Plagiarism check
```

### Backend (FastAPI :8000)
```
GET  /                      → Health check
POST /api/v1/assessment/grade           → GPT-4o grading
POST /api/v1/assessment/check_plagiarism → Similarity
```

---

## 🚨 Critical Rules

### ✅ Always Do
- Add `'use client'` to components with hooks/state
- Import types from `@/types` only
- Use root imports: `@/hooks`, `@/lib`, `@/context`
- Keep Arabic RTL layout (`dir="rtl"`)
- Test localStorage after state changes

### ❌ Never Do
- Change localStorage keys without migration
- Modify VR evidence count from 4
- Use relative paths for root resources
- Forget `'use client'` directive
- Break Arabic RTL layout

---

## 📦 Package Versions

```json
{
  "next": "^16.1.6",
  "react": "^18.2.0",
  "typescript": "^5.3.0",
  "zustand": "^4.5.0",
  "@react-three/fiber": "^8.18.0",
  "tailwindcss": "^3.4.19"
}
```

---

## 🛠️ Commands

```bash
# Frontend
cd frontend
npm run dev          # localhost:3000
npm run build        # Production
npm run type-check   # TypeScript
npm run lint         # ESLint

# Backend
cd backend
python app/main.py   # FastAPI :8000
uvicorn app.main:app --reload  # Dev mode
```

---

## 🎯 Common Tasks

### Add New Page
1. Create `frontend/src/app/[name]/page.tsx`
2. Add `'use client'` if using hooks
3. Import from `@/hooks`, `@/types`
4. Use RTL classes (`rtl:text-right`)

### Add New API
1. Create `frontend/src/app/api/[name]/route.ts`
2. Export `POST`/`GET` functions
3. Call FastAPI at `http://127.0.0.1:8000`

### Add New Store
1. Create `hooks/use[Name].ts`
2. Use `create<T>()(persist(...))`
3. Choose unique localStorage key

### Add 3D Component
1. Create in `components/[Name].tsx`
2. Use `@react-three/fiber` + `drei`
3. Add to simulation scene

---

## 📚 Quick Links

| Resource | Location |
|----------|----------|
| Full Context (EN) | `.github/EDUVERSE_CONTEXT.md` |
| Full Context (AR) | `.github/EDUVERSE_CONTEXT_AR.md` |
| Complete Guide | `.github/copilot-instructions.md` |
| Project Snapshot | `PROJECT_SNAPSHOT_*.txt` |
| Type Definitions | `types/index.ts` |
| Grading Logic | `lib/btec-grading.ts` |

---

**🔖 Bookmark this card for instant reference!**
