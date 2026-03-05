# 🌌 NEXUS ACADEMY - Grand Context Prompt
**نموذج السياق العظيم للتطوير مع GitHub Copilot**

---

## 📋 Quick Copy-Paste Template

```
═══════════════════════════════════════════════════════════════
🎓 NEXUS ACADEMY v3.0 - Development Context
═══════════════════════════════════════════════════════════════

I am developing a high-end BTEC educational platform called "Nexus Academy".

📁 ARCHITECTURE RULES:
────────────────────────────────────────────────────────────────
• Project Root: E:\Phase 1_ Quantum Foundation Project Setup Instructions\
• Next.js App: frontend/src/app (52 pages, App Router)
• Shared Resources: hooks/, lib/, context/, types/ at REPOSITORY ROOT
  └─ Accessed via @/ alias from frontend files
• Styling: Tailwind CSS v3.4 + Arabic RTL + Cairo Font (Arabic-optimized)
• Backend: FastAPI on :8000 (GPT-4o Forensic Grading Engine)
• State: Zustand + localStorage persistence

🔐 CRITICAL CONVENTIONS:
────────────────────────────────────────────────────────────────
1. 'use client' directive: REQUIRED for any component using hooks/state
2. Path imports: @/hooks, @/lib, @/context, @/types (root-level)
3. localStorage keys: IMMUTABLE (nexus-auth, nexus-assessments, nexus-vr, btec_platform_progress)
4. TypeScript: Import types from @/types only (centralized)
5. UI Language: Arabic with RTL layout (lang="ar" dir="rtl")
6. VR Evidence: Hard-coded to 4 items (changing breaks progress %)
7. Grading: Dual-path (client keyword-based, server GPT-4o forensic)

📦 KEY DEPENDENCIES:
────────────────────────────────────────────────────────────────
• Next.js: ^16.1.6 (Turbopack enabled)
• React: ^18.2.0 (with React Three Fiber ^8.18.0)
• TypeScript: ^5.3.0
• Zustand: ^4.5.0 (with persist middleware)
• OpenAI: ^6.17.0

🎯 TASK:
────────────────────────────────────────────────────────────────
[INSERT YOUR DEVELOPMENT TASK HERE]

🚫 CONSTRAINT:
────────────────────────────────────────────────────────────────
• Respect root-level structure (hooks/, lib/, context/, types/)
• Never change localStorage keys without data migration
• Maintain Arabic RTL layout in all UI changes
• Always add 'use client' to components with hooks
• No explanations - just precise code alignment

═══════════════════════════════════════════════════════════════
```

---

## 🌟 Extended Context (للمهام المعقدة)

### 📂 Project Structure Map

