import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4, v5 as uuidv5, validate as isValidUuid } from "uuid";
import { env } from "../config/env.js";
import { DocumentChunk } from "./chunking.js";
import { EmbeddingService } from "./embeddings.js";
import { logger } from "../utils/logger.js";

const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

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

  private static isQdrantActive(): boolean {
    return env.VECTOR_PROVIDER === "qdrant" && env.NODE_ENV !== "test" && !!this.client;
  }

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

      if (this.isQdrantActive() && this.client) {
        try {
          const pointId = isValidUuid(chunk.chunkId)
            ? chunk.chunkId
            : uuidv5(`${chunk.tenantId}:${chunk.chunkId}`, NAMESPACE);

          await this.client.upsert(this.COLLECTION_NAME, {
            wait: true,
            points: [
              {
                id: pointId,
                vector,
                payload: {
                  chunkId: chunk.chunkId,
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
        // Mock store — update in place if already indexed
        const existingIdx = this.mockStore.findIndex(
          (item) => item.chunk.tenantId === chunk.tenantId && item.chunk.chunkId === chunk.chunkId
        );
        if (existingIdx >= 0) {
          this.mockStore[existingIdx] = { id: chunk.chunkId, vector, chunk };
        } else {
          this.mockStore.push({
            id: chunk.chunkId,
            vector,
            chunk
          });
        }
      }
    }
    logger.info({ count: chunks.length }, "Indexed chunks in vector store");
  }

  static async deletePointsByFilter(tenantId: string, filter: Record<string, any>): Promise<void> {
    if (this.isQdrantActive() && this.client) {
      try {
        const mustFilters: any[] = [{ key: "tenantId", match: { value: tenantId } }];
        for (const [key, value] of Object.entries(filter)) {
          mustFilters.push({ key, match: { value } });
        }
        await (this.client as any).delete(this.COLLECTION_NAME, {
          filter: { must: mustFilters }
        });
        logger.info({ tenantId, filter }, "Pruned Qdrant vector points by filter");
      } catch (err: any) {
        logger.warn({ err: err.message, tenantId, filter }, "Failed to delete points from Qdrant");
      }
    } else {
      // Prune in mock store
      this.mockStore = this.mockStore.filter((item) => {
        if (item.chunk.tenantId !== tenantId) return true;
        for (const [key, val] of Object.entries(filter)) {
          if ((item.chunk as any)[key] === val) return false;
        }
        return true;
      });
    }
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

    if (this.isQdrantActive() && this.client) {
      try {
        const mustFilters: any[] = [{ key: "tenantId", match: { value: tenantId } }];
        if (filter.customerId) {
          mustFilters.push({ key: "customerId", match: { value: filter.customerId } });
        }
        if (filter.documentType) {
          mustFilters.push({ key: "documentType", match: { value: filter.documentType } });
        }

        const res = await (this.client as any).query(this.COLLECTION_NAME, {
          query: queryVector,
          filter: mustFilters.length > 0 ? { must: mustFilters } : undefined,
          limit: topK,
          with_payload: true
        });

        const points = res.points || [];
        return points.map((hit: any) => ({
          score: hit.score,
          chunk: {
            chunkId: (hit.payload?.chunkId as string) || String(hit.id),
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
