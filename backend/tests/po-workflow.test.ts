import { describe, it, expect, beforeEach } from "vitest";
import { POProcessingWorkflow } from "../src/agents/workflow.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  InvoiceRepository,
  CustomerRepository,
  ProductRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { StorageService } from "../src/storage/s3.service.js";
import { QdrantService } from "../src/rag/qdrant.service.js";

describe("PO-to-Invoice Agentic Workflow Execution", () => {
  const tenantId = "test_tenant_workflow";

  beforeEach(() => {
    QdrantService.clearMockStore();
    clearTestRepositories();
  });

  it("processes a valid PO end-to-end through Extraction, Validation, and Invoice Issuance", async () => {
    // No catalog seeding needed: when a product SKU is not in the catalog, the matching agent
    // uses the extracted unit price as the baseline (0% variance) so the pipeline completes.

    // 1. Upload mock file to storage
    const upload = await StorageService.uploadFile(
      tenantId,
      "pos",
      "po_test_1",
      "test_order.pdf",
      Buffer.from("%PDF-1.4 Mock PO"),
      "application/pdf"
    );


    // 2. Create initial PO
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-778899",
      customerName: "Acme Global Industries",
      gstNumber: "27AABCU9603R1ZM",
      status: "UPLOADED",
      s3Key: upload.s3Key,
      documentName: "test_order.pdf",
      documentSize: upload.sizeBytes,
      contentType: "application/pdf"
    });

    // 3. Run workflow
    await POProcessingWorkflow.runWorkflow(tenantId, po._id.toString());

    // 4. Verify PO transitioned to COMPLETED
    const updatedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(updatedPo).toBeDefined();
    expect(updatedPo!.status).toBe("COMPLETED");
    expect(updatedPo!.lineItems.length).toBeGreaterThan(0);
    expect(updatedPo!.totalAmount).toBeGreaterThan(0);

    // 5. Verify Invoice was generated and ISSUED
    const invoice = await InvoiceRepository.findByPoId(tenantId, po._id.toString());
    expect(invoice).toBeDefined();
    expect(invoice!.status).toBe("ISSUED");
    expect(invoice!.s3PdfKey).toBeDefined();
    expect(invoice!.totalAmount).toBe(updatedPo!.totalAmount);
  });


  it("detects price mismatch and routes to Human Review in validation stage with evidence array", async () => {
    // Seed product with catalog price of $500
    await ProductRepository.create(tenantId, {
      sku: "PROD-CLOUD-01",
      name: "Enterprise Cloud Hosting",
      basePrice: 500.0
    });

    // Index a policy clause for variance tolerance in Qdrant
    await QdrantService.indexChunks([
      {
        chunkId: "policy_pricing_1",
        tenantId,
        documentId: "pol_1",
        documentName: "Corporate Procurement Policy 2026",
        documentType: "POLICY",
        section: "Section 4.1 Price Deviations",
        pageNumber: 5,
        content: "Maximum allowable price variance without manual executive approval is 10%."
      }
    ]);

    const upload = await StorageService.uploadFile(
      tenantId,
      "pos",
      "po_test_variance",
      "variance_order.pdf",
      Buffer.from("%PDF-1.4 Mock PO"),
      "application/pdf"
    );

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-VARIANCE-01",
      customerName: "Acme Global Industries",
      gstNumber: "27AABCU9603R1ZM",
      status: "UPLOADED",
      s3Key: upload.s3Key,
      documentName: "variance_order.pdf",
      documentSize: upload.sizeBytes,
      contentType: "application/pdf"
    });

    await POProcessingWorkflow.runWorkflow(tenantId, po._id.toString());

    // PO extracted price is $1200 vs catalog $500 (> 100% variance) -> must halt at HUMAN_REVIEW
    const updatedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(updatedPo!.status).toBe("HUMAN_REVIEW");

    // Review record must exist with stage: 'validation' and non-empty evidence list
    const reviews = await ReviewRepository.findByEntityId(tenantId, po._id.toString());
    expect(reviews.length).toBeGreaterThan(0);
    const review = reviews[0];
    expect(review.stage).toBe("validation");
    expect(review.status).toBe("PENDING");
    expect(review.requestedByAgent).toBe("ValidationAgent");
    expect(Array.isArray(review.evidence)).toBe(true);

    // Human Approves the exception
    await ReviewRepository.resolveReview(tenantId, review._id.toString(), "APPROVED", "Approved override", "admin@p2i.ai");
    await PurchaseOrderRepository.updateStatus(tenantId, po._id.toString(), "APPROVED");
    await POProcessingWorkflow.runWorkflow(tenantId, po._id.toString());

    // PO should now advance and complete
    const finalPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(finalPo!.status).toBe("COMPLETED");
  });
});