```
E:\Phase 1_ Quantum Foundation Project Setup Instructions\
│
├── 🎨 frontend/                    # Next.js 16 Application
│   ├── src/
│   │   ├── app/                   # App Router (52 pages)
│   │   │   ├── page.tsx           # Root page
│   │   │   ├── layout.tsx         # Root layout (Arabic RTL)
│   │   │   ├── globals.css        # Tailwind + custom utilities
│   │   │   ├── api/               # API Routes (4 endpoints)
│   │   │   │   ├── chat/route.ts          # AI Teacher/Advisor
│   │   │   │   ├── evaluate/route.ts      # Bridge to FastAPI
│   │   │   │   ├── openai-grade/route.ts  # Client key grading
│   │   │   │   └── plagiarism/route.ts    # Plagiarism check
│   │   │   │
│   │   │   ├── dashboard/         # Main dashboard
│   │   │   ├── assessment/        # Assessment module
│   │   │   ├── simulation/        # Business simulation
│   │   │   ├── vr-experience/     # VR environment
│   │   │   ├── ai-teacher/        # AI chat interface
│   │   │   └── student/           # Student portal
│   │   │
│   │   └── components/            # Page-specific components
│   │
│   ├── package.json               # Next.js ^16.1.6, React ^18.2
│   ├── tsconfig.json              # TS config with root aliases
│   ├── next.config.js             # Turbopack + path aliases
│   └── tailwind.config.ts         # Tailwind v3 + Cairo font
│
├── 🐍 backend/                     # Python FastAPI + Node Express
│   ├── app/
│   │   ├── main.py                # FastAPI entry point
│   │   ├── api/v1/endpoints/      # API route handlers
│   │   └── services/
│   │       ├── forensic_grader.py # GPT-4o grading engine
│   │       └── plagiarism_guard.py# Plagiarism detection
│   │
│   ├── requirements.txt           # Python deps (FastAPI, OpenAI)
│   └── package.json               # Node Express deps
│
├── 🧩 components/                  # Shared React Components (42 files)
│   ├── MarketingSimulation.tsx    # Main 3D simulation (40KB)
│   ├── EvidenceCollector.tsx      # VR evidence system
│   ├── PESTLEAnalyzer.tsx         # PESTLE analysis tool
│   ├── NPC.tsx                    # 3D NPC characters
│   └── ...
│
├── 🪝 hooks/                       # Zustand Stores (5 files)
│   ├── useAuth.ts                 # Auth store (nexus-auth)
│   ├── useAssessment.ts           # Grading store (nexus-assessments)
│   ├── useVR.ts                   # VR progress (nexus-vr)
│   └── ...
│
├── 🛠️ lib/                         # Utility Libraries
│   ├── btec-grading.ts            # Client-side grading engine
│   └── evaluation/
│
├── 🔄 context/                     # React Context Providers
│   └── ProgressContext.tsx        # Gameplay state (btec_platform_progress)
│
├── 📘 types/                       # TypeScript Definitions
│   └── index.ts                   # Centralized types (Assessment, GradingResult, User, etc.)
│
└── 📄 .github/
    ├── copilot-instructions.md    # Full AI assistant guide
    └── NEXUS_CONTEXT.md           # This file
```

---

## 🎯 Common Development Patterns

### Pattern 1: Creating a New Page Component

```typescript
// File: frontend/src/app/new-feature/page.tsx
'use client';  // ⚠️ REQUIRED for hooks/state

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';  // ✅ Root-level import
import { useAssessment } from '@/hooks/useAssessment';
import type { GradingResult } from '@/types';  // ✅ Centralized types

export default function NewFeaturePage() {
  const { user, isAuthenticated } = useAuth();
  const { evaluate } = useAssessment();
  const [result, setResult] = useState<GradingResult | null>(null);

  // Your component logic...

  return (
    <div className="p-8 rtl:text-right">
      {/* Arabic RTL layout */}
      <h1 className="text-3xl font-cairo text-gradient">
        عنوان الصفحة
      </h1>
      {/* ... */}
    </div>
  );
}
```

### Pattern 2: Adding a New API Route

```typescript
// File: frontend/src/app/api/new-endpoint/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;  // 5 minutes

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Call FastAPI backend
    const response = await fetch('http://127.0.0.1:8000/api/v1/your-endpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
    
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

### Pattern 3: Creating a Zustand Store

```typescript
// File: hooks/useNewFeature.ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NewFeatureState {
  data: any[];
  isLoading: boolean;
  addData: (item: any) => void;
  clearData: () => void;
}

export const useNewFeatureStore = create<NewFeatureState>()(
  persist(
    (set, get) => ({
      data: [],
      isLoading: false,
      
      addData: (item) => {
        set({ data: [...get().data, item] });
      },
      
      clearData: () => {
        set({ data: [] });
      },
    }),
    { 
      name: 'nexus-new-feature'  // ⚠️ Choose a unique key
    }
  )
);

export function useNewFeature() {
  return useNewFeatureStore();
}
```

### Pattern 4: Adding a Shared Component

```typescript
// File: components/NewComponent.tsx
'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface NewComponentProps {
  title: string;
  children: ReactNode;
  onAction?: () => void;
}

export default function NewComponent({ 
  title, 
  children, 
  onAction 
}: NewComponentProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-nexus p-6 rounded-2xl border border-white/10"
    >
      <h3 className="text-xl font-bold text-gradient mb-4">
        {title}
      </h3>
      <div className="rtl:text-right">
        {children}
      </div>
      {onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-6 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg transition"
        >
          تنفيذ
        </button>
      )}
    </motion.div>
  );
}
```

---

## 🔍 Quick Reference

### 📦 Import Paths Cheatsheet

```typescript
// ✅ CORRECT - Root-level resources
import { useAuth } from '@/hooks/useAuth';
import { useAssessment } from '@/hooks/useAssessment';
import { calculateGrade } from '@/lib/btec-grading';
import { useProgress } from '@/context/ProgressContext';
import type { Assessment, User } from '@/types';

