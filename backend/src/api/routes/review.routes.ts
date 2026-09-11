import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { authenticate } from "../../auth/auth.middleware.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  AuditRepository,
  reconcileTaxFromLineItems
} from "../../repositories/index.js";
import { POProcessingWorkflow } from "../../agents/workflow.js";
import { ReviewStage, ReviewStatus } from "../../types/index.js";
import { runOrchestrationWorkflow } from "../../ai/workflow/graph.js";
import { ReanalysisService } from "../../ai/workflow/reanalysis.service.js";
import { logger } from "../../utils/logger.js";

export const reviewRouter = Router();

reviewRouter.use(authenticate);

/**
 * GET /reviews
 * Filterable by stage (?stage=extraction|validation|invoice) and status
 */
reviewRouter.get("/", asyncHandler(async (req: Request, res: Response): Promise<void> => {
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
}));

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

async function handleReviewApproval(req: Request, res: Response): Promise<void> {
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

  // Close any duplicate pending tickets for this entity
  await ReviewRepository.closeDuplicatePendingTickets(tenantId, review.entityId, review._id.toString());

  // Resume workflow at the appropriate stage
  if (review.stage === "extraction" || review.stage === "validation") {
    if (review.entity === "purchase_order") {
      const po = await PurchaseOrderRepository.findById(tenantId, review.entityId);
      const activeLineItems = (Array.isArray(correctedLineItems) && correctedLineItems.length > 0)
        ? correctedLineItems
        : po?.lineItems;
      const reconciledTax = reconcileTaxFromLineItems(activeLineItems);

      await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, review.entityId, "HUMAN_APPROVED", {
        extractionConfidence: 1.0,
        humanReviewedAt: new Date(),
        humanReviewedBy: req.user!.email,
        ...(reconciledTax !== null ? { tax: reconciledTax } : {})
      });
    }

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
}

