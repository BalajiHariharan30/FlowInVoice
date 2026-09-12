import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { authenticate } from "../../auth/auth.middleware.js";
import { PurchaseOrderRepository, AuditRepository, ReviewRepository } from "../../repositories/index.js";
import { StorageService } from "../../storage/s3.service.js";
import { QdrantService } from "../../rag/qdrant.service.js";
import { QueueManager } from "../../workers/queue.js";
import { POStatus } from "../../types/index.js";
import { runOrchestrationWorkflow } from "../../ai/workflow/graph.js";
import { workflowRateLimiter } from "../../ai/workflow/rate-limiter.js";
import { logger } from "../../utils/logger.js";

export const poRouter = Router();

// Multer in-memory storage configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB limit
});

// All PO routes require authentication
poRouter.use(authenticate);

/**
 * POST /pos
 * Accepts PO document, returns 202 Accepted with poId, jobId, and status: PROCESSING
 */
poRouter.post("/", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const file = req.file;

  if (!file) {
    res.status(400).json({
      code: "FILE_REQUIRED",
      message: "No purchase order file uploaded",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  // Validate allowed file types
  const allowedMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/tiff",
    "application/octet-stream"
  ];
  if (!allowedMimeTypes.includes(file.mimetype) && !file.originalname.toLowerCase().endsWith(".pdf")) {
    res.status(400).json({
      code: "INVALID_FILE_TYPE",
      message: "Uploaded file must be a PDF or standard image (PNG, JPEG, TIFF)",
      details: { mimeType: file.mimetype, filename: file.originalname },
      requestId: req.requestId || ""
    });
    return;
  }

  try {
    const poTempId = `po_${uuidv4().slice(0, 12)}`;
    const originalName = file.originalname;

    // Upload to S3 storage
    const s3Result = await StorageService.uploadFile(
      tenantId,
      "pos",
      poTempId,
      originalName,
      file.buffer,
      file.mimetype || "application/pdf"
    );

    const providedPoNumber = req.body?.poNumber ? String(req.body.poNumber).trim() : null;
    const poNumber = providedPoNumber && providedPoNumber.length > 0
      ? providedPoNumber
      : `PENDING-${uuidv4().slice(0, 6).toUpperCase()}`;

    // Rule 9: Version tracking on resubmissions
    const previousVersionId = req.body?.previousVersionId ? String(req.body.previousVersionId).trim() : undefined;
    let version = 1;
    if (previousVersionId) {
      const prevPo = await PurchaseOrderRepository.findById(tenantId, previousVersionId);
      if (prevPo) {
        version = (prevPo.version || 1) + 1;
      }
    }

    // Rule 5: Record submitter ID for segregation of duties
    const createdBy = req.user!.id || (req.user as any).userId || req.user!.email;

    // Initial PO record creation in database
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber,
      customerName: req.body?.customerName || "Processing Customer...",
      gstNumber: "",
      status: "PROCESSING",
      s3Key: s3Result.s3Key,
      documentName: originalName,
      documentSize: s3Result.sizeBytes,
      contentType: file.mimetype || "application/pdf",
      extractionConfidence: 1.0,
      lineItems: [],
      createdBy,
      previousVersionId,
      version
    });

    const poId = po._id.toString();

    // Log Intake Audit record
    await AuditRepository.create(tenantId, {
      agentName: "IntakeAgent",
      action: "RECEIVE_DOCUMENT",
      status: "SUCCESS",
      entityId: poId,
      workflowId: `wf_${uuidv4()}`,
      summary: `Document ${originalName} (${(s3Result.sizeBytes / 1024).toFixed(1)} KB) received and queued for processing`
    });

    // Enqueue BullMQ processing job
    const jobId = await QueueManager.addPOProcessingJob(tenantId, poId);

    // Return 202 Accepted strictly as specified in §B3 and §C4.3
    res.status(202).json({
      poId,
      jobId,
      status: "PROCESSING"
    });
  } catch (err: any) {
    if (err?.code === "DUPLICATE_PO_NUMBER" || err?.statusCode === 409 || err?.code === 11000) {
      res.status(409).json({
        code: "DUPLICATE_PO_NUMBER",
        message: err.message || "Duplicate purchase order number detected",
        details: {},
        requestId: req.requestId || ""
      });
      return;
    }
    res.status(500).json({
      code: "UPLOAD_FAILED",
      message: err.message || "Failed to process upload",
      details: {},
      requestId: req.requestId || ""
    });
  }
});

/**
 * POST /pos/:poId/process-graph
 * Invokes the 7-agent LangGraph orchestration pipeline for a purchase order.
 * Route-scoped rate-limited (20 req/min), tenant-isolated, 30s timeout bounded.
 */