// ✅ CORRECT - Frontend src files
import '@/app/globals.css';
import SomeComponent from '@/components/SomeComponent';

// ❌ WRONG - Don't use relative paths for root resources
import { useAuth } from '../../../hooks/useAuth';  // ❌
```

### 🎨 CSS Utility Classes (from globals.css)

```css
/* Glassmorphism */
.glass-nexus     /* Frosted glass effect with neon border */
.card-nexus      /* Glass card with hover scale */

/* Text Effects */
.text-gradient   /* Cyan-to-emerald gradient text */
.custom-scrollbar /* Styled scrollbar */

/* Tailwind Extensions */
bg-midnight      /* #020617 - Deep space background */
text-cyan-500    /* #06b6d4 - Primary accent */
text-emerald-500 /* #10b981 - Success/achievement */
```

### 🔐 localStorage Keys (IMMUTABLE)

```typescript
// ⚠️ NEVER change these keys without data migration
const STORAGE_KEYS = {
  AUTH: 'nexus-auth',              // User session + role
  ASSESSMENTS: 'nexus-assessments', // Grading history
  VR: 'nexus-vr',                  // VR progress (4 evidence items)
  PROGRESS: 'btec_platform_progress' // Gameplay state
} as const;
```

### 🌐 API Endpoints Map

```typescript
// Frontend API Routes
POST /api/chat              → AI Teacher/Advisor chat
POST /api/evaluate          → Bridge to FastAPI grading
POST /api/openai-grade      → Client-key grading
POST /api/plagiarism        → Plagiarism detection

// Backend API Routes (FastAPI on :8000)
GET  /                      → Health check
POST /api/v1/assessment/grade           → GPT-4o forensic grading
POST /api/v1/assessment/check_plagiarism → Similarity analysis
```

---

## 🚨 Critical Reminders

### ⚠️ Must Do
- ✅ Add `'use client'` to components using hooks/state/context
- ✅ Import types from `@/types` only (centralized)
- ✅ Use root-level imports for hooks/lib/context
- ✅ Maintain Arabic RTL layout in UI changes
- ✅ Test localStorage persistence after state changes

### 🚫 Must NOT Do
- ❌ Change localStorage keys without migration strategy
- ❌ Modify VR evidence count from 4 (breaks progress %)
- ❌ Use relative paths for root-level resources
- ❌ Forget `'use client'` directive
- ❌ Import types from multiple sources (use @/types only)

---

## 📚 Additional Resources

- **Full Guide**: `.github/copilot-instructions.md`
- **Type Definitions**: `types/index.ts`
- **Grading Logic**: `lib/btec-grading.ts` (client) + `backend/app/services/forensic_grader.py` (server)
- **Project Snapshot**: `PROJECT_SNAPSHOT_20260217_014828.txt`

---

## 🎬 Usage Examples

### Example 1: Add New Assessment Feature
```
[Copy template above, then add:]

🎯 TASK:
Create a new "Quick Assessment" page that:
1. Shows 5 random BTEC questions
2. Uses useAssessment hook for grading
3. Displays results in Arabic RTL layout
4. Saves progress to localStorage
```

### Example 2: Integrate New 3D Component
```
[Copy template above, then add:]

🎯 TASK:
Add a new 3D office room to MarketingSimulation.tsx:
1. Use React Three Fiber + Drei
2. Add 2 new NPC characters with dialogue
3. Collect 1 new evidence item (keep total at 4)
4. Update useVR progress tracking
```

### Example 3: Create New API Endpoint
```
[Copy template above, then add:]

🎯 TASK:
Create /api/generate-report endpoint that:
1. Accepts student submission data
2. Calls FastAPI for AI-generated feedback
3. Returns PDF download link
4. Handles Arabic text correctly
```

---

## 🔄 Version History

- **v1.0** (2026-02-17): Initial grand context prompt
- Current versions: Next.js 16.1.6, React 18.2.0, TypeScript 5.3.0

---

**💡 Pro Tip**: Bookmark this file and copy the template before every Copilot session for consistent, accurate code generation aligned with Nexus Academy's architecture.
