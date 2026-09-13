export type POStatus = 
  | 'PENDING' 
  | 'PROCESSING' 
  | 'EXTRACTED' 
  | 'DISCREPANCY_FOUND' 
  | 'READY_FOR_APPROVAL' 
  | 'APPROVED' 
  | 'REJECTED' 
  | 'VALIDATION_FAILED';

export interface POLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface POData {
  id: string;
  tenantId: string;
  status: POStatus;
  vendorName?: string;
  totalAmount?: number;
  baseAmount?: number;
  taxAmount?: number;
  lineItems: POLineItem[];
  rejectionReason?: string;
  isResumed: boolean;
  version: number;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function mapToEntityStatus(status: string): POStatus {
  switch (status) {
    case 'UPLOADED':
    case 'PENDING':
      return 'PENDING';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'EXTRACTED':
      return 'EXTRACTED';
    case 'HUMAN_REVIEW':
    case 'DISCREPANCY_FOUND':
      return 'DISCREPANCY_FOUND';
    case 'HUMAN_APPROVED':
    case 'READY_FOR_APPROVAL':
      return 'READY_FOR_APPROVAL';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'FAILED':
    case 'VALIDATION_FAILED':
      return 'VALIDATION_FAILED';
    default:
      return (status as POStatus) || 'PENDING';
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
    if (this.props.status !== 'PENDING' && this.props.status !== 'VALIDATION_FAILED') {
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
    this.props.totalAmount = extractedData.totalAmount ?? this.props.totalAmount;
    this.props.baseAmount = extractedData.baseAmount ?? this.props.baseAmount;
    this.props.taxAmount = extractedData.taxAmount ?? this.props.taxAmount;
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
    if (this.props.status !== 'DISCREPANCY_FOUND' && this.props.status !== 'READY_FOR_APPROVAL') {
      throw new DomainError(`Cannot resume PO in non-checkpoint status: ${this.props.status}`);
    }
    this.props.isResumed = true;
    this.props.version += 1;
  }

  public markValidationFailed(reason: string): void {
    this.props.status = 'VALIDATION_FAILED';
    this.props.rejectionReason = reason;
    this.props.version += 1;
  }
}
