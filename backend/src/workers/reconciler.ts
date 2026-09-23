/**
 * Reconciliation Worker — polls for PENDING resume_jobs and re-attempts BullMQ.
 *
 * Runs every 90 seconds in production. Idempotent: checks PO is still in a
 * resumable state before dispatching, uses per-row processing locks to prevent
 * races between multiple Render instances or between the reconciler and a late
 * BullMQ delivery.
 */
import { logger } from "../utils/logger.js";
import { ResumeJobRepository } from "../repositories/index.js";
import { PurchaseOrderRepository } from "../repositories/index.js";
import { QueueManager } from "./queue.js";

const MAX_ATTEMPTS = 5;
const STALE_AFTER_SECS = 120;   // pick up rows older than 2 minutes
const STUCK_ALERT_SECS = 300;   // alert if still stuck after 5 minutes
const POLL_INTERVAL_MS = 90_000; // 90 seconds

let reconcilerTimer: NodeJS.Timeout | null = null;

/** Terminal PO statuses — never resume these */
const TERMINAL = new Set(["REJECTED", "DELETED", "COMPLETED", "FAILED"]);

async function runReconcilerCycle(): Promise<void> {
  try {
    const rows = await ResumeJobRepository.findStaleRows(STALE_AFTER_SECS);
    if (rows.length === 0) return;

    logger.info({ count: rows.length }, "Reconciler: found stale PENDING resume jobs");

    for (const row of rows) {
      const outboxId = (row as any)._id?.toString() ?? (row as any).id;
      const { tenantId, poId, reviewId, attempts } = row as any;

      // Idempotency: check PO is still in a resumable state
      const po = await PurchaseOrderRepository.findById(tenantId, poId);
      if (!po || TERMINAL.has(po.status)) {
        logger.info({ poId, status: po?.status }, "Reconciler: PO is terminal, marking outbox DONE");
        await ResumeJobRepository.markDone(outboxId).catch(() => {});
        continue;
      }

      // Acquire lock to prevent double-processing
      const locked = await ResumeJobRepository.acquireLock(outboxId);
      if (!locked) {
        // Another instance or a concurrent cycle grabbed it
        continue;
      }

      logger.info({ outboxId, poId, tenantId, attempts }, "Reconciler: re-attempting BullMQ enqueue");

      try {
        await QueueManager.addPOResumeJob(tenantId, poId, reviewId, outboxId);
        // addPOResumeJob marks ENQUEUED on success and leaves PENDING on BullMQ failure.
        // If BullMQ is still down the lock is still held; release it back to PENDING.
      } catch (err: any) {
        logger.error({ err: err.message, outboxId, poId }, "Reconciler: re-enqueue threw unexpectedly");

        if ((attempts ?? 0) >= MAX_ATTEMPTS) {
          await ResumeJobRepository.markFailed(outboxId, err.message).catch(() => {});
          logger.error(
            { outboxId, poId, tenantId, attempts },
            "[ALERT] Reconciler exhausted attempts — resume job FAILED permanently"
          );
        } else {
          await ResumeJobRepository.releaseLock(outboxId, err.message).catch(() => {});
        }
      }
    }

    // === OBSERVABILITY: alert on jobs stuck beyond STUCK_ALERT_SECS ===
    const stuck = await ResumeJobRepository.countStuck(STUCK_ALERT_SECS);
    if (stuck > 0) {
      // TODO: wire to Sentry/Slack/PagerDuty
      logger.warn(
        { stuckCount: stuck, thresholdSecs: STUCK_ALERT_SECS },
        "[ALERT] resume_jobs health: jobs stuck PENDING past alert threshold"
      );
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "Reconciler cycle error (non-fatal)");
  }
}

/**
 * Start the reconciler background poller.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startReconciler(): void {
  if (reconcilerTimer) return;   // Already running
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Reconciler: starting resume-job outbox poller");
  reconcilerTimer = setInterval(runReconcilerCycle, POLL_INTERVAL_MS);
  // Unref so it doesn't keep the process alive in tests
  if (reconcilerTimer.unref) reconcilerTimer.unref();
}

/** Stop the reconciler (for clean shutdown / tests). */
export function stopReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}

/** Expose a one-shot run for tests. */
export { runReconcilerCycle };
