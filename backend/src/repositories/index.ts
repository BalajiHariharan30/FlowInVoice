import mongoose from "mongoose";
import {
  Customer,
  Contract,
  PurchaseOrder,
  Invoice,
  HumanReview,
  ValidationResult,
  AuditLog,
  User,
  Product,
  ICustomer,
  IContract,
  IPurchaseOrder,
  IInvoice,
  IHumanReview,
  IValidationResult,
  IAuditLog,
  IUser,
  IProduct
} from "../models/index.js";
import { PaginationParams, PaginatedResult, POStatus, InvoiceStatus, ReviewStatus, ReviewStage } from "../types/index.js";

// Helper for pagination calculations
function calcPagination(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 1
  };
}

// Check if mongoose is currently connected
function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

// In-memory storage for offline / unit test mode
const inMemory = {
  customers: new Map<string, any>(),
  contracts: new Map<string, any>(),
  pos: new Map<string, any>(),
  invoices: new Map<string, any>(),
  reviews: new Map<string, any>(),
  audits: new Map<string, any>(),
  validations: new Map<string, any>(),
  users: new Map<string, any>(),
  products: new Map<string, any>()
};

export function clearTestRepositories() {
  inMemory.customers.clear();
  inMemory.contracts.clear();
  inMemory.pos.clear();
  inMemory.invoices.clear();
  inMemory.reviews.clear();
  inMemory.audits.clear();
  inMemory.validations.clear();
  inMemory.users.clear();
  inMemory.products.clear();
}

function generateId(): string {
  return new mongoose.Types.ObjectId().toString();
}

// -------------------------------------------------------------
// Customer Repository
// -------------------------------------------------------------
export class CustomerRepository {
  static async create(tenantId: string, data: Partial<ICustomer>): Promise<ICustomer> {
    if (isDbConnected()) {
      const customer = new Customer({ ...data, tenantId });
      return customer.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.customers.set(id, doc);
    return doc;
  }

  static async findById(tenantId: string, id: string): Promise<ICustomer | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return Customer.findOne({ tenantId, _id: id });
    }
    const doc = inMemory.customers.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    return doc;
  }

  static async findByCode(tenantId: string, code: string): Promise<ICustomer | null> {
    if (isDbConnected()) {
      return Customer.findOne({ tenantId, code });
    }
    for (const doc of inMemory.customers.values()) {
      if (doc.tenantId === tenantId && doc.code.toLowerCase() === code.toLowerCase()) {
        return doc;
      }
    }
    return null;
  }

  static async findByName(tenantId: string, name: string): Promise<ICustomer | null> {
    if (isDbConnected()) {
      return Customer.findOne({ tenantId, name: { $regex: new RegExp(`^${name}$`, "i") } });
    }
    for (const doc of inMemory.customers.values()) {
      if (doc.tenantId === tenantId && doc.name.toLowerCase() === name.toLowerCase()) {
        return doc;
      }
    }
    return null;
  }

  static async findMany(tenantId: string, params: PaginationParams): Promise<PaginatedResult<ICustomer>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query: any = { tenantId };
      if (params.search) {
        query.$or = [
          { name: { $regex: params.search, $options: "i" } },
          { code: { $regex: params.search, $options: "i" } },
          { email: { $regex: params.search, $options: "i" } }
        ];
      }
      const [data, total] = await Promise.all([
        Customer.find(query).skip((page - 1) * pageSize).limit(pageSize).sort({ createdAt: -1 }),
        Customer.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    let items = Array.from(inMemory.customers.values()).filter((c) => c.tenantId === tenantId);
    if (params.search) {
      const q = params.search.toLowerCase();
      items = items.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
      );
    }
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }
}

// -------------------------------------------------------------
// Contract Repository
// -------------------------------------------------------------
export class ContractRepository {
  static async create(tenantId: string, data: Partial<IContract>): Promise<IContract> {
    if (isDbConnected()) {
      const contract = new Contract({ ...data, tenantId });
      return contract.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.contracts.set(id, doc);
    return doc;
  }

  static async findById(tenantId: string, id: string): Promise<IContract | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return Contract.findOne({ tenantId, _id: id });
    }
    const doc = inMemory.contracts.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    return doc;
  }

  static async findByCustomerId(tenantId: string, customerId: string): Promise<IContract[]> {
    if (isDbConnected()) {
      return Contract.find({ tenantId, customerId }).sort({ effectiveFrom: -1 });
    }
    return Array.from(inMemory.contracts.values()).filter(
      (c) => c.tenantId === tenantId && c.customerId === customerId
    );
  }

  static async findActiveContracts(tenantId: string, customerId: string): Promise<IContract[]> {
    const now = new Date();
    if (isDbConnected()) {
      return Contract.find({
        tenantId,
        customerId,
        status: "ACTIVE",
        effectiveFrom: { $lte: now },
        effectiveTo: { $gte: now }
      });
    }
    return Array.from(inMemory.contracts.values()).filter(
      (c) =>
        c.tenantId === tenantId &&
        c.customerId === customerId &&
        c.status === "ACTIVE" &&
        new Date(c.effectiveFrom) <= now &&
        new Date(c.effectiveTo) >= now
    );
  }
}

