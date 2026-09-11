import { env } from "../src/config/env.js";
env.DOCUMENT_AI_PROVIDER = "mock";
import { createApp } from "../src/app.js";
import request from "supertest";
import { AuthService } from "../src/auth/jwt.js";
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
import { DocumentChunk } from "../src/rag/chunking.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import { createExceptionNode } from "../src/ai/workflow/exception/exception.agent.js";
import { WorkflowState } from "../src/ai/workflow/state.js";

async function runAll7Repros() {
  const results: any[] = [];
  const app = createApp();

  // ==========================================
  // REPRO 1 (BLOCKER) - Arithmetic Invariance Under Human Approval
  // ==========================================
  clearTestRepositories();
  const t1 = "tenant_repro_1";
  const revToken = AuthService.generateTokens({
    id: "user_r1",
    tenantId: t1,
    email: "reviewer@r1.com",
    name: "Rev 1",
    role: "REVIEWER"
  }).accessToken;

  const po1 = await PurchaseOrderRepository.create(t1, {
    poNumber: "PO-REPRO-01",
    customerName: "Acme Arithmetic",
    gstNumber: "27AABCU9603R1ZM",
    currency: "INR",
    status: "HUMAN_REVIEW",
    s3Key: "pos/repro1.pdf",
    documentName: "repro1.pdf",
    documentSize: 1024,
    contentType: "application/pdf",
    subtotal: 1000,
    tax: 180,
    discount: 0,
    totalAmount: 1180,
    extractionConfidence: 0.6
  });

  const rev1 = await ReviewRepository.create(t1, {
    entity: "purchase_order",
    entityId: po1._id.toString(),
    stage: "extraction",
    status: "PENDING",
    priority: "HIGH",
    reason: "Low OCR confidence"
  });

  await request(app)
    .post(`/api/v1/reviews/${rev1._id.toString()}/resolve`)
    .set("Authorization", `Bearer ${revToken}`)
    .send({
      decision: "APPROVED",
      correctedLineItems: [
        {
          lineNumber: 1,
          productCode: "WIDGET-BAD",
          description: "Bad Math Widget",
          quantity: 10,
          unitPrice: 100,
          lineTotal: 99999,
          taxRate: 18
        }
      ]
    });

  const wf1 = await runOrchestrationWorkflow(t1, po1._id.toString());
  const invoice1 = await InvoiceRepository.findByPoId(t1, po1._id.toString());
  results.push({
    step: 1,
    name: "Arithmetic Invariance Survival",
    reproBefore: "Auto-approved & posted $99,999 to ERP despite 10*100!=99999",
    reproAfter: `Halted at '${wf1.currentStep}' with errors: [${wf1.validationErrors.join("; ")}]. Invoice created: ${invoice1 !== null}`,
    verdict: wf1.isBusinessException && invoice1 === null ? "PASS" : "FAIL"
  });

  // ==========================================
  // REPRO 2 (HIGH) - Duplicate PO Concurrency Race
  // ==========================================
  clearTestRepositories();
  const t2 = "tenant_repro_2";
  const userToken2 = AuthService.generateTokens({
    id: "user_r2",
    tenantId: t2,
    email: "admin@r2.com",
    name: "Admin 2",
    role: "ADMIN"
  }).accessToken;

  let r2Success = 0;
  let r2Duplicate = 0;
  for (let i = 1; i <= 20; i++) {
    const dupPo = `PO-RACE-SEQ-${i}`;
    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/v1/pos")
        .set("Authorization", `Bearer ${userToken2}`)
        .field("poNumber", dupPo)
        .attach("file", Buffer.from("%PDF-1.4 Mock"), `f_${i}_a.pdf`),
      request(app)
        .post("/api/v1/pos")
        .set("Authorization", `Bearer ${userToken2}`)
        .field("poNumber", dupPo)
        .attach("file", Buffer.from("%PDF-1.4 Mock"), `f_${i}_b.pdf`)
    ]);
    const codes = [resA.status, resB.status].sort();
    if (codes[0] === 202 && codes[1] === 409) {
      r2Success++;
      const conflict = resA.status === 409 ? resA : resB;
      if (conflict.body.code === "DUPLICATE_PO_NUMBER") r2Duplicate++;
    }
  }
  results.push({
    step: 2,
    name: "Duplicate PO Concurrency Race",
    reproBefore: "Both concurrent requests inserted duplicate records (202/202)",
    reproAfter: `Across 20 concurrent pairs: exactly one succeeded (202) and one returned 409 DUPLICATE_PO_NUMBER in ${r2Success}/20 iterations`,
    verdict: r2Success === 20 && r2Duplicate === 20 ? "PASS" : "FAIL"
  });

  // ==========================================
  // REPRO 3 (HIGH) - Temporal Filtering on Contract RAG
  // ==========================================
  clearTestRepositories();
  QdrantService.clearMockStore();
  const t3 = "tenant_repro_3";
  const cust3 = await CustomerRepository.create(t3, {
    name: "Temporal Corp",
    code: "TEMPORAL",
    gstNumber: "27AABCU1111A1Z1",
    currency: "USD"
  });
  await ProductRepository.create(t3, { sku: "SKU-TEMP", name: "Temp Widget", basePrice: 100 });
  const expContract = await ContractRepository.create(t3, {
    customerId: cust3._id.toString(),
    contractNumber: "CTR-2023",
    effectiveFrom: new Date("2022-01-01T00:00:00Z"),
    effectiveTo: new Date("2023-12-31T23:59:59Z"),
    status: "EXPIRED"
  });
  await QdrantService.indexChunks([
    {
      chunkId: "c_exp_1",
      tenantId: t3,
      documentId: expContract._id.toString(),
      documentName: "Contract_2023.pdf",
      documentType: "CONTRACT",
      customerId: cust3._id.toString(),
      section: "Sec 4 Pricing",
      pageNumber: 1,
      content: "Discount tier for SKU-TEMP: 50% discount ($50 unit price)"
    }
  ]);
  const po3 = await PurchaseOrderRepository.create(t3, {
    poNumber: "PO-TEMP-2026",
    customerName: "Temporal Corp",
    customerId: cust3._id.toString(),
    gstNumber: "27AABCU1111A1Z1",
    currency: "USD",
    issueDate: new Date("2026-06-01T00:00:00Z"),
    status: "EXTRACTED",
    s3Key: "pos/p3.pdf",
    documentName: "p3.pdf",
    documentSize: 1024,
    contentType: "application/pdf",
    subtotal: 500,
    tax: 0,
    discount: 0,
    totalAmount: 500,
    extractionConfidence: 1.0,
    lineItems: [{ lineNumber: 1, productCode: "SKU-TEMP", description: "Temp", quantity: 10, unitPrice: 50, lineTotal: 500, taxRate: 0 }]
  });
  const wf3 = await runOrchestrationWorkflow(t3, po3._id.toString());
  results.push({
    step: 3,
    name: "Contract RAG Temporal Filtering",
    reproBefore: "Expired 2023 50% discount clause matched and auto-approved in 2026",
    reproAfter: `Expired clause filtered out (noActiveContract: ${wf3.noActiveContract}). Workflow routed to '${wf3.currentStep}' with exception: ${wf3.isBusinessException}`,
    verdict: wf3.isBusinessException && wf3.noActiveContract ? "PASS" : "FAIL"
  });

  // ==========================================
  // REPRO 4 (HIGH) - Reject Multi-Currency Flat Summation
  // ==========================================
  clearTestRepositories();
  const t4 = "tenant_repro_4";
  const po4 = await PurchaseOrderRepository.create(t4, {
    poNumber: "PO-CURR-MIX",
    customerName: "Multi Currency Corp",
    gstNumber: "27AABCU9603R1ZM",
    currency: "INR",
    status: "EXTRACTED",
    s3Key: "pos/p4.pdf",
    documentName: "p4.pdf",
    documentSize: 1024,
    contentType: "application/pdf",
    subtotal: 8400,
    tax: 0,
    discount: 0,
    totalAmount: 8400,
    extractionConfidence: 1.0,
    lineItems: [
      { lineNumber: 1, productCode: "USD-ITEM", description: "US Item", quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 0, currency: "USD" },
      { lineNumber: 2, productCode: "INR-ITEM", description: "IN Item", quantity: 1, unitPrice: 8300, lineTotal: 8300, taxRate: 0, currency: "INR" }
    ]
  });
  const wf4 = await runOrchestrationWorkflow(t4, po4._id.toString());
  results.push({
    step: 4,
    name: "Multi-Currency Mixed Summation Rejection",
    reproBefore: "Silently summed 100 USD + 8300 INR into wrong subtotal 8400 INR",
    reproAfter: `Halted with errors: [${wf4.validationErrors.join("; ")}] and routed to '${wf4.currentStep}'`,
    verdict: wf4.isBusinessException && wf4.validationErrors.some(e => e.includes("CURRENCY_MISMATCH")) ? "PASS" : "FAIL"
  });

  // ==========================================
  // REPRO 5 (MEDIUM) - Uncataloged SKU Threshold
  // ==========================================
  clearTestRepositories();
  const t5 = "tenant_repro_5";
  const cust5 = await CustomerRepository.create(t5, { name: "Ghost Buyer", code: "GHOST", gstNumber: "27AABCU9603R1ZM", currency: "USD" });
  const po5 = await PurchaseOrderRepository.create(t5, {
    poNumber: "PO-GHOST-SKU",
    customerName: "Ghost Buyer",
    customerId: cust5._id.toString(),
    gstNumber: "27AABCU9603R1ZM",
    currency: "USD",
    status: "EXTRACTED",
    s3Key: "pos/p5.pdf",
    documentName: "p5.pdf",
    documentSize: 1024,
    contentType: "application/pdf",
    subtotal: 1000000,
    tax: 0,
    discount: 0,
    totalAmount: 1000000,
    extractionConfidence: 1.0,
    lineItems: [{ lineNumber: 1, productCode: "GHOST-SKU-999", description: "Ghost Turbine", quantity: 1, unitPrice: 1000000, lineTotal: 1000000, taxRate: 0 }]
  });
  const wf5 = await runOrchestrationWorkflow(t5, po5._id.toString());
  results.push({
    step: 5,
    name: "Uncataloged SKU Threshold Protection",
    reproBefore: "Ghost SKU at $1,000,000 auto-approved with 0% computed variance",
    reproAfter: `Flagged for catalog review (errors: [${wf5.validationErrors.join("; ")}]) and routed to '${wf5.currentStep}'`,
    verdict: wf5.isBusinessException && wf5.validationErrors.some(e => e.includes("GHOST-SKU-999")) ? "PASS" : "FAIL"
  });

  // ==========================================
  // REPRO 6 (MEDIUM) - Ambiguous Customer Disambiguation
  // ==========================================
  clearTestRepositories();
  const t6 = "tenant_repro_6";
  await CustomerRepository.create(t6, { name: "Acme Corp", code: "ACME-1", gstNumber: "27AABCA1111A1Z1", currency: "INR" });
  await CustomerRepository.create(t6, { name: "Acme Corp", code: "ACME-2", gstNumber: "29AABCA2222B1Z2", currency: "INR" });
  const po6 = await PurchaseOrderRepository.create(t6, {
    poNumber: "PO-AMBIG-CUST",
    customerName: "Acme Corp",
    gstNumber: "",
    currency: "INR",
    status: "EXTRACTED",
    s3Key: "pos/p6.pdf",
    documentName: "p6.pdf",
    documentSize: 1024,
    contentType: "application/pdf",
    subtotal: 100,
    tax: 0,
    discount: 0,
    totalAmount: 100,
    extractionConfidence: 1.0,
    lineItems: [{ lineNumber: 1, productCode: "SKU-1", description: "Item 1", quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 0 }]
  });
  const wf6 = await runOrchestrationWorkflow(t6, po6._id.toString());
  results.push({
    step: 6,
    name: "Ambiguous Customer Match Escalation",
    reproBefore: "Arbitrarily linked to first returned Mongo customer record",
    reproAfter: `Detected multiple matches and routed to '${wf6.currentStep}' listing candidate GSTINs: [${wf6.validationErrors.join("; ")}]`,
    verdict: wf6.isBusinessException && wf6.validationErrors.some(e => e.includes("CUSTOMER_AMBIGUITY")) ? "PASS" : "FAIL"
  });

  // ==========================================
  // REPRO 7 (HIGH) - Evidence Merging on Review Ticket Update
  // ==========================================
  clearTestRepositories();
  const t7 = "tenant_repro_7";
  const po7 = await PurchaseOrderRepository.create(t7, {
    poNumber: "PO-EV-MERGE",
    customerName: "Evidence Corp",
    gstNumber: "27AABCU9603R1ZM",
    currency: "USD",
    status: "PROCESSING",
    s3Key: "pos/p7.pdf",
    documentName: "p7.pdf",
    documentSize: 1024,
    contentType: "application/pdf"
  });
  const exNode = createExceptionNode(t7);
  const baseState: WorkflowState = {
    tenantId: t7,
    poId: po7._id.toString(),
    workflowId: "wf_7",
    documentName: "p7.pdf",
    s3Key: "pos/p7.pdf",
    currentStep: "extraction",
    status: "PROCESSING",
    toolCallCount: 0,
    validationChecks: [],
    validationErrors: ["Low OCR score"],
    evidence: [{ sourceType: "CONTRACT", documentId: "d1", documentName: "d1.pdf", pageNumber: 1, section: "Sec 1", chunkId: "c_ocr_1", claim: "OCR score 60%" }],
    policySourceReferences: [],
    matchedLineItems: [],
    approvalRequired: false,
    isBusinessException: true,
    allowedVariancePct: 10,
    stepRetries: {},
    isHumanApproved: false,
    skipValidation: false
  };
  await exNode(baseState);
  await exNode({
    ...baseState,
    currentStep: "policy_evaluation",
    validationErrors: ["Pricing variance"],
    evidence: [{ sourceType: "CONTRACT", documentId: "d2", documentName: "d2.pdf", pageNumber: 2, section: "Sec 2", chunkId: "c_price_2", claim: "Price tier 10%" }]
  });
  const rev7 = await ReviewRepository.findPendingByEntityId(t7, po7._id.toString());
  const evidenceCount = rev7?.evidence.length || 0;
  const chunkIds = rev7?.evidence.map(e => e.chunkId) || [];
  results.push({
    step: 7,
    name: "Review Evidence Merging",
    reproBefore: "Second exception update erased original evidence item",
    reproAfter: `Review ticket preserved both distinct evidence chunks: [${chunkIds.join(", ")}] (count: ${evidenceCount})`,
    verdict: evidenceCount === 2 && chunkIds.includes("c_ocr_1") && chunkIds.includes("c_price_2") ? "PASS" : "FAIL"
  });

  console.log("\n=======================================================");
  console.log("FINAL SEQUENTIAL REPRODUCTION VERIFICATION RESULTS");
  console.log("=======================================================");
  for (const r of results) {
    console.log(`[STEP ${r.step}] ${r.name}: ${r.verdict}`);
    console.log(`  BEFORE: ${r.reproBefore}`);
    console.log(`  AFTER:  ${r.reproAfter}\n`);
  }
}

runAll7Repros().catch(console.error);
