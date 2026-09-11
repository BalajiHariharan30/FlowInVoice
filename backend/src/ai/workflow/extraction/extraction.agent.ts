import { WorkflowState } from "../state.js";
import { DocumentExtractorFactory, ExtractedPOData } from "../../../agents/providers/ocr.provider.js";
import { StorageService } from "../../../storage/s3.service.js";
import {
  PurchaseOrderRepository,
  AuditRepository
} from "../../../repositories/index.js";
import { logger } from "../../../utils/logger.js";
import { env } from "../../../config/env.js";

/**
 * Agent 1: Extraction Agent
 * Extracts structured PO data from uploaded document in S3.
 */
export function createExtractionNode(tenantId: string) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    logger.info({ tenantId, poId: state.poId }, "ExtractionAgent: Starting extraction node");
    const startTime = Date.now();

    const po = await PurchaseOrderRepository.findById(tenantId, state.poId);
    if (!po) {
      throw new Error(`PO not found for ID: ${state.poId}`);
    }

    const hasPreExtractedData =
      Array.isArray(po.lineItems) &&
      po.lineItems.length > 0 &&
      po.poNumber &&
      !po.poNumber.startsWith("PENDING-");

    // If human reviewer verified/corrected extraction or PO is already extracted with line items, preserve data
    const isHumanVerified =
      Boolean(state.isHumanApproved) ||
      po.status === "HUMAN_APPROVED" ||
      Boolean(po.humanReviewedAt) ||
      po.status === "EXTRACTED" ||
      hasPreExtractedData ||
      po.extractionConfidence === 1.0;

    if (isHumanVerified && hasPreExtractedData) {
      logger.info({ tenantId, poId: state.poId }, "ExtractionAgent: Human-verified/pre-extracted data detected, preserving line items");
      const humanVerified: ExtractedPOData = {
        poNumber: po.poNumber,
        customerName: po.customerName,
        gstNumber: po.gstNumber || "",
        currency: po.currency || "INR",
        paymentTerms: po.paymentTerms || "NET_30",
        issueDate: po.issueDate ? new Date(po.issueDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        subtotal: po.subtotal || 0,
        tax: po.tax || 0,
        discount: po.discount || 0,
        totalAmount: po.totalAmount || 0,
        confidence: po.extractionConfidence ?? 1.0,
        lineItems: po.lineItems
      };
      return {
        currentStep: "extraction",
        status: "EXTRACTED",
        extractedData: humanVerified
      };
    }

    if (!state.isHumanApproved && po.status !== "HUMAN_APPROVED") {
      await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "PROCESSING");
    }

    // Retrieve buffer from S3 (or mock storage)
    const fileBuffer = await StorageService.getFileBuffer(po.s3Key);
    if (!fileBuffer && env.DOCUMENT_AI_PROVIDER !== "mock") {
      throw new Error(
        `Document file buffer is null for PO ${state.poId} (key: ${po.s3Key}). Real document extraction cannot proceed without the uploaded file bytes.`
      );
    }

    try {
      const extractor = DocumentExtractorFactory.getExtractor();

      const extracted = await extractor.extract({
        buffer: fileBuffer || Buffer.from("mock PO content"),
        fileName: po.documentName,
        contentType: po.contentType || "application/pdf"
      });

      const latency = Date.now() - startTime;

      // Persist raw OCR response for auditability if available
      let ocrResultKey: string | undefined;
      const rawResult = extractor.getRawResult?.();
      if (rawResult && rawResult.mode !== "mock") {
        try {
          const rawKey = `tenants/${tenantId}/pos/${state.poId}/raw_ocr_response.json`;
          await StorageService.uploadFile(
            tenantId,
            "pos",
            state.poId,
            "raw_ocr_response.json",
            Buffer.from(JSON.stringify(rawResult, null, 2)),
            "application/json"
          );
          ocrResultKey = rawKey;
        } catch (e: any) {
          logger.warn({ err: e.message }, "Could not persist raw OCR response to storage");
        }
      }

      // Update PO in repository
      await PurchaseOrderRepository.updateExtraction(tenantId, state.poId, {
        poNumber: extracted.poNumber,
        customerName: extracted.customerName,
        gstNumber: extracted.gstNumber,
        currency: extracted.currency,
        paymentTerms: extracted.paymentTerms,
        subtotal: extracted.subtotal,
        tax: extracted.tax,
        discount: extracted.discount,
        totalAmount: extracted.totalAmount,
        extractionConfidence: extracted.confidence,
        ocrResultKey: ocrResultKey || po.ocrResultKey,
        lineItems: extracted.lineItems.map((li) => ({
          lineNumber: li.lineNumber,
          productCode: li.productCode,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: li.lineTotal,
          taxRate: li.taxRate,
          gstNumber: li.gstNumber
        })),
        status: "EXTRACTED"
      });


      await AuditRepository.create(tenantId, {
        agentName: "POExtractionAgent",
        action: "EXTRACT_DOCUMENT",
        status: "SUCCESS",
        entityId: state.poId,
        workflowId: state.workflowId,
        latency,
        summary: `Extracted PO ${extracted.poNumber} with ${extracted.lineItems.length} line items (confidence: ${(extracted.confidence * 100).toFixed(1)}%)`
      });

      const isConfidenceLow = (extracted.confidence ?? 1.0) < 0.75;
      const extractionErrors = isConfidenceLow
        ? [`Low extraction confidence: ${(extracted.confidence * 100).toFixed(1)}%`]
        : [];

      return {
        extractedData: extracted,
        customerName: extracted.customerName,
        validationErrors: extractionErrors,
        isBusinessException: isConfidenceLow,
        status: "EXTRACTED",
        currentStep: "extraction"
      };
    } catch (err: any) {
      // Re-throw unrecoverable data/programming errors (e.g. PO or file buffer not found)
      if (
        err.message?.includes("PO not found") ||
        err.message?.includes("Document file buffer is null")
      ) {
        throw err;
      }

      logger.error({ err, tenantId, poId: state.poId }, "ExtractionAgent failed");
      await AuditRepository.create(tenantId, {
        agentName: "POExtractionAgent",
        action: "EXTRACTION_FAILED",
        status: "FAILURE",
        entityId: state.poId,
        workflowId: state.workflowId,
        summary: `Document extraction failed: ${err.message}`
      });

      const errorMessage = err.message || "Document extraction failed due to a technical error";
      return {
        technicalError: errorMessage,
        failureReason: errorMessage,
        validationErrors: [errorMessage],
        currentStep: "extraction"
      };
    }
  };
}
