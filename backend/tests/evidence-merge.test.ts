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

  it("merges and deduplicates evidence items across multiple exception runs rather than overwriting", async () => {
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

    // 2. First Exception Run: Low OCR Confidence with OCR evidence chunk
    const firstState: WorkflowState = {
      tenantId,
      poId,
      workflowId: "wf_1",
      documentName: "ev.pdf",
      s3Key: "pos/ev.pdf",
      currentStep: "extraction",
      status: "PROCESSING",
      toolCallCount: 0,
      validationChecks: [],
      validationErrors: ["Low OCR extraction confidence"],
      evidence: [
        {
          sourceType: "CONTRACT",
          documentId: "doc_ocr_01",
          documentName: "ocr_evidence.pdf",
          pageNumber: 1,
          section: "OCR Extraction Summary",
          chunkId: "chunk_ocr_01",
          claim: "Scanned text readability score: 62%"
        }
      ],
      policySourceReferences: [],
      matchedLineItems: [],
      approvalRequired: false,
      isBusinessException: true,
      allowedVariancePct: 10,
      stepRetries: {},
      isHumanApproved: false,
      skipValidation: false
    };

    await exceptionNode(firstState);

    // Verify first ticket created with 1 evidence item
    const reviewFirst = await ReviewRepository.findPendingByEntityId(tenantId, poId);
    expect(reviewFirst).not.toBeNull();
    expect(reviewFirst!.evidence.length).toBe(1);
    expect(reviewFirst!.evidence[0].chunkId).toBe("chunk_ocr_01");

    // 3. Second Exception Run: Commercial Price Variance with Pricing Clause evidence
    const secondState: WorkflowState = {
      ...firstState,
      currentStep: "policy_evaluation",
      validationErrors: ["Price variance exceeds 10%"],
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

    // 4. Verify review ticket was updated and contains BOTH evidence items (merged!)
    const reviewSecond = await ReviewRepository.findPendingByEntityId(tenantId, poId);
    expect(reviewSecond).not.toBeNull();
    expect(reviewSecond!._id.toString()).toBe(reviewFirst!._id.toString());
    expect(reviewSecond!.evidence.length).toBe(2);

    const chunkIds = reviewSecond!.evidence.map((e) => e.chunkId);
    expect(chunkIds).toContain("chunk_ocr_01");
    expect(chunkIds).toContain("chunk_pricing_99");
  });
});
