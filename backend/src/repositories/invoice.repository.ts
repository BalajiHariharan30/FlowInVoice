import mongoose from "mongoose";
import { Invoice, IInvoice } from "../models/index.js";
import { PaginationParams, PaginatedResult, InvoiceStatus } from "../types/index.js";
import { inMemory, isDbConnected, generateId, calcPagination } from "./base.js";

export class InvoiceRepository {
  static async create(tenantId: string, data: Partial<IInvoice>): Promise<IInvoice> {
    if (isDbConnected()) {
      const invoice = new Invoice({ ...data, tenantId });
      return invoice.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId, lineItems: [],
      ...data,
      createdAt: new Date(), updatedAt: new Date()
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
    return doc?.tenantId === tenantId ? doc : null;
  }

  static async findByPoId(tenantId: string, poId: string): Promise<IInvoice | null> {
    if (isDbConnected()) {
      return Invoice.findOne({ tenantId, poId });
    }
    for (const doc of inMemory.invoices.values()) {
      if (doc.tenantId === tenantId && doc.poId === poId) return doc;
    }
    return null;
  }

  static async findByInvoiceNumber(tenantId: string, invoiceNumber: string): Promise<IInvoice | null> {
    if (isDbConnected()) {
      return Invoice.findOne({ tenantId, invoiceNumber });
    }
    for (const doc of inMemory.invoices.values()) {
      if (doc.tenantId === tenantId && doc.invoiceNumber === invoiceNumber) return doc;
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
      return Invoice.findOneAndUpdate(
        { tenantId, _id: id },
        { $set: { status, ...extra } },
        { new: true }
      );
    }
    const doc = inMemory.invoices.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    doc.status = status;
    Object.assign(doc, extra, { updatedAt: new Date() });
    return doc;
  }

  static async findMany(
    tenantId: string,
    params: PaginationParams
  ): Promise<PaginatedResult<IInvoice>> {
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
        Invoice.find(query).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
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
    // Always sort newest first
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }
}
