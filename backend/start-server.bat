@echo off
setlocal enabledelayedexpansion

:: Force UTF-8 for Arabic text in logs (prevents charmap/cp1252 crash on Windows)
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
chcp 65001 > nul

cd /d "e:\Phase 1_ Quantum Foundation Project Setup Instructions\backend"

echo.
echo ============================================================
echo BTEC Platform 2026 - Backend Server Startup
echo ============================================================
echo.

echo [*] Installing dependencies...
python.exe -m pip install --quiet fastapi uvicorn pydantic python-multipart python-dotenv openai rapidfuzz asyncio-mqtt
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to install dependencies
    echo Please check your Python installation
    pause
    exit /b 1
)

echo [OK] Dependencies installed

echo.
echo ============================================================
echo Server Configuration:
echo   URL:  http://127.0.0.1:8000
echo   Docs: http://127.0.0.1:8000/docs
echo ============================================================
echo.
echo [*] Starting FastAPI backend server...
echo Press Ctrl+C to stop the server
echo.

# OpenAI Configuration (REQUIRED)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Server Configuration
PORT=8000
HOST=127.0.0.1

# Environment
ENVIRONMENT=development
DEBUG=true

# Empty file to make v1 a package

python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server failed to start
    pause
)

import { NextRequest, NextResponse } from 'next/server';

interface GradeRequest {
  assignment_text: string;
  student_text: string;
}

interface GradeResponse {
  final_grade: string;
  summary: string;
  criteria: Record<string, {
    band: string;
    achieved: boolean;
    feedback: string;
    evidence_quote: string;
    start_index: number;
    end_index: number;
    confidence?: number;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignment_text, student_text } = body;

    // Validate inputs
    if (!assignment_text || !student_text) {
      return NextResponse.json(
        { success: false, error: 'Missing assignment_text or student_text' },
        { status: 400 }
      );
    }

    // Truncate inputs to backend limits
    const truncatedAssignment = assignment_text.slice(0, 15000);
    const truncatedStudent = student_text.slice(0, 25000);

    // Call FastAPI backend
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    const response = await fetch(`${backendUrl}/api/v1/assessment/grade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assignment_text: truncatedAssignment,
        student_text: truncatedStudent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Backend error:', errorData);
      
      return NextResponse.json(
        { 
          success: false, 
          error: `Backend error (${response.status}): ${errorData}` 
        },
        { status: response.status }
      );
    }

    const result: GradeResponse = await response.json();

    // Transform backend response to frontend format
    const criteriaArray = Object.entries(result.criteria).map(([code, data]) => ({
      code,
      ...data,
    }));

    return NextResponse.json({
      success: true,
      data: {
        final_grade: result.final_grade,
        summary: result.summary,
        criteria: criteriaArray,
      },
      report: `Evaluation completed. Grade: ${result.final_grade}`,
    });

  } catch (error) {
    console.error('Evaluation API error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error during evaluation',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

