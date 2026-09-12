import { ExtractedPOData } from "../../agents/providers/ocr.provider.js";
import { EvidenceItem } from "../../types/index.js";

export interface WorkflowValidationCheck {
  checkName: string;
  passed: boolean;
  message: string;
  details?: any;
}

export interface MatchedLineItem {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
  catalogPrice?: number;
  variancePercentage?: number;
  isMatch?: boolean;
  requiresCatalogReview?: boolean;
  autoAcceptedNewSku?: boolean;
}

/**
 * Plain TypeScript WorkflowState interface for FlowInvoice AI PO/Invoice Workflow.
 * Replaces LangGraph StateAnnotation with deterministic state representation.
 */
export interface WorkflowState {
  // Immutable tenant & entity identifiers
  tenantId: string;
  poId: string;
  workflowId: string;
  documentName: string;
  s3Key: string;

  // Agent 1: Extraction state
  extractedData?: ExtractedPOData;

  // Agent 2: Matching state
  customerId?: string;
  customerName?: string;
  matchedLineItems: MatchedLineItem[];

  // Agent 3: PO Verification & Math checks
  validationChecks: WorkflowValidationCheck[];
  validationErrors: string[];

  // Agent 4: Policy & Contract Evaluation
  evidence: EvidenceItem[];
  allowedVariancePct: number;
  policySourceReferences: string[];
  noActiveContract: boolean;
  requiresCatalogReview: boolean;

  // Agent 5: Approval Decision state
  approvalRequired: boolean;
  approvalReason?: string;

  // Agent 6: Exception / Review ticket
  reviewId?: string;
  isBusinessException: boolean;

  // Agent 7: Posting & ERP state
  invoiceId?: string;
  invoiceNumber?: string;
  s3PdfKey?: string;
  erpPostingId?: string;

  // Lifecycle & Telemetry tracking
  status: string;
  currentStep: string;
  failureReason?: string;
  toolCallCount: number;
  stepRetries: Record<string, number>;
  technicalError?: string;
  isHumanApproved: boolean;
  skipValidation: boolean;
  resumedFromStep?: string;
}
