import { Router } from "express";
import { PurchaseOrderModel } from "../../models/purchase-order.model.js";
import { poQueue, QueueManager } from "../../workers/queue.js";
import { inMemory, isDbConnected } from "../../repositories/base.js";

const router = Router();

router.post(["/po/:id/resume", "/pos/:id/resume", "/:id/resume"], async (req: any, res: any) => {
  try {
    const poId = req.params.id;

    // Extract payload gracefully regardless of frontend nesting shape
    const payload = req.body.po || req.body.invoiceData || req.body.data || req.body || {};

    const vendorName = payload.vendorName || payload.vendor_name;
    const totalAmount = payload.totalAmount ?? payload.total_amount;
    const baseAmount = payload.baseAmount ?? payload.base_amount;
    const taxAmount = payload.taxAmount ?? payload.tax_amount;
    const lineItems = payload.lineItems || payload.line_items || [];

    console.log(`[Resume API] Received resume request for PO: ${poId}`);

    // Update MongoDB document FIRST with corrected user canvas data & checkpoint status
    let updatedDoc: any = null;

    if (isDbConnected()) {
      updatedDoc = await PurchaseOrderModel.findByIdAndUpdate(
        poId,
        {
          $set: {
            ...(vendorName && { vendorName, customerName: vendorName }),
            ...(totalAmount !== undefined && { totalAmount }),
            ...(baseAmount !== undefined && { baseAmount, subtotal: baseAmount }),
            ...(taxAmount !== undefined && { taxAmount, tax: taxAmount }),
            ...(lineItems.length > 0 && { lineItems }),
            status: "READY_FOR_APPROVAL", // Force checkpoint status
            isResumed: true
          }
        },
        { new: true }
      );
    } else {
      const doc = inMemory.pos.get(poId);
      if (doc) {
        if (vendorName) {
          doc.vendorName = vendorName;
          doc.customerName = vendorName;
        }
        if (totalAmount !== undefined) doc.totalAmount = totalAmount;
        if (baseAmount !== undefined) {
          doc.baseAmount = baseAmount;
          doc.subtotal = baseAmount;
        }
        if (taxAmount !== undefined) {
          doc.taxAmount = taxAmount;
          doc.tax = taxAmount;
        }
        if (lineItems.length > 0) doc.lineItems = lineItems;
        doc.status = "READY_FOR_APPROVAL";
        doc.isResumed = true;
        updatedDoc = doc;
      }
    }

    if (!updatedDoc) {
      return res.status(404).json({ success: false, error: "Purchase Order not found in database" });
    }

    console.log(`[Resume API] Pre-dispatch DB check: PO ${poId} status set to "${updatedDoc.status}", isResumed: ${updatedDoc.isResumed}`);

    // Add job to BullMQ with explicit resume parameters
    try {
      if (QueueManager.getHealthStatus().status === "connected") {
        await poQueue.add(
          "po-resume",
          {
            poId: poId,
            id: poId,
            tenantId: updatedDoc.tenantId,
            isResumeAction: true,
            action: "resume"
          },
          {
            removeOnComplete: true,
            attempts: 1
          }
        );
      } else {
        await QueueManager.addPOResumeJob(updatedDoc.tenantId, poId, "manual_resume");
      }
    } catch (queueErr: any) {
      console.warn(`[Resume API] BullMQ direct enqueue failed (${queueErr.message}), falling back to QueueManager`);
      await QueueManager.addPOResumeJob(updatedDoc.tenantId, poId, "manual_resume");
    }

    console.log(`[Resume API] Successfully enqueued po-resume job for PO: ${poId}`);
    return res.status(200).json({
      success: true,
      message: "Resumption job enqueued successfully",
      status: updatedDoc.status
    });
  } catch (err: any) {
    console.error(`[Resume API Error]:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
