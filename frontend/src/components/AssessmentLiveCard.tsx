"use client";
import React, { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import ProgressTower from "./ProgressTower";

export default function AssessmentLiveCard() {
  const [score, setScore] = useState(0);
  const lastEvaluateKeyRef = useRef('');

  const handleEvaluate = async (studentContent: string, assignmentText: string) => {
    // Validate content before making API call
    if (!studentContent || !assignmentText) return;
    if (studentContent.length < 50) return; // Match API validation
    if (assignmentText.length < 20) return; // Match API validation

    try {
      await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_text: studentContent, // Use correct field name
          assignment_text: assignmentText,
          unit_id: '14',
        }),
      });
    } catch (error) {
      console.warn('AssessmentLiveCard evaluation failed:', error);
    }
  };

  const syncData = () => {
    const localScore = localStorage.getItem('student_score');
    if (localScore) setScore(parseInt(localScore));

    // Only evaluate if we have substantial content to avoid 400 errors
    const studentContent = localStorage.getItem('student_content') || localStorage.getItem('student_text') || '';
    const assignmentText = localStorage.getItem('assignment_text') || '';
    
    if (studentContent && assignmentText && 
        studentContent.length >= 50 && 
        assignmentText.length >= 20) {
      const evaluateKey = `${studentContent.length}:${assignmentText.length}`;
      if (evaluateKey !== lastEvaluateKeyRef.current) {
        lastEvaluateKeyRef.current = evaluateKey;
        void handleEvaluate(studentContent, assignmentText);
      }
    }
  };

  useEffect(() => {
    syncData();
    window.addEventListener('storage', syncData);
    // Reduce frequency to avoid excessive API calls
    const interval = setInterval(syncData, 15000); // Every 15 seconds instead of 5
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', syncData);
    };
  }, []);

  return (
    <div className="relative h-[450px] w-full bg-gray-900/40 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden group">
      <div className="absolute top-6 right-6 z-10 text-right">
        <h3 className="text-xl font-bold text-white">تحليل الإنجاز</h3>
        <p className="text-sm text-emerald-400 font-mono">Pythagoras AI Live</p>
      </div>
      <Canvas camera={{ position: [0, 2, 7], fov: 40 }}>
        <ambientLight intensity={0.7} />
        <ProgressTower score={score} />
        <Environment preset="city" />
        <OrbitControls enableZoom={false} autoRotate />
      </Canvas>
    </div>
  );
}