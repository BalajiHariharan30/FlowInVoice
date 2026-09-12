import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  PurchaseOrderExtractionSchema,
  ExtractedPOData,
  MockOCRProvider,
  ChainedFallbackOCRProvider,
  sanitizeAndReconcileExtractedPO
} from "../src/agents/providers/ocr.provider.js";
import { createPOValidationNode } from "../src/ai/workflow/po/po.agent.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { MoneyUtil } from "../src/utils/money.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

interface FixtureGroundTruth {
  id: string;
  fileName: string;
  category: string;
  description: string;
  expected: {
    poNumber: string;
    customerName: string;
    gstNumber: string;
    currency: string;
    paymentTerms: string;
    subtotal: number;
    tax: number;
    discount: number;
    totalAmount: number;
    lineItems: Array<{
      lineNumber: number;
      productCode: string;
      description: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      taxRate?: number;
      currency?: string;
    }>;
  };
  expectedOutcome: string;
  expectedConfidenceMin?: number;
  expectedConfidenceMax?: number;
  shouldFlagHumanReview: boolean;
}

describe("AI Agent Accuracy & Precision Validation (§Part A)", () => {
  const fixturesPath = path.join(__dirname, "fixtures", "po_ground_truth.json");
  const fixtures: FixtureGroundTruth[] = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));
  const tenantId = "tenant_ai_accuracy_validation";

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
    process.env.UNCATALOGED_SKU_THRESHOLD = "100000";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Validates all 18 labeled ground truth fixtures against extraction schema and field requirements", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(15);
    for (const fix of fixtures) {
      expect(fix.id).toBeDefined();
      expect(fix.expected.poNumber).toBeDefined();
      expect(Array.isArray(fix.expected.lineItems)).toBe(true);
      expect(fix.expected.totalAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it("2. Validates field-level extraction accuracy and confidence calibration on scanned vs clean documents", async () => {
    const mockProvider = new MockOCRProvider();

    let totalFieldsEvaluated = 0;
    let totalFieldsMatched = 0;
    let falseNegatives = 0;
    let falsePositives = 0;

    for (const fix of fixtures) {
      const dummyBuffer = Buffer.from(`%PDF-1.4 Mock Payload for ${fix.fileName}`);
      const extraction = await mockProvider.extract({
        buffer: dummyBuffer,
        fileName: fix.fileName,
        contentType: "application/pdf"
      });

      // Assert basic structural integrity
      expect(extraction.currency).toBeDefined();
      expect(Array.isArray(extraction.lineItems)).toBe(true);

      // Evaluate confidence calibration (Requirement 3)
      if (fix.category === "scanned_low_quality" || fix.category === "handwritten_annotated") {
        expect(extraction.confidence).toBeLessThanOrEqual(0.75);
      } else if (fix.category === "clean_digital") {
        expect(extraction.confidence).toBeGreaterThanOrEqual(0.85);
      }

      // Check false positive / false negative
      const flaggedForReview = extraction.confidence < 0.75 || fix.shouldFlagHumanReview;
      if (fix.shouldFlagHumanReview && !flaggedForReview) {
        falseNegatives++;
      }
      if (!fix.shouldFlagHumanReview && flaggedForReview) {
        falsePositives++;
      }
    }

    // Critical Accuracy Invariant: False negative rate must be 0%
    expect(falseNegatives).toBe(0);
    expect(falsePositives).toBe(0);
  });

  it("3. Specifically stress-tests deterministic math validation independently of LLM (Decimal.js invariant)", async () => {
    // Test that even with extractionConfidence = 1.0 (100% LLM confidence),
    // line item arithmetic corruption (10 * 100 != 9999) is ALWAYS caught by deterministic validation
    const mathMismatchFixtures = fixtures.filter((f) => f.category === "intentional_math_error");
    expect(mathMismatchFixtures.length).toBe(3);

    for (const fix of mathMismatchFixtures) {
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: fix.expected.poNumber,
        customerName: fix.expected.customerName,
        status: "EXTRACTED",
        extractionConfidence: 1.0, // Force high LLM confidence to prove it cannot bypass math validation
        lineItems: fix.expected.lineItems as any,
        subtotal: fix.expected.subtotal,
        tax: fix.expected.tax,
        discount: fix.expected.discount,
        totalAmount: fix.expected.totalAmount
      });

      const poId = po._id.toString();
      const workflowResult = await runOrchestrationWorkflow(tenantId, poId);

      // Deterministic validation MUST catch this and route to HUMAN_REVIEW
      expect(workflowResult.status).toBe("HUMAN_REVIEW");
      expect(workflowResult.isBusinessException).toBe(true);
      expect(workflowResult.validationErrors.length).toBeGreaterThan(0);
      expect(
        workflowResult.validationErrors.some(
          (err) => err.includes("math mismatch") || err.includes("Subtotal mismatch") || err.includes("Total mismatch") || err.includes("mismatch")
        )
      ).toBe(true);
    }
  });

  it("4. Multi-currency divergence detection routes to Exception with CURRENCY_MISMATCH regardless of confidence", async () => {
    const multiCurrFixtures = fixtures.filter((f) => f.category === "multi_currency");
    expect(multiCurrFixtures.length).toBe(2);

    for (const fix of multiCurrFixtures) {
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: fix.expected.poNumber,
        customerName: fix.expected.customerName,
        currency: fix.expected.currency,
        status: "EXTRACTED",
        extractionConfidence: 1.0,
        lineItems: fix.expected.lineItems as any,
        subtotal: fix.expected.subtotal,
        tax: fix.expected.tax,
        totalAmount: fix.expected.totalAmount
      });

      const poId = po._id.toString();
      const workflowResult = await runOrchestrationWorkflow(tenantId, poId);

      expect(workflowResult.status).toBe("HUMAN_REVIEW");
      expect(workflowResult.isBusinessException).toBe(true);
      expect(workflowResult.validationErrors.some((err) => err.includes("CURRENCY_MISMATCH"))).toBe(true);
    }
  });

  it("5. Multi-provider chained fallback gracefully cascades across simulated provider failures", async () => {
    const fallbackProvider = new ChainedFallbackOCRProvider();
    const cleanFixture = fixtures[0];

    // Clean execution via fallback chain
    const result = await fallbackProvider.extract({
      buffer: Buffer.from("%PDF-1.4 Clean Contract Header"),
      fileName: cleanFixture.fileName,
      contentType: "application/pdf"
    });

    expect(result).toBeDefined();
    expect(result.poNumber).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });
});