// -------------------------------------------------------------
// Purchase Order Repository
// -------------------------------------------------------------
export class PurchaseOrderRepository {
  static async create(tenantId: string, data: Partial<IPurchaseOrder>): Promise<IPurchaseOrder> {
    if (isDbConnected()) {
      const po = new PurchaseOrder({ ...data, tenantId });
      return po.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      subtotal: 0,
      tax: 0,
      discount: 0,
      totalAmount: 0,
      extractionConfidence: 1.0,
      retryCount: 0,
      lineItems: [],
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.pos.set(id, doc);
    return doc;
  }

  static async findById(tenantId: string, id: string): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return PurchaseOrder.findOne({ tenantId, _id: id });
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    return doc;
  }

  static async findByPoNumber(tenantId: string, poNumber: string): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      return PurchaseOrder.findOne({ tenantId, poNumber });
    }
    for (const doc of inMemory.pos.values()) {
      if (doc.tenantId === tenantId && doc.poNumber === poNumber) {
        return doc;
      }
    }
    return null;
  }

  static async updateStatus(
    tenantId: string,
    id: string,
    status: POStatus,
    failureReason?: string
  ): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      const update: any = { status };
      if (failureReason !== undefined) update.failureReason = failureReason;
      return PurchaseOrder.findOneAndUpdate({ tenantId, _id: id }, { $set: update }, { new: true });
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    doc.status = status;
    if (failureReason !== undefined) doc.failureReason = failureReason;
    doc.updatedAt = new Date();
    return doc;
  }

  static async updateExtraction(
    tenantId: string,
    id: string,
    data: Partial<IPurchaseOrder>
  ): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return PurchaseOrder.findOneAndUpdate({ tenantId, _id: id }, { $set: data }, { new: true });
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    Object.assign(doc, data, { updatedAt: new Date() });
    return doc;
  }

  static async incrementRetryCount(tenantId: string, id: string): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return PurchaseOrder.findOneAndUpdate(
        { tenantId, _id: id },
        { $inc: { retryCount: 1 } },
        { new: true }
      );
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    doc.retryCount = (doc.retryCount || 0) + 1;
    doc.updatedAt = new Date();
    return doc;
  }

  static async findMany(tenantId: string, params: PaginationParams): Promise<PaginatedResult<IPurchaseOrder>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query: any = { tenantId };
      if (params.status) query.status = params.status;
      if (params.customerId) query.customerId = params.customerId;
      if (params.search) {
        query.$or = [
          { poNumber: { $regex: params.search, $options: "i" } },
          { customerName: { $regex: params.search, $options: "i" } }
        ];
      }
      if (params.dateFrom || params.dateTo) {
        query.createdAt = {};
        if (params.dateFrom) query.createdAt.$gte = new Date(params.dateFrom);
        if (params.dateTo) query.createdAt.$lte = new Date(params.dateTo);
      }
      const [data, total] = await Promise.all([
        PurchaseOrder.find(query).skip((page - 1) * pageSize).limit(pageSize).sort({ createdAt: -1 }),
        PurchaseOrder.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    let items = Array.from(inMemory.pos.values()).filter((p) => p.tenantId === tenantId);
    if (params.status) items = items.filter((p) => p.status === params.status);
    if (params.customerId) items = items.filter((p) => p.customerId === params.customerId);
    if (params.search) {
      const q = params.search.toLowerCase();
      items = items.filter(
        (p) =>
          p.poNumber?.toLowerCase().includes(q) ||
          p.customerName?.toLowerCase().includes(q)
      );
    }
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }
}

