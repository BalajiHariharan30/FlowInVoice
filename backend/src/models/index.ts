import mongoose, { Schema, Document } from "mongoose";
import { Role, POStatus, InvoiceStatus, ReviewStage, ReviewStatus, ReviewPriority } from "../types/index.js";

// -------------------------------------------------------------
// 1. Customer Model
// -------------------------------------------------------------
export interface ICustomer extends Document {
  tenantId: string;
  name: string;
  code: string;
  email: string;
  gstNumber: string;
  paymentTerms: string;
  currency: string;
  address: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    email: { type: String, required: true },
    gstNumber: { type: String, required: true },
    paymentTerms: { type: String, default: "NET_30" },
    currency: { type: String, default: "USD" },
    address: { type: String, default: "" }
  },
  { timestamps: true }
);
CustomerSchema.index({ tenantId: 1, code: 1 }, { unique: true });
CustomerSchema.index({ tenantId: 1, name: 1 });

// -------------------------------------------------------------
// 2. Contract Model (Customer 1 — N Contract)
// -------------------------------------------------------------
export interface IContract extends Document {
  tenantId: string;
  customerId: string;
  contractNumber: string;
  contractType: string;
  effectiveFrom: Date;
  effectiveTo: Date;
  status: "ACTIVE" | "EXPIRED" | "TERMINATED" | "DRAFT";
  s3Key?: string;
  totalValue?: number;
  termsSummary?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContractSchema = new Schema<IContract>(
  {
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    contractNumber: { type: String, required: true },
    contractType: { type: String, default: "MASTER_SERVICES_AGREEMENT" },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, required: true },
    status: { type: String, enum: ["ACTIVE", "EXPIRED", "TERMINATED", "DRAFT"], default: "ACTIVE" },
    s3Key: { type: String },
    totalValue: { type: Number },
    termsSummary: { type: String }
  },
  { timestamps: true }
);
ContractSchema.index({ tenantId: 1, contractNumber: 1 }, { unique: true });
ContractSchema.index({ tenantId: 1, customerId: 1 });

// -------------------------------------------------------------
// 3. Purchase Order & Line Item Models
// -------------------------------------------------------------
export interface IPOLineItem {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
  gstNumber?: string;
  matchedProductId?: string;
}

const POLineItemSchema = new Schema<IPOLineItem>(
  {
    lineNumber: { type: Number, required: true },
    productCode: { type: String, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    taxRate: { type: Number, default: 0 },
    gstNumber: { type: String },
    matchedProductId: { type: String }
  },
  { _id: false }
);

export interface IPurchaseOrder extends Document {
  tenantId: string;
  poNumber: string;
  customerId?: string;
  customerName: string;
  gstNumber: string;
  status: POStatus;
  currency: string;
  issueDate: Date;
  deliveryDate?: Date;
  paymentTerms: string;
  s3Key: string;
  documentName: string;
  documentSize: number;
  contentType: string;
  ocrResultKey?: string;
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  extractionConfidence: number;
  governingContractId?: string;
  lineItems: IPOLineItem[];
  retryCount: number;
  failureReason?: string;
  workflowId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PurchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    tenantId: { type: String, required: true, index: true },
    poNumber: { type: String, required: true },
    customerId: { type: String, index: true },
    customerName: { type: String, required: true },
    gstNumber: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "UPLOADED",
        "PROCESSING",
        "EXTRACTED",
        "VALIDATING",
        "RAG_CHECKING",
        "COMPLIANCE_CHECKING",
        "HUMAN_REVIEW",
        "APPROVED",
        "REJECTED",
        "INVOICE_GENERATING",
        "INVOICE_VALIDATING",
        "COMPLETED",
        "FAILED"
      ],
      default: "UPLOADED",
      index: true
    },
    currency: { type: String, default: "USD" },
    issueDate: { type: Date, default: Date.now },
    deliveryDate: { type: Date },
    paymentTerms: { type: String, default: "NET_30" },
    s3Key: { type: String, required: true },
    documentName: { type: String, required: true },
    documentSize: { type: Number, required: true },
    contentType: { type: String, required: true },
    ocrResultKey: { type: String },
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    extractionConfidence: { type: Number, default: 1.0 },
    governingContractId: { type: String },
    lineItems: [POLineItemSchema],
    retryCount: { type: Number, default: 0 },
    failureReason: { type: String },
    workflowId: { type: String }
  },
  { timestamps: true }
);
PurchaseOrderSchema.index({ tenantId: 1, poNumber: 1 }, { unique: true });
PurchaseOrderSchema.index({ tenantId: 1, status: 1 });
PurchaseOrderSchema.index({ tenantId: 1, customerId: 1 });
PurchaseOrderSchema.index({ tenantId: 1, createdAt: -1 });

