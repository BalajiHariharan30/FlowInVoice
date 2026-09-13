export type POStatus = 
  | 'PENDING' 
  | 'PROCESSING' 
  | 'EXTRACTED' 
  | 'DISCREPANCY_FOUND' 
  | 'READY_FOR_APPROVAL' 
  | 'APPROVED' 
  | 'REJECTED' 
  | 'VALIDATION_FAILED'
  | 'UPLOADED'
  | 'VALIDATING'
  | 'RAG_CHECKING'
  | 'COMPLIANCE_CHECKING'
  | 'HUMAN_REVIEW'
  | 'HUMAN_APPROVED'
  | 'INVOICE_GENERATING'
  | 'INVOICE_VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DELETED';

export interface POLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
  lineTotal?: number;
  productCode?: string;
  itemNumber?: number;
  lineNumber?: number;
  taxRate?: number;
  gstNumber?: string;
  currency?: string;
}

export interface POData {
  id: string;
  tenantId: string;
  status: POStatus;
  poNumber?: string;
  customerName?: string;
  vendorName?: string;
  totalAmount?: number;
  baseAmount?: number;
  subtotal?: number;
  taxAmount?: number;
  tax?: number;
  lineItems: POLineItem[];
  rejectionReason?: string;
  failureReason?: string;
  isResumed: boolean;
  version: number;
  workflowId?: string;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class PurchaseOrderEntity {
  private props: POData;

  private constructor(props: POData) {
    this.props = props;
  }

  public static create(props: POData): PurchaseOrderEntity {
    return new PurchaseOrderEntity({ ...props });
  }

  public get id(): string { return this.props.id; }
  public get tenantId(): string { return this.props.tenantId; }
  public get status(): POStatus { return this.props.status; }
  public get isResumed(): boolean { return this.props.isResumed; }
  public get data(): Readonly<POData> { return { ...this.props }; }

  // State Transition Guards (InvoiceScan DDD Pattern)

  public startProcessing(): void {
    const validPreceding = ['PENDING', 'VALIDATION_FAILED', 'UPLOADED', 'FAILED'];
    if (!validPreceding.includes(this.props.status)) {
      throw new DomainError(`Cannot transition to PROCESSING from state: ${this.props.status}`);
    }
    this.props.status = 'PROCESSING';
    this.props.version += 1;
  }

  public markExtracted(extractedData: Partial<POData>): void {
    if (this.props.status !== 'PROCESSING') {
      throw new DomainError(`Cannot transition to EXTRACTED from state: ${this.props.status}`);
    }
    this.props.vendorName = extractedData.vendorName ?? this.props.vendorName;
    this.props.customerName = extractedData.customerName ?? extractedData.vendorName ?? this.props.customerName;
    this.props.totalAmount = extractedData.totalAmount ?? this.props.totalAmount;
    this.props.baseAmount = extractedData.baseAmount ?? extractedData.subtotal ?? this.props.baseAmount;
    this.props.subtotal = extractedData.subtotal ?? extractedData.baseAmount ?? this.props.subtotal;
    this.props.taxAmount = extractedData.taxAmount ?? extractedData.tax ?? this.props.taxAmount;
    this.props.tax = extractedData.tax ?? extractedData.taxAmount ?? this.props.tax;
    this.props.lineItems = extractedData.lineItems ?? this.props.lineItems;
    this.props.status = 'EXTRACTED';
    this.props.version += 1;
  }

  public flagDiscrepancy(): void {
    this.props.status = 'DISCREPANCY_FOUND';
    this.props.version += 1;
  }

  public markReadyForApproval(): void {
    this.props.status = 'READY_FOR_APPROVAL';
    this.props.version += 1;
  }

  public resumeExecution(): void {
    // Defense against Router 1 Bypass: Guard checkpoint status
    const checkpointStatuses = ['DISCREPANCY_FOUND', 'READY_FOR_APPROVAL', 'HUMAN_REVIEW', 'HUMAN_APPROVED'];
    if (!checkpointStatuses.includes(this.props.status)) {
      throw new DomainError(`Cannot resume PO in non-checkpoint status: ${this.props.status}`);
    }
    this.props.isResumed = true;
    this.props.version += 1;
  }

  public markValidationFailed(reason: string): void {
    this.props.status = 'VALIDATION_FAILED';
    this.props.rejectionReason = reason;
    this.props.failureReason = reason;
    this.props.version += 1;
  }
}