// -------------------------------------------------------------
// Invoice Repository
// -------------------------------------------------------------
export class InvoiceRepository {
  static async create(tenantId: string, data: Partial<IInvoice>): Promise<IInvoice> {
    if (isDbConnected()) {
      const invoice = new Invoice({ ...data, tenantId });
      return invoice.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      lineItems: [],
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.invoices.set(id, doc);
    return doc;
  }

  static async findById(tenantId: string, id: string): Promise<IInvoice | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return Invoice.findOne({ tenantId, _id: id });
    }
    const doc = inMemory.invoices.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    return doc;
  }

  static async findByPoId(tenantId: string, poId: string): Promise<IInvoice | null> {
    if (isDbConnected()) {
      return Invoice.findOne({ tenantId, poId });
    }
    for (const doc of inMemory.invoices.values()) {
      if (doc.tenantId === tenantId && doc.poId === poId) {
        return doc;
      }
    }
    return null;
  }

  static async findByInvoiceNumber(tenantId: string, invoiceNumber: string): Promise<IInvoice | null> {
    if (isDbConnected()) {
      return Invoice.findOne({ tenantId, invoiceNumber });
    }
    for (const doc of inMemory.invoices.values()) {
      if (doc.tenantId === tenantId && doc.invoiceNumber === invoiceNumber) {
        return doc;
      }
    }
    return null;
  }

  static async updateStatus(
    tenantId: string,
    id: string,
    status: InvoiceStatus,
    extra: Partial<IInvoice> = {}
  ): Promise<IInvoice | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return Invoice.findOneAndUpdate({ tenantId, _id: id }, { $set: { status, ...extra } }, { new: true });
    }
    const doc = inMemory.invoices.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    doc.status = status;
    Object.assign(doc, extra, { updatedAt: new Date() });
    return doc;
  }

  static async findMany(tenantId: string, params: PaginationParams): Promise<PaginatedResult<IInvoice>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query: any = { tenantId };
      if (params.status) query.status = params.status;
      if (params.customerId) query.customerId = params.customerId;
      if (params.search) {
        query.$or = [
          { invoiceNumber: { $regex: params.search, $options: "i" } },
          { poNumber: { $regex: params.search, $options: "i" } },
          { customerName: { $regex: params.search, $options: "i" } }
        ];
      }
      const [data, total] = await Promise.all([
        Invoice.find(query).skip((page - 1) * pageSize).limit(pageSize).sort({ createdAt: -1 }),
        Invoice.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    let items = Array.from(inMemory.invoices.values()).filter((i) => i.tenantId === tenantId);
    if (params.status) items = items.filter((i) => i.status === params.status);
    if (params.customerId) items = items.filter((i) => i.customerId === params.customerId);
    if (params.search) {
      const q = params.search.toLowerCase();
      items = items.filter(
        (i) =>
          i.invoiceNumber?.toLowerCase().includes(q) ||
          i.poNumber?.toLowerCase().includes(q) ||
          i.customerName?.toLowerCase().includes(q)
      );
    }
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }
}

// -------------------------------------------------------------
// Review Repository
// -------------------------------------------------------------
export class ReviewRepository {
  static async create(tenantId: string, data: Partial<IHumanReview>): Promise<IHumanReview> {
    if (isDbConnected()) {
      const review = new HumanReview({ ...data, tenantId });
      return review.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      evidence: [],
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.reviews.set(id, doc);
    return doc;
  }

  static async findById(tenantId: string, id: string): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return HumanReview.findOne({ tenantId, _id: id });
    }
    const doc = inMemory.reviews.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    return doc;
  }

  static async findByEntityId(tenantId: string, entityId: string): Promise<IHumanReview[]> {
    if (isDbConnected()) {
      return HumanReview.find({ tenantId, entityId }).sort({ createdAt: -1 });
    }
    return Array.from(inMemory.reviews.values()).filter(
      (r) => r.tenantId === tenantId && r.entityId === entityId
    );
  }

  static async findMany(tenantId: string, params: PaginationParams): Promise<PaginatedResult<IHumanReview>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query: any = { tenantId };
      if (params.stage) query.stage = params.stage;
      if (params.status) query.status = params.status;
      const [data, total] = await Promise.all([
        HumanReview.find(query).skip((page - 1) * pageSize).limit(pageSize).sort({ createdAt: -1 }),
        HumanReview.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    let items = Array.from(inMemory.reviews.values()).filter((r) => r.tenantId === tenantId);
    if (params.stage) items = items.filter((r) => r.stage === params.stage);
    if (params.status) items = items.filter((r) => r.status === params.status);
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }

  static async resolveReview(
    tenantId: string,
    id: string,
    status: ReviewStatus,
    resolutionNotes: string,
    resolvedBy: string
  ): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return HumanReview.findOneAndUpdate(
        { tenantId, _id: id, status: "PENDING" },
        {
          $set: {
            status,
            resolutionNotes,
            resolvedBy,
            resolvedAt: new Date()
          }
        },
        { new: true }
      );
    }
    const doc = inMemory.reviews.get(id);
    if (!doc || doc.tenantId !== tenantId || doc.status !== "PENDING") return null;
    doc.status = status;
    doc.resolutionNotes = resolutionNotes;
    doc.resolvedBy = resolvedBy;
    doc.resolvedAt = new Date();
    doc.updatedAt = new Date();
    return doc;
  }
}

