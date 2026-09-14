import { Router } from "express";
import { PurchaseOrderModel } from "../../models/purchase-order.model.js";
import { PurchaseOrderEntity, mapToEntityStatus } from "../../domain/entities/purchase-order.entity.js";
import { runDeterministicPipeline } from "../../ai/workflow/deterministic.js";
import { poQueue, QueueManager } from "../../workers/queue.js";
import { inMemory, isDbConnected } from "../../repositories/base.js";

const router = Router();

router.post(["/po/:id/resume", "/pos/:id/resume", "/:id/resume"], async (req: any, res: any) => {
  try {
    const poId = req.params.id;

    // 1. Extract payload safely regardless of frontend nesting structure
    const payload = req.body.po || req.body.invoiceData || req.body.data || req.body || {};

    const vendorName = payload.vendorName || payload.vendor_name;
    const totalAmount = payload.totalAmount ?? payload.total_amount;
    const baseAmount = payload.baseAmount ?? payload.base_amount;
    const taxAmount = payload.taxAmount ?? payload.tax_amount;
    const lineItems = payload.lineItems || payload.line_items || [];

    console.log(`[Resume Route] Processing resume request for PO ID: ${poId}`);

    // 2. Write corrections to MongoDB FIRST & set checkpoint status
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
            status: "READY_FOR_APPROVAL",
            isResumed: true,
          },
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
      return res.status(404).json({ success: false, error: "Purchase Order document not found." });
    }

    console.log(`[Resume Route] Pre-dispatch DB check: PO ${poId} status set to "${updatedDoc.status}", isResumed: ${updatedDoc.isResumed}`);

    // 3. Attempt Asynchronous BullMQ Queue Addition
    let queueSuccess = false;
    try {
      if (QueueManager.getHealthStatus().status === "connected") {
        const queuePromise = poQueue.add(
          "po-resume",
          {
            poId: poId,
            id: poId,
            tenantId: updatedDoc.tenantId,
            isResumeAction: true,
            action: "resume"
          },
          { removeOnComplete: true, attempts: 1 }
        );

        // Race against a 2.5-second timeout to handle Redis connection hangs
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Queue connection timeout")), 2500)
        );

        await Promise.race([queuePromise, timeoutPromise]);
        queueSuccess = true;
        console.log(`[Resume Route] Async job successfully enqueued for PO ${poId}`);
      } else {
        // Fallback to QueueManager internal dispatcher
        await QueueManager.addPOResumeJob(updatedDoc.tenantId, poId, "manual_resume");
        queueSuccess = true;
        console.log(`[Resume Route] Job dispatched via QueueManager for PO ${poId}`);
      }
    } catch (queueError: any) {
      console.warn(`[Resume Route Warning] Queue dispatch failed/timed out (${queueError.message}). Activating Synchronous Inline Fallback.`);
    }

    // 4. Return immediately if Queue accepted the job
    if (queueSuccess) {
      return res.status(200).json({
        success: true,
        executionMode: "async",
        message: "Resumption enqueued via BullMQ queue.",
        status: updatedDoc.status,
      });
    }

    // 5. INLINE SYNCHRONOUS FALLBACK ENGINE: Run pipeline synchronously if Redis is offline / queue drops
    console.log(`[Inline Engine] Executing deterministic pipeline synchronously for PO ${poId}...`);

    const poEntity = PurchaseOrderEntity.create({
      id: updatedDoc._id ? updatedDoc._id.toString() : poId,
      tenantId: updatedDoc.tenantId,
      status: mapToEntityStatus(updatedDoc.status),
      vendorName: updatedDoc.vendorName || updatedDoc.customerName,
      totalAmount: updatedDoc.totalAmount,
      baseAmount: updatedDoc.baseAmount || updatedDoc.subtotal,
      taxAmount: updatedDoc.taxAmount || updatedDoc.tax,
      lineItems: (updatedDoc.lineItems || []).map((li: any) => ({
        description: li.description || li.productCode || "",
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.unitPrice) || 0,
        totalPrice: Number(li.lineTotal || li.totalPrice) || 0,
      })),
      isResumed: true,
      version: updatedDoc.__v || updatedDoc.version || 0,
    });

    // Directly execute pipeline (will trigger resumption bypass for Agents 1-3)
    const resultEntity = await runDeterministicPipeline(poEntity);

    // Persist final result back to database
    let finalDoc: any = null;
    if (isDbConnected()) {
      finalDoc = await PurchaseOrderModel.findByIdAndUpdate(
        poId,
        {
          $set: {
            status: resultEntity.status,
            vendorName: resultEntity.data.vendorName,
            customerName: resultEntity.data.vendorName,
            totalAmount: resultEntity.data.totalAmount,
            baseAmount: resultEntity.data.baseAmount,
            subtotal: resultEntity.data.baseAmount,
            taxAmount: resultEntity.data.taxAmount,
            tax: resultEntity.data.taxAmount,
            lineItems: resultEntity.data.lineItems,
            rejectionReason: resultEntity.data.rejectionReason,
          },
          $inc: { __v: 1 },
        },
        { new: true }
      );
    } else {
      const memDoc = inMemory.pos.get(poId);
      if (memDoc) {
        memDoc.status = resultEntity.status;
        memDoc.vendorName = resultEntity.data.vendorName;
        memDoc.customerName = resultEntity.data.vendorName;
        memDoc.totalAmount = resultEntity.data.totalAmount;
        memDoc.baseAmount = resultEntity.data.baseAmount;
        memDoc.subtotal = resultEntity.data.baseAmount;
        memDoc.taxAmount = resultEntity.data.taxAmount;
        memDoc.tax = resultEntity.data.taxAmount;
        memDoc.lineItems = resultEntity.data.lineItems;
        memDoc.rejectionReason = resultEntity.data.rejectionReason;
        memDoc.version = (memDoc.version || 0) + 1;
        finalDoc = memDoc;
      }
    }

    console.log(`[Inline Engine] Completed synchronous pipeline for PO ${poId}. Final Status: "${finalDoc?.status || resultEntity.status}"`);

    return res.status(200).json({
      success: true,
      executionMode: "sync",
      message: "Resumption executed synchronously via inline fallback engine.",
      status: finalDoc?.status || resultEntity.status,
      po: finalDoc,
    });
  } catch (err: any) {
    console.error(`[Resume Route Error]:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