async function handleReviewRejection(req: Request, res: Response): Promise<void> {
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

  // BUG 1 FIX: If reviewing a Purchase Order, run comprehensive re-analysis across Nodes 02–06
  if (review.entity === "purchase_order") {
    const reanalysis = await ReanalysisService.reanalyzePurchaseOrder(tenantId, review.entityId);

    // Case A: If ZERO discrepancies remain within tolerance -> DO NOT auto-reject!
    // Route back to Human Review with note "resolved on re-check" for confirmation.
    if (reanalysis.discrepancies.length === 0) {
      const resolutionNotes =
        "Resolved on re-check. No discrepancies found within tolerance; confirmation required.";
      const updated = await ReviewRepository.updateReview(tenantId, review._id.toString(), {
        resolutionNotes,
        evidence: [...(review.evidence || []), ...reanalysis.evidence]
      });

      await AuditRepository.create(tenantId, {
        agentName: "ReanalysisEngine",
        action: "REANALYSIS_CLEARED",
        status: "SUCCESS",
        entityId: review.entityId,
        workflowId: "manual_review",
        summary: `Re-analysis across Nodes 02-06 detected NO remaining discrepancies for PO ${review.entityId}. Routed back to review center for confirmation.`
      });

      res.status(200).json({
        id: updated!._id.toString(),
        entity: updated!.entity,
        entityId: updated!.entityId,
        stage: updated!.stage,
        status: "PENDING",
        resolutionNotes,
        resolvedBy: updated!.resolvedBy,
        resolvedAt: updated!.resolvedAt,
        discrepancyReport: [],
        message: "No discrepancies found on re-check. Ticket remains PENDING for reviewer confirmation."
      });
      return;
    }

    // Case B: Discrepancies exist! Collect all discrepancies into structured DiscrepancyReport
    // Persist report to HumanReview record & AuditTrail, mark review REJECTED and PO REJECTED.
    const combinedEvidence = [...(review.evidence || []), ...reanalysis.evidence];
    const resolved = await ReviewRepository.resolveReview(
      tenantId,
      review._id.toString(),
      "REJECTED",
      reason,
      req.user!.email,
      {
        discrepancyReport: reanalysis.discrepancies,
        evidence: combinedEvidence,
        rejectionReason: reason
      }
    );

    // Close any duplicate pending tickets for this entity
    await ReviewRepository.closeDuplicatePendingTickets(tenantId, review.entityId, review._id.toString(), "REJECTED");

    // Mark PO REJECTED with summary reasons
    const summaryReasons = reanalysis.discrepancies
      .map((d) => `[${d.nodeId}] ${d.message || d.field}`)
      .join("; ");

    await PurchaseOrderRepository.updateHumanReviewStatus(
      tenantId,
      review.entityId,
      "REJECTED",
      {
        humanReviewedAt: new Date(),
        humanReviewedBy: req.user!.email,
        terminatedAt: new Date(),
        terminationReason: `Rejection confirmed with ${reanalysis.discrepancies.length} discrepancies: ${summaryReasons}`,
        failureReason: `Rejection confirmed with ${reanalysis.discrepancies.length} discrepancies: ${summaryReasons}`
      }
    );

    // Persist immutable audit log with full discrepancy report
    await AuditRepository.create(tenantId, {
      agentName: "ReanalysisEngine",
      action: "REVIEW_REJECTED_WITH_REANALYSIS",
      status: "EXCEPTION",
      entityId: review.entityId,
      workflowId: "manual_review",
      summary: `Human review rejected by ${req.user!.email}. Complete pipeline re-analysis identified ${reanalysis.discrepancies.length} discrepancies across Nodes 02-06. Reason: ${reason}`,
      metadata: {
        discrepancyReport: reanalysis.discrepancies,
        discrepancyCount: reanalysis.discrepancies.length,
        reviewerNotes: reason
      }
    });

    res.status(200).json({
      id: resolved!._id.toString(),
      entity: resolved!.entity,
      entityId: resolved!.entityId,
      stage: resolved!.stage,
      status: resolved!.status,
      resolutionNotes: resolved!.resolutionNotes,
      resolvedBy: resolved!.resolvedBy,
      resolvedAt: resolved!.resolvedAt,
      discrepancyReport: reanalysis.discrepancies
    });
    return;
  }

  // Fallback for invoice stage exceptions
  const resolved = await ReviewRepository.resolveReview(
    tenantId,
    review._id.toString(),
    "REJECTED",
    reason,
    req.user!.email,
    { rejectionReason: reason }
  );

  // Close any duplicate pending tickets for this entity
  await ReviewRepository.closeDuplicatePendingTickets(tenantId, review.entityId, review._id.toString(), "REJECTED");

  if (review.stage === "invoice") {
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
}

/**
 * POST /reviews/:reviewId/approve
 * Approves exception and resumes workflow at corresponding stage
 */
reviewRouter.post("/:reviewId/approve", async (req: Request, res: Response): Promise<void> => {
  return handleReviewApproval(req, res);
});

/**
 * POST /reviews/:reviewId/reject
 * Rejects exception with stage-aware outcome
 */
reviewRouter.post("/:reviewId/reject", async (req: Request, res: Response): Promise<void> => {
  return handleReviewRejection(req, res);
});

/**
 * POST /reviews/:reviewId/resolve
 * Unified resolution endpoint supporting { decision: 'APPROVED' | 'REJECTED', ... }
 */
reviewRouter.post("/:reviewId/resolve", async (req: Request, res: Response): Promise<void> => {
  const { decision, reason, resolutionNotes } = req.body || {};
  if (decision === "REJECTED") {
    if (!req.body.reason && resolutionNotes) {
      req.body.reason = resolutionNotes;
    }
    return handleReviewRejection(req, res);
  } else if (decision === "APPROVED") {
    if (!req.body.resolutionNotes && reason) {
      req.body.resolutionNotes = reason;
    }
    return handleReviewApproval(req, res);
  } else {
    res.status(400).json({
      code: "INVALID_DECISION",
      message: "decision must be either 'APPROVED' or 'REJECTED'",
      details: { decision },
      requestId: req.requestId || ""
    });
  }
});
