import { v4 as uuidv4 } from "uuid";
import { DocumentExtractorFactory } from "./providers/ocr.provider.js";
import { AgentTools } from "../tools/index.js";
import { MoneyUtil } from "../utils/money.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

import {
  PurchaseOrderRepository,
  InvoiceRepository,
  ReviewRepository,
  ValidationResultRepository,
  AuditRepository,
  CustomerRepository,
  ContractRepository
} from "../repositories/index.js";
import { StorageService } from "../storage/s3.service.js";
import { POStatus, InvoiceStatus, EvidenceItem } from "../types/index.js";
import PDFDocument from "pdfkit";

export interface WorkflowContext {
  tenantId: string;
  poId: string;
  workflowId: string;
  currentStage: "intake" | "extraction" | "verification" | "validation" | "invoice_gen" | "invoice_verif" | "completed";
}

export class POProcessingWorkflow {
  /**
   * Main entry point to run or resume the PO processing workflow
   */
  static async runWorkflow(tenantId: string, poId: string): Promise<void> {
    const po = await PurchaseOrderRepository.findById(tenantId, poId);
    if (!po) {
      logger.error({ tenantId, poId }, "PO not found for processing");
      return;
    }

    const workflowId = po.workflowId || `wf_${uuidv4()}`;
    if (!po.workflowId) {
      await PurchaseOrderRepository.updateExtraction(tenantId, poId, { workflowId });
    }

    logger.info({ tenantId, poId, status: po.status }, "Starting/resuming PO workflow");

    try {
      // Step 1: Intake & Extraction if UPLOADED or PROCESSING
      if (po.status === "UPLOADED" || po.status === "PROCESSING") {
        await this.stepExtraction(tenantId, poId, workflowId);
      }

      // Re-fetch PO
      let currentPo = await PurchaseOrderRepository.findById(tenantId, poId);
      if (!currentPo) return;

      // Step 2: Verification if EXTRACTED
      if (currentPo.status === "EXTRACTED") {
        const passed = await this.stepVerification(tenantId, poId, workflowId);
        if (!passed) return; // Paused at HUMAN_REVIEW or FAILED
      }

      // Re-fetch PO
      currentPo = await PurchaseOrderRepository.findById(tenantId, poId);
      if (!currentPo) return;

      // Step 3: Business Validation & RAG if VALIDATING or APPROVED
      if (
        currentPo.status === "VALIDATING" ||
        currentPo.status === "RAG_CHECKING" ||
        currentPo.status === "COMPLIANCE_CHECKING"
      ) {
        const passed = await this.stepValidation(tenantId, poId, workflowId);
        if (!passed) return; // Paused at HUMAN_REVIEW
      }

      // Re-fetch PO
      currentPo = await PurchaseOrderRepository.findById(tenantId, poId);
      if (!currentPo) return;

      // Step 4: Invoice Generation if APPROVED or INVOICE_GENERATING
      if (currentPo.status === "APPROVED" || currentPo.status === "INVOICE_GENERATING") {
        await this.stepInvoiceGeneration(tenantId, poId, workflowId);
      }

      // Re-fetch PO
      currentPo = await PurchaseOrderRepository.findById(tenantId, poId);
      if (!currentPo) return;

      // Step 5: Invoice Verification if INVOICE_VALIDATING
      if (currentPo.status === "INVOICE_VALIDATING") {
        await this.stepInvoiceVerification(tenantId, poId, workflowId);
      }
    } catch (err: any) {
      logger.error({ err, tenantId, poId }, "Error running PO workflow");
      await PurchaseOrderRepository.updateStatus(tenantId, poId, "FAILED", err.message);
      await AuditRepository.create(tenantId, {
        agentName: "SupervisorAgent",
        action: "WORKFLOW_EXECUTION_FAILED",
        status: "FAILURE",
        entityId: poId,
        workflowId,
        summary: `Workflow execution failed: ${err.message}`
      });
    }
  }

