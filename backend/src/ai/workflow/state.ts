import { Annotation } from "@langchain/langgraph";
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
 * LangGraph State Annotation for FlowInvoice AI PO/Invoice Workflow.
 * Bounded: contains IDs, flags, and structured data only (no full documents, secrets, or raw buffers).
 */
export const WorkflowStateAnnotation = Annotation.Root({
  // Immutable tenant & entity identifiers (populated by Express entrypoint, read-only to nodes)
  tenantId: Annotation<string>({
    reducer: (_, update) => update,
    default: () => ""
  }),
  poId: Annotation<string>({
    reducer: (_, update) => update,
    default: () => ""
  }),
  workflowId: Annotation<string>({
    reducer: (_, update) => update,
    default: () => ""
  }),
  documentName: Annotation<string>({
    reducer: (_, update) => update,
    default: () => ""
  }),
  s3Key: Annotation<string>({
    reducer: (_, update) => update,
    default: () => ""
  }),

  // Agent 1: Extraction state
  extractedData: Annotation<ExtractedPOData | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),

  // Agent 2: Matching state
  customerId: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  customerName: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  matchedLineItems: Annotation<MatchedLineItem[]>({
    reducer: (_, update) => update,
    default: () => []
  }),

  // Agent 3: PO Verification & Math checks
  validationChecks: Annotation<WorkflowValidationCheck[]>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => []
  }),
  validationErrors: Annotation<string[]>({
    reducer: (curr: string[], update: string[] | null | undefined) =>
      update === null ? [] : (update !== undefined ? update : curr),
    default: () => []
  }),

  // Agent 4: Policy & Contract Evaluation
  evidence: Annotation<EvidenceItem[]>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => []
  }),
  allowedVariancePct: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 10.0
  }),
  policySourceReferences: Annotation<string[]>({
    reducer: (curr, update) => (update !== undefined ? Array.from(new Set([...curr, ...update])) : curr),
    default: () => []
  }),
  noActiveContract: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false
  }),
  requiresCatalogReview: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false
  }),

  // Agent 5: Approval Decision state
  approvalRequired: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false
  }),
  approvalReason: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),

  // Agent 6: Exception / Review ticket
  reviewId: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  isBusinessException: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false
  }),

  // Agent 7: Posting & ERP state
  invoiceId: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  invoiceNumber: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  s3PdfKey: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  erpPostingId: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),

  // Lifecycle & Telemetry tracking
  status: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "PROCESSING"
  }),
  currentStep: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "intake"
  }),
  failureReason: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  toolCallCount: Annotation<number>({
    reducer: (curr, update) => curr + update,
    default: () => 0
  }),
  stepRetries: Annotation<Record<string, number>>({
    reducer: (curr, update) => ({ ...curr, ...update }),
    default: () => ({})
  }),
  technicalError: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  isHumanApproved: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false
  }),
  skipValidation: Annotation<boolean>({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false
  }),
  resumedFromStep: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  })
});

export type WorkflowState = typeof WorkflowStateAnnotation.State;
