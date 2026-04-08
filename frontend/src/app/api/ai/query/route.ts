// app/api/ai/query/route.ts
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
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid or empty JSON body." },
        { status: 400 }
      );
    }

    const { question } = body;
    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid required field: 'question' (string)" },
        { status: 400 }
      );
    }

    // 3. Generate embedding for the question
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
      dimensions: 1024,
    });

    const vector = embeddingResponse.data[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      return NextResponse.json(
        { error: "Failed to generate embedding for the question." },
        { status: 500 }
      );
    }

    // 4. Query Pinecone
    const pc = initVectorDB();
    const index = pc.index(indexName);

    const queryResponse = await index.query({
      vector,
      topK: 5,
      includeMetadata: true,
    });

    const matches = queryResponse.matches || [];

    // 5. Build context from matched documents
    const context = matches
      .map((m: any) => m.metadata?.content)
      .filter(Boolean)
      .join("\n\n");

    // 6. Generate answer using GPT-4
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: context
            ? `Use the following context to answer the user's question:\n\n${context}`
            : "No relevant context was found. Answer based on your general knowledge.",
        },
        { role: "user", content: question },
      ],
    });

    const answer = chatResponse.choices[0]?.message?.content || "No answer generated.";

    return NextResponse.json({
      answer,
      sources: matches.map((m: any) => ({
        id: m.id,
        score: m.score,
        content: m.metadata?.content || null,
      })),
    });
  } catch (error: any) {
    console.error("🔥 Query Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error during query.",
        details: error.message || String(error),
      },
      { status: 500 }
    );
  }
}