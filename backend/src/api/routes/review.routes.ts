import { Router, Request, Response } from "express";
import { authenticate } from "../../auth/auth.middleware.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  AuditRepository
} from "../../repositories/index.js";
import { POProcessingWorkflow } from "../../agents/workflow.js";
import { ReviewStage, ReviewStatus } from "../../types/index.js";
import { runOrchestrationWorkflow } from "../../ai/workflow/graph.js";
import { logger } from "../../utils/logger.js";

export const reviewRouter = Router();

reviewRouter.use(authenticate);

/**
 * GET /reviews
 * Filterable by stage (?stage=extraction|validation|invoice) and status
 */
reviewRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { page, pageSize, stage, status } = req.query;

  const result = await ReviewRepository.findMany(tenantId, {
    page: page ? parseInt(page as string, 10) : 1,
    pageSize: pageSize ? parseInt(pageSize as string, 10) : 20,
    stage: stage as ReviewStage,
    status: status as ReviewStatus
  });

  const formattedData = result.data.map((rev) => ({
    id: rev._id.toString(),
    entity: rev.entity,
    entityId: rev.entityId,
    stage: rev.stage,
    status: rev.status,
    priority: rev.priority,
    reason: rev.reason,
    requestedByAgent: rev.requestedByAgent,
    expectedValue: rev.expectedValue,
    actualValue: rev.actualValue,
    evidenceCount: rev.evidence.length,
    assignedTo: rev.assignedTo,
    resolvedBy: rev.resolvedBy,
    resolvedAt: rev.resolvedAt,
    createdAt: rev.createdAt,
    updatedAt: rev.updatedAt
  }));

  res.status(200).json({
    data: formattedData,
    pagination: result.pagination
  });
});

/**
 * GET /reviews/:reviewId
 * Detailed review item with multi-source evidence array
 */
reviewRouter.get("/:reviewId", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const reviewId = req.params.reviewId as string;
  const review = await ReviewRepository.findById(tenantId, reviewId);

  if (!review) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Human review record not found",
      details: { reviewId },
      requestId: req.requestId || ""
    });
    return;
  }

  res.status(200).json({
    id: review._id.toString(),
    entity: review.entity,
    entityId: review.entityId,
    stage: review.stage,
    status: review.status,
    priority: review.priority,
    reason: review.reason,
    requestedByAgent: review.requestedByAgent,
    expectedValue: review.expectedValue,
    actualValue: review.actualValue,
    evidence: review.evidence,
    assignedTo: review.assignedTo,
    resolutionNotes: review.resolutionNotes,
    resolvedBy: review.resolvedBy,
    resolvedAt: review.resolvedAt,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt
  });
});

/**
 * POST /reviews/:reviewId/approve
 * Approves exception and resumes workflow at corresponding stage
 */