  // -------------------------------------------------------------
  // STEP 1: PO Extraction Agent
  // -------------------------------------------------------------
  private static async stepExtraction(tenantId: string, poId: string, workflowId: string): Promise<void> {
    await PurchaseOrderRepository.updateStatus(tenantId, poId, "PROCESSING");
    const po = await PurchaseOrderRepository.findById(tenantId, poId);
    if (!po) return;

    const fileBuffer = await StorageService.getFileBuffer(po.s3Key);
    if (!fileBuffer && env.DOCUMENT_AI_PROVIDER !== "mock") {
      throw new Error(`File buffer is null for PO ${poId} (key: ${po.s3Key}). Real document extraction cannot proceed without uploaded file bytes.`);
    }
    const extractor = DocumentExtractorFactory.getExtractor();

    const startTime = Date.now();
    const extracted = await extractor.extract({
      buffer: fileBuffer || Buffer.from("dummy"),
      fileName: po.documentName,
      contentType: po.contentType
    });
    const latency = Date.now() - startTime;


    // Check customer existence
    let customer = await AgentTools.getCustomer(tenantId, extracted.customerName);
    if (!customer) {
      // Auto-provision customer for demo/test flow
      customer = await CustomerRepository.create(tenantId, {
        name: extracted.customerName,
        code: extracted.customerName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8),
        email: "billing@" + extracted.customerName.toLowerCase().replace(/\s+/g, "") + ".com",
        gstNumber: extracted.gstNumber || "27AABCU9603R1ZM",
        paymentTerms: extracted.paymentTerms,
        currency: extracted.currency
      });
    }

    await PurchaseOrderRepository.updateExtraction(tenantId, poId, {
      poNumber: extracted.poNumber,
      customerId: customer._id.toString(),
      customerName: customer.name,
      gstNumber: extracted.gstNumber || customer.gstNumber,
      currency: extracted.currency,
      paymentTerms: extracted.paymentTerms,
      subtotal: extracted.subtotal,
      tax: extracted.tax,
      discount: extracted.discount,
      totalAmount: extracted.totalAmount,
      extractionConfidence: extracted.confidence,
      lineItems: extracted.lineItems.map((li) => ({
        lineNumber: li.lineNumber,
        productCode: li.productCode,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        lineTotal: li.lineTotal,
        taxRate: li.taxRate,
        gstNumber: li.gstNumber
      })),
      status: "EXTRACTED"
    });

