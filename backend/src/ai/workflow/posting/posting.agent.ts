import { WorkflowState } from "../state.js";
import { MoneyUtil } from "../../../utils/money.js";
import { StorageService } from "../../../storage/s3.service.js";
import {
  PurchaseOrderRepository,
  InvoiceRepository,
  AuditRepository
} from "../../../repositories/index.js";
import { MockErpClient, getTenantErpConnector } from "./erp-connectors.js";
import PDFDocument from "pdfkit";
import { logger } from "../../../utils/logger.js";

// Re-export connector types so consumers only need one import path
export type { ErpConnector, ErpInvoicePayload, MockErpVoucher } from "./erp-connectors.js";
export { MockErpConnector, NetSuiteErpConnector, SapS4HanaConnector, ErpConnectorFactory, MockErpClient, getTenantErpConnector } from "./erp-connectors.js";

/**
 * Agent 7: Posting / ERP Agent (100% Deterministic TypeScript)
 *
 * Responsibilities:
 *  1. Compute canonical Decimal.js totals from PO line items.
 *  2. Generate a PDF invoice with PDFKit and upload to S3.
 *  3. Create or update the canonical Invoice record.
 *  4. Post the invoice to the configured ERP connector.
 *  5. Mark PO COMPLETED and write an audit log.
 */