// -------------------------------------------------------------
// 4. Invoice & Line Item Models
// -------------------------------------------------------------
export interface IInvoiceLineItem {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
  gstNumber?: string;
}

const InvoiceLineItemSchema = new Schema<IInvoiceLineItem>(
  {
    lineNumber: { type: Number, required: true },
    productCode: { type: String, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    taxRate: { type: Number, default: 0 },
    gstNumber: { type: String }
  },
  { _id: false }
);

export interface IInvoice extends Document {
  tenantId: string;
  invoiceNumber: string;
  poId: string;
  poNumber: string;
  customerId: string;
  customerName: string;
  gstNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  paymentTerms: string;
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  s3PdfKey?: string;
  lineItems: IInvoiceLineItem[];
  verifiedAt?: Date;
  issuedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema = new Schema<IInvoice>(
  {
    tenantId: { type: String, required: true, index: true },
    invoiceNumber: { type: String, required: true },
    poId: { type: String, required: true, index: true },
    poNumber: { type: String, required: true },
    customerId: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    gstNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ["DRAFT", "GENERATING", "VALIDATING", "HUMAN_REVIEW", "ISSUED", "REJECTED", "CANCELLED"],
      default: "DRAFT",
      index: true
    },
    currency: { type: String, default: "USD" },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    paymentTerms: { type: String, default: "NET_30" },
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    s3PdfKey: { type: String },
    lineItems: [InvoiceLineItemSchema],
    verifiedAt: { type: Date },
    issuedAt: { type: Date }
  },
  { timestamps: true }
);
InvoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });
InvoiceSchema.index({ tenantId: 1, poId: 1 });
InvoiceSchema.index({ tenantId: 1, status: 1 });
InvoiceSchema.index({ tenantId: 1, createdAt: -1 });

// -------------------------------------------------------------
// 5. Human Review Model
// -------------------------------------------------------------
export interface IEvidenceItem {
  sourceType: "CONTRACT" | "POLICY";
  documentId: string;
  documentName: string;
  pageNumber: number;
  section: string;
  chunkId?: string;
  claim: string;
}

const EvidenceItemSchema = new Schema<IEvidenceItem>(
  {
    sourceType: { type: String, enum: ["CONTRACT", "POLICY"], required: true },
    documentId: { type: String, required: true },
    documentName: { type: String, required: true },
    pageNumber: { type: Number, required: true },
    section: { type: String, required: true },
    chunkId: { type: String },
    claim: { type: String, required: true }
  },
  { _id: false }
);

