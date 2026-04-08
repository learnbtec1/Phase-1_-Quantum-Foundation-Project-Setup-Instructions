# EDUVERSE-EDU 2200 [Quantum Edition] - AI Coding Agent Instructions

## Project Overview
This is an immersive educational application set in the year 2200, combining Next.js 14 with React Three Fiber to create a 3D quantum farm simulation for business education. Users interact with NPCs, collect evidence, and perform PESTLE analysis through a sci-fi themed UI.

## Architecture & Key Patterns

### Three-Layer Structure
1. **3D Simulation Layer** ([src/components/quantum-engine/](src/components/quantum-engine/)) - React Three Fiber components, always wrapped with `dynamic()` and `{ ssr: false }`
2. **2D UI Overlay Layer** ([src/components/hologram-ui/](src/components/hologram-ui/)) - Modal dialogs, HUD elements using Framer Motion
3. **State Management Layer** ([src/lib/quantum-store.ts](src/lib/quantum-store.ts)) - Zustand with persist middleware

### Dynamic Import Pattern (Critical)
**Always** disable SSR for 3D components to prevent WebGL errors:
```tsx
const ProceduralFarm = dynamic(
  () => import("@/components/quantum-engine/ProceduralFarm"),
  { ssr: false }
);
```
This pattern is mandatory for ALL React Three Fiber components (Canvas, meshes, entities).

### State Management with Zustand
- Global state in [src/lib/quantum-store.ts](src/lib/quantum-store.ts) using `zustand/persist` for localStorage persistence
- Key state slices: `pestleAnalysis` (user submissions), `evidence` (collected data streams)
- Evidence collection prevents duplicates by checking `entityName`, `category`, and `timestamp`
- Access pattern: `const evidence = useQuantumStore((s) => s.evidence.collected);`

### Data-Driven NPCs
- Entity definitions are hardcoded in [src/components/quantum-engine/NPCEntities.tsx](src/components/quantum-engine/NPCEntities.tsx)
- Each NPC has `dataStreams[]` with `title`, `content`, `category` (PESTLE section), `timestamp`
- [public/data/quantum-entities.json](public/data/quantum-entities.json) provides reference data structure (currently NOT dynamically loaded)
- 3 NPCs: Victoria (hologram, red), Stefan (cyborg, blue), Harvest-Drone-7 (AI, green)

### PESTLE Analysis Workflow
1. User explores 3D farm → clicks NPC → [NeuralLinkModal](src/components/hologram-ui/NeuralLinkModal.tsx) opens
2. Modal displays data streams → user clicks "Collect Evidence" → saves to Zustand store
3. Navigate to `/simulation/quantum-farm/analysis` → [PESTLEMatrix](src/components/sentient-logic/PESTLEMatrix.tsx) component
4. User writes analysis → submit → [calculateQuantumGrade()](src/lib/grading-rubric.ts) evaluates based on text length
5. Results stored in `pestleAnalysis` state with `{ submitted: boolean, input: string, result: GradingResult }`

## Theme & Styling Conventions

### Tailwind Custom Colors (defined in [tailwind.config.ts](tailwind.config.ts))
```tsx
"quantum-blue": "#00f3ff"    // Primary UI elements, borders, accents
"neural-purple": "#b967ff"   // Secondary accents, gradients
"bio-green": "#00ff88"       // Success states, evidence indicators
"alert-red": "#ff0066"       // Warnings, Victoria's color
"space-deep": "#0a0a1a"      // Background color
```

### Component Styling Patterns
- Glass morphism: `bg-black/70 backdrop-blur-md border border-quantum-blue/50`
- Glow effects: `shadow-[0_0_30px_rgba(0,243,255,0.4)]`
- Gradient buttons: `bg-gradient-to-r from-quantum-blue to-neural-purple`
- Use `.hologram-card` class for consistent panel styling

## Development Workflow

### Commands
```bash
npm run dev     # Start dev server (http://localhost:3000 or 3002)
npm run build   # Production build
npm start       # Serve production build
```

### Component Organization
- **quantum-engine/**: 3D components (Three.js geometry, animations)
- **hologram-ui/**: 2D overlays (modals, HUDs, cards)
- **sentient-logic/**: Business logic components (PESTLEMatrix, OracleAI, grading)

### Key Files to Understand
- [src/lib/quantum-store.ts](src/lib/quantum-store.ts) - Central state management
- [src/lib/grading-rubric.ts](src/lib/grading-rubric.ts) - Analysis evaluation logic
- [src/types/quantum-types.ts](src/types/quantum-types.ts) - TypeScript interfaces for QuantumState, Evidence, GradingResult
- [src/components/quantum-engine/NPCEntities.tsx](src/components/quantum-engine/NPCEntities.tsx) - Interactive NPC click handlers and data

## Critical Implementation Details

### React Three Fiber Best Practices
- Use `useFrame()` hook for animations (runs every frame)
- Use `useRef<THREE.Mesh>(null)` for direct mesh manipulation
- Wrap animated elements with `<Float>` from `@react-three/drei` for floating effects
- Cast shadows: `castShadow receiveShadow` on meshes

### Framer Motion Patterns
- Use `<AnimatePresence>` for conditional rendering with exit animations
- Standard modal animation: `initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}`
- Apply `exit` prop for unmount animations

### Error Prevention
- All 3D components MUST be dynamically imported with `ssr: false`
- Zustand persist uses `name: "quantum-storage"` key - don't change this
- Evidence collection checks for duplicates before adding to state
- Modal close handlers use `onClick={onClose}` on overlay + `onClick={(e) => e.stopPropagation()}` on content

## Project-Specific Terminology
- **Quantum State**: Grading result enum (`DECOHERENCE`, `STABLE`, `RESONANT`, `ENTANGLED`)
- **Data Streams**: Evidence items from NPCs (displayed in NeuralLinkModal)
- **PESTLE Sections**: Political, Economic, Social, Technological, Legal, Environmental
- **Oracle AI**: Chatbot assistant component ([OracleAI.tsx](src/components/sentient-logic/OracleAI.tsx))

## Common Tasks

### Adding a New NPC
1. Add entity function in [NPCEntities.tsx](src/components/quantum-engine/NPCEntities.tsx) with `dataStreams[]`
2. Add to scene in `NPCEntities` export with unique position
3. Follow naming: `{Name}Entity` component with `onSelect` prop

### Modifying Grading Logic
Edit [calculateQuantumGrade()](src/lib/grading-rubric.ts) function - currently uses text length thresholds (20, 100 chars).

### Adding New PESTLE Section
1. Update `PESTLESection` type in [quantum-types.ts](src/types/quantum-types.ts)
2. Update `getAllPESTLESections()` in [grading-rubric.ts](src/lib/grading-rubric.ts)
3. Ensure NPCs have matching `category` in dataStreams

## Dependencies
- **Three.js Stack**: `@react-three/fiber` (React renderer), `@react-three/drei` (helpers), `three` (core)
- **Animation**: `framer-motion` for 2D UI animations
- **State**: `zustand` with persist middleware
- **Framework**: Next.js 14 with App Router, TypeScript strict mode