poRouter.post("/:poId/process-graph", workflowRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const poId = req.params.poId as string;

  if (!poId || poId.trim().length === 0) {
    res.status(400).json({
      code: "VALIDATION_FAILURE",
      message: "PO ID is required",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  try {
    const result = await runOrchestrationWorkflow(tenantId, poId);

    // Business exception mapped to 200 with exception payload (§0.9)
    if (result.isBusinessException) {
      res.status(200).json({
        status: "HUMAN_REVIEW",
        poId: result.poId,
        workflowId: result.workflowId,
        isBusinessException: true,
        reviewId: result.reviewId,
        validationErrors: result.validationErrors,
        currentStep: result.currentStep
      });
      return;
    }

    // Success -> 200
    res.status(200).json({
      status: "COMPLETED",
      poId: result.poId,
      workflowId: result.workflowId,
      isBusinessException: false,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      erpPostingId: result.erpPostingId,
      currentStep: result.currentStep
    });
  } catch (err: any) {
    const isTimeout = err.message?.includes("timed out");
    logger.error({ err, tenantId, poId }, "Orchestration workflow route error");

    res.status(isTimeout ? 504 : 500).json({
      code: isTimeout ? "GATEWAY_TIMEOUT" : "TECHNICAL_FAILURE",
      message: isTimeout
        ? "Workflow orchestration processing timed out. Please retry."
        : "An unexpected internal failure occurred while processing workflow.",
      details: {},
      requestId: req.requestId || ""
    });
  }
});

/**
 * GET /pos/:poId/stream-graph
 * Streams real-time step telemetry for the LangGraph orchestration pipeline via Server-Sent Events (SSE).
 * Route-scoped rate-limited (20 req/min), tenant-isolated, 30s timeout bounded.
 */
poRouter.get("/:poId/stream-graph", workflowRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const poId = req.params.poId as string;

  if (!poId || poId.trim().length === 0) {
    res.status(400).json({
      code: "VALIDATION_FAILURE",
      message: "PO ID is required",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  // Set SSE response headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent("workflow_start", {
    poId,
    timestamp: new Date().toISOString()
  });

  try {
    const result = await runOrchestrationWorkflow(tenantId, poId, {
      onStepUpdate: (stepEvent) => {
        sendEvent("step_update", stepEvent);
      }
    });

    sendEvent("workflow_complete", {
      status: result.status,
      poId: result.poId,
      workflowId: result.workflowId,
      isBusinessException: result.isBusinessException,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      reviewId: result.reviewId,
      erpPostingId: result.erpPostingId,
      currentStep: result.currentStep,
      validationErrors: result.validationErrors
    });
  } catch (err: any) {
    const isTimeout = err.message?.includes("timed out");
    logger.error({ err, tenantId, poId }, "Orchestration workflow SSE stream error");
    sendEvent("workflow_error", {
      code: isTimeout ? "GATEWAY_TIMEOUT" : "TECHNICAL_FAILURE",
      message: isTimeout
        ? "Workflow orchestration processing timed out. Please retry."
        : "An unexpected internal failure occurred while processing workflow.",
      details: {}
    });
  } finally {
    res.write("event: done\ndata: {}\n\n");
    res.end();
  }
});

/**
 * GET /pos
 * List POs with pagination, filters, and search
 */
poRouter.get("/", asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { page, pageSize, status, search, customerId, dateFrom, dateTo, latestOnly } = req.query;

  const result = await PurchaseOrderRepository.findMany(tenantId, {
    page: page ? parseInt(page as string, 10) : 1,
    pageSize: pageSize ? parseInt(pageSize as string, 10) : 20,
    status: status as POStatus,
    search: search as string,
    customerId: customerId as string,
    dateFrom: dateFrom as string,
    dateTo: dateTo as string,
    latestOnly: latestOnly === "false" ? false : true
  });

  const formattedData = result.data.map((po) => ({
    id: po._id.toString(),
    poNumber: po.poNumber,
    customerId: po.customerId,
    customerName: po.customerName,
    gstNumber: po.gstNumber,
    status: po.status,
    currency: po.currency,
    issueDate: po.issueDate,
    deliveryDate: po.deliveryDate,
    subtotal: po.subtotal,
    tax: po.tax,
    discount: po.discount,
    totalAmount: po.totalAmount,
    extractionConfidence: po.extractionConfidence,
    lineItemsCount: po.lineItems.length,
    retryCount: po.retryCount,
    failureReason: po.failureReason,
    version: po.version || 1,
    previousVersionId: po.previousVersionId,
    createdBy: po.createdBy,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt
  }));

  res.status(200).json({
    data: formattedData,
    pagination: result.pagination
  });
}));

/**
 * GET /pos/:poId/version-chain
 * Returns the complete revision timeline for a given PO (ancestors + descendants)
 */
poRouter.get("/:poId/version-chain", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const poId = req.params.poId as string;

  const chain = await PurchaseOrderRepository.findVersionChain(tenantId, poId);
  if (chain.length === 0) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Purchase order version chain not found",
      details: { poId },
      requestId: req.requestId || ""
    });
    return;
  }

  const formattedChain = chain.map((p) => ({
    id: p._id.toString(),
    poNumber: p.poNumber,
    version: p.version || 1,
    status: p.status,
    totalAmount: p.totalAmount,
    previousVersionId: p.previousVersionId,
    createdBy: p.createdBy,
    failureReason: p.failureReason || p.terminationReason,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }));

  res.status(200).json({
    data: formattedChain,
    totalVersions: formattedChain.length,
    currentVersionId: poId
  });
});

/**
 * GET /pos/:poId
 * Single PO resource
 */
poRouter.get("/:poId", async (req: Request, res: Response): Promise<void> => {
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

  // Get download presigned URL for the original document
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const userToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : undefined;
  const download = await StorageService.getPresignedDownloadUrl(po.s3Key, 300, baseUrl, userToken);

  res.status(200).json({
    id: po._id.toString(),
    poNumber: po.poNumber,
    customerId: po.customerId,
    customerName: po.customerName,
    gstNumber: po.gstNumber,
    status: po.status,
    currency: po.currency,
    issueDate: po.issueDate,
    deliveryDate: po.deliveryDate,
    paymentTerms: po.paymentTerms,
    documentName: po.documentName,
    documentUrl: download.url,
    subtotal: po.subtotal,
    tax: po.tax,
    discount: po.discount,
    totalAmount: po.totalAmount,
    extractionConfidence: po.extractionConfidence,
    lineItems: po.lineItems,
    retryCount: po.retryCount,
    failureReason: po.failureReason,
    workflowId: po.workflowId,
    version: po.version || 1,
    previousVersionId: po.previousVersionId,
    createdBy: po.createdBy,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt
  });
});

/**
 * GET /pos/:poId/status
 * Status polling endpoint
 */
poRouter.get("/:poId/status", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const poId = req.params.poId as string;
  const po = await PurchaseOrderRepository.findById(tenantId, poId);

  if (!po) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Purchase order not found",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  res.status(200).json({
    id: po._id.toString(),
    poNumber: po.poNumber,
    status: po.status,
    retryCount: po.retryCount,
    failureReason: po.failureReason,
    updatedAt: po.updatedAt
  });
});

/**
 * POST /pos/:poId/retry
 * Manual retry endpoint (only allowed when status is FAILED per §C10)
 */
poRouter.post("/:poId/retry", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const poId = req.params.poId as string;
  const po = await PurchaseOrderRepository.findById(tenantId, poId);

  if (!po) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Purchase order not found",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  if (po.status !== "FAILED") {
    res.status(400).json({
      code: "INVALID_STATE",
      message: `Cannot retry purchase order with status ${po.status}. Only FAILED POs can be retried.`,
      details: { currentStatus: po.status },
      requestId: req.requestId || ""
    });
    return;
  }

  await PurchaseOrderRepository.updateStatus(tenantId, po._id.toString(), "PROCESSING");
  const jobId = await QueueManager.addPOProcessingJob(tenantId, po._id.toString());

  res.status(202).json({
    poId: po._id.toString(),
    jobId,
    status: "PROCESSING"
  });
});

/**
 * DELETE /pos/:poId
 * Soft-deletes a purchase order, marks open review tickets as REJECTED,
 * prunes associated Qdrant vector chunks, and logs an immutable audit event.
 */
poRouter.delete("/:poId", async (req: Request, res: Response): Promise<void> => {
  const poId = req.params.poId as string;
  const tenantId = req.user!.tenantId;

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

  // Soft-delete the PO
  await PurchaseOrderRepository.softDelete(tenantId, poId);

  // Close and reject any open review tickets
  await ReviewRepository.rejectOpenReviewsForEntity(
    tenantId,
    poId,
    "PO record was deleted by user"
  );

  // Prune associated Qdrant vector points
  await QdrantService.deletePointsByFilter(tenantId, { documentId: poId });

  // Immutable audit log
  await AuditRepository.create(tenantId, {
    agentName: "PurchaseOrderService",
    action: "DELETE_PO",
    status: "SUCCESS",
    entityId: poId,
    workflowId: `del_${poId}`,
    summary: `Purchase order ${po.poNumber} (${poId}) soft-deleted by ${req.user!.email}`
  });

  res.status(204).send();
});
