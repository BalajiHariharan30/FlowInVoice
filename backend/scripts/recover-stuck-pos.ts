/**
 * recover-stuck-pos.ts — One-off recovery script for stuck POs.
 *
 * Dry-run by default; pass --apply to execute repairs.
 *
 * Cases:
 *   a) PO in HUMAN_REVIEW with zero PENDING/ESCALATED reviews
 *      → set to FAILED so a reviewer can re-triage
 *   b) PO in HUMAN_APPROVED with no PENDING/ENQUEUED/PROCESSING resume row
 *      → create a PENDING outbox row so the reconciler picks it up
 *   c) Resume rows stuck in PROCESSING for > 10 minutes
 *      → release the lock back to PENDING
 *
 * Usage:
 *   npx tsx scripts/recover-stuck-pos.ts           # dry-run
 *   npx tsx scripts/recover-stuck-pos.ts --apply   # execute repairs
 */

import mongoose from "mongoose";
import { config } from "dotenv";
import { PurchaseOrder, HumanReview, ResumeJob } from "../src/models/index.js";

config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const STUCK_PROCESSING_MINS = 10;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  await mongoose.connect(uri);
  console.log(`[recover-stuck-pos] Connected. dry-run=${!APPLY}`);

  // ── Case A: PO in HUMAN_REVIEW with zero open reviews ──────────────────────
  const humanReviewPOs = await PurchaseOrder.find({ status: "HUMAN_REVIEW" }).lean();
  let caseACount = 0;
  for (const po of humanReviewPOs) {
    const openReviews = await HumanReview.countDocuments({
      tenantId: po.tenantId,
      entityId: (po._id as any).toString(),
      status: { $in: ["PENDING", "ESCALATED"] }
    });
    if (openReviews === 0) {
      caseACount++;
      console.log(`[A] PO ${po._id} (${po.tenantId}) stuck HUMAN_REVIEW with no open reviews`);
      if (APPLY) {
        await PurchaseOrder.findByIdAndUpdate(po._id, {
          $set: { status: "FAILED", failureReason: "Recovered: no open reviews but stuck in HUMAN_REVIEW", updatedAt: new Date() }
        });
        console.log(`    → set to FAILED for re-triage`);
      }
    }
  }
  console.log(`[A] Total: ${caseACount} stuck HUMAN_REVIEW POs`);

  // ── Case B: PO in HUMAN_APPROVED with no active resume row ─────────────────
  const humanApprovedPOs = await PurchaseOrder.find({ status: "HUMAN_APPROVED" }).lean();
  let caseBCount = 0;
  for (const po of humanApprovedPOs) {
    const activeRow = await ResumeJob.findOne({
      tenantId: po.tenantId,
      poId: (po._id as any).toString(),
      status: { $in: ["PENDING", "ENQUEUED", "PROCESSING"] }
    }).lean();
    if (!activeRow) {
      caseBCount++;
      console.log(`[B] PO ${po._id} (${po.tenantId}) stuck HUMAN_APPROVED with no resume row`);
      if (APPLY) {
        const [newRow] = await ResumeJob.create([{
          tenantId: po.tenantId,
          poId: (po._id as any).toString(),
          reviewId: "recovered",
          status: "PENDING",
          attempts: 0,
          lastError: null,
          processingLock: null
        }]);
        console.log(`    → created outbox row ${newRow._id}`);
      }
    }
  }
  console.log(`[B] Total: ${caseBCount} stuck HUMAN_APPROVED POs`);

  // ── Case C: Resume rows stuck in PROCESSING for > STUCK_PROCESSING_MINS ───
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MINS * 60 * 1000);
  const stuckRows = await ResumeJob.find({ status: "PROCESSING", processingLock: { $lt: cutoff } }).lean();
  console.log(`[C] Total: ${stuckRows.length} PROCESSING rows stuck > ${STUCK_PROCESSING_MINS}m`);
  for (const row of stuckRows) {
    console.log(`[C] ResumeJob ${row._id} (${row.tenantId}/${row.poId}) stuck PROCESSING since ${(row as any).processingLock}`);
    if (APPLY) {
      await ResumeJob.findByIdAndUpdate(row._id, {
        $set: { status: "PENDING", processingLock: null, lastError: "Released by recovery script", updatedAt: new Date() }
      });
      console.log(`    → released lock, set to PENDING`);
    }
  }

  await mongoose.disconnect();
  console.log(`[recover-stuck-pos] Done. ${APPLY ? "Repairs applied." : "Dry-run only — rerun with --apply to execute."}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
