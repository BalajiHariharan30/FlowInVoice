/**
 * ResumeJobRepository — durable outbox for BullMQ resume jobs.
 *
 * Pattern: write to outbox (PENDING) atomically with PO status change,
 * then mark ENQUEUED when BullMQ accepts the job. A reconciler picks up
 * any PENDING rows older than N minutes and re-attempts.
 */
import mongoose from "mongoose";
import { ResumeJob, IResumeJob } from "../models/index.js";
import { inMemory, generateId, isDbConnected } from "./base.js";

export class ResumeJobRepository {
  /**
   * Atomically write PO status update + outbox insert in a MongoDB session.
   * Falls back to non-transactional writes when running in-memory.
   */
  static async createWithTransaction(
    tenantId: string,
    poId: string,
    reviewId: string,
    updatePoFn: (session: mongoose.ClientSession | null) => Promise<void>
  ): Promise<string> {
    if (!isDbConnected()) {
      // In-memory mode: no transactions needed
      await updatePoFn(null);
      const id = generateId();
      inMemory.resumeJobs.set(id, {
        id,
        tenantId,
        poId,
        reviewId,
        status: "PENDING",
        attempts: 0,
        lastError: null,
        processingLock: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return id;
    }

    const session = await mongoose.startSession();
    let outboxId = "";
    try {
      await session.withTransaction(async () => {
        await updatePoFn(session);
        const [doc] = await ResumeJob.create(
          [{ tenantId, poId, reviewId, status: "PENDING", attempts: 0, lastError: null, processingLock: null }],
          { session }
        );
        outboxId = doc._id.toString();
      });
    } finally {
      await session.endSession();
    }
    return outboxId;
  }

  /** Mark the outbox row ENQUEUED (BullMQ accepted it). */
  static async markEnqueued(outboxId: string): Promise<void> {
    if (!isDbConnected()) {
      const row = inMemory.resumeJobs.get(outboxId);
      if (row) { row.status = "ENQUEUED"; row.updatedAt = new Date(); }
      return;
    }
    await ResumeJob.findByIdAndUpdate(outboxId, { status: "ENQUEUED", updatedAt: new Date() });
  }

  /** Mark DONE after worker completes successfully. */
  static async markDone(outboxId: string): Promise<void> {
    if (!isDbConnected()) {
      const row = inMemory.resumeJobs.get(outboxId);
      if (row) { row.status = "DONE"; row.updatedAt = new Date(); }
      return;
    }
    await ResumeJob.findByIdAndUpdate(outboxId, { status: "DONE", updatedAt: new Date() });
  }

  /** Record a BullMQ enqueue failure — leave as PENDING for reconciler. */
  static async markEnqueueFailed(outboxId: string, error: string): Promise<void> {
    if (!isDbConnected()) {
      const row = inMemory.resumeJobs.get(outboxId);
      if (row) { row.lastError = error; row.updatedAt = new Date(); }
      return;
    }
    await ResumeJob.findByIdAndUpdate(outboxId, { lastError: error, updatedAt: new Date() });
  }

  /**
   * Acquire a processing lock on a PENDING row (idempotent, prevents
   * double-processing between reconciler and a late BullMQ delivery).
   * Returns the locked row, or null if someone else beat us to it.
   */
  static async acquireLock(outboxId: string): Promise<IResumeJob | null> {
    if (!isDbConnected()) {
      const row = inMemory.resumeJobs.get(outboxId);
      if (!row || row.status !== "PENDING" || row.processingLock) return null;
      row.processingLock = new Date();
      row.status = "PROCESSING";
      row.attempts = (row.attempts || 0) + 1;
      return row as unknown as IResumeJob;
    }
    // Atomic findOneAndUpdate to avoid races
    return ResumeJob.findOneAndUpdate(
      { _id: outboxId, status: "PENDING", processingLock: null },
      { $set: { processingLock: new Date(), status: "PROCESSING" }, $inc: { attempts: 1 } },
      { new: true }
    );
  }

  /** Release lock back to PENDING (on transient failure, let reconciler retry). */
  static async releaseLock(outboxId: string, error: string): Promise<void> {
    if (!isDbConnected()) {
      const row = inMemory.resumeJobs.get(outboxId);
      if (row) { row.status = "PENDING"; row.processingLock = null; row.lastError = error; }
      return;
    }
    await ResumeJob.findByIdAndUpdate(outboxId, {
      status: "PENDING",
      processingLock: null,
      lastError: error,
      updatedAt: new Date()
    });
  }

  /** Mark permanently failed (too many attempts). */
  static async markFailed(outboxId: string, error: string): Promise<void> {
    if (!isDbConnected()) {
      const row = inMemory.resumeJobs.get(outboxId);
      if (row) { row.status = "FAILED"; row.lastError = error; row.processingLock = null; }
      return;
    }
    await ResumeJob.findByIdAndUpdate(outboxId, {
      status: "FAILED",
      processingLock: null,
      lastError: error,
      updatedAt: new Date()
    });
  }

  /**
   * Find all PENDING rows created more than `staleSecs` seconds ago
   * (reconciler picks these up).
   */
  static async findStaleRows(staleSecs = 120): Promise<IResumeJob[]> {
    if (!isDbConnected()) {
      const cutoff = new Date(Date.now() - staleSecs * 1000);
      return Array.from(inMemory.resumeJobs.values()).filter(
        (r: any) => r.status === "PENDING" && new Date(r.createdAt) < cutoff
      ) as unknown as IResumeJob[];
    }
    const cutoff = new Date(Date.now() - staleSecs * 1000);
    return ResumeJob.find({ status: "PENDING", processingLock: null, createdAt: { $lt: cutoff } }).lean() as unknown as IResumeJob[];
  }

  /** Count rows stuck PENDING past `staleSecs`. */
  static async countStuck(staleSecs = 300): Promise<number> {
    if (!isDbConnected()) {
      const cutoff = new Date(Date.now() - staleSecs * 1000);
      return Array.from(inMemory.resumeJobs.values()).filter(
        (r: any) => r.status === "PENDING" && new Date(r.createdAt) < cutoff
      ).length;
    }
    const cutoff = new Date(Date.now() - staleSecs * 1000);
    return ResumeJob.countDocuments({ status: "PENDING", createdAt: { $lt: cutoff } });
  }
}
