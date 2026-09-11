import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "../src/config/env.js";
env.DOCUMENT_AI_PROVIDER = "mock";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import { ReanalysisService } from "../src/ai/workflow/reanalysis.service.js";
import { POProcessingWorkflow } from "../src/agents/workflow.js";
import { QueueManager } from "../src/workers/queue.js";
import {
  ErpConnectorFactory,
  MockErpConnector,
  NetSuiteErpConnector,
  SapS4HanaConnector,
  SandboxErpConnector
} from "../src/ai/workflow/posting/erp-connectors.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  CustomerRepository,
  ProductRepository,
  ContractRepository,
  InvoiceRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { QdrantService } from "../src/rag/qdrant.service.js";

describe("Agentic AI Workflows — Comprehensive Verification", () => {
  beforeEach(() => {
    clearTestRepositories();
    QdrantService.clearMockStore();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearTestRepositories();
  });

  // =========================================================================
  // WORKFLOW 1: LangGraph 7-Agent Autonomous Pipeline & Routing Branches
  // =========================================================================
  describe("Workflow 1: LangGraph 7-Agent Orchestration Pipeline", () => {
    it("1.1 Autonomous Happy Path (Extraction -> Matching -> Validation -> Policy -> Approval -> ERP Posting)", async () => {
      const tenantId = "tenant_wf_happy";
      const customer = await CustomerRepository.create(tenantId, {
        name: "Acme Industrial Supplies",
        code: "ACME-IND",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR"
      });

      await ProductRepository.create(tenantId, {
        sku: "VALVE-001",
        name: "Industrial Ball Valve",
        basePrice: 500
      });

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-HAPPY-01",
        customerName: "Acme Industrial Supplies",
        customerId: customer._id.toString(),
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "EXTRACTED",
        s3Key: "pos/wf_happy.pdf",
        documentName: "wf_happy.pdf",
        documentSize: 2048,
        contentType: "application/pdf",
        subtotal: 5000,
        tax: 900,
        discount: 0,
        totalAmount: 5900,
        extractionConfidence: 0.98,
        lineItems: [
          {
            lineNumber: 1,
            productCode: "VALVE-001",
            description: "Industrial Ball Valve",
            quantity: 10,
            unitPrice: 500,
            lineTotal: 5000,
            taxRate: 18,
            currency: "INR"
          }
        ]
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());

      expect(result.status).toBe("COMPLETED");
      expect(result.currentStep).toBe("posting");
      expect(result.isBusinessException).toBe(false);
      expect(result.validationErrors).toHaveLength(0);
      expect(result.invoiceNumber).toBe("INV-WF-HAPPY-01");
      expect(result.erpPostingId).toBeDefined();

      const savedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
      expect(savedPo?.status).toBe("COMPLETED");

      const savedInvoice = await InvoiceRepository.findByPoId(tenantId, po._id.toString());
      expect(savedInvoice?.status).toBe("ISSUED");
      expect(savedInvoice?.totalAmount).toBe(5900);
    });

    it("1.2 Low OCR Confidence -> Routes to Exception Node with Review Ticket", async () => {
      const tenantId = "tenant_wf_ocr";
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-LOW-OCR",
        customerName: "Blurry Scans Ltd",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "UPLOADED",
        s3Key: "pos/blurry.pdf",
        documentName: "blurry.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        extractionConfidence: 0.45
      });

      await ProductRepository.create(tenantId, {
        sku: "BLUR-1",
        name: "Blur Item",
        basePrice: 1000
      });

      const { DocumentExtractorFactory } = await import("../src/agents/providers/ocr.provider.js");
      vi.spyOn(DocumentExtractorFactory, "getExtractor").mockReturnValue({
        extract: async () => ({
          poNumber: "PO-WF-LOW-OCR",
          customerName: "Blurry Scans Ltd",
          gstNumber: "27AABCU9603R1ZM",
          currency: "INR",
          subtotal: 1000,
          tax: 180,
          discount: 0,
          totalAmount: 1180,
          confidence: 0.45,
          lineItems: [
            {
              lineNumber: 1,
              productCode: "BLUR-1",
              description: "Blur Item",
              quantity: 1,
              unitPrice: 1000,
              lineTotal: 1000,
              taxRate: 18
            }
          ]
        })
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());
      console.log("RESULT 1.2:", JSON.stringify(result, null, 2));

      expect(result.isBusinessException).toBe(true);
      expect(result.currentStep).toBe("exception");
      expect(result.validationErrors.some((e) => e.toLowerCase().includes("confidence"))).toBe(true);

      const review = await ReviewRepository.findPendingByEntityId(tenantId, po._id.toString());
      expect(review).toBeDefined();
      expect(review?.stage).toBe("extraction");
      expect(review?.priority).toBe("HIGH");
    });

    it("1.3 Line Arithmetic Mismatch -> Halts at PO Validation & Routes to Exception", async () => {
      const tenantId = "tenant_wf_math";
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-MATH-ERR",
        customerName: "Math Error Corp",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "EXTRACTED",
        s3Key: "pos/math.pdf",
        documentName: "math.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 1000,
        tax: 0,
        discount: 0,
        totalAmount: 1000,
        extractionConfidence: 0.99,
        lineItems: [
          {
            lineNumber: 1,
            productCode: "MATH-SKU",
            description: "Math SKU",
            quantity: 5,
            unitPrice: 100,
            lineTotal: 9999, // Math mismatch: 5 * 100 != 9999
            taxRate: 0
          }
        ]
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());

      expect(result.isBusinessException).toBe(true);
      expect(result.currentStep).toBe("exception");
      expect(result.validationErrors.some((e) => e.toLowerCase().includes("math mismatch"))).toBe(true);
      expect(result.invoiceNumber).toBeUndefined();
    });

    it("1.4 Header Total Reconciliation Mismatch -> Halts & Routes to Exception", async () => {
      const tenantId = "tenant_wf_headertotal";
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-HEADER-ERR",
        customerName: "Header Total Corp",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "EXTRACTED",
        s3Key: "pos/header.pdf",
        documentName: "header.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 1000,
        tax: 180,
        discount: 0,
        totalAmount: 2500, // Total mismatch: 1000 + 180 - 0 = 1180 != 2500
        extractionConfidence: 0.99,
        lineItems: [
          {
            lineNumber: 1,
            productCode: "HEAD-SKU",
            description: "Header SKU",
            quantity: 10,
            unitPrice: 100,
            lineTotal: 1000,
            taxRate: 18
          }
        ]
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());

      expect(result.isBusinessException).toBe(true);
      expect(result.currentStep).toBe("exception");
      expect(result.validationErrors.some((e) => e.toLowerCase().includes("mismatch"))).toBe(true);
      expect(result.invoiceNumber).toBeUndefined();
    });

    it("1.5 Cross-Currency Divergence -> Raises CURRENCY_MISMATCH and Routes to Exception", async () => {
      const tenantId = "tenant_wf_currency";
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-CURR-ERR",
        customerName: "Currency Corp",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "EXTRACTED",
        s3Key: "pos/curr.pdf",
        documentName: "curr.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 8400,
        tax: 0,
        discount: 0,
        totalAmount: 8400,
        extractionConfidence: 0.99,
        lineItems: [
          { lineNumber: 1, productCode: "SKU-USD", description: "USD Item", quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 0, currency: "USD" },
          { lineNumber: 2, productCode: "SKU-INR", description: "INR Item", quantity: 1, unitPrice: 8300, lineTotal: 8300, taxRate: 0, currency: "INR" }
        ]
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());

      expect(result.isBusinessException).toBe(true);
      expect(result.currentStep).toBe("exception");
      expect(result.validationErrors.some((e) => e.includes("CURRENCY_MISMATCH"))).toBe(true);
    });

    it("1.6 Customer Ambiguity (Multiple Candidates) -> Escalates to Human Review", async () => {
      const tenantId = "tenant_wf_ambig_cust";
      await CustomerRepository.create(tenantId, { name: "Apex Solutions", code: "APEX-1", gstNumber: "27AABCA1111A1Z1", currency: "INR" });
      await CustomerRepository.create(tenantId, { name: "Apex Solutions", code: "APEX-2", gstNumber: "29AABCA2222B1Z2", currency: "INR" });

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-APEX",
        customerName: "Apex Solutions",
        gstNumber: "", // Ambiguous without exact GSTIN
        currency: "INR",
        status: "EXTRACTED",
        s3Key: "pos/apex.pdf",
        documentName: "apex.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 500,
        tax: 0,
        discount: 0,
        totalAmount: 500,
        extractionConfidence: 1.0,
        lineItems: [{ lineNumber: 1, productCode: "SKU-A", description: "Item A", quantity: 1, unitPrice: 500, lineTotal: 500, taxRate: 0 }]
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());

      expect(result.isBusinessException).toBe(true);
      expect(result.currentStep).toBe("exception");
      expect(result.validationErrors.some((e) => e.includes("CUSTOMER_AMBIGUITY"))).toBe(true);
    });

    it("1.7 Uncataloged SKU Threshold: High Value (>= $1000) Escalates vs Low Value (< $1000) Auto-Accepts", async () => {
      const tenantId = "tenant_wf_sku_threshold";
      // High value uncataloged SKU
      const poHigh = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-SKU-HIGH",
        customerName: "SKU Tester",
        gstNumber: "27AABCU9603R1ZM",
        currency: "USD",
        status: "EXTRACTED",
        s3Key: "pos/sku1.pdf",
        documentName: "sku1.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 5000,
        tax: 0,
        discount: 0,
        totalAmount: 5000,
        extractionConfidence: 1.0,
        lineItems: [{ lineNumber: 1, productCode: "NEW-GENERATOR-99", description: "Generator", quantity: 1, unitPrice: 5000, lineTotal: 5000, taxRate: 0 }]
      });

      const resultHigh = await runOrchestrationWorkflow(tenantId, poHigh._id.toString());
      expect(resultHigh.isBusinessException).toBe(true);
      expect(resultHigh.validationErrors.some((e) => e.includes("NEW-GENERATOR-99"))).toBe(true);

      // Low value uncataloged SKU
      const poLow = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-SKU-LOW",
        customerName: "SKU Tester",
        gstNumber: "27AABCU9603R1ZM",
        currency: "USD",
        status: "EXTRACTED",
        s3Key: "pos/sku2.pdf",
        documentName: "sku2.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 450,
        tax: 0,
        discount: 0,
        totalAmount: 450,
        extractionConfidence: 1.0,
        lineItems: [{ lineNumber: 1, productCode: "OFFICE-SUPPLY-12", description: "Stapler Box", quantity: 10, unitPrice: 45, lineTotal: 450, taxRate: 0 }]
      });

      const resultLow = await runOrchestrationWorkflow(tenantId, poLow._id.toString());
      expect(resultLow.isBusinessException).toBe(false);
      expect(resultLow.status).toBe("COMPLETED");
    });

    it("1.8 Agentic Policy RAG: Active Contract Clause Matches High Variance & Auto-Approves", async () => {
      const tenantId = "tenant_wf_rag_active";
      const cust = await CustomerRepository.create(tenantId, {
        name: "Enterprise Partner",
        code: "ENT-PARTNER",
        gstNumber: "27AABCU9603R1ZM",
        currency: "USD"
      });

      await ProductRepository.create(tenantId, { sku: "SERVER-PRO", name: "Pro Server", basePrice: 1000 });

      const activeContract = await ContractRepository.create(tenantId, {
        customerId: cust._id.toString(),
        contractNumber: "CTR-ACTIVE-2026",
        effectiveFrom: new Date("2025-01-01T00:00:00Z"),
        effectiveTo: new Date("2027-12-31T23:59:59Z"),
        status: "ACTIVE"
      });

      await QdrantService.indexChunks([
        {
          chunkId: "chunk_active_server",
          tenantId,
          documentId: activeContract._id.toString(),
          documentName: "Enterprise_Contract_2026.pdf",
          documentType: "CONTRACT",
          customerId: cust._id.toString(),
          section: "Schedule C - Volume Tier Discount",
          pageNumber: 3,
          content: "Discount tier for SERVER-PRO: 40% enterprise discount ($600 per unit)"
        }
      ]);

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-RAG-ACTIVE",
        customerName: "Enterprise Partner",
        customerId: cust._id.toString(),
        gstNumber: "27AABCU9603R1ZM",
        currency: "USD",
        issueDate: new Date("2026-05-15T00:00:00Z"),
        status: "EXTRACTED",
        s3Key: "pos/rag_act.pdf",
        documentName: "rag_act.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 6000,
        tax: 0,
        discount: 0,
        totalAmount: 6000,
        extractionConfidence: 1.0,
        lineItems: [{ lineNumber: 1, productCode: "SERVER-PRO", description: "Pro Server", quantity: 10, unitPrice: 600, lineTotal: 6000, taxRate: 0 }]
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());
      expect(result.status).toBe("COMPLETED");
      expect(result.isBusinessException).toBe(false);
      expect(result.invoiceNumber).toBeDefined();
    });

    it("1.9 Human Review Sign-Off Re-injection: Corrected Line Items Waive OCR but Validate Math", async () => {
      const tenantId = "tenant_wf_human_loop";
      await ProductRepository.create(tenantId, {
        sku: "CORRECTED-ITEM",
        name: "Verified Line",
        basePrice: 100
      });

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-WF-HUMAN-RES",
        customerName: "Review Loop Corp",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "HUMAN_APPROVED",
        s3Key: "pos/loop.pdf",
        documentName: "loop.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 2000,
        tax: 360,
        discount: 0,
        totalAmount: 2360,
        extractionConfidence: 0.5, // low confidence waived by human sign-off
        lineItems: [
          { lineNumber: 1, productCode: "CORRECTED-ITEM", description: "Verified Line", quantity: 20, unitPrice: 100, lineTotal: 2000, taxRate: 18 }
        ]
      });

      const result = await runOrchestrationWorkflow(tenantId, po._id.toString());
      expect(result.status).toBe("COMPLETED");
      expect(result.isBusinessException).toBe(false);
      expect(result.invoiceNumber).toBeDefined();
    });
  });

  // =========================================================================
  // WORKFLOW 2: Reanalysis Service (Non-Blocking Multi-Node Inspection)
  // =========================================================================
  describe("Workflow 2: Reanalysis Service Pipeline", () => {
    it("2.1 Inspects all nodes (Confidence, SKU, Math, RAG, GSTIN) and aggregates discrepancies", async () => {
      const tenantId = "tenant_reanalysis_wf";
      const customer = await CustomerRepository.create(tenantId, {
        name: "Tax Invariant Corp",
        code: "TAX-CORP",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR"
      });

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-REANALYSIS-01",
        customerName: "Tax Invariant Corp",
        customerId: customer._id.toString(),
        gstNumber: "INVALID-GSTIN-XXX", // Statutory GSTIN regex failure
        currency: "INR",
        status: "HUMAN_REVIEW",
        s3Key: "pos/reanal.pdf",
        documentName: "reanal.pdf",
        documentSize: 1024,
        contentType: "application/pdf",
        subtotal: 1000,
        tax: 180,
        discount: 0,
        totalAmount: 1180,
        extractionConfidence: 0.6, // Node 02 failure
        lineItems: [
          { lineNumber: 1, productCode: "UNKNOWN-SKU-777", description: "Unregistered", quantity: 10, unitPrice: 100, lineTotal: 1000, taxRate: 18 }
        ]
      });

      const reanalysis = await ReanalysisService.reanalyzePurchaseOrder(tenantId, po._id.toString());

      expect(reanalysis.allNodesPassed).toBe(false);
      expect(reanalysis.discrepancies.length).toBeGreaterThanOrEqual(3);

      const nodeIds = reanalysis.discrepancies.map((d) => d.nodeId);
      expect(nodeIds).toContain("02_EXTRACTION_CONFIDENCE");
      expect(nodeIds).toContain("03_SKU_MATCHING");
      expect(nodeIds).toContain("06_TAX_COMPLIANCE");
    });
  });

  // =========================================================================
  // WORKFLOW 3: ERP Connectors Dispatch Workflow
  // =========================================================================
  describe("Workflow 3: ERP Connectors Dispatch", () => {
    const tenantId = "tenant_erp_connectors";
    const samplePayload = {
      invoiceNumber: "INV-ERP-TEST-001",
      poNumber: "PO-ERP-TEST-001",
      totalAmount: 15000,
      customerName: "Global Manufacturing Ltd"
    };

    it("3.1 MockErpConnector generates valid financial voucher", async () => {
      const connector = new MockErpConnector();
      const voucher = await connector.postInvoice(tenantId, samplePayload);

      expect(voucher.status).toBe("POSTED");
      expect(voucher.targetSystem).toBe("MOCK_ERP_FINANCE");
      expect(voucher.voucherNumber).toBe("VCH-ERP-TEST-001");
      expect(voucher.erpPostingId).toContain(tenantId);
    });

    it("3.2 NetSuiteErpConnector posts via SuiteTalk REST schema", async () => {
      const connector = new NetSuiteErpConnector();
      const voucher = await connector.postInvoice(tenantId, samplePayload);

      expect(voucher.status).toBe("POSTED");
      expect(voucher.targetSystem).toBe("ORACLE_NETSUITE_REST");
      expect(voucher.voucherNumber).toBe("NS-VCH-ERP-TEST-001");
      expect(voucher.erpPostingId).toContain("ns_");
    });

    it("3.3 SapS4HanaConnector posts via SAP OData schema", async () => {
      const connector = new SapS4HanaConnector();
      const voucher = await connector.postInvoice(tenantId, samplePayload);

      expect(voucher.status).toBe("POSTED");
      expect(voucher.targetSystem).toBe("SAP_S4HANA_ODATA");
      expect(voucher.voucherNumber).toBe("SAP-INV-ERP-TEST-001");
      expect(voucher.erpPostingId).toContain("sap_");
    });

    it("3.4 SandboxErpConnector handles external dispatch and fallback", async () => {
      const connector = new SandboxErpConnector();
      const voucher = await connector.postInvoice(tenantId, samplePayload);

      expect(voucher.status).toBe("POSTED");
      expect(voucher.targetSystem).toBe("REST_ERP_SANDBOX_GATEWAY");
      expect(voucher.voucherNumber).toBe("VCH-ERP-TEST-001");
    });

    it("3.5 ErpConnectorFactory dynamically resolves connector from environment", () => {
      expect(ErpConnectorFactory.getConnector("mock")).toBeInstanceOf(MockErpConnector);
      expect(ErpConnectorFactory.getConnector("netsuite")).toBeInstanceOf(NetSuiteErpConnector);
      expect(ErpConnectorFactory.getConnector("sap")).toBeInstanceOf(SapS4HanaConnector);
      expect(ErpConnectorFactory.getConnector("sandbox")).toBeInstanceOf(SandboxErpConnector);
    });
  });

  // =========================================================================
  // WORKFLOW 4: Sequential Legacy Multi-Agent Workflow (POProcessingWorkflow)
  // =========================================================================
  describe("Workflow 4: Sequential Legacy POProcessingWorkflow", () => {
    it("4.1 Runs 5-step sequential pipeline: Extraction, Verification, Validation, Invoice PDF, Verification & Completion", async () => {
      const tenantId = "tenant_seq_wf";
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-SEQ-001",
        customerName: "Sequential Testing Inc",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "PROCESSING",
        s3Key: "pos/seq.pdf",
        documentName: "seq.pdf",
        documentSize: 2048,
        contentType: "application/pdf"
      });

      await POProcessingWorkflow.runWorkflow(tenantId, po._id.toString());

      const completedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
      expect(completedPo?.status).toBe("COMPLETED");

      const invoice = await InvoiceRepository.findByPoId(tenantId, po._id.toString());
      expect(invoice).toBeDefined();
      expect(invoice?.status).toBe("ISSUED");
      expect(invoice?.s3PdfKey).toBeDefined();
      expect(invoice?.lineItems.length).toBeGreaterThan(0);
    });

    it("4.2 Human Review Gate halts immediately when PO is marked REJECTED", async () => {
      const tenantId = "tenant_seq_reject";
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-SEQ-REJECT",
        customerName: "Reject Corp",
        gstNumber: "27AABCU9603R1ZM",
        currency: "INR",
        status: "REJECTED",
        s3Key: "pos/reject.pdf",
        documentName: "reject.pdf",
        documentSize: 1024,
        contentType: "application/pdf"
      });

      await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: po._id.toString(),
        stage: "validation",
        status: "REJECTED",
        priority: "HIGH",
        reason: "Customer order cancelled"
      });

      await POProcessingWorkflow.runWorkflow(tenantId, po._id.toString());

      const afterPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
      expect(afterPo?.status).toBe("REJECTED");

      const invoice = await InvoiceRepository.findByPoId(tenantId, po._id.toString());
      expect(invoice).toBeNull();
    });
  });

  // =========================================================================
  // WORKFLOW 5: Background Queue Worker Workflow
  // =========================================================================
  describe("Workflow 5: Background Queue Dispatcher Workflow", () => {
    it("5.1 Inspects queue health status and telemetry structure", () => {
      const health = QueueManager.getHealthStatus();
      expect(health).toHaveProperty("status");
      expect(health).toHaveProperty("mode");
      expect(health).toHaveProperty("provider");
      expect(health).toHaveProperty("connectionType");
      expect(typeof health.isConfigured).toBe("boolean");
    });

    it("5.2 Dispatches asynchronous PO processing job and returns composite jobId", async () => {
      const tenantId = "tenant_queue_job";
      const poId = "po_async_test_99";

      const jobId = await QueueManager.addPOProcessingJob(tenantId, poId);

      expect(jobId).toBeDefined();
      expect(jobId).toContain(tenantId);
      expect(jobId).toContain(poId);
    });
  });
});
