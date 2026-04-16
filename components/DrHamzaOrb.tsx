"use client";

/**
 * Placeholder orb for root Dashboard — minimal visual so root app typechecks.
 * Canonical avatar experience lives under `frontend/`.
 */
export default function DrHamzaOrb() {
  return (
    <div
      className="pointer-events-none fixed bottom-8 left-1/2 z-0 h-24 w-24 -translate-x-1/2 rounded-full border border-white/10 bg-gradient-to-br from-cyan-500/25 to-emerald-500/15 blur-md"
      aria-hidden
    />
  );
}
