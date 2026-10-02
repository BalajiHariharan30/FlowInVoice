import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { authenticate } from "../../auth/auth.middleware.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  AuditRepository,
  ResumeJobRepository,
  reconcileTaxFromLineItems
} from "../../repositories/index.js";
import { ReviewStage, ReviewStatus } from "../../types/index.js";
import { runOrchestrationWorkflow } from "../../ai/workflow/index.js";
import { executeSynchronousResumeFallback } from "../../ai/workflow/deterministic.js";
import { ReanalysisService } from "../../ai/workflow/reanalysis.service.js";
import { QueueManager } from "../../workers/queue.js";
import { MoneyUtil } from "../../utils/money.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

/**
 * Returns true when the user who created the PO is the same person attempting to review it,
 * AND maker-checker enforcement is enabled.
 * Covers purchase_order and invoice entity types.
 * Returns false when ENFORCE_MAKER_CHECKER=false (e.g. solo-dev / staging environments).
 */
async function isMakerCheckerViolation(
  tenantId: string,
  entity: string,
  entityId: string,
  userId: string
): Promise<boolean> {
  if (!env.ENFORCE_MAKER_CHECKER) return false;
  let createdBy: string | undefined;
  if (entity === "purchase_order") {
    const po = await PurchaseOrderRepository.findById(tenantId, entityId);
    createdBy = po?.createdBy;
  } else if (entity === "invoice") {
    const inv = await InvoiceRepository.findById(tenantId, entityId);
    if (inv?.poId) {
      const po = await PurchaseOrderRepository.findById(tenantId, inv.poId);
      createdBy = po?.createdBy;
    }
  }
  return Boolean(createdBy && createdBy === userId);
}

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
    findings: (review as any).findings || [],
    resumeAttempts: (review as any).resumeAttempts || 0,
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

  // Rule 5: Segregation of duties — delegated to isMakerCheckerViolation() helper (respects ENFORCE_MAKER_CHECKER)
  const currentUserId = req.user!.id || (req.user as any).userId;
  if (await isMakerCheckerViolation(tenantId, review.entity, review.entityId, currentUserId)) {
    res.status(403).json({
      code: "MAKER_CHECKER_VIOLATION",
      message: "Users cannot review documents they submitted",
      details: { reviewer: currentUserId },
      requestId: req.requestId || ""
    });
    return;
  }

  if (review.status === "APPROVED") {
    res.status(200).json({
      id: review._id.toString(),
      entity: review.entity,
      entityId: review.entityId,
      stage: review.stage,
      status: review.status,
      resolutionNotes: review.resolutionNotes,
      resolvedBy: review.resolvedBy,
      resolvedAt: review.resolvedAt,
      remainingOpenReviewsCount: 0,
      message: "Review is already approved."
    });
    return;
  }

  if (review.status === "REJECTED") {
    res.status(409).json({
      code: "CANNOT_APPROVE_REJECTED_REVIEW",
      message: "Cannot approve a review that has already been rejected",
      details: { currentStatus: review.status },
      requestId: req.requestId || ""
    });
    return;
  }

  if (review.status !== "PENDING" && review.status !== "ESCALATED") {
    res.status(400).json({
      code: "ALREADY_RESOLVED",
      message: `Review is already resolved with status ${review.status}`,
      details: { currentStatus: review.status },
      requestId: req.requestId || ""
    });
    return;
  }

  // If reviewer provided corrected line items, persist them to the PO before resuming.
  // B3: Do NOT overwrite extractionConfidence — the OCR score reflects actual accuracy.
  if (Array.isArray(correctedLineItems) && correctedLineItems.length > 0) {
    await PurchaseOrderRepository.updateExtraction(tenantId, review.entityId, {
      lineItems: correctedLineItems
    });
  }

  // Rule 2: Multi-exception all-approval check — must happen BEFORE resolveReview so we don't
  // accidentally resume when other open reviews still exist.
  const allReviews = await ReviewRepository.findByEntityId(tenantId, review.entityId);
  const openReviews = allReviews.filter(
    (r) => (r.status === "PENDING" || r.status === "ESCALATED") && r._id.toString() !== review._id.toString()
  );

  if (openReviews.length > 0) {
    // Resolve this review but do NOT resume the pipeline — more reviews remain.
    const partialResolved = await ReviewRepository.resolveReview(
      tenantId,
      review._id.toString(),
      "APPROVED",
      resolutionNotes || "Approved by human reviewer",
      req.user!.email
    );
    if (!partialResolved) {
      // Concurrent resolve — idempotent: return the current state
      const latest = await ReviewRepository.findById(tenantId, reviewId);
      res.status(200).json({
        id: latest?._id.toString() ?? reviewId,
        entity: review.entity,
        entityId: review.entityId,
        stage: review.stage,
        status: latest?.status ?? "APPROVED",
        resolutionNotes: latest?.resolutionNotes,
        resolvedBy: latest?.resolvedBy,
        resolvedAt: latest?.resolvedAt,
        remainingOpenReviewsCount: openReviews.length,
        message: "Review already resolved by concurrent operation."
      });
      return;
    }
    logger.info(
      { tenantId, entityId: review.entityId, remainingCount: openReviews.length },
      "Review item approved, but other pending reviews remain. PO remains in HUMAN_REVIEW."
    );
    // Close duplicates AFTER resolveReview so propagation uses the "approval" message
    await ReviewRepository.closeDuplicatePendingTickets(tenantId, review.entityId, review._id.toString());
    await AuditRepository.create(tenantId, {
      agentName: "HumanReviewCenter",
      action: "REVIEW_APPROVED",
      status: "SUCCESS",
      entityId: review.entityId,
      workflowId: "manual_review",
      summary: `Human review (${review.stage} stage) approved by ${req.user!.email}. ${openReviews.length} open review item(s) remain before pipeline resumes.`
    });
    res.status(200).json({
      id: partialResolved._id.toString(),
      entity: partialResolved.entity,
      entityId: partialResolved.entityId,
      stage: partialResolved.stage,
      status: partialResolved.status,
      resolutionNotes: partialResolved.resolutionNotes,
      resolvedBy: partialResolved.resolvedBy,
      resolvedAt: partialResolved.resolvedAt,
      remainingOpenReviewsCount: openReviews.length,
      message: `Review approved. Awaiting resolution of ${openReviews.length} remaining review item(s) before workflow resumes.`
    });
    return;
  }

  // Rule 3: All review items approved → Resume workflow at the posting stage checkpoint
  if (review.stage === "extraction" || review.stage === "validation") {
    if (review.entity === "purchase_order") {
      const po = await PurchaseOrderRepository.findById(tenantId, review.entityId);
      if (po) {
        const hasExplicitCorrections = Array.isArray(correctedLineItems) && correctedLineItems.length > 0;
        let activeLineItems = hasExplicitCorrections
          ? correctedLineItems
          : (po.lineItems || []);

        // If no explicit human corrections provided, auto-reconcile OCR tax-inclusive line totals
        if (!hasExplicitCorrections) {
          activeLineItems = activeLineItems.map((li: any) => {
            const qty = li.quantity ?? 1;
            const price = li.unitPrice ?? 0;
            const canonicalLineTotal = MoneyUtil.multiply(qty, price).toDecimalPlaces(2);
            const currentTotal = MoneyUtil.from(li.lineTotal ?? 0);
            if (canonicalLineTotal.greaterThan(0) && !MoneyUtil.equals(currentTotal, canonicalLineTotal, 0.01)) {
              return { ...li, lineTotal: MoneyUtil.toNumber(canonicalLineTotal) };
            }
            return li;
          });
        }

        const reconciledTax = reconcileTaxFromLineItems(activeLineItems);
        const subtotalDecimal = MoneyUtil.sum(activeLineItems.map((li: any) => li.lineTotal ?? 0)).toDecimalPlaces(2);
        const subtotal = MoneyUtil.toNumber(subtotalDecimal);
        const effectiveTax = reconciledTax !== null ? reconciledTax : (po.tax || 0);
        const discount = po.discount || 0;
        const totalAmount = MoneyUtil.toNumber(MoneyUtil.calculateTotal(subtotal, effectiveTax, discount).toDecimalPlaces(2));

        await PurchaseOrderRepository.updateExtraction(tenantId, review.entityId, {
          lineItems: activeLineItems,
          subtotal,
          tax: effectiveTax,
          totalAmount
        });

        // B1+B2: Do the PO update + outbox insert FIRST (inside the transaction), THEN resolve the review.
        // This means a retry that hits the "already APPROVED" shortcut knows the PO is already consistent.
        // If the state-machine blocks the PO update (returns null), throw → outbox rolls back → 409.
        let outboxId: string;
        try {
          outboxId = await ResumeJobRepository.createWithTransaction(
            tenantId,
            review.entityId,
            review._id.toString(),
            async (session) => {
              const updated = await PurchaseOrderRepository.updateHumanReviewStatus(
                tenantId,
                review.entityId,
                "HUMAN_APPROVED",
                {
                  humanVerified: true,          // B3: signals human sign-off; preserves real OCR confidence
                  humanReviewedAt: new Date(),
                  humanReviewedBy: req.user!.email,
                  ...(reconciledTax !== null ? { tax: reconciledTax } : {})
                },
                false,
                undefined,
                session                          // B1: session propagation
              );
              if (!updated) {
                throw Object.assign(
                  new Error(`State machine blocked HUMAN_APPROVED transition for PO ${review.entityId}`),
                  { code: "PO_TRANSITION_BLOCKED" }
                );
              }
            }
          );
        } catch (err: any) {
          if (err.code === "PO_TRANSITION_BLOCKED") {
            res.status(409).json({
              code: "PO_STATE_CONFLICT",
              message: "PO status transition to HUMAN_APPROVED was blocked by the state machine. The PO may have already been processed.",
              details: { poId: review.entityId },
              requestId: req.requestId || ""
            });
            return;
          }
          throw err;
        }

        // Fast path: try BullMQ; on enqueued:false fall back to inline synchronous resume.
        const { jobId: resumeJobId, enqueued } = await QueueManager.addPOResumeJob(
          tenantId,
          review.entityId,
          review._id.toString(),
          outboxId
        );
        logger.info({ tenantId, poId: review.entityId, resumeJobId, enqueued, outboxId }, "Queued pipeline resume after approval");
        if (!enqueued) {
          logger.warn(
            { tenantId, poId: review.entityId, outboxId },
            "handleReviewApproval: BullMQ unavailable — falling back to synchronous inline resume"
          );
          // Immediate inline fallback; reconciler is the final safety net
          await executeSynchronousResumeFallback(tenantId, review.entityId, review._id.toString());
        }
      }
    }
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

  // B2: resolveReview runs after the PO+outbox transaction commits.
  const resolved = await ReviewRepository.resolveReview(
    tenantId,
    review._id.toString(),
    "APPROVED",
    resolutionNotes || "Approved by human reviewer",
    req.user!.email
  );
  if (!resolved) {
    // Concurrent resolve is fine — PO+outbox already committed. Re-fetch for response shape.
    const latest = await ReviewRepository.findById(tenantId, reviewId);
    if (latest?.status === "APPROVED") {
      res.status(200).json({
        id: latest._id.toString(),
        entity: latest.entity,
        entityId: latest.entityId,
        stage: latest.stage,
        status: latest.status,
        resolutionNotes: latest.resolutionNotes,
        resolvedBy: latest.resolvedBy,
        resolvedAt: latest.resolvedAt,
        resumeStatus: review.stage === "invoice" ? "COMPLETED" : "QUEUED"
      });
      return;
    }
  }

  await AuditRepository.create(tenantId, {
    agentName: "HumanReviewCenter",
    action: "REVIEW_APPROVED",
    status: "SUCCESS",
    entityId: review.entityId,
    workflowId: "manual_review",
    summary: `Human review (${review.stage} stage) approved by ${req.user!.email}. All exceptions resolved; workflow resumed.`
  });

  res.status(200).json({
    id: (resolved ?? review)._id.toString(),
    entity: (resolved ?? review).entity,
    entityId: (resolved ?? review).entityId,
    stage: (resolved ?? review).stage,
    status: resolved?.status ?? "APPROVED",
    resolutionNotes: resolved?.resolutionNotes,
    resolvedBy: resolved?.resolvedBy,
    resolvedAt: resolved?.resolvedAt,
    resumeStatus: review.stage === "invoice" ? "COMPLETED" : "QUEUED"
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

  // Rule 5: Segregation of duties — delegated to isMakerCheckerViolation() helper (respects ENFORCE_MAKER_CHECKER)
  const currentUserId = req.user!.id || (req.user as any).userId;
  if (await isMakerCheckerViolation(tenantId, review.entity, review.entityId, currentUserId)) {
    res.status(403).json({
      code: "MAKER_CHECKER_VIOLATION",
      message: "Users cannot review documents they submitted",
      details: { reviewer: currentUserId },
      requestId: req.requestId || ""
    });
    return;
  }

  if (review.status === "REJECTED") {
    res.status(200).json({
      id: review._id.toString(),
      entity: review.entity,
      entityId: review.entityId,
      stage: review.stage,
      status: review.status,
      resolutionNotes: review.resolutionNotes,
      resolvedBy: review.resolvedBy,
      resolvedAt: review.resolvedAt,
      discrepancyReport: review.discrepancyReport || [],
      message: "Review is already rejected."
    });
    return;
  }

  if (review.status === "APPROVED") {
    res.status(409).json({
      code: "CANNOT_REJECT_APPROVED_REVIEW",
      message: "Cannot reject a review that has already been approved",
      details: { currentStatus: review.status },
      requestId: req.requestId || ""
    });
    return;
  }

  if (review.status !== "PENDING" && review.status !== "ESCALATED") {
    res.status(400).json({
      code: "ALREADY_RESOLVED",
      message: `Review is already resolved with status ${review.status}`,
      details: { currentStatus: review.status },
      requestId: req.requestId || ""
    });
    return;
  }

  // Rule 1 & Rule 2: Rejection with Re-analysis and Cascading Rejection
  if (review.entity === "purchase_order") {
    const reanalysis = await ReanalysisService.reanalyzePurchaseOrder(tenantId, review.entityId);

    // Case A: If ZERO discrepancies remain within tolerance -> route back for confirmation UNLESS confirmation was already requested or confirmed by user
    const isAlreadyAwaitingConfirmation = Boolean(review.resolutionNotes?.includes("confirmation required"));
    const isExplicitlyConfirmed = req.body?.confirmed === true || req.body?.force === true;

    if (reanalysis.discrepancies.length === 0 && !isAlreadyAwaitingConfirmation && !isExplicitlyConfirmed) {
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

    // Case B: Discrepancies exist (or rejection confirmed): Collect all discrepancies into structured DiscrepancyReport
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

    if (!resolved) {
      const latest = await ReviewRepository.findById(tenantId, reviewId);
      if (latest?.status === "REJECTED") {
        res.status(200).json({
          id: latest._id.toString(),
          entity: latest.entity,
          entityId: latest.entityId,
          stage: latest.stage,
          status: latest.status,
          resolutionNotes: latest.resolutionNotes,
          resolvedBy: latest.resolvedBy,
          resolvedAt: latest.resolvedAt,
          discrepancyReport: latest.discrepancyReport || [],
          message: "Review already rejected by concurrent operation."
        });
        return;
      }
      res.status(409).json({
        code: "REVIEW_STATE_CONFLICT",
        message: `Review was resolved concurrently with status: ${latest?.status || "UNKNOWN"}`,
        details: { currentStatus: latest?.status },
        requestId: req.requestId || ""
      });
      return;
    }

    // Cascade rejection to all open reviews for this entity
    await ReviewRepository.rejectOpenReviewsForEntity(
      tenantId,
      review.entityId,
      `Cascaded rejection from exception ${review._id.toString()}: ${reason}`
    );

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

  // Cascade rejection to all open reviews for this entity
  await ReviewRepository.rejectOpenReviewsForEntity(
    tenantId,
    review.entityId,
    `Cascaded rejection from exception ${review._id.toString()}: ${reason}`
  );

  if (review.stage === "invoice") {
    await InvoiceRepository.updateStatus(tenantId, review.entityId, "REJECTED");
    const inv = await InvoiceRepository.findById(tenantId, review.entityId);
    if (inv) {
      await PurchaseOrderRepository.updateStatus(
        tenantId,
        inv.poId,
        "REJECTED",
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
 * POST /reviews/escalate-stale
 * Triggers SLA escalation for review tickets exceeding the SLA threshold (default 24h)
 */
reviewRouter.post("/escalate-stale", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const thresholdHours = req.body?.thresholdHours ? Number(req.body.thresholdHours) : 24;
  const result = await ReviewRepository.escalateStaleReviews(tenantId, thresholdHours);
  res.status(200).json({
    success: true,
    ...result
  });
});

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
