import { WorkflowState } from "../state.js";
import { DocumentExtractorFactory, ExtractedPOData } from "../../../agents/providers/ocr.provider.js";
import { StorageService } from "../../../storage/s3.service.js";
import {
  PurchaseOrderRepository,
  AuditRepository
} from "../../../repositories/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Agent 1: Extraction Agent
 * Extracts structured PO data from uploaded document in S3.
 */
export function createExtractionNode(tenantId: string) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    logger.info({ tenantId, poId: state.poId }, "ExtractionAgent: Starting extraction node");
    const startTime = Date.now();

    try {
      const po = await PurchaseOrderRepository.findById(tenantId, state.poId);
      if (!po) {
        throw new Error(`PO not found for ID: ${state.poId}`);
      }

      await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "PROCESSING");

      // If human reviewer verified/corrected extraction, preserve verified data
      if (
        po.lineItems &&
        po.lineItems.length > 0 &&
        po.extractionConfidence === 1.0 &&
        po.poNumber &&
        !po.poNumber.startsWith("PENDING-")
      ) {
        logger.info({ tenantId, poId: state.poId }, "ExtractionAgent: Human-verified extraction detected, preserving corrected line items");
        const humanVerified: ExtractedPOData = {
          poNumber: po.poNumber,
          customerName: po.customerName,
          gstNumber: po.gstNumber || "",
          currency: po.currency || "USD",
          paymentTerms: po.paymentTerms || "NET_30",
          issueDate: po.issueDate ? new Date(po.issueDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
          subtotal: po.subtotal || 0,
          tax: po.tax || 0,
          discount: po.discount || 0,
          totalAmount: po.totalAmount || 0,
          confidence: 1.0,
          lineItems: po.lineItems
        };
        return {
          currentStep: "extraction",
          status: "EXTRACTED",
          extractedData: humanVerified
        };
      }

      // Retrieve buffer from S3 (or mock storage)
      const fileBuffer = await StorageService.getFileBuffer(po.s3Key);
      const extractor = DocumentExtractorFactory.getExtractor();

      const extracted = await extractor.extract({
        buffer: fileBuffer || Buffer.from("mock PO content"),
        fileName: po.documentName,
        contentType: po.contentType || "application/pdf"
      });

      const latency = Date.now() - startTime;

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

      return {
        extractedData: extracted,
        customerName: extracted.customerName,
        status: "EXTRACTED",
        currentStep: "extraction"
      };
    } catch (err: any) {
      logger.error({ err, tenantId, poId: state.poId }, "ExtractionAgent failed");
      await AuditRepository.create(tenantId, {
        agentName: "POExtractionAgent",
        action: "EXTRACTION_FAILED",
        status: "FAILURE",
        entityId: state.poId,
        workflowId: state.workflowId,
        summary: `Document extraction failed: ${err.message}`
      });

      throw err;
    }
  };
}
