"use client";

import { useEffect, useMemo, useState } from "react";

import { useAssessment } from "@/hooks/useAssessment";

/** ≥ POLICY.minWords (150): required or submit fails client-side validation. */
const SAMPLE_STUDENT_WORK = `${"This paragraph tests the unified useAssessment submission path with realistic length. Networks use layered models and routed paths. Students describe explain and evaluate using evidence. ".repeat(10)}`.trim();

function SmokeTestAssessment() {
  const { submitAssessment, loading } = useAssessment();
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function smoke() {
      const result = await submitAssessment({
        btecUnit: "Unit 1",
        studentWork: SAMPLE_STUDENT_WORK,
        submissionFiles: undefined,
        contentSource: "text",
        assignmentCriteria: "",
        acknowledgeHighSimilarity: true,
        persistCoaching: false,
      });
      if (cancelled) return;
      console.log("[test-assessment] RESULT:", JSON.stringify(result, null, 2));
      setDone(true);
    }

    smoke();
    return () => {
      cancelled = true;
    };
  }, [submitAssessment]);

  const note = useMemo(
    () =>
      `Requires bearer token (same as main app login). Opens console (F12) for RESULT.`,
    [],
  );

  return (
    <div style={{ padding: "1.25rem", fontFamily: "system-ui,sans-serif", maxWidth: 640 }}>
      <h1 style={{ fontSize: "1.1rem" }}>useAssessment smoke test</h1>
      <p style={{ color: "#555", marginTop: 8 }}>{note}</p>
      <p style={{ marginTop: 12 }}>
        Status:{" "}
        <strong>{loading ? "waiting for submitAssessment…" : done ? "request finished — see console." : "starting…"}</strong>
      </p>
      <pre
        style={{
          marginTop: 16,
          padding: 12,
          background: "#111",
          color: "#0f0",
          fontSize: 12,
          overflow: "auto",
        }}
      >
        PATH: GET /test-assessment after login
      </pre>
    </div>
  );
}

export default function TestAssessmentPage() {
  if (process.env.NODE_ENV !== "development") {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <p>This diagnostic route is only available in development builds.</p>
      </div>
    );
  }
  return <SmokeTestAssessment />;
}
