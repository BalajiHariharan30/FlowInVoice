import mongoose from "mongoose";
import { PurchaseOrder, IPurchaseOrder } from "../models/index.js";
import { PaginationParams, PaginatedResult, POStatus } from "../types/index.js";
import { inMemory, isDbConnected, generateId, calcPagination } from "./base.js";

export class PurchaseOrderRepository {
  static async create(tenantId: string, data: Partial<IPurchaseOrder>): Promise<IPurchaseOrder> {
    if (isDbConnected()) {
      const po = new PurchaseOrder({ ...data, tenantId });
      return po.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId,
      subtotal: 0, tax: 0, discount: 0, totalAmount: 0,
      extractionConfidence: 1.0, retryCount: 0, lineItems: [],
      ...data,
      createdAt: new Date(), updatedAt: new Date()
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
    return doc?.tenantId === tenantId ? doc : null;
  }

  static async findByPoNumber(tenantId: string, poNumber: string): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      return PurchaseOrder.findOne({ tenantId, poNumber });
    }
    for (const doc of inMemory.pos.values()) {
      if (doc.tenantId === tenantId && doc.poNumber === poNumber) return doc;
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

  static async findMany(
    tenantId: string,
    params: PaginationParams
  ): Promise<PaginatedResult<IPurchaseOrder>> {
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
        PurchaseOrder.find(query).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
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
    // Always sort newest first so newly uploaded POs appear at the top
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }
}
