import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "AI API is online",
    endpoints: {
      ingest: "POST /api/ai/ingest — Ingest documents into vector DB",
      query: "POST /api/ai/query — Query documents with natural language",
    },
  });
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Use /api/ai/ingest for ingestion or /api/ai/query for queries.",
      endpoints: {
        ingest: "POST /api/ai/ingest",
        query: "POST /api/ai/query",
      },
    },
    { status: 400 }
  );
}