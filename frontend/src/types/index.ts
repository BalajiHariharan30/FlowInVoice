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

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details: Record<string, any>;
  requestId: string;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
}

export interface POLineItem {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
  gstNumber?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  customerId?: string;
  customerName: string;
  gstNumber: string;
  status: POStatus;
  currency: string;
  issueDate: string;
  deliveryDate?: string;
  paymentTerms?: string;
  documentName?: string;
  documentUrl?: string;
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  extractionConfidence: number;
  lineItems: POLineItem[];
  retryCount: number;
  failureReason?: string;
  terminationReason?: string;
  workflowId?: string;
  createdBy?: string;
  previousVersionId?: string;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItem {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
  gstNumber?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  poId: string;
  poNumber: string;
  customerId: string;
  customerName: string;
  gstNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  lineItems: InvoiceLineItem[];
  verifiedAt?: string;
  issuedAt?: string;
  createdAt: string;
  updatedAt: string;
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

export interface HumanReview {
  id: string;
  entity: "purchase_order" | "invoice";
  entityId: string;
  stage: ReviewStage;
  status: ReviewStatus;
  priority: ReviewPriority;
  reason: string;
  requestedByAgent: string;
  expectedValue?: string;
  actualValue?: string;
  evidence: EvidenceItem[];
  discrepancyReport?: DiscrepancyItem[];
  suggestedFix?: SuggestedFix;
  assignedTo?: string;
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerContract {
  id: string;
  contractNumber: string;
  contractType: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
  totalValue?: number;
  termsSummary?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  code: string;
  email: string;
  gstNumber: string;
  paymentTerms: string;
  currency: string;
  address?: string;
  contracts?: CustomerContract[];
  contractCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogItem {
  id: string;
  agentName: string;
  action: string;
  status: "SUCCESS" | "FAILURE" | "IN_PROGRESS" | "EXCEPTION";
  entityId: string;
  workflowId: string;
  timestamp: string;
  model?: string;
  latency?: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  summary: string;
  references: string[];
  traceId?: string;
  traceLocation?: string;
}

export interface UserItem {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface DashboardSummary {
  totalPOs: number;
  approvedPOs: number;
  pendingReviews: number;
  totalInvoicedAmount: number;
  processingAccuracy: number;
}

export interface DashboardAnalytics {
  statusBreakdown: Array<{ status: string; count: number }>;
  volumeTrends: Array<{ date: string; count: number; amount: number }>;
  averageProcessingTimeMs: number;
}
