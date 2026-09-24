import crypto from "crypto";
import mongoose from "mongoose";
import { HumanReview, IHumanReview, IStageFinding } from "../models/index.js";
import { PaginationParams, PaginatedResult, ReviewStatus, ReviewStage } from "../types/index.js";
import { inMemory, isDbConnected, generateId, calcPagination } from "./base.js";
import { AuditRepository } from "./audit.repository.js";
import { logger } from "../utils/logger.js";

/**
 * Computes a deterministic deduplication key for a Human Review queue item.
 * Key components: tenantId + entity + entityId + stage + requestedByAgent + normalized reason
 */
export function computeReviewDedupKey(tenantId: string, data: Partial<IHumanReview>): string {
  if (data.dedupKey && typeof data.dedupKey === "string" && data.dedupKey.trim().length > 0) {
    return data.dedupKey.trim();
  }
  const entityId = data.entityId || (data as any).poId || "";
  const entity = data.entity || "purchase_order";
  const stage = data.stage || "validation";
  const agent = data.requestedByAgent || "system";
  // Normalize reason by trimming and collapsing multiple spaces
  const reason = (data.reason || "").trim().replace(/\s+/g, " ");

  const rawKey = `${tenantId}:${entity}:${entityId}:${stage}:${agent}:${reason}`;
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Merges two evidence arrays without duplicates based on chunkId, documentId + section, or claim.
 */
export function mergeEvidenceArrays(existing: any[] = [], incoming: any[] = []): any[] {
  const merged = [...existing];
  for (const ev of incoming) {
    const isDuplicate = merged.some(
      (e) =>
        (e.chunkId && ev.chunkId && e.chunkId === ev.chunkId) ||
        (e.documentId === ev.documentId && e.section === ev.section) ||
        (e.claim && ev.claim && e.claim === ev.claim)
    );
    if (!isDuplicate) {
      merged.push(ev);
    }
  }
  return merged;
}

export class ReviewRepository {
  /**
   * Enforces write-time deduplication and upsert.
   * If an existing ticket with the same dedupKey exists:
   *   - If APPROVED: no-op / preserves APPROVED status, logs warning, does not create new row.
   *   - If REJECTED: preserves REJECTED status, logs warning.
   *   - If PENDING: updates existing row with merged evidence, latest details, and new timestamp.
   * If not found: inserts a single canonical row.
   */
  static async create(tenantId: string, data: Partial<IHumanReview>): Promise<IHumanReview> {
    const dedupKey = computeReviewDedupKey(tenantId, data);
    const enrichedData = { ...data, tenantId, dedupKey };

    if (isDbConnected()) {
      // 1. Check for existing review by dedupKey or legacy entityId + stage + reason
      let existing = await HumanReview.findOne({ tenantId, dedupKey });
      if (!existing && data.entityId && data.reason) {
        existing = await HumanReview.findOne({
          tenantId,
          entityId: data.entityId,
          stage: data.stage || "validation",
          reason: data.reason
        });
        if (existing && !existing.dedupKey) {
          existing.dedupKey = dedupKey;
        }
      }

      if (existing) {
        if (existing.status === "APPROVED") {
          logger.warn(
            {
              tenantId,
              dedupKey,
              existingReviewId: existing._id.toString(),
              entityId: data.entityId,
              reason: data.reason
            },
            "ReviewRepository.create: Duplicate review write detected for an already APPROVED item. Preserving APPROVED status and skipping duplicate creation."
          );
          if (data.evidence && data.evidence.length > 0) {
            existing.evidence = mergeEvidenceArrays(existing.evidence || [], data.evidence) as any;
            existing.updatedAt = new Date();
            await existing.save();
          }
          return existing;
        }

        if (existing.status === "REJECTED") {
          logger.warn(
            {
              tenantId,
              dedupKey,
              existingReviewId: existing._id.toString(),
              entityId: data.entityId,
              reason: data.reason
            },
            "ReviewRepository.create: Duplicate review write detected for an already REJECTED item. Preserving REJECTED status."
          );
          return existing;
        }

        // Existing is PENDING: update in-place rather than creating a new row
        logger.warn(
          {
            tenantId,
            dedupKey,
            existingReviewId: existing._id.toString(),
            entityId: data.entityId,
            reason: data.reason
          },
          "ReviewRepository.create: Duplicate review write detected for PENDING review item. Updating existing record instead of creating duplicate row."
        );
        const mergedEvidence = mergeEvidenceArrays(existing.evidence || [], data.evidence || []);
        existing.reason = data.reason || existing.reason;
        existing.priority = data.priority || existing.priority;
        existing.stage = data.stage || existing.stage;
        existing.expectedValue = data.expectedValue || existing.expectedValue;
        existing.actualValue = data.actualValue || existing.actualValue;
        existing.evidence = mergedEvidence as any;
        if (data.discrepancyReport) existing.discrepancyReport = data.discrepancyReport as any;
        existing.dedupKey = dedupKey;
        existing.updatedAt = new Date();
        return existing.save();
      }

      // 2. Insert new canonical record
      try {
        const review = new HumanReview(enrichedData);
        return await review.save();
      } catch (err: any) {
        if (err.code === 11000) {
          logger.warn(
            { tenantId, dedupKey, err: err.message },
            "ReviewRepository.create: Concurrent duplicate key E11000 caught; resolving to existing record."
          );
          const conflictRecord = await HumanReview.findOne({ tenantId, dedupKey });
          if (conflictRecord) {
            if (conflictRecord.status === "APPROVED") return conflictRecord;
            const mergedEvidence = mergeEvidenceArrays(conflictRecord.evidence || [], data.evidence || []);
            conflictRecord.evidence = mergedEvidence as any;
            conflictRecord.updatedAt = new Date();
            return conflictRecord.save();
          }
        }
        throw err;
      }
    }

    // In-Memory Mode (for mock/unit test environments)
    const existingInMemory = Array.from(inMemory.reviews.values()).find(
      (r) =>
        r.tenantId === tenantId &&
        (r.dedupKey === dedupKey ||
          (r.entityId === data.entityId && r.stage === data.stage && r.reason === data.reason))
    );

    if (existingInMemory) {
      if (existingInMemory.status === "APPROVED") {
        logger.warn(
          { tenantId, dedupKey, existingReviewId: existingInMemory._id, entityId: data.entityId },
          "ReviewRepository.create: Duplicate in-memory write detected for already APPROVED item. Preserving APPROVED status."
        );
        return existingInMemory;
      }
      if (existingInMemory.status === "REJECTED") {
        logger.warn(
          { tenantId, dedupKey, existingReviewId: existingInMemory._id, entityId: data.entityId },
          "ReviewRepository.create: Duplicate in-memory write detected for already REJECTED item. Preserving status."
        );
        return existingInMemory;
      }

      logger.warn(
        { tenantId, dedupKey, existingReviewId: existingInMemory._id, entityId: data.entityId },
        "ReviewRepository.create: Duplicate in-memory write detected for PENDING item. Updating existing record."
      );
      const mergedEvidence = mergeEvidenceArrays(existingInMemory.evidence || [], data.evidence || []);
      Object.assign(existingInMemory, data, {
        evidence: mergedEvidence,
        dedupKey,
        updatedAt: new Date()
      });
      return existingInMemory;
    }

    const id = generateId();
    const doc: any = {
      ...data,
      _id: id,
      id,
      tenantId,
      dedupKey,
      evidence: data.evidence || [],
      createdAt: (data as any).createdAt ? new Date((data as any).createdAt) : new Date(),
      updatedAt: new Date()
    };
    inMemory.reviews.set(id, doc);
    return doc;
  }

  static async findById(tenantId: string, id: string): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return HumanReview.findOne({ tenantId, _id: id });
    }
    const doc = inMemory.reviews.get(id);
    return doc?.tenantId === tenantId ? doc : null;
  }

  static async findByEntityId(tenantId: string, entityId: string): Promise<IHumanReview[]> {
    if (isDbConnected()) {
      return HumanReview.find({ tenantId, entityId }).sort({ createdAt: -1 });
    }
    return Array.from(inMemory.reviews.values()).filter(
      (r) => r.tenantId === tenantId && r.entityId === entityId
    );
  }

  static async findPendingByEntityId(tenantId: string, entityId: string): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      return HumanReview.findOne({ tenantId, entityId, status: "PENDING" }).sort({ createdAt: -1 });
    }
    const items = Array.from(inMemory.reviews.values())
      .filter((r) => r.tenantId === tenantId && r.entityId === entityId && r.status === "PENDING")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items[0] || null;
  }

  /**
   * Finds the most recent non-terminal review for a specific (tenantId, entityId, stage).
   * Non-terminal = PENDING or ESCALATED.
   */
  static async findPendingByStage(
    tenantId: string,
    entityId: string,
    stage: ReviewStage
  ): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      return HumanReview.findOne({
        tenantId,
        entityId,
        stage,
        status: { $in: ["PENDING", "ESCALATED"] }
      }).sort({ createdAt: -1 });
    }
    const items = Array.from(inMemory.reviews.values())
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.entityId === entityId &&
          r.stage === stage &&
          (r.status === "PENDING" || r.status === "ESCALATED")
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items[0] || null;
  }

  /**
   * INVARIANT ENFORCEMENT: Maximum one non-terminal review per (tenantId, entityId, stage).
   *
   * - If NO review exists for this (poId, stage) or the existing one is terminal (APPROVED/REJECTED):
   *     • Creates a new PENDING review with the provided findings.
   * - If a non-terminal (PENDING/ESCALATED) review EXISTS for this (poId, stage):
   *     • REPLACES its findings array with the new findings (not appended — replaces).
   *     • Increments resumeAttempts by 1.
   *     • Updates reason, priority, checkpointStep, evidence.
   *     • Status stays PENDING (or ESCALATED — not changed).
   *     • This is the "partial fix approved, resume, still has errors" path.
   * - If a PREVIOUSLY APPROVED review exists AND new findings exist for the same stage:
   *     • REOPENS the review: sets status back to PENDING, replaces findings, increments resumeAttempts.
   *     • This supports the "approve partial fix → same review updated" spec requirement.
   *
   * Returns the created or updated IHumanReview document.
   */
  static async findOrUpdateStageReview(
    tenantId: string,
    data: Partial<IHumanReview> & { findings: IStageFinding[] }
  ): Promise<IHumanReview> {
    const stage = data.stage!;
    const entityId = data.entityId!;

    if (isDbConnected()) {
      // Look for any existing review for this (poId, stage) — non-terminal first, then most recent
      let existing = await HumanReview.findOne({
        tenantId,
        entityId,
        stage,
        status: { $in: ["PENDING", "ESCALATED"] }
      }).sort({ createdAt: -1 });

      if (!existing) {
        // Check for the most recent APPROVED review for this stage (reopen path)
        existing = await HumanReview.findOne({
          tenantId,
          entityId,
          stage,
          status: "APPROVED"
        }).sort({ createdAt: -1 }) as any;
      }

      if (existing) {
        const wasApproved = existing.status === "APPROVED";
        const updatePayload: any = {
          findings: data.findings,
          reason: data.reason || existing.reason,
          priority: data.priority || existing.priority,
          checkpointStep: data.checkpointStep || existing.checkpointStep,
          actualValue: data.actualValue || existing.actualValue,
          updatedAt: new Date()
        };
        if (data.evidence && data.evidence.length > 0) {
          updatePayload.evidence = mergeEvidenceArrays(existing.evidence || [], data.evidence as any[]);
        }
        if (data.suggestedFix) {
          updatePayload.suggestedFix = data.suggestedFix;
        }
        if (wasApproved) {
          // Reopen: reset to PENDING, clear resolution fields, increment resumeAttempts
          updatePayload.status = "PENDING";
          updatePayload.resolvedAt = undefined;
          updatePayload.resolvedBy = undefined;
          updatePayload.resolutionNotes = undefined;
          updatePayload.resumeAttempts = (existing.resumeAttempts || 0) + 1;
          logger.info(
            { tenantId, entityId, stage, resumeAttempts: updatePayload.resumeAttempts },
            "ReviewRepository.findOrUpdateStageReview: Reopening APPROVED review with new findings after partial fix"
          );
        } else {
          updatePayload.resumeAttempts = (existing.resumeAttempts || 0) + 1;
          logger.info(
            { tenantId, entityId, stage, resumeAttempts: updatePayload.resumeAttempts },
            "ReviewRepository.findOrUpdateStageReview: Updating existing PENDING review with new findings"
          );
        }
        const updated = await HumanReview.findOneAndUpdate(
          { tenantId, _id: existing._id },
          { $set: updatePayload },
          { new: true }
        );
        return updated!;
      }

      // No existing review → create fresh
      const dedupKey = computeReviewDedupKey(tenantId, data);
      try {
        const review = new HumanReview({ ...data, tenantId, dedupKey, resumeAttempts: 0 });
        return await review.save();
      } catch (err: any) {
        if (err.code === 11000) {
          // Race: concurrent workflow run created the same review
          const conflict = await HumanReview.findOne({
            tenantId, entityId, stage, status: { $in: ["PENDING", "ESCALATED"] }
          }).sort({ createdAt: -1 });
          if (conflict) {
            conflict.findings = data.findings as any;
            conflict.resumeAttempts = (conflict.resumeAttempts || 0) + 1;
            conflict.updatedAt = new Date();
            return conflict.save();
          }
        }
        throw err;
      }
    }

    // ── In-Memory Mode (tests) ──────────────────────────────────────────────
    const stage_ = data.stage!;

    let existing = Array.from(inMemory.reviews.values())
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.entityId === entityId &&
          r.stage === stage_ &&
          (r.status === "PENDING" || r.status === "ESCALATED")
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

    if (!existing) {
      // Check for APPROVED (reopen path)
      existing = Array.from(inMemory.reviews.values())
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            r.entityId === entityId &&
            r.stage === stage_ &&
            r.status === "APPROVED"
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
    }

    if (existing) {
      const wasApproved = existing.status === "APPROVED";
      (existing as any).findings = data.findings;
      (existing as any).resumeAttempts = ((existing as any).resumeAttempts || 0) + 1;
      if (data.reason) existing.reason = data.reason;
      if (data.priority) existing.priority = data.priority;
      if (data.checkpointStep) existing.checkpointStep = data.checkpointStep;
      if (data.actualValue) existing.actualValue = data.actualValue;
      if (data.evidence && data.evidence.length > 0) {
        existing.evidence = mergeEvidenceArrays(existing.evidence || [], data.evidence as any[]) as any;
      }
      if (data.suggestedFix) (existing as any).suggestedFix = data.suggestedFix;
      if (wasApproved) {
        existing.status = "PENDING";
        existing.resolvedAt = undefined;
        existing.resolvedBy = undefined;
        existing.resolutionNotes = undefined;
        logger.info(
          { tenantId, entityId, stage: stage_, resumeAttempts: (existing as any).resumeAttempts },
          "ReviewRepository.findOrUpdateStageReview [in-memory]: Reopening APPROVED review with new findings"
        );
      }
      existing.updatedAt = new Date();
      return existing;
    }

    // Create fresh in-memory
    const id = generateId();
    const dedupKey = computeReviewDedupKey(tenantId, data);
    const doc: any = {
      ...data,
      _id: id,
      id,
      tenantId,
      dedupKey,
      findings: data.findings,
      resumeAttempts: 0,
      evidence: data.evidence || [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.reviews.set(id, doc);
    return doc;
  }

  static async findMany(
    tenantId: string,
    params: PaginationParams
  ): Promise<PaginatedResult<IHumanReview>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query: any = { tenantId };
      if (params.stage) query.stage = params.stage;
      if (params.status) query.status = params.status;
      const [data, total] = await Promise.all([
        HumanReview.find(query).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
        HumanReview.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    let items = Array.from(inMemory.reviews.values()).filter((r) => r.tenantId === tenantId);
    if (params.stage) items = items.filter((r) => r.stage === params.stage);
    if (params.status) items = items.filter((r) => r.status === params.status);
    // Always sort newest first
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }

  static async rejectOpenReviewsForEntity(
    tenantId: string,
    entityId: string,
    reason: string
  ): Promise<void> {
    const resolvedAt = new Date();
    if (isDbConnected()) {
      await HumanReview.updateMany(
        {
          tenantId,
          $or: [{ entityId }, { poId: entityId }],
          status: { $nin: ["APPROVED", "REJECTED"] }
        },
        { status: "REJECTED", resolvedAt, resolutionNotes: reason }
      );
      return;
    }
    for (const doc of inMemory.reviews.values()) {
      if (
        doc.tenantId === tenantId &&
        (doc.entityId === entityId || (doc as any).poId === entityId) &&
        doc.status !== "APPROVED" &&
        doc.status !== "REJECTED"
      ) {
        doc.status = "REJECTED";
        doc.resolvedAt = resolvedAt;
        doc.resolutionNotes = reason;
        doc.updatedAt = resolvedAt;
      }
    }
  }

  static async updateReview(
    tenantId: string,
    id: string,
    updates: Partial<IHumanReview>
  ): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return HumanReview.findOneAndUpdate(
        { tenantId, _id: id },
        { $set: { ...updates, updatedAt: new Date() } },
        { new: true }
      );
    }
    const doc = inMemory.reviews.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    Object.assign(doc, updates, { updatedAt: new Date() });
    return doc;
  }

  static async resolveReview(
    tenantId: string,
    id: string,
    status: ReviewStatus,
    resolutionNotes: string,
    resolvedBy: string,
    extra?: { discrepancyReport?: any[]; evidence?: any[]; rejectionReason?: string }
  ): Promise<IHumanReview | null> {
    const updatePayload: any = {
      status,
      resolutionNotes,
      resolvedBy,
      resolvedAt: new Date(),
      updatedAt: new Date()
    };
    if (extra?.discrepancyReport) {
      updatePayload.discrepancyReport = extra.discrepancyReport;
    }
    if (extra?.evidence) {
      updatePayload.evidence = extra.evidence;
    }
    if (extra?.rejectionReason) {
      updatePayload.rejectionReason = extra.rejectionReason;
    }

    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      const target = await HumanReview.findOneAndUpdate(
        { tenantId, _id: id, status: { $in: ["PENDING", "ESCALATED"] } },
        { $set: updatePayload },
        { new: true }
      );

      if (!target) return null;

      // Approval Propagation Rule: If approved, propagate ONLY to true duplicates (same dedupKey or same entity+stage+root reason)
      if (status === "APPROVED") {
        const orConditions: any[] = [];
        if (target.dedupKey) orConditions.push({ dedupKey: target.dedupKey });
        if (target.stage && target.reason && target.reason.length >= 10) {
          const sanitizedPrefix = target.reason.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          orConditions.push({
            entityId: target.entityId,
            stage: target.stage,
            reason: { $regex: new RegExp("^" + sanitizedPrefix, "i") }
          });
        }

        if (orConditions.length > 0) {
          const staleQuery: any = {
            tenantId,
            _id: { $ne: target._id },
            status: { $in: ["PENDING", "ESCALATED"] },
            $or: orConditions
          };

          const staleCount = await HumanReview.countDocuments(staleQuery);
          if (staleCount > 0) {
            logger.warn(
              { tenantId, dedupKey: target.dedupKey, entityId: target.entityId, staleCount },
              "Stale pending duplicate review item(s) detected during approval. Propagating APPROVED status across exact duplicates."
            );
            await HumanReview.updateMany(staleQuery, {
              $set: {
                status: "APPROVED",
                resolutionNotes: `Resolved alongside primary review approval (${target._id.toString()})`,
                resolvedBy,
                resolvedAt: new Date(),
                updatedAt: new Date()
              }
            });
          }
        }
      }

      return target;
    }

    // In-Memory Mode
    const doc = inMemory.reviews.get(id);
    if (!doc || doc.tenantId !== tenantId || (doc.status !== "PENDING" && doc.status !== "ESCALATED")) return null;
    Object.assign(doc, updatePayload);

    if (status === "APPROVED") {
      let staleCount = 0;
      for (const sibling of inMemory.reviews.values()) {
        const isDuplicate =
          sibling.tenantId === tenantId &&
          sibling._id !== id &&
          (sibling.status === "PENDING" || sibling.status === "ESCALATED") &&
          ((doc.dedupKey && sibling.dedupKey === doc.dedupKey) ||
           (sibling.entityId === doc.entityId &&
            sibling.stage === doc.stage &&
            doc.reason &&
            sibling.reason &&
            (sibling.reason === doc.reason ||
             sibling.reason.startsWith(doc.reason) ||
             doc.reason.startsWith(sibling.reason) ||
             (doc.reason.length >= 15 && sibling.reason.slice(0, 15) === doc.reason.slice(0, 15)))));

        if (isDuplicate) {
          sibling.status = "APPROVED";
          sibling.resolutionNotes = `Resolved alongside primary review approval (${id})`;
          sibling.resolvedBy = resolvedBy;
          sibling.resolvedAt = new Date();
          sibling.updatedAt = new Date();
          staleCount++;
        }
      }
      if (staleCount > 0) {
        logger.warn(
          { tenantId, dedupKey: doc.dedupKey, entityId: doc.entityId, staleCount },
          "Stale pending duplicate in-memory review item(s) detected during approval. Propagating APPROVED status across exact duplicates."
        );
      }
    }

    return doc;
  }

  /**
   * SLA Monitor: Identifies unresolved review tickets older than threshold (default 24h)
   * and marks them as ESCALATED without altering final approval/rejection outcome.
   */
  static async escalateStaleReviews(
    tenantId?: string,
    thresholdHours = 24
  ): Promise<{ escalatedCount: number; escalatedIds: string[] }> {
    const cutoffDate = new Date(Date.now() - thresholdHours * 3600 * 1000);
    const escalatedIds: string[] = [];

    if (isDbConnected()) {
      const query: any = {
        status: "PENDING",
        createdAt: { $lt: cutoffDate }
      };
      if (tenantId) query.tenantId = tenantId;

      const staleReviews = await HumanReview.find(query);
      for (const rev of staleReviews) {
        rev.status = "ESCALATED";
        rev.updatedAt = new Date();
        await rev.save();
        escalatedIds.push(rev._id.toString());

        await AuditRepository.create(rev.tenantId, {
          agentName: "SlaMonitor",
          action: "REVIEW_ESCALATED",
          status: "EXCEPTION",
          entityId: rev.entityId,
          workflowId: "sla_monitor",
          summary: `Human review (${rev.stage} stage) exceeded ${thresholdHours}h SLA and was marked ESCALATED. Reason: ${rev.reason}`
        });
      }
      return { escalatedCount: escalatedIds.length, escalatedIds };
    }

    // In-Memory Mode
    for (const [id, doc] of inMemory.reviews.entries()) {
      if (
        (!tenantId || doc.tenantId === tenantId) &&
        doc.status === "PENDING" &&
        new Date(doc.createdAt).getTime() < cutoffDate.getTime()
      ) {
        doc.status = "ESCALATED";
        doc.updatedAt = new Date();
        escalatedIds.push(id);

        await AuditRepository.create(doc.tenantId, {
          agentName: "SlaMonitor",
          action: "REVIEW_ESCALATED",
          status: "EXCEPTION",
          entityId: doc.entityId,
          workflowId: "sla_monitor",
          summary: `Human review (${doc.stage} stage) exceeded ${thresholdHours}h SLA and was marked ESCALATED. Reason: ${doc.reason}`
        });
      }
    }

    return { escalatedCount: escalatedIds.length, escalatedIds };
  }

  static async findLatestByEntityId(tenantId: string, entityId: string): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      return HumanReview.findOne({ tenantId, entityId }).sort({ createdAt: -1 });
    }
    const items = Array.from(inMemory.reviews.values())
      .filter((r) => r.tenantId === tenantId && r.entityId === entityId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items[0] || null;
  }

  static async closeDuplicatePendingTickets(
    tenantId: string,
    entityId: string,
    keepReviewId?: string,
    decision: ReviewStatus = "APPROVED",
    dedupKey?: string
  ): Promise<void> {
    let keepReview: IHumanReview | null = null;
    if (keepReviewId) {
      keepReview = await this.findById(tenantId, keepReviewId);
      if (keepReview && !dedupKey && keepReview.dedupKey) {
        dedupKey = keepReview.dedupKey;
      }
    }

    const stage = keepReview?.stage;
    const reason = keepReview?.reason;

    if (isDbConnected()) {
      const orConditions: any[] = [];
      if (dedupKey) orConditions.push({ dedupKey });
      if (stage && reason && reason.length >= 10) {
        const sanitizedPrefix = reason.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        orConditions.push({
          entityId,
          stage,
          reason: { $regex: new RegExp("^" + sanitizedPrefix, "i") }
        });
      }

      if (orConditions.length === 0) return;

      const query: any = {
        tenantId,
        status: { $in: ["PENDING", "ESCALATED"] },
        $or: orConditions
      };
      if (keepReviewId && mongoose.isValidObjectId(keepReviewId)) {
        query._id = { $ne: keepReviewId };
      }
      const count = await HumanReview.countDocuments(query);
      if (count > 0) {
        logger.warn(
          { tenantId, entityId, keepReviewId, decision, count, dedupKey },
          `Closing ${count} duplicate pending tickets with decision: ${decision}`
        );
        await HumanReview.updateMany(query, {
          $set: {
            status: decision,
            resolutionNotes: `Resolved alongside primary review decision (${decision})`,
            resolvedAt: new Date(),
            updatedAt: new Date()
          }
        });
      }
      return;
    }

    let count = 0;
    for (const r of inMemory.reviews.values()) {
      const isDuplicate =
        r.tenantId === tenantId &&
        r._id !== keepReviewId &&
        (r.status === "PENDING" || r.status === "ESCALATED") &&
        ((dedupKey && r.dedupKey === dedupKey) ||
         (r.entityId === entityId &&
          stage &&
          r.stage === stage &&
          reason &&
          r.reason &&
          (r.reason === reason ||
           r.reason.startsWith(reason) ||
           reason.startsWith(r.reason) ||
           (reason.length >= 15 && r.reason.slice(0, 15) === reason.slice(0, 15)))));

      if (isDuplicate) {
        r.status = decision;
        r.resolutionNotes = `Resolved alongside primary review decision (${decision})`;
        r.resolvedAt = new Date();
        r.updatedAt = new Date();
        count++;
      }
    }
    if (count > 0) {
      logger.warn(
        { tenantId, entityId, keepReviewId, decision, count, dedupKey },
        `Closing ${count} in-memory duplicate pending tickets with decision: ${decision}`
      );
    }
  }

  /**
   * Migration & Cleanup Helper:
   * Collapses duplicate review rows sharing the same dedupKey into one canonical row.
   * If any duplicate among them is APPROVED, the canonical row's status = APPROVED;
   * otherwise keeps the latest status. Merges all evidence and deletes the rest.
   */
  static async collapseDuplicates(tenantId?: string): Promise<{
    totalEvaluated: number;
    groupsEvaluated: number;
    duplicatesDeleted: number;
    canonicalUpdated: number;
  }> {
    let duplicatesDeleted = 0;
    let canonicalUpdated = 0;
    let totalEvaluated = 0;
    let groupsEvaluated = 0;

    if (isDbConnected()) {
      const filter: any = tenantId ? { tenantId } : {};
      const allReviews = await HumanReview.find(filter).sort({ createdAt: 1 });
      totalEvaluated = allReviews.length;

      const groups = new Map<string, IHumanReview[]>();
      for (const r of allReviews) {
        if (!r.dedupKey) {
          r.dedupKey = computeReviewDedupKey(r.tenantId, r);
          await r.save();
        }
        const groupKey = `${r.tenantId}__${r.dedupKey}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey)!.push(r);
      }

      groupsEvaluated = groups.size;

      for (const [groupKey, records] of groups.entries()) {
        if (records.length <= 1) continue;

        const approvedRecord = records.find((r) => r.status === "APPROVED");
        const canonical = approvedRecord || records[records.length - 1];
        const targetStatus: ReviewStatus = approvedRecord ? "APPROVED" : canonical.status;

        const siblingIds = records
          .filter((r) => r._id.toString() !== canonical._id.toString())
          .map((r) => r._id);

        let combinedEvidence: any[] = canonical.evidence || [];
        for (const r of records) {
          combinedEvidence = mergeEvidenceArrays(combinedEvidence, r.evidence || []);
        }

        canonical.status = targetStatus;
        canonical.evidence = combinedEvidence as any;
        if (approvedRecord && !canonical.resolvedAt) {
          canonical.resolvedAt = approvedRecord.resolvedAt || new Date();
          canonical.resolvedBy = approvedRecord.resolvedBy || "migration_cleanup";
          canonical.resolutionNotes = approvedRecord.resolutionNotes || "Canonical approved record";
        }
        canonical.updatedAt = new Date();
        await canonical.save();
        canonicalUpdated++;

        await HumanReview.deleteMany({ _id: { $in: siblingIds } });
        duplicatesDeleted += siblingIds.length;

        logger.warn(
          {
            groupKey,
            canonicalId: canonical._id.toString(),
            deletedCount: siblingIds.length,
            finalStatus: targetStatus
          },
          "Migration: Collapsed duplicate review items into canonical record"
        );
      }

      return { totalEvaluated, groupsEvaluated, duplicatesDeleted, canonicalUpdated };
    }

    // In-Memory Mode
    const allReviews = Array.from(inMemory.reviews.values()).filter(
      (r) => !tenantId || r.tenantId === tenantId
    );
    totalEvaluated = allReviews.length;

    const groups = new Map<string, any[]>();
    for (const r of allReviews) {
      if (!r.dedupKey) {
        r.dedupKey = computeReviewDedupKey(r.tenantId, r);
      }
      const groupKey = `${r.tenantId}__${r.dedupKey}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(r);
    }

    groupsEvaluated = groups.size;

    for (const [groupKey, records] of groups.entries()) {
      if (records.length <= 1) continue;

      const approvedRecord = records.find((r) => r.status === "APPROVED");
      const canonical = approvedRecord || records[records.length - 1];
      const targetStatus: ReviewStatus = approvedRecord ? "APPROVED" : canonical.status;

      const siblingIds = records
        .filter((r) => r._id !== canonical._id)
        .map((r) => r._id);

      let combinedEvidence: any[] = canonical.evidence || [];
      for (const r of records) {
        combinedEvidence = mergeEvidenceArrays(combinedEvidence, r.evidence || []);
      }

      canonical.status = targetStatus;
      canonical.evidence = combinedEvidence;
      if (approvedRecord && !canonical.resolvedAt) {
        canonical.resolvedAt = approvedRecord.resolvedAt || new Date();
        canonical.resolvedBy = approvedRecord.resolvedBy || "migration_cleanup";
        canonical.resolutionNotes = approvedRecord.resolutionNotes || "Canonical approved record";
      }
      canonical.updatedAt = new Date();
      canonicalUpdated++;

      for (const sid of siblingIds) {
        inMemory.reviews.delete(sid);
        duplicatesDeleted++;
      }

      logger.warn(
        {
          groupKey,
          canonicalId: canonical._id,
          deletedCount: siblingIds.length,
          finalStatus: targetStatus
        },
        "Migration: Collapsed in-memory duplicate review items into canonical record"
      );
    }

    return { totalEvaluated, groupsEvaluated, duplicatesDeleted, canonicalUpdated };
  }
}

/**
 * Reconciles tax from line item tax rates if available.
 * Returns the exact computed tax or null if line items have no tax rates.
 */
export function reconcileTaxFromLineItems(lineItems?: any[]): number | null {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return null;
  const lineTaxesSum = lineItems.reduce((acc: number, li: any) => {
    const lt = typeof li.lineTotal === "number" ? li.lineTotal : Number(li.lineTotal) || 0;
    const tr = typeof li.taxRate === "number" ? li.taxRate : Number(li.taxRate) || 0;
    return acc + (lt * tr / 100);
  }, 0);
  return lineTaxesSum > 0 ? Number(lineTaxesSum.toFixed(2)) : null;
}


