export type Role = "ADMIN" | "FINANCE" | "OPERATIONS" | "REVIEWER" | "VIEWER";

export type POStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "EXTRACTED"
  | "VALIDATING"
  | "RAG_CHECKING"
  | "COMPLIANCE_CHECKING"
  | "HUMAN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "INVOICE_GENERATING"
  | "INVOICE_VALIDATING"
  | "COMPLETED"
  | "FAILED";

export type InvoiceStatus =
  | "DRAFT"
  | "GENERATING"
  | "VALIDATING"
  | "HUMAN_REVIEW"
  | "ISSUED"
  | "REJECTED"
  | "CANCELLED";

export type ReviewStage = "extraction" | "validation" | "invoice";

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ReviewPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface EvidenceItem {
  sourceType: "CONTRACT" | "POLICY";
  documentId: string;
  documentName: string;
  pageNumber: number;
  section: string;
  chunkId?: string;
  claim: string;
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