export interface IHumanReview extends Document {
  tenantId: string;
  entity: "purchase_order" | "invoice";
  entityId: string;
  stage: ReviewStage;
  status: ReviewStatus;
  priority: ReviewPriority;
  reason: string;
  requestedByAgent: string;
  expectedValue?: string;
  actualValue?: string;
  evidence: IEvidenceItem[];
  assignedTo?: string;
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const HumanReviewSchema = new Schema<IHumanReview>(
  {
    tenantId: { type: String, required: true, index: true },
    entity: { type: String, enum: ["purchase_order", "invoice"], required: true },
    entityId: { type: String, required: true, index: true },
    stage: { type: String, enum: ["extraction", "validation", "invoice"], required: true, index: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
    priority: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "MEDIUM" },
    reason: { type: String, required: true },
    requestedByAgent: { type: String, required: true },
    expectedValue: { type: String },
    actualValue: { type: String },
    evidence: [EvidenceItemSchema],
    assignedTo: { type: String },
    resolutionNotes: { type: String },
    resolvedBy: { type: String },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);
HumanReviewSchema.index({ tenantId: 1, status: 1 });
HumanReviewSchema.index({ tenantId: 1, entityId: 1, stage: 1 });

// -------------------------------------------------------------
// 6. Validation Result Model
// -------------------------------------------------------------
export interface IValidationResult extends Document {
  tenantId: string;
  poId: string;
  stage: "extraction" | "business_validation" | "invoice";
  status: "PASSED" | "FAILED" | "REQUIRES_REVIEW";
  checks: Array<{
    checkName: string;
    passed: boolean;
    message: string;
    details?: any;
  }>;
  confidence: number;
  validationErrors: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ValidationResultSchema = new Schema<IValidationResult>(
  {
    tenantId: { type: String, required: true, index: true },
    poId: { type: String, required: true, index: true },
    stage: { type: String, enum: ["extraction", "business_validation", "invoice"], required: true },
    status: { type: String, enum: ["PASSED", "FAILED", "REQUIRES_REVIEW"], required: true },
    checks: [
      {
        checkName: { type: String, required: true },
        passed: { type: Boolean, required: true },
        message: { type: String, required: true },
        details: { type: Schema.Types.Mixed }
      }
    ],
    confidence: { type: Number, default: 1.0 },
    validationErrors: [{ type: String }]
  },
  { timestamps: true }
);
ValidationResultSchema.index({ tenantId: 1, poId: 1 });

// -------------------------------------------------------------
// 7. Audit Log Model (Bounded 16MB Discipline §B24)
// -------------------------------------------------------------
export interface IAuditLog extends Document {
  tenantId: string;
  agentName: string;
  action: string;
  status: "SUCCESS" | "FAILURE" | "IN_PROGRESS" | "EXCEPTION";
  entityId: string;
  workflowId: string;
  timestamp: Date;
  aiModel?: string;
  latency?: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  summary: string;
  references?: string[];
  traceId?: string;
  traceLocation?: string;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    tenantId: { type: String, required: true, index: true },
    agentName: { type: String, required: true },
    action: { type: String, required: true },
    status: { type: String, enum: ["SUCCESS", "FAILURE", "IN_PROGRESS", "EXCEPTION"], required: true },
    entityId: { type: String, required: true, index: true },
    workflowId: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    aiModel: { type: String },
    latency: { type: Number },
    tokenUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 }
    },
    summary: { type: String, required: true },
    references: [{ type: String }],
    traceId: { type: String },
    traceLocation: { type: String }
  },
  { timestamps: false }
);
AuditLogSchema.index({ tenantId: 1, entityId: 1, timestamp: -1 });

// -------------------------------------------------------------
// 8. User Model
// -------------------------------------------------------------
export interface IUser extends Document {
  tenantId: string;
  email: string;
  passwordHash?: string;
  name: string;
  role: Role;
  googleId?: string;
  isActive: boolean;
  refreshTokenHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    tenantId: { type: String, required: true, index: true },
    email: { type: String, required: true },
    passwordHash: { type: String },
    name: { type: String, required: true },
    role: { type: String, enum: ["ADMIN", "FINANCE", "OPERATIONS", "REVIEWER", "VIEWER"], default: "VIEWER" },
    googleId: { type: String },
    isActive: { type: Boolean, default: true },
    refreshTokenHash: { type: String }
  },
  { timestamps: true }
);
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

// -------------------------------------------------------------
// 9. Product & Pricing Models
// -------------------------------------------------------------
export interface IProduct extends Document {
  tenantId: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  basePrice: number;
}

const ProductSchema = new Schema<IProduct>(
  {
    tenantId: { type: String, required: true, index: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    category: { type: String, default: "GENERAL" },
    unit: { type: String, default: "EA" },
    basePrice: { type: Number, required: true }
  },
  { timestamps: true }
);
ProductSchema.index({ tenantId: 1, sku: 1 }, { unique: true });

// Export Models
export const Customer = mongoose.model<ICustomer>("Customer", CustomerSchema);
export const Contract = mongoose.model<IContract>("Contract", ContractSchema);
export const PurchaseOrder = mongoose.model<IPurchaseOrder>("PurchaseOrder", PurchaseOrderSchema);
export const Invoice = mongoose.model<IInvoice>("Invoice", InvoiceSchema);
export const HumanReview = mongoose.model<IHumanReview>("HumanReview", HumanReviewSchema);
export const ValidationResult = mongoose.model<IValidationResult>("ValidationResult", ValidationResultSchema);
export const AuditLog = mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
export const User = mongoose.model<IUser>("User", UserSchema);
export const Product = mongoose.model<IProduct>("Product", ProductSchema);
