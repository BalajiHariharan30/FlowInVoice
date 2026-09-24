import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { createExceptionNode } from "../src/ai/workflow/exception/exception.agent.js";
import { WorkflowState } from "../src/ai/workflow/state.js";

describe("STEP 7 (HIGH) — Evidence Merging on Review Ticket Re-Flagging", () => {
  const tenantId = "tenant_evidence_merge";

  beforeEach(() => {
    clearTestRepositories();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges and deduplicates evidence items within the SAME stage across multiple exception runs", async () => {
    // 1. Create a PO
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-EVIDENCE-MERGE-01",
      customerName: "Evidence Test Corp",
      gstNumber: "27AABCU9603R1ZM",
      currency: "USD",
      status: "PROCESSING",
      s3Key: "pos/ev.pdf",
      documentName: "ev.pdf",
      documentSize: 1024,
      contentType: "application/pdf"
    });

    const poId = po._id.toString();
    const exceptionNode = createExceptionNode(tenantId);

    // 2. First Exception Run: Policy Evaluation with one evidence chunk
    const firstState: WorkflowState = {
      tenantId,
      poId,
      workflowId: "wf_1",
      documentName: "ev.pdf",
      s3Key: "pos/ev.pdf",
      currentStep: "policy_evaluation",
      status: "PROCESSING",
      toolCallCount: 0,
      validationChecks: [],
      validationErrors: ["Price variance exceeds 10%"],
      evidence: [
        {
          sourceType: "CONTRACT",
          documentId: "doc_contract_01",
          documentName: "Rate_Schedule_2026.pdf",
          pageNumber: 1,
          section: "Section 4. Base Pricing",
          chunkId: "chunk_pricing_01",
          claim: "Base price for SKU-A is 100.00"
        }
      ],
      policySourceReferences: [],
      matchedLineItems: [],
      approvalRequired: false,
      isBusinessException: true,
      allowedVariancePct: 10,
      stepRetries: {},
      isHumanApproved: false,
      skipValidation: false,
      noActiveContract: false,
      requiresCatalogReview: false
    };

    await exceptionNode(firstState);

    // Verify first ticket created with 1 evidence item
    const reviewFirst = await ReviewRepository.findPendingByStage(tenantId, poId, "validation");
    expect(reviewFirst).not.toBeNull();
    expect(reviewFirst!.evidence.length).toBe(1);
    expect(reviewFirst!.evidence[0].chunkId).toBe("chunk_pricing_01");

    // 3. Second Exception Run: Same stage (policy_evaluation → validation) with additional evidence
    const secondState: WorkflowState = {
      ...firstState,
      workflowId: "wf_2",
      currentStep: "policy_evaluation",
      validationErrors: ["Price variance exceeds 10% on another item"],
      evidence: [
        {
          sourceType: "CONTRACT",
          documentId: "doc_contract_99",
          documentName: "Rate_Schedule_2026.pdf",
          pageNumber: 3,
          section: "Section 8. Maximum Discount Ceiling",
          chunkId: "chunk_pricing_99",
          claim: "Maximum allowable discount tier is 10% off MSRP"
        }
      ]
    };

    await exceptionNode(secondState);

    // 4. Same stage → same review updated; evidence merged (contains both chunks)
    const reviewSecond = await ReviewRepository.findPendingByStage(tenantId, poId, "validation");
    expect(reviewSecond).not.toBeNull();
    // Same review document (not a new one)
    expect(reviewSecond!._id.toString()).toBe(reviewFirst!._id.toString());
    // Evidence merged: both chunks present
    expect(reviewSecond!.evidence.length).toBe(2);

    const chunkIds = reviewSecond!.evidence.map((e) => e.chunkId);
    expect(chunkIds).toContain("chunk_pricing_01");
    expect(chunkIds).toContain("chunk_pricing_99");

    // 5. Cross-stage: extraction stage creates a SEPARATE review
    const extractionState: WorkflowState = {
      ...firstState,
      workflowId: "wf_3",
      currentStep: "extraction",
      validationErrors: ["Low OCR confidence"],
      evidence: []
    };

    await exceptionNode(extractionState);

    // Should now have 2 reviews: one for validation, one for extraction
    const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    const stages = allReviews.map((r) => r.stage);
    expect(stages).toContain("validation");
    expect(stages).toContain("extraction");
    // Exactly 2 distinct stages
    expect(new Set(stages).size).toBe(2);
  });
});
