import { Pinecone } from "@pinecone-database/pinecone";

let client: Pinecone | null = null;

/**
 * Initialize and return a singleton Pinecone client.
 * Works with @pinecone-database/pinecone v2+ / v3+
 */
export function initVectorDB(): Pinecone {
  if (!client) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "PINECONE_API_KEY is not set. Add it to your .env.local file."
      );
    }
    client = new Pinecone({ apiKey });
  }
  return client;
}

// Keep backward-compatibility alias
export const getVectorDB = initVectorDB;

type RecordMetadata = Record<string, string | number | boolean | string[]>;

/**
 * Upsert a single embedding vector into a Pinecone index.
 */
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

  await index.upsert({
    records: [
      {
        id,
        values: vector,
        metadata,
      },
    ],
  });
}

/**
 * Query a Pinecone index with a vector and return the top-K matches.
 */
export async function queryEmbedding(
  indexName: string,
  vector: number[],
  topK: number = 5
) {
  const pc = initVectorDB();
  const index = pc.index(indexName);

  const result = await index.query({
    vector,
    topK,
    includeMetadata: true,
  });

  return result.matches || [];
}

/**
 * Test connectivity to a Pinecone index (useful for health checks).
 */
export async function testPineconeConnection(indexName: string) {
  try {
    const pc = initVectorDB();
    const index = pc.index(indexName);
    return await index.describeIndexStats();
  } catch (error) {
    console.error("❌ Pinecone connection failed:", error);
    throw error;
  }
}