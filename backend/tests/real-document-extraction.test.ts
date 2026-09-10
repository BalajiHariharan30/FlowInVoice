import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  DocumentExtractorFactory,
  BedrockOCRProvider,
  GeminiVisionProvider,
  MistralOCRProvider,
  MockOCRProvider,
  PurchaseOrderExtractionSchema
} from "../src/agents/providers/ocr.provider.js";
import { env } from "../src/config/env.js";
import { createExtractionNode } from "../src/ai/workflow/extraction/extraction.agent.js";
import {
  PurchaseOrderRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { StorageService } from "../src/storage/s3.service.js";

describe("Real Document Extraction & OCR Provider (§Fix Spec)", () => {
  const tenantId = "tenant_ocr_test";
  const originalEnvProvider = env.DOCUMENT_AI_PROVIDER;
  const originalGeminiKey = env.GEMINI_API_KEY;
  const originalMistralKey = env.MISTRAL_API_KEY;

  beforeEach(() => {
    clearTestRepositories();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    env.DOCUMENT_AI_PROVIDER = originalEnvProvider;
    env.GEMINI_API_KEY = originalGeminiKey;
    env.MISTRAL_API_KEY = originalMistralKey;
  });

  it("1. DocumentExtractorFactory correctly branches on DOCUMENT_AI_PROVIDER", () => {
    env.DOCUMENT_AI_PROVIDER = "bedrock";
    expect(DocumentExtractorFactory.getExtractor()).toBeInstanceOf(BedrockOCRProvider);

    env.DOCUMENT_AI_PROVIDER = "vision_fallback";
    expect(DocumentExtractorFactory.getExtractor()).toBeInstanceOf(GeminiVisionProvider);

    env.DOCUMENT_AI_PROVIDER = "mistral_ocr";
    expect(DocumentExtractorFactory.getExtractor()).toBeInstanceOf(MistralOCRProvider);

    env.DOCUMENT_AI_PROVIDER = "mock";
    expect(DocumentExtractorFactory.getExtractor()).toBeInstanceOf(MockOCRProvider);

    // @ts-expect-error test unknown provider error
    env.DOCUMENT_AI_PROVIDER = "unknown_engine";
    expect(() => DocumentExtractorFactory.getExtractor()).toThrow("Unknown DOCUMENT_AI_PROVIDER: unknown_engine");
  });

  it("2. GeminiVisionProvider throws a loud, clear error when GEMINI_API_KEY is missing", async () => {
    env.DOCUMENT_AI_PROVIDER = "vision_fallback";
    env.GEMINI_API_KEY = "";
    delete process.env.GEMINI_API_KEY;

    const provider = new GeminiVisionProvider();
    await expect(
      provider.extract({
        buffer: Buffer.from("%PDF-1.4 real PO file content"),
        fileName: "Real_Purchase_Order.pdf",
        contentType: "application/pdf"
      })
    ).rejects.toThrow(/GEMINI_API_KEY is not configured/i);
  });

  it("3. MistralOCRProvider throws a loud, clear error when MISTRAL_API_KEY is missing", async () => {
    env.DOCUMENT_AI_PROVIDER = "mistral_ocr";
    env.MISTRAL_API_KEY = "";
    delete process.env.MISTRAL_API_KEY;

    const provider = new MistralOCRProvider();
    await expect(
      provider.extract({
        buffer: Buffer.from("%PDF-1.4 real PO file content"),
        fileName: "Real_Purchase_Order.pdf",
        contentType: "application/pdf"
      })
    ).rejects.toThrow(/MISTRAL_API_KEY is not configured/i);
  });

  it("4. extraction.agent throws a loud error if fileBuffer is null and provider is not mock", async () => {
    env.DOCUMENT_AI_PROVIDER = "vision_fallback";
    env.GEMINI_API_KEY = "test-gemini-key";

    // Create a PO record whose S3 key does NOT exist in storage
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PENDING-001",
      customerName: "Pending",
      gstNumber: "",
      status: "PROCESSING",
      s3Key: "tenants/tenant_ocr_test/pos/non_existent_file.pdf",
      documentName: "non_existent_file.pdf",
      contentType: "application/pdf",
      lineItems: []
    });

    const extractionNode = createExtractionNode(tenantId);
    await expect(
      extractionNode({
        poId: po._id.toString(),
        workflowId: "wf_test_null_buffer",
        currentStep: "intake",
        status: "PROCESSING"
      })
    ).rejects.toThrow(/Document file buffer is null/i);
  });

  it("5. Real extraction parses model response and populates ocrResultKey on PurchaseOrder", async () => {
    env.DOCUMENT_AI_PROVIDER = "vision_fallback";
    env.GEMINI_API_KEY = "dummy-key-for-mocked-fetch";

    const realPOContent = {
      poNumber: "PO-REAL-2026-9941",
      customerName: "Real Global Procurement Corp",
      gstNumber: "29AABCR1234M1Z2",
      issueDate: "2026-03-20",
      deliveryDate: "2026-04-05",
      currency: "INR",
      paymentTerms: "NET_30",
      lineItems: [
        {
          lineNumber: 1,
          productCode: "REAL-SUPPLY-01",
          description: "Premium Ergonomic Office Task Chairs",
          quantity: 10,
          unitPrice: 4500.0,
          lineTotal: 45000.0,
          taxRate: 18
        },
        {
          lineNumber: 2,
          productCode: "REAL-SUPPLY-02",
          description: "Solid Oak Conference Meeting Table (8ft)",
          quantity: 1,
          unitPrice: 28000.0,
          lineTotal: 28000.0,
          taxRate: 18
        }
      ],
      subtotal: 73000.0,
      tax: 13140.0,
      discount: 0.0,
      totalAmount: 86140.0,
      confidence: 0.99
    };

    // Mock global fetch to return real Gemini Vision API output
    const mockApiResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(realPOContent) }]
          }
        }
      ]
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
      text: async () => JSON.stringify(mockApiResponse)
    } as any);

    // Upload real document bytes into storage
    const upload = await StorageService.uploadFile(
      tenantId,
      "pos",
      "po_real_extraction_id",
      "Real_Procurement_Contract.pdf",
      Buffer.from("%PDF-1.4 Real Contract content with chairs and tables"),
      "application/pdf"
    );

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PENDING-REAL",
      customerName: "Pending",
      gstNumber: "",
      status: "PROCESSING",
      s3Key: upload.s3Key,
      documentName: "Real_Procurement_Contract.pdf",
      contentType: "application/pdf",
      lineItems: []
    });

    const extractionNode = createExtractionNode(tenantId);
    const result = await extractionNode({
      poId: po._id.toString(),
      workflowId: "wf_real_extraction",
      currentStep: "intake",
      status: "PROCESSING"
    });

    expect(result.status).toBe("EXTRACTED");
    expect(result.extractedData?.poNumber).toBe("PO-REAL-2026-9941");
    expect(result.extractedData?.customerName).toBe("Real Global Procurement Corp");
    expect(result.extractedData?.lineItems).toHaveLength(2);
    expect(result.extractedData?.lineItems[0].productCode).toBe("REAL-SUPPLY-01");
    expect(result.extractedData?.totalAmount).toBe(86140.0);
    expect(result.extractedData?.confidence).toBe(0.99);

    // Verify ocrResultKey is populated on the PurchaseOrder model
    const updatedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(updatedPo?.ocrResultKey).toBeDefined();
    expect(updatedPo?.ocrResultKey).toContain("raw_ocr_response.json");

    // Verify the raw OCR response was saved to storage
    const rawOcrBuffer = await StorageService.getFileBuffer(updatedPo!.ocrResultKey!);
    expect(rawOcrBuffer).not.toBeNull();
    const parsedRawOcr = JSON.parse(rawOcrBuffer!.toString("utf8"));
    expect(parsedRawOcr.candidates).toBeDefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("6. BedrockOCRProvider throws a loud, clear error when AWS credentials are missing", async () => {
    env.DOCUMENT_AI_PROVIDER = "bedrock";
    env.AWS_ACCESS_KEY_ID = "";
    delete process.env.AWS_ACCESS_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;

    const provider = new BedrockOCRProvider();
    await expect(
      provider.extract({
        buffer: Buffer.from("%PDF-1.4 real PO file content"),
        fileName: "Real_Purchase_Order.pdf",
        contentType: "application/pdf"
      })
    ).rejects.toThrow(/AWS_ACCESS_KEY \/ AWS_SECRET_KEY is not configured/i);
  });
});
