import { Pinecone } from "@pinecone-database/pinecone";

let client: Pinecone | null = null;

type RecordMetadata = Record<string, string | number | boolean | string[]>;

export function initVectorDB(): Pinecone {
  if (!client) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error("PINECONE_API_KEY is not set in environment variables.");
    }
    client = new Pinecone({ apiKey });
  }
  return client;
}

export const getVectorDB = initVectorDB;

export async function upsertEmbedding(
  indexName: string,
  id: string,
  vector: number[],
  metadata: RecordMetadata = {}
): Promise<void> {
  if (!id || !Array.isArray(vector) || vector.length === 0) {
    throw new Error(
      `Invalid upsert input: id="${id}", vector length=${vector?.length}`
    );
  }
  const pc = initVectorDB();
  const index = pc.index(indexName);
  await index.upsert([{ id, values: vector, metadata }]);
}

export async function queryEmbedding(
  indexName: string,
  vector: number[],
  topK: number = 5
) {
  const pc = initVectorDB();
  const index = pc.index(indexName);
  const result = await index.query({ vector, topK, includeMetadata: true });
  return result.matches || [];
}

export async function testPineconeConnection(indexName: string) {
  const pc = initVectorDB();
  const index = pc.index(indexName);
  const stats = await index.describeIndexStats();
  console.log("✅ Pinecone connected. Stats:", stats);
  return stats;
}