reviewRouter.post("/:reviewId/approve", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { resolutionNotes, correctedLineItems } = req.body || {};
  const reviewId = req.params.reviewId as string;
  const review = await ReviewRepository.findById(tenantId, reviewId);

  if (!review) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Human review record not found",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  if (review.status !== "PENDING") {
    res.status(400).json({
      code: "ALREADY_RESOLVED",
      message: `Review is already resolved with status ${review.status}`,
      details: { currentStatus: review.status },
      requestId: req.requestId || ""
    });
    return;
  }

  // If reviewer provided corrected line items, persist them to the PO before resuming
  if (Array.isArray(correctedLineItems) && correctedLineItems.length > 0) {
    await PurchaseOrderRepository.updateExtraction(tenantId, review.entityId, {
      lineItems: correctedLineItems,
      extractionConfidence: 1.0
    });
  }

  const resolved = await ReviewRepository.resolveReview(
    tenantId,
    review._id.toString(),
    "APPROVED",
    resolutionNotes || "Approved by human reviewer",
    req.user!.email
  );

  // Resume workflow at the appropriate stage
  if (review.stage === "extraction" || review.stage === "validation") {
    // Advance PO status
    const targetStatus = review.stage === "extraction" ? "VALIDATING" : "APPROVED";
    await PurchaseOrderRepository.updateStatus(tenantId, review.entityId, targetStatus);

    // Resume via LangGraph Orchestration Workflow asynchronously with legacy fallback
    setImmediate(async () => {
      try {
        await runOrchestrationWorkflow(tenantId, review.entityId);
      } catch (err: any) {
        logger.error(
          { err, tenantId, poId: review.entityId },
          "Error running LangGraph workflow upon review approval; attempting legacy fallback"
        );
        try {
          await POProcessingWorkflow.runWorkflow(tenantId, review.entityId);
        } catch (legacyErr: any) {
          logger.error(
            { legacyErr, tenantId, poId: review.entityId },
            "Legacy workflow also failed upon review approval"
          );
        }
      }
    });
  } else if (review.stage === "invoice") {
    // Advance invoice to ISSUED
    await InvoiceRepository.updateStatus(tenantId, review.entityId, "ISSUED", {
      verifiedAt: new Date(),
      issuedAt: new Date()
    });
    const inv = await InvoiceRepository.findById(tenantId, review.entityId);
    if (inv) {
      await PurchaseOrderRepository.updateStatus(tenantId, inv.poId, "COMPLETED");
    }
  }

  await AuditRepository.create(tenantId, {
    agentName: "HumanReviewCenter",
    action: "REVIEW_APPROVED",
    status: "SUCCESS",
    entityId: review.entityId,
    workflowId: "manual_review",
    summary: `Human review (${review.stage} stage) approved by ${req.user!.email}. Notes: ${resolutionNotes || "None"}`
  });

  res.status(200).json({
    id: resolved!._id.toString(),
    entity: resolved!.entity,
    entityId: resolved!.entityId,
    stage: resolved!.stage,
    status: resolved!.status,
    resolutionNotes: resolved!.resolutionNotes,
    resolvedBy: resolved!.resolvedBy,
    resolvedAt: resolved!.resolvedAt
  });
});

/**
 * POST /reviews/:reviewId/reject
 * Rejects exception with stage-aware outcome
 */
reviewRouter.post("/:reviewId/reject", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { reason } = req.body || {};

  if (!reason) {
    res.status(400).json({
      code: "REASON_REQUIRED",
      message: "A rejection reason must be provided",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  const reviewId = req.params.reviewId as string;
  const review = await ReviewRepository.findById(tenantId, reviewId);

  if (!review) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Human review record not found",
      details: { reviewId },
      requestId: req.requestId || ""
    });
    return;
  }

  if (review.status !== "PENDING") {
    res.status(400).json({
      code: "ALREADY_RESOLVED",
      message: `Review is already resolved with status ${review.status}`,
      details: { currentStatus: review.status },
      requestId: req.requestId || ""
    });
    return;
  }

  const resolved = await ReviewRepository.resolveReview(
    tenantId,
    review._id.toString(),
    "REJECTED",
    reason,
    req.user!.email
  );

  // Stage-specific rejection outcome per §B19 & §C11.2
  if (review.stage === "extraction") {
    // Notify customer and mark PO closed/rejected
    await PurchaseOrderRepository.updateStatus(
      tenantId,
      review.entityId,
      "REJECTED",
      `Extraction rejected: ${reason}`
    );
  } else if (review.stage === "validation") {
    // Mark PO REJECTED
    await PurchaseOrderRepository.updateStatus(
      tenantId,
      review.entityId,
      "REJECTED",
      `Commercial validation rejected: ${reason}`
    );
  } else if (review.stage === "invoice") {
    // Hold invoice for correction / REJECTED
    await InvoiceRepository.updateStatus(tenantId, review.entityId, "REJECTED");
    const inv = await InvoiceRepository.findById(tenantId, review.entityId);
    if (inv) {
      await PurchaseOrderRepository.updateStatus(
        tenantId,
        inv.poId,
        "FAILED",
        `Invoice rejected: ${reason}`
      );
    }
  }

  await AuditRepository.create(tenantId, {
    agentName: "HumanReviewCenter",
    action: "REVIEW_REJECTED",
    status: "EXCEPTION",
    entityId: review.entityId,
    workflowId: "manual_review",
    summary: `Human review (${review.stage} stage) rejected by ${req.user!.email}. Reason: ${reason}`
  });

  res.status(200).json({
    id: resolved!._id.toString(),
    entity: resolved!.entity,
    entityId: resolved!.entityId,
    stage: resolved!.stage,
    status: resolved!.status,
    resolutionNotes: resolved!.resolutionNotes,
    resolvedBy: resolved!.resolvedBy,
    resolvedAt: resolved!.resolvedAt
  });
});