// -------------------------------------------------------------
// Audit Repository
// -------------------------------------------------------------
export class AuditRepository {
  static async create(tenantId: string, data: Partial<IAuditLog>): Promise<IAuditLog> {
    if (isDbConnected()) {
      const log = new AuditLog({ ...data, tenantId });
      return log.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      timestamp: new Date(),
      references: [],
      ...data
    };
    inMemory.audits.set(id, doc);
    return doc;
  }

  static async findByEntityId(tenantId: string, entityId: string): Promise<IAuditLog[]> {
    if (isDbConnected()) {
      return AuditLog.find({ tenantId, entityId }).sort({ timestamp: -1 });
    }
    return Array.from(inMemory.audits.values()).filter(
      (l) => l.tenantId === tenantId && l.entityId === entityId
    );
  }
}

// -------------------------------------------------------------
// Validation Result Repository
// -------------------------------------------------------------
export class ValidationResultRepository {
  static async create(tenantId: string, data: Partial<IValidationResult>): Promise<IValidationResult> {
    if (isDbConnected()) {
      const res = new ValidationResult({ ...data, tenantId });
      return res.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      checks: [],
      errors: [],
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.validations.set(id, doc);
    return doc;
  }

  static async findLatestByPoId(tenantId: string, poId: string): Promise<IValidationResult | null> {
    if (isDbConnected()) {
      return ValidationResult.findOne({ tenantId, poId }).sort({ createdAt: -1 });
    }
    const items = Array.from(inMemory.validations.values()).filter(
      (v) => v.tenantId === tenantId && v.poId === poId
    );
    return items[items.length - 1] || null;
  }

  static async findByPoId(tenantId: string, poId: string): Promise<IValidationResult[]> {
    if (isDbConnected()) {
      return ValidationResult.find({ tenantId, poId }).sort({ createdAt: -1 });
    }
    return Array.from(inMemory.validations.values()).filter(
      (v) => v.tenantId === tenantId && v.poId === poId
    );
  }
}

// -------------------------------------------------------------
// User Repository
// -------------------------------------------------------------
export class UserRepository {
  static async create(tenantId: string, data: Partial<IUser>): Promise<IUser> {
    if (isDbConnected()) {
      const user = new User({ ...data, tenantId });
      return user.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      isActive: true,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.users.set(id, doc);
    return doc;
  }

  static async findById(tenantId: string, id: string): Promise<IUser | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return User.findOne({ tenantId, _id: id });
    }
    const doc = inMemory.users.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    return doc;
  }

  static async findByEmail(tenantId: string, email: string): Promise<IUser | null> {
    if (isDbConnected()) {
      return User.findOne({ tenantId, email });
    }
    for (const doc of inMemory.users.values()) {
      if (doc.tenantId === tenantId && doc.email.toLowerCase() === email.toLowerCase()) {
        return doc;
      }
    }
    return null;
  }

  static async findMany(tenantId: string, params: PaginationParams = {}): Promise<PaginatedResult<IUser>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query = { tenantId };
      const [data, total] = await Promise.all([
        User.find(query)
          .select("-passwordHash -refreshTokenHash")
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .sort({ createdAt: -1 }),
        User.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    const items = Array.from(inMemory.users.values()).filter((u) => u.tenantId === tenantId);
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }

  static async updateRole(tenantId: string, id: string, role: "ADMIN" | "FINANCE" | "REVIEWER"): Promise<void> {
    if (isDbConnected()) {
      await User.updateOne({ tenantId, _id: id }, { role });
      return;
    }
    const doc = inMemory.users.get(id);
    if (doc && doc.tenantId === tenantId) {
      doc.role = role;
    }
  }
}

// -------------------------------------------------------------
// Product Repository
// -------------------------------------------------------------
export class ProductRepository {
  static async create(tenantId: string, data: Partial<IProduct>): Promise<IProduct> {
    if (isDbConnected()) {
      const product = new Product({ ...data, tenantId });
      return product.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id,
      id,
      tenantId,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemory.products.set(id, doc);
    return doc;
  }

  static async findBySku(tenantId: string, sku: string): Promise<IProduct | null> {
    if (isDbConnected()) {
      return Product.findOne({ tenantId, sku });
    }
    for (const doc of inMemory.products.values()) {
      if (doc.tenantId === tenantId && doc.sku === sku) {
        return doc;
      }
    }
    return null;
  }
}
