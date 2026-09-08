import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env.js";
import { DocumentChunk } from "./chunking.js";
import { EmbeddingService } from "./embeddings.js";
import { logger } from "../utils/logger.js";

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
}

export class QdrantService {
  private static client =
    env.VECTOR_PROVIDER === "qdrant"
      ? new QdrantClient({
          url: env.QDRANT_URL,
          apiKey: env.QDRANT_API_KEY
        })
      : null;

  private static readonly COLLECTION_NAME = "p2i_rag_documents";

  // In-memory mock store for test/dev
  private static mockStore: Array<{
    id: string;
    vector: number[];
    chunk: DocumentChunk;
  }> = [];

  static async initialize(): Promise<void> {
    if (env.VECTOR_PROVIDER === "qdrant" && this.client) {
      try {
        const collections = await this.client.getCollections();
        const exists = collections.collections.some((c) => c.name === this.COLLECTION_NAME);
        if (!exists) {
          await this.client.createCollection(this.COLLECTION_NAME, {
            vectors: {
              size: 384,
              distance: "Cosine"
            }
          });
          logger.info("Initialized Qdrant collection: " + this.COLLECTION_NAME);
        }
      } catch (err) {
        logger.warn({ err }, "Could not connect to live Qdrant, operating in fallback mode");
      }
    }
  }

  static async indexChunks(chunks: DocumentChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const vector = await EmbeddingService.getEmbedding(chunk.content);

      if (env.VECTOR_PROVIDER === "qdrant" && this.client) {
        try {
          await this.client.upsert(this.COLLECTION_NAME, {
            wait: true,
            points: [
              {
                id: chunk.chunkId,
                vector,
                payload: {
                  tenantId: chunk.tenantId,
                  customerId: chunk.customerId || "",
                  documentId: chunk.documentId,
                  documentName: chunk.documentName,
                  documentType: chunk.documentType,
                  section: chunk.section,
                  pageNumber: chunk.pageNumber,
                  content: chunk.content
                }
              }
            ]
          });
        } catch (err) {
          logger.error({ err, chunkId: chunk.chunkId }, "Failed to upsert to Qdrant");
        }
      } else {
        // Mock store
        this.mockStore.push({
          id: chunk.chunkId,
          vector,
          chunk
        });
      }
    }
    logger.info({ count: chunks.length }, "Indexed chunks in vector store");
  }

  static async search(
    tenantId: string,
    query: string,
    filter: {
      customerId?: string;
      documentType?: "CONTRACT" | "POLICY";
    },
    topK = 5
  ): Promise<SearchResult[]> {
    const queryVector = await EmbeddingService.getEmbedding(query);

    if (env.VECTOR_PROVIDER === "qdrant" && this.client) {
      try {
        const mustFilters: any[] = [{ key: "tenantId", match: { value: tenantId } }];
        if (filter.customerId) {
          mustFilters.push({ key: "customerId", match: { value: filter.customerId } });
        }
        if (filter.documentType) {
          mustFilters.push({ key: "documentType", match: { value: filter.documentType } });
        }

        const res = await (this.client as any).search(this.COLLECTION_NAME, {
          vector: queryVector,
          filter: { must: mustFilters },
          limit: topK
        });

        return res.map((hit: any) => ({
          score: hit.score,
          chunk: {
            chunkId: String(hit.id),
            tenantId: hit.payload?.tenantId as string,
            documentId: hit.payload?.documentId as string,
            documentName: hit.payload?.documentName as string,
            documentType: hit.payload?.documentType as "CONTRACT" | "POLICY",
            customerId: hit.payload?.customerId as string,
            section: hit.payload?.section as string,
            pageNumber: (hit.payload?.pageNumber as number) || 1,
            content: hit.payload?.content as string
          }
        }));
      } catch (err) {
        logger.error({ err }, "Qdrant search failed, falling back to mock search");
      }
    }

    // In-memory mock search with strict tenant isolation and cosine similarity
    const candidates = this.mockStore.filter((item) => {
      if (item.chunk.tenantId !== tenantId) return false;
      if (filter.customerId && item.chunk.customerId !== filter.customerId) return false;
      if (filter.documentType && item.chunk.documentType !== filter.documentType) return false;
      return true;
    });

    const results = candidates.map((item) => {
      // Calculate cosine similarity
      let dot = 0;
      for (let i = 0; i < queryVector.length; i++) {
        dot += queryVector[i] * item.vector[i];
      }
      // Also boost score if words in query appear in content
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const matchCount = words.filter(w => item.chunk.content.toLowerCase().includes(w)).length;
      const textMatchBoost = matchCount * 0.15;
      return {
        chunk: item.chunk,
        score: dot + textMatchBoost
      };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  static clearMockStore(): void {
    this.mockStore = [];
  }
}