export function createPostingNode(tenantId: string) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    logger.info({ tenantId, poId: state.poId }, "PostingAgent: Generating invoice & posting to ERP");
    const startTime = Date.now();

    const po = await PurchaseOrderRepository.findById(tenantId, state.poId);
    if (!po) {
      throw new Error(`PO not found for posting: ${state.poId}`);
    }

    // 0. Arithmetic Invariance Guard: Strictly validate qty * unitPrice == lineTotal
    const mathErrors: string[] = [];
    if (po.lineItems && po.lineItems.length > 0) {
      for (const item of po.lineItems) {
        if (item.quantity !== undefined && item.unitPrice !== undefined && item.lineTotal !== undefined) {
          const expectedLineTotal = MoneyUtil.multiply(item.quantity, item.unitPrice);
          const actualLineTotal = MoneyUtil.from(item.lineTotal);
          if (!MoneyUtil.equals(expectedLineTotal, actualLineTotal)) {
            mathErrors.push(
              `Line ${item.lineNumber || 1} math mismatch: ${item.quantity} * ${item.unitPrice} != ${item.lineTotal}`
            );
          }
        }
      }
    }

    if (mathErrors.length > 0) {
      logger.error(
        { tenantId, poId: state.poId, mathErrors },
        "PostingAgent: Arithmetic invariant check failed. Halting posting and routing to human review."
      );
      await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, state.poId, "HUMAN_REVIEW", {
        failureReason: mathErrors.join("; ")
      });
      return {
        status: "HUMAN_REVIEW",
        isBusinessException: true,
        validationErrors: mathErrors,
        currentStep: "human_review"
      };
    }

    await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "INVOICE_GENERATING");

    // 1. Establish Invoice Identification & Check for Existing Issued Invoice
    let invoice = await InvoiceRepository.findByPoId(tenantId, state.poId);
    if (invoice && invoice.status === "ISSUED") {
      logger.warn(
        { tenantId, poId: state.poId, invoiceNumber: invoice.invoiceNumber },
        "PostingAgent: Invoice already exists and is ISSUED for this PO. Aborting duplicate creation."
      );
      await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "COMPLETED");
      return {
        invoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        status: "COMPLETED",
        currentStep: "completed"
      };
    }
    const invoiceNumber = invoice?.invoiceNumber || `INV-${po.poNumber.replace(/^PO-/, "")}`;

    // 2. Compute Canonical Decimal Totals
    // -----------------------------------------------------------------------------------------------------------------
    // DECISION ON SUBTOTAL & INVOICE GENERATION:
    // Downstream invoice generation strictly calculates subtotal = sum(item.quantity * item.unitPrice) using Decimal.js.
    // Even if the vendor's raw OCR text stated a flawed total ($3,900.00), the issued invoice and ERP voucher strictly
    // reflect the verified line items ($3,800.00) + applicable statutory tax ($684.00) = $4,484.00.
    // -----------------------------------------------------------------------------------------------------------------
    const headerCurrency = (po.currency || "INR").trim().toUpperCase();
    const divergent = po.lineItems.find(
      (it: any) => it.currency && it.currency.trim().toUpperCase() !== headerCurrency
    );
    if (divergent) {
      throw new Error(
        `CURRENCY_MISMATCH: Cannot generate invoice with divergent line item currency (${(divergent as any).currency} vs header ${headerCurrency})`
      );
    }

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

    // 3. Generate PDF Document
    const pdfBuffer = await generateInvoicePdfBuffer({
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

    // 4. Upload to S3
    const upload = await StorageService.uploadFile(
      tenantId,
      "invoices",
      state.poId,
      `${invoiceNumber}.pdf`,
      pdfBuffer,
      "application/pdf"
    );

    // 5. Create or Update Invoice Record
    if (!invoice) {
      invoice = await InvoiceRepository.create(tenantId, {
        invoiceNumber,
        poId: state.poId,
        poNumber: po.poNumber,
        customerId: po.customerId || "",
        customerName: po.customerName || "Customer",
        gstNumber: po.gstNumber || "",
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

    const invoiceId = invoice._id.toString();

    // 6. Post to ERP
    const connector = await getTenantErpConnector(tenantId);
    const erpVoucher = await connector.postInvoice(tenantId, {
      invoiceNumber,
      poNumber: po.poNumber,
      totalAmount: MoneyUtil.toNumber(totalAmount),
      customerName: po.customerName
    });

    // 7. Complete & Issue
    await InvoiceRepository.updateStatus(tenantId, invoiceId, "ISSUED", {
      verifiedAt: new Date(),
      issuedAt: new Date()
    });
    await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "COMPLETED");

    const latency = Date.now() - startTime;
    await AuditRepository.create(tenantId, {
      agentName: "PostingAgent",
      action: "INVOICE_POSTED_AND_ISSUED",
      status: "SUCCESS",
      entityId: invoiceId,
      workflowId: state.workflowId,
      latency,
      summary: `Invoice ${invoiceNumber} issued (${headerCurrency} ${totalAmount.toFixed(2)}) and posted to ERP (voucher: ${erpVoucher.voucherNumber})`
    });

    return {
      invoiceId,
      invoiceNumber,
      s3PdfKey: upload.s3Key,
      erpPostingId: erpVoucher.erpPostingId,
      status: "COMPLETED",
      isBusinessException: false,
      validationErrors: [],
      currentStep: "posting"
    };
  };
}

// ----------------------------------------------------------------
// PDF generation helper (internal — not exported)
// ----------------------------------------------------------------

interface PdfInvoiceData {
  invoiceNumber: string;
  poNumber: string;
  customerName: string;
  gstNumber: string;
  issueDate: string;
  dueDate: string;
  lineItems: Array<{
    productCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
}

function generateInvoicePdfBuffer(data: PdfInvoiceData): Promise<Buffer> {
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

    // Line items header
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Item / Description", 50, doc.y, { width: 250 });
    doc.text("Qty", 300, doc.y, { width: 50, align: "right" });
    doc.text("Unit Price", 360, doc.y, { width: 80, align: "right" });
    doc.text("Amount", 450, doc.y, { width: 90, align: "right" });
    doc.moveDown();
    doc.font("Helvetica");

    const curr = data.currency || "INR";

    // Line items
    for (const item of data.lineItems) {
      const y = doc.y;
      doc.text(`${item.productCode} - ${item.description}`, 50, y, { width: 240 });
      doc.text(String(item.quantity), 300, y, { width: 50, align: "right" });
      doc.text(`${curr} ${Number(item.unitPrice).toFixed(2)}`, 360, y, { width: 80, align: "right" });
      doc.text(`${curr} ${Number(item.lineTotal).toFixed(2)}`, 450, y, { width: 90, align: "right" });
      doc.moveDown();
    }

    // Totals
    doc.moveDown();
    doc.font("Helvetica-Bold");
    doc.text(`Subtotal: ${curr} ${Number(data.subtotal).toFixed(2)}`, { align: "right" });
    doc.text(`Tax: ${curr} ${Number(data.tax).toFixed(2)}`, { align: "right" });
    doc.fontSize(14).text(`Total Amount: ${curr} ${Number(data.total).toFixed(2)}`, { align: "right" });

    doc.end();
  });
}
