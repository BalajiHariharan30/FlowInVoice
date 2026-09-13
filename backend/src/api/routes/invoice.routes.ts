import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { authenticate } from "../../auth/auth.middleware.js";
import { InvoiceRepository, PurchaseOrderRepository } from "../../repositories/index.js";
import { StorageService } from "../../storage/s3.service.js";
import { runOrchestrationWorkflow } from "../../ai/workflow/index.js";
import { InvoiceStatus } from "../../types/index.js";

export const invoiceRouter = Router();

invoiceRouter.use(authenticate);

/**
 * GET /invoices
 * List invoices with pagination and search
 */
invoiceRouter.get("/", asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { page, pageSize, status, search, customerId } = req.query;

  const result = await InvoiceRepository.findMany(tenantId, {
    page: page ? parseInt(page as string, 10) : 1,
    pageSize: pageSize ? parseInt(pageSize as string, 10) : 20,
    status: status as InvoiceStatus,
    search: search as string,
    customerId: customerId as string
  });

  const formattedData = result.data.map((inv) => ({
    id: inv._id.toString(),
    invoiceNumber: inv.invoiceNumber,
    poId: inv.poId,
    poNumber: inv.poNumber,
    customerId: inv.customerId,
    customerName: inv.customerName,
    gstNumber: inv.gstNumber,
    status: inv.status,
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    subtotal: inv.subtotal,
    tax: inv.tax,
    discount: inv.discount,
    totalAmount: inv.totalAmount,
    lineItemsCount: inv.lineItems.length,
    verifiedAt: inv.verifiedAt,
    issuedAt: inv.issuedAt,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt
  }));

  res.status(200).json({
    data: formattedData,
    pagination: result.pagination
  });
}));

/**
 * GET /invoices/:invoiceId
 * Single invoice resource
 */
invoiceRouter.get("/:invoiceId", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const invoiceId = req.params.invoiceId as string;
  const invoice = await InvoiceRepository.findById(tenantId, invoiceId);

  if (!invoice) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Invoice not found",
      details: { invoiceId },
      requestId: req.requestId || ""
    });
    return;
  }

  res.status(200).json({
    id: invoice._id.toString(),
    invoiceNumber: invoice.invoiceNumber,
    poId: invoice.poId,
    poNumber: invoice.poNumber,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    gstNumber: invoice.gstNumber,
    status: invoice.status,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTerms: invoice.paymentTerms,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    discount: invoice.discount,
    totalAmount: invoice.totalAmount,
    lineItems: invoice.lineItems,
    verifiedAt: invoice.verifiedAt,
    issuedAt: invoice.issuedAt,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt
  });
});

/**
 * POST /invoices/:poId/generate
 * Trigger invoice generation for a validated purchase order
 */
invoiceRouter.post("/:poId/generate", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const poId = req.params.poId as string;
  const po = await PurchaseOrderRepository.findById(tenantId, poId);

  if (!po) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Purchase order not found",
      details: { poId },
      requestId: req.requestId || ""
    });
    return;
  }

  // Section 23: Duplicate Invoice Protection
  const existingInvoice = await InvoiceRepository.findByPoId(tenantId, po._id.toString());
  if (existingInvoice) {
    res.status(200).json({
      id: existingInvoice._id.toString(),
      invoiceNumber: existingInvoice.invoiceNumber,
      poId: existingInvoice.poId,
      poNumber: existingInvoice.poNumber,
      customerName: existingInvoice.customerName,
      gstNumber: existingInvoice.gstNumber,
      status: existingInvoice.status,
      totalAmount: existingInvoice.totalAmount,
      message: "Invoice already exists for this purchase order."
    });
    return;
  }

  // State guard: Rejection and deletion are terminal
  if (po.status === "REJECTED" || po.status === "DELETED") {
    res.status(400).json({
      code: "INVALID_PO_STATE",
      message: `Cannot generate invoice for purchase order in ${po.status} status`,
      details: { status: po.status },
      requestId: req.requestId || ""
    });
    return;
  }

  // Trigger invoice generation step in workflow (advance to APPROVED if not already human approved)
  if (po.status !== "HUMAN_APPROVED" && po.status !== "APPROVED") {
    await PurchaseOrderRepository.updateStatus(tenantId, po._id.toString(), "APPROVED");
  }
  await runOrchestrationWorkflow(tenantId, po._id.toString());

  const invoice = await InvoiceRepository.findByPoId(tenantId, po._id.toString());

  if (!invoice) {
    res.status(500).json({
      code: "INVOICE_GENERATION_FAILED",
      message: "Invoice generation could not be completed",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  res.status(201).json({
    id: invoice._id.toString(),
    invoiceNumber: invoice.invoiceNumber,
    poId: invoice.poId,
    poNumber: invoice.poNumber,
    customerName: invoice.customerName,
    gstNumber: invoice.gstNumber,
    status: invoice.status,
    totalAmount: invoice.totalAmount
  });
});

/**
 * GET /invoices/:invoiceId/download
 * Returns JSON containing short-lived presigned URL per §B3 / §C4.4
 */
invoiceRouter.get("/:invoiceId/download", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const invoiceId = req.params.invoiceId as string;
  const invoice = await InvoiceRepository.findById(tenantId, invoiceId);

  if (!invoice || !invoice.s3PdfKey) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Invoice PDF not available for download",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  // Generate 5-minute presigned download URL
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const userToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : undefined;
  const { url, expiresAt } = await StorageService.getPresignedDownloadUrl(invoice.s3PdfKey, 300, baseUrl, userToken);

  res.status(200).json({
    url,
    expiresAt
  });
});
