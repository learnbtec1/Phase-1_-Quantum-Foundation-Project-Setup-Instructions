import { NextRequest, NextResponse } from "next/server";
import { initVectorDB } from "@/lib/ai/vectorDB";
import OpenAI from "openai";
import {
  blockAiBffUnlessEnabledInProduction,
  requireAuthenticatedUser,
} from "@/lib/server/bffAuth";

export async function POST(req: NextRequest) {
  const disabled = blockAiBffUnlessEnabledInProduction();
  if (disabled) return disabled;

  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    // 1. Validate environment
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 503 }
      );
    }
    if (!process.env.PINECONE_API_KEY) {
      return NextResponse.json(
        { error: "PINECONE_API_KEY is not configured on the server." },
        { status: 503 }
      );
    }

    const indexName = process.env.PINECONE_INDEX_NAME || process.env.PINECONE_INDEX;
    if (!indexName) {
      return NextResponse.json(
        { error: "PINECONE_INDEX_NAME is not configured on the server." },
        { status: 503 }
      );
    }

    // 2. Parse request body
    let body: { id?: unknown; content?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid or empty JSON body." },
        { status: 400 }
      );
    }

    const { id, content } = body;
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid required field: 'id' (string)" },
        { status: 400 }
      );
    }
    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid required field: 'content' (string)" },
        { status: 400 }
      );
    }

    // 3. Generate embedding via OpenAI (dimensions: 1024 to match Pinecone index)
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: content,
      dimensions: 1024,
    });

    const vector = embeddingResponse.data[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      console.error("Generated vector is invalid:", vector);
      return NextResponse.json(
        { error: "Failed to generate a valid embedding vector." },
        { status: 500 }
      );
    }

    // 4. Upsert into Pinecone
    const pc = initVectorDB();
    const index = pc.index(indexName);

    await index.upsert({
      records: [
        {
          id,
          values: vector,
          metadata: { content },
        },
      ],
    });

    return NextResponse.json({
      success: true,
      id,
      dimensions: vector.length,
    });
  } catch (error: unknown) {
    console.error("🔥 Ingest Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error during ingestion.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}