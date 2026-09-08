import { describe, it, expect, beforeEach } from "vitest";
import { QdrantService } from "../src/rag/qdrant.service.js";
import { DocumentChunk } from "../src/rag/chunking.js";

describe("Tenant Isolation & Vector DB RAG Security", () => {
  beforeEach(() => {
    QdrantService.clearMockStore();
  });

  it("strictly prevents cross-tenant vector chunk retrieval", async () => {
    // Index contract clause for Tenant A
    const tenantAChunk: DocumentChunk = {
      chunkId: "chunk_a_1",
      tenantId: "tenant_alpha",
      documentId: "doc_a",
      documentName: "Alpha Contract",
      documentType: "CONTRACT",
      customerId: "cust_a",
      section: "Pricing Terms",
      pageNumber: 3,
      content: "Alpha Corporation negotiated pricing: $500 per unit for Cloud Pro"
    };

    // Index contract clause for Tenant B
    const tenantBChunk: DocumentChunk = {
      chunkId: "chunk_b_1",
      tenantId: "tenant_beta",
      documentId: "doc_b",
      documentName: "Beta Contract",
      documentType: "CONTRACT",
      customerId: "cust_b",
      section: "Pricing Terms",
      pageNumber: 4,
      content: "Beta Corporation negotiated pricing: $750 per unit for Cloud Pro"
    };

    await QdrantService.indexChunks([tenantAChunk, tenantBChunk]);

    // Query from Tenant Alpha
    const resultsAlpha = await QdrantService.search(
      "tenant_alpha",
      "Cloud Pro negotiated pricing",
      { documentType: "CONTRACT" }
    );

    expect(resultsAlpha.length).toBe(1);
    expect(resultsAlpha[0].chunk.tenantId).toBe("tenant_alpha");
    expect(resultsAlpha[0].chunk.content).toContain("$500 per unit");

    // Query from Tenant Beta
    const resultsBeta = await QdrantService.search(
      "tenant_beta",
      "Cloud Pro negotiated pricing",
      { documentType: "CONTRACT" }
    );

    expect(resultsBeta.length).toBe(1);
    expect(resultsBeta[0].chunk.tenantId).toBe("tenant_beta");
    expect(resultsBeta[0].chunk.content).toContain("$750 per unit");

    // Query from Tenant Gamma (should return 0)
    const resultsGamma = await QdrantService.search(
      "tenant_gamma",
      "Cloud Pro negotiated pricing",
      { documentType: "CONTRACT" }
    );

    expect(resultsGamma.length).toBe(0);
  });
});