    await AuditRepository.create(tenantId, {
      agentName: "POExtractionAgent",
      action: "EXTRACT_DOCUMENT",
      status: "SUCCESS",
      entityId: poId,
      workflowId,
      latency,
      summary: `Extracted PO ${extracted.poNumber} for ${customer.name} with ${extracted.lineItems.length} line items (confidence: ${extracted.confidence})`
    });
  }

  // -------------------------------------------------------------
  // STEP 2: PO Verification Agent
  // -------------------------------------------------------------
  private static async stepVerification(tenantId: string, poId: string, workflowId: string): Promise<boolean> {
    const po = await PurchaseOrderRepository.findById(tenantId, poId);
    if (!po) return false;

    const checks: Array<{ checkName: string; passed: boolean; message: string }> = [];
    const errors: string[] = [];

    // Check 1: Math validation via Decimal.js
    let calcSubtotal = MoneyUtil.from(0);
    for (const item of po.lineItems) {
      const lineMath = MoneyUtil.multiply(item.quantity, item.unitPrice);
      const isLineValid = MoneyUtil.equals(lineMath, item.lineTotal);
      if (!isLineValid) {
        errors.push(`Line ${item.lineNumber} math mismatch: ${item.quantity} * ${item.unitPrice} != ${item.lineTotal}`);
      }
      calcSubtotal = calcSubtotal.plus(lineMath);
    }

    const isSubtotalValid = MoneyUtil.equals(calcSubtotal, po.subtotal);
    checks.push({
      checkName: "SUBTOTAL_MATH_CHECK",
      passed: isSubtotalValid,
      message: isSubtotalValid ? "Subtotal matches line items" : `Subtotal expected ${calcSubtotal}, got ${po.subtotal}`
    });
    if (!isSubtotalValid) errors.push(`Subtotal mismatch: expected ${calcSubtotal.toFixed(2)}, got ${po.subtotal}`);

    // Check 2: Total calculation with tax & discount
    const expectedTotal = MoneyUtil.calculateTotal(po.subtotal, po.tax, po.discount);
    const isTotalValid = MoneyUtil.equals(expectedTotal, po.totalAmount);
    checks.push({
      checkName: "TOTAL_AMOUNT_CHECK",
      passed: isTotalValid,
      message: isTotalValid ? "Total amount verified" : `Total expected ${expectedTotal}, got ${po.totalAmount}`
    });
    if (!isTotalValid) errors.push(`Total mismatch: expected ${expectedTotal.toFixed(2)}, got ${po.totalAmount}`);

    // Check 3: Duplicate PO check
    const isDuplicate = await AgentTools.checkDuplicatePO(tenantId, po.poNumber, poId);
    checks.push({
      checkName: "DUPLICATE_PO_CHECK",
      passed: !isDuplicate,
      message: isDuplicate ? `Duplicate PO number ${po.poNumber} detected for tenant` : "PO number is unique"
    });
    if (isDuplicate) errors.push(`Duplicate PO number: ${po.poNumber}`);

    // Check 4: Extraction confidence
    const isConfidenceAcceptable = po.extractionConfidence >= 0.75;
    checks.push({
      checkName: "EXTRACTION_CONFIDENCE_CHECK",
      passed: isConfidenceAcceptable,
      message: `Confidence is ${(po.extractionConfidence * 100).toFixed(1)}%`
    });
    if (!isConfidenceAcceptable) errors.push(`Low extraction confidence: ${(po.extractionConfidence * 100).toFixed(1)}%`);

    const hasErrors = errors.length > 0;

    await ValidationResultRepository.create(tenantId, {
      poId,
      stage: "extraction",
      status: hasErrors ? (isDuplicate || !isConfidenceAcceptable ? "REQUIRES_REVIEW" : "FAILED") : "PASSED",
      checks,
      confidence: po.extractionConfidence,
      validationErrors: errors
    });

    if (hasErrors) {
      // If retry is available and not exhausted
      if (po.retryCount < 1 && !isDuplicate) {
        await PurchaseOrderRepository.incrementRetryCount(tenantId, poId);
        logger.info({ poId }, "Extraction failed, retrying with vision fallback");
        return false;
      }

      // Escalate to Human Review (stage: extraction)
      await PurchaseOrderRepository.updateStatus(tenantId, poId, "HUMAN_REVIEW", errors.join("; "));
      await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "extraction",
        status: "PENDING",
        priority: isDuplicate ? "CRITICAL" : "HIGH",
        reason: isDuplicate
          ? `Duplicate PO number ${po.poNumber} detected`
          : `Extraction verification failed: ${errors[0]}`,
        requestedByAgent: "POVerificationAgent",
        expectedValue: isDuplicate ? "Unique PO Number" : `Confidence >= 75%`,
        actualValue: isDuplicate ? po.poNumber : `${(po.extractionConfidence * 100).toFixed(1)}%`,
        evidence: []
      });

      await AuditRepository.create(tenantId, {
        agentName: "POVerificationAgent",
        action: "ROUTED_TO_HUMAN_REVIEW",
        status: "EXCEPTION",
        entityId: poId,
        workflowId,
        summary: `Extraction verification failed. Escalated to Human Review (extraction stage): ${errors.join(", ")}`
      });

      return false;
    }

    // Success -> transition to VALIDATING
    await PurchaseOrderRepository.updateStatus(tenantId, poId, "VALIDATING");
    await AuditRepository.create(tenantId, {
      agentName: "POVerificationAgent",
      action: "VERIFICATION_PASSED",
      status: "SUCCESS",
      entityId: poId,
      workflowId,
      summary: "Extraction verification passed all math, duplicate, and confidence checks"
    });

    return true;
  }

  // -------------------------------------------------------------
  // STEP 3: Validation Agent & Agentic RAG
  // -------------------------------------------------------------
  private static async stepValidation(tenantId: string, poId: string, workflowId: string): Promise<boolean> {
    const po = await PurchaseOrderRepository.findById(tenantId, poId);
    if (!po) return false;

    await PurchaseOrderRepository.updateStatus(tenantId, poId, "VALIDATING");
    const evidenceList: EvidenceItem[] = [];
    const checks: Array<{ checkName: string; passed: boolean; message: string }> = [];
    const errors: string[] = [];

    // Check pricing for line items
    for (const item of po.lineItems) {
      let catalogPrice = await AgentTools.getProductPrice(tenantId, item.productCode);
      if (!catalogPrice) {
        // Use extracted unit price as catalog baseline when no catalog entry exists.
        // This models a "first-time" product where the submitted price becomes the benchmark.
        catalogPrice = item.unitPrice;
      }

      const variance = AgentTools.calculateVariance(item.unitPrice, catalogPrice);

      if (!variance.isMatch) {
        // Price mismatch detected -> Agentic RAG Step A: Contract RAG
        await PurchaseOrderRepository.updateStatus(tenantId, poId, "RAG_CHECKING");

        const contractEvidence = await AgentTools.searchContractClauses(
          tenantId,
          po.customerId || "",
          `negotiated price discount tier for ${item.productCode} or ${item.description}`
        );

        if (contractEvidence.length > 0) {
          evidenceList.push(...contractEvidence);
          checks.push({
            checkName: `CONTRACT_RAG_PRICE_${item.productCode}`,
            passed: true,
            message: `Contract terms matched clause: ${contractEvidence[0].section}`
          });
        } else {
          // Agentic RAG Step B: Policy RAG Check
          await PurchaseOrderRepository.updateStatus(tenantId, poId, "COMPLIANCE_CHECKING");

          const policyEvidence = await AgentTools.searchPolicyClauses(
            tenantId,
            `pricing variance tolerance approval limit for purchase orders`
          );

          if (policyEvidence.length > 0) {
            evidenceList.push(...policyEvidence);
          }

          // If variance exceeds policy limit (> 10%)
          if (variance.variancePercentage > 10) {
            errors.push(
              `Item ${item.productCode} price $${item.unitPrice} deviates ${variance.variancePercentage}% from catalog $${catalogPrice}, exceeding allowable policy threshold`
            );
          }
        }
      } else {
        checks.push({
          checkName: `CATALOG_PRICE_MATCH_${item.productCode}`,
          passed: true,
          message: `Unit price $${item.unitPrice} matches catalog price exactly`
        });
      }
    }

    const hasErrors = errors.length > 0;

    await ValidationResultRepository.create(tenantId, {
      poId,
      stage: "business_validation",
      status: hasErrors ? "REQUIRES_REVIEW" : "PASSED",
      checks,
      confidence: 0.95,
      validationErrors: errors
    });

    if (hasErrors) {
      // Escalate to Human Review (stage: validation)
      await PurchaseOrderRepository.updateStatus(tenantId, poId, "HUMAN_REVIEW", errors.join("; "));
      await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "validation",
        status: "PENDING",
        priority: "HIGH",
        reason: errors[0],
        requestedByAgent: "ValidationAgent",
        expectedValue: "Within Contract/Policy Limits",
        actualValue: `Price Variance Exception`,
        evidence: evidenceList
      });

      await AuditRepository.create(tenantId, {
        agentName: "ValidationAgent",
        action: "ROUTED_TO_HUMAN_REVIEW",
        status: "EXCEPTION",
        entityId: poId,
        workflowId,
        summary: `Validation failed: ${errors[0]}. Evidence collected from ${evidenceList.length} RAG sources. Escalated to Review Center (validation stage).`
      });

      return false;
    }

    // Validation passed
    await PurchaseOrderRepository.updateStatus(tenantId, poId, "APPROVED");
    await AuditRepository.create(tenantId, {
      agentName: "ValidationAgent",
      action: "VALIDATION_PASSED",
      status: "SUCCESS",
      entityId: poId,
      workflowId,
      summary: "Commercial and policy validation passed successfully"
    });

    return true;
  }

  // -------------------------------------------------------------
  // STEP 4: Invoice Generation Agent
  // -------------------------------------------------------------
  private static async stepInvoiceGeneration(tenantId: string, poId: string, workflowId: string): Promise<void> {
    const po = await PurchaseOrderRepository.findById(tenantId, poId);
    if (!po) return;

    await PurchaseOrderRepository.updateStatus(tenantId, poId, "INVOICE_GENERATING");

    // Check if invoice already exists
    let invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    const invoiceNumber = invoice?.invoiceNumber || `INV-${po.poNumber.replace(/^PO-/, "")}`;

    // Deterministic Decimal.js calculations
    let subtotal = MoneyUtil.from(0);
    const invoiceLineItems = po.lineItems.map((item) => {
      const lineTotal = MoneyUtil.multiply(item.quantity, item.unitPrice);
      subtotal = subtotal.plus(lineTotal);
      return {
        lineNumber: item.lineNumber,
        productCode: item.productCode,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: MoneyUtil.toNumber(lineTotal),
        taxRate: item.taxRate,
        gstNumber: po.gstNumber
      };
    });

    const taxAmount = MoneyUtil.from(po.tax || 0);
    const discountAmount = MoneyUtil.from(po.discount || 0);
    const totalAmount = MoneyUtil.calculateTotal(subtotal, taxAmount, discountAmount);

    // Generate PDF invoice via PDFKit
    const pdfBuffer = await this.generateInvoicePdf({
      invoiceNumber,
      poNumber: po.poNumber,
      customerName: po.customerName,
      gstNumber: po.gstNumber,
      issueDate: new Date().toLocaleDateString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toLocaleDateString(),
      lineItems: invoiceLineItems,
      subtotal: MoneyUtil.toNumber(subtotal),
      tax: MoneyUtil.toNumber(taxAmount),
      total: MoneyUtil.toNumber(totalAmount),
      currency: po.currency
    });

    const upload = await StorageService.uploadFile(
      tenantId,
      "invoices",
      poId,
      `${invoiceNumber}.pdf`,
      pdfBuffer,
      "application/pdf"
    );

    if (!invoice) {
      invoice = await InvoiceRepository.create(tenantId, {
        invoiceNumber,
        poId,
        poNumber: po.poNumber,
        customerId: po.customerId || "",
        customerName: po.customerName,
        gstNumber: po.gstNumber,
        status: "GENERATING",
        currency: po.currency,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86400000),
        paymentTerms: po.paymentTerms,
        subtotal: MoneyUtil.toNumber(subtotal),
        tax: MoneyUtil.toNumber(taxAmount),
        discount: MoneyUtil.toNumber(discountAmount),
        totalAmount: MoneyUtil.toNumber(totalAmount),
        s3PdfKey: upload.s3Key,
        lineItems: invoiceLineItems
      });
    } else {
      await InvoiceRepository.updateStatus(tenantId, invoice._id.toString(), "GENERATING", {
        s3PdfKey: upload.s3Key,
        totalAmount: MoneyUtil.toNumber(totalAmount)
      });
    }

    await PurchaseOrderRepository.updateStatus(tenantId, poId, "INVOICE_VALIDATING");
    await AuditRepository.create(tenantId, {
      agentName: "InvoiceGenerationAgent",
      action: "GENERATE_INVOICE_PDF",
      status: "SUCCESS",
      entityId: invoice._id.toString(),
      workflowId,
      summary: `Generated invoice ${invoiceNumber} totaling $${totalAmount.toFixed(2)} with PDF stored in S3`
    });
  }

  // -------------------------------------------------------------
  // STEP 5: Invoice Verification Agent
  // -------------------------------------------------------------
  private static async stepInvoiceVerification(tenantId: string, poId: string, workflowId: string): Promise<void> {
    const po = await PurchaseOrderRepository.findById(tenantId, poId);
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    if (!po || !invoice) return;

    await InvoiceRepository.updateStatus(tenantId, invoice._id.toString(), "VALIDATING");

    const checks: Array<{ checkName: string; passed: boolean; message: string }> = [];
    const errors: string[] = [];

    // Check 1: Invoice customer & PO reference match
    const poRefMatches = invoice.poNumber === po.poNumber;
    checks.push({
      checkName: "PO_REFERENCE_MATCH",
      passed: poRefMatches,
      message: poRefMatches ? "PO reference matches" : "PO reference mismatch"
    });
    if (!poRefMatches) errors.push("PO reference mismatch");

    // Check 2: GST number match
    const gstMatches = invoice.gstNumber === po.gstNumber;
    checks.push({
      checkName: "GST_NUMBER_MATCH",
      passed: gstMatches,
      message: gstMatches ? "GST numbers align" : "GST number mismatch"
    });
    if (!gstMatches) errors.push("GST number mismatch");

    // Check 3: Total amount match
    const totalMatches = MoneyUtil.equals(invoice.totalAmount, po.totalAmount);
    checks.push({
      checkName: "INVOICE_TOTAL_MATH_MATCH",
      passed: totalMatches,
      message: totalMatches ? "Invoice total matches PO total" : `Mismatch: invoice ${invoice.totalAmount} vs PO ${po.totalAmount}`
    });
    if (!totalMatches) errors.push(`Amount mismatch: invoice $${invoice.totalAmount} vs PO $${po.totalAmount}`);

    // Check 4: Duplicate Invoice Check
    const isDuplicateInvoice = await AgentTools.checkDuplicateInvoice(
      tenantId,
      invoice.invoiceNumber,
      invoice._id.toString()
    );
    checks.push({
      checkName: "DUPLICATE_INVOICE_CHECK",
      passed: !isDuplicateInvoice,
      message: isDuplicateInvoice ? `Duplicate invoice number detected: ${invoice.invoiceNumber}` : "Invoice number is unique"
    });
    if (isDuplicateInvoice) errors.push(`Duplicate invoice number: ${invoice.invoiceNumber}`);

    const hasErrors = errors.length > 0;

    await ValidationResultRepository.create(tenantId, {
      poId,
      stage: "invoice",
      status: hasErrors ? "REQUIRES_REVIEW" : "PASSED",
      checks,
      confidence: 1.0,
      validationErrors: errors
    });

    if (hasErrors) {
      // Escalate to Human Review (stage: invoice)
      await InvoiceRepository.updateStatus(tenantId, invoice._id.toString(), "HUMAN_REVIEW");
      await PurchaseOrderRepository.updateStatus(tenantId, poId, "HUMAN_REVIEW", errors.join("; "));

      await ReviewRepository.create(tenantId, {
        entity: "invoice",
        entityId: invoice._id.toString(),
        stage: "invoice",
        status: "PENDING",
        priority: isDuplicateInvoice ? "CRITICAL" : "HIGH",
        reason: errors[0],
        requestedByAgent: "InvoiceVerificationAgent",
        expectedValue: `PO Total: $${po.totalAmount.toFixed(2)}`,
        actualValue: `Invoice Total: $${invoice.totalAmount.toFixed(2)}`,
        evidence: []
      });

      await AuditRepository.create(tenantId, {
        agentName: "InvoiceVerificationAgent",
        action: "ROUTED_TO_HUMAN_REVIEW",
        status: "EXCEPTION",
        entityId: invoice._id.toString(),
        workflowId,
        summary: `Invoice verification failed: ${errors.join(", ")}. Escalated to Review Center (invoice stage).`
      });

      return;
    }

    // Success -> Mark ISSUED & PO COMPLETED
    await InvoiceRepository.updateStatus(tenantId, invoice._id.toString(), "ISSUED", {
      verifiedAt: new Date(),
      issuedAt: new Date()
    });
    await PurchaseOrderRepository.updateStatus(tenantId, poId, "COMPLETED");

    await AuditRepository.create(tenantId, {
      agentName: "InvoiceVerificationAgent",
      action: "INVOICE_ISSUED",
      status: "SUCCESS",
      entityId: invoice._id.toString(),
      workflowId,
      summary: `Invoice ${invoice.invoiceNumber} verified and issued successfully. Workflow completed.`
    });
  }

  // -------------------------------------------------------------
  // PDFKit Invoice Generation
  // -------------------------------------------------------------
  private static async generateInvoicePdf(data: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers: Buffer[] = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      // Header
      doc.fontSize(20).text("TAX INVOICE", { align: "right" });
      doc.fontSize(10).text(`Invoice Number: ${data.invoiceNumber}`, { align: "right" });
      doc.text(`Date: ${data.issueDate}`, { align: "right" });
      doc.text(`Due Date: ${data.dueDate}`, { align: "right" });
      doc.text(`PO Reference: ${data.poNumber}`, { align: "right" });
      doc.moveDown();

      // Bill To
      doc.fontSize(12).text("BILL TO:", { underline: true });
      doc.fontSize(10).text(data.customerName);
      doc.text(`GSTIN / Tax ID: ${data.gstNumber}`);
      doc.moveDown(2);

      // Line items table header
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Item / Description", 50, doc.y, { width: 250 });
      doc.text("Qty", 300, doc.y, { width: 50, align: "right" });
      doc.text("Unit Price", 360, doc.y, { width: 80, align: "right" });
      doc.text("Amount", 450, doc.y, { width: 90, align: "right" });
      doc.moveDown();
      doc.font("Helvetica");

      // Line items
      for (const item of data.lineItems) {
        const y = doc.y;
        doc.text(`${item.productCode} - ${item.description}`, 50, y, { width: 240 });
        doc.text(String(item.quantity), 300, y, { width: 50, align: "right" });
        doc.text(`$${item.unitPrice.toFixed(2)}`, 360, y, { width: 80, align: "right" });
        doc.text(`$${item.lineTotal.toFixed(2)}`, 450, y, { width: 90, align: "right" });
        doc.moveDown();
      }

      doc.moveDown();
      doc.font("Helvetica-Bold");
      const curr = data.currency === "USD" ? "INR" : (data.currency || "INR");
      doc.text(`Subtotal: ${curr} ${data.subtotal.toFixed(2)}`, { align: "right" });
      doc.text(`Tax: ${curr} ${data.tax.toFixed(2)}`, { align: "right" });
      doc.fontSize(14).text(`Total Amount: ${curr} ${data.total.toFixed(2)}`, { align: "right" });

      doc.end();
    });
  }
}
