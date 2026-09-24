export type Role = "ADMIN" | "FINANCE" | "OPERATIONS" | "REVIEWER" | "VIEWER";

export type POStatus =
  | "UPLOADED"
  | "PENDING"
  | "PROCESSING"
  | "EXTRACTED"
  | "VALIDATING"
  | "RAG_CHECKING"
  | "COMPLIANCE_CHECKING"
  | "DISCREPANCY_FOUND"
  | "READY_FOR_APPROVAL"
  | "HUMAN_REVIEW"
  | "HUMAN_APPROVED"
  | "APPROVED"
  | "REJECTED"
  | "INVOICE_GENERATING"
  | "INVOICE_VALIDATING"
  | "VALIDATION_FAILED"
  | "COMPLETED"
  | "FAILED"
  | "DELETED";

export type InvoiceStatus =
  | "DRAFT"
  | "GENERATING"
  | "VALIDATING"
  | "HUMAN_REVIEW"
  | "ISSUED"
  | "REJECTED"
  | "CANCELLED";

export type ReviewStage = "extraction" | "validation" | "invoice";

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED";

export type ReviewPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SuggestedFix {
  failurePatternSummary: string;
  rootCauseCategory: string;
  recommendedAction: string;
}

export interface EvidenceItem {
  sourceType: "CONTRACT" | "POLICY";
  documentId: string;
  documentName: string;
  pageNumber: number;
  section: string;
  chunkId?: string;
  claim: string;
}

/**
 * A single structured finding produced by a validation stage check.
 * All checks within a stage are collected into StageFinding[] before
 * creating or updating a HumanReview — never one finding per review.
 */
export interface StageFinding {
  /** Stable ID: "<stage>:<checkName>:<field>" — used to identify this finding across resume cycles. */
  id: string;
  /** The check that produced this finding (e.g. "SUBTOTAL_MATH_CHECK"). */
  checkType: string;
  /** The PO field or line item involved (e.g. "subtotal", "line_1_total"). */
  field: string;
  /** Human-readable string of the expected value. */
  expected: string;
  /** Human-readable string of the actual value found in the document. */
  actual: string;
  /** Full human-readable explanation shown to the reviewer. */
  message: string;
  /** True once the reviewer has corrected this specific finding (set by approve handler). */
  resolved: boolean;
}

export interface DiscrepancyItem {
  nodeId: string;
  field: string;
  expectedValue: any;
  extractedValue: any;
  sourceClause?: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message?: string;
}


export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  stage?: ReviewStage;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  latestOnly?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
}
