import { Fragment, type ReactNode } from "react";

/**
 * 1) الأقواس المربعة: `[أكمل أنت]` (مع دعم `اكمل` بلا همزة)
 * 2) نمط المثال الذهبي: `... (اكمل أنت …)` (ثلاث نقاط ASCII أو علامة … U+2026)
 */
const GAP = /(\[[^\]]*(?:أ|ا)كمل أنت[^\]]*\]|(?:\.{3}|…|\u2026)\s*\([^)]+\))/g;

const badgeClassName =
  "inline-block max-w-full rounded border border-primary/40 bg-primary/20 px-2 py-0.5 text-sm font-bold text-primary animate-pulse [word-break:break-word]";

function isGapSegment(part: string): boolean {
  if (/^\[[^\]]*(?:أ|ا)كمل أنت[^\]]*\]$/.test(part)) return true;
  if (/^(?:\.{3}|…|\u2026)\s*\([^)]+\)$/.test(part)) return true;
  return false;
}

/**
 * Highlights student-completion gaps in partial scaffold text (brackets and `... ( )` from backend).
 */
export function renderPartialSolution(text: string): ReactNode {
  if (!text?.trim()) return null;
  const parts = text.split(GAP);
  return (
    <>
      {parts.map((part, i) => {
        if (isGapSegment(part)) {
          return (
            <span key={i} className={badgeClassName}>
              {part}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
