import mongoose from "mongoose";
import { PurchaseOrder, IPurchaseOrder } from "../models/index.js";
import { PaginationParams, PaginatedResult, POStatus } from "../types/index.js";
import { inMemory, isDbConnected, generateId, calcPagination } from "./base.js";
import { ReviewRepository } from "./review.repository.js";

export class PurchaseOrderRepository {
  static async create(tenantId: string, data: Partial<IPurchaseOrder>): Promise<IPurchaseOrder> {
    if (isDbConnected()) {
      try {
        const po = new PurchaseOrder({ ...data, tenantId });
        return await po.save();
      } catch (err: any) {
        if (err?.code === 11000) {
          const duplicateError: any = new Error(`Duplicate purchase order number: ${data.poNumber || "unknown"}`);
          duplicateError.code = "DUPLICATE_PO_NUMBER";
          duplicateError.statusCode = 409;
          throw duplicateError;
        }
        throw err;
      }
    }
    if (data.poNumber && data.poNumber.trim().length > 0) {
      for (const doc of inMemory.pos.values()) {
        if (
          doc.tenantId === tenantId &&
          doc.poNumber === data.poNumber &&
          !["REJECTED", "FAILED", "DELETED"].includes(doc.status)
        ) {
          const duplicateError: any = new Error(`Duplicate purchase order number: ${data.poNumber}`);
          duplicateError.code = "DUPLICATE_PO_NUMBER";
          duplicateError.statusCode = 409;
          throw duplicateError;
        }
      }
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
      return PurchaseOrder.findOne({
        tenantId,
        poNumber,
        status: { $nin: ["REJECTED", "FAILED", "DELETED"] }
      });
    }
    for (const doc of inMemory.pos.values()) {
      if (
        doc.tenantId === tenantId &&
        doc.poNumber === poNumber &&
        !["REJECTED", "FAILED", "DELETED"].includes(doc.status)
      ) {
        return doc;
      }
    }
    return null;
  }

  static async softDelete(tenantId: string, id: string): Promise<IPurchaseOrder | null> {
    const updatePayload = {
      status: "DELETED" as POStatus,
      deletedAt: new Date(),
      updatedAt: new Date()
    };
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return PurchaseOrder.findOneAndUpdate(
        { tenantId, _id: id },
        { $set: updatePayload },
        { new: true }
      );
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    Object.assign(doc, updatePayload);
    return doc;
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

  static async updateHumanReviewStatus(
    tenantId: string,
    id: string,
    status: POStatus,
    extra: {
      humanReviewedAt?: Date;
      humanReviewedBy?: string;
      terminatedAt?: Date;
      terminationReason?: string;
      failureReason?: string;
      extractionConfidence?: number;
      tax?: number;
    } = {}
  ): Promise<IPurchaseOrder | null> {
    const updatePayload: any = { status, ...extra, updatedAt: new Date() };
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return PurchaseOrder.findOneAndUpdate({ tenantId, _id: id }, { $set: updatePayload }, { new: true });
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    Object.assign(doc, updatePayload);
    return doc;
  }

  static async claimForProcessing(tenantId: string, id: string): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return PurchaseOrder.findOneAndUpdate(
        {
          tenantId,
          _id: id,
          status: { $in: ["HUMAN_APPROVED", "PROCESSING", "VALIDATING"] }
        },
        {
          $set: {
            status: "INVOICE_GENERATING",
            updatedAt: new Date()
          }
        },
        { new: true }
      );
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    if (!["HUMAN_APPROVED", "PROCESSING", "VALIDATING"].includes(doc.status)) return null;
    doc.status = "INVOICE_GENERATING";
    doc.updatedAt = new Date();
    return doc;
  }

  /** Deterministic engine: persist pipeline state to the PO document. */
  static async savePipelineState(tenantId: string, id: string, state: Record<string, any>): Promise<void> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return;
      await PurchaseOrder.findOneAndUpdate(
        { tenantId, _id: id },
        { $set: { pipelineState: state, updatedAt: new Date() } }
      );
      return;
    }
    const doc = inMemory.pos.get(id);
    if (doc && doc.tenantId === tenantId) {
      (doc as any).pipelineState = state;
      doc.updatedAt = new Date();
    }
  }

  /** Deterministic engine: load persisted pipeline state from the PO document. */
  static async loadPipelineState(tenantId: string, id: string): Promise<Record<string, any> | null> {
    const po = await this.findById(tenantId, id);
    return (po as any)?.pipelineState || null;
  }

  static async updateExtraction(
    tenantId: string,
    id: string,
    data: Partial<IPurchaseOrder>
  ): Promise<IPurchaseOrder | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;

      // Detect duplicate PO collision and route to Human Review instead of mutating PO number
      if (data.poNumber) {
        const existing = await PurchaseOrder.findOne({
          tenantId,
          poNumber: data.poNumber,
          status: { $nin: ["REJECTED", "FAILED", "DELETED"] },
          _id: { $ne: new mongoose.Types.ObjectId(id) }
        });
        if (existing) {
          await ReviewRepository.create(tenantId, {
            entity: "purchase_order",
            entityId: id,
            stage: "extraction",
            priority: "HIGH",
            reason: `Duplicate PO number: ${data.poNumber}`,
            expectedValue: "Unique PO Number",
            actualValue: data.poNumber,
            requestedByAgent: "ExtractionAgent",
            status: "PENDING",
            evidence: [
              {
                sourceType: "POLICY",
                documentId: existing._id.toString(),
                documentName: "PurchaseOrder-DuplicateCheck",
                pageNumber: 1,
                section: "Extraction Check",
                claim: `PO number ${data.poNumber} already exists in system under record ${existing._id.toString()}`
              }
            ]
          });
          const updatePayload: any = {
            ...data,
            status: "HUMAN_REVIEW",
            failureReason: `DUPLICATE_PO: ${data.poNumber}`,
            updatedAt: new Date()
          };
          return await PurchaseOrder.findOneAndUpdate({ tenantId, _id: id }, { $set: updatePayload }, { new: true });
        }
      }

      try {
        return await PurchaseOrder.findOneAndUpdate({ tenantId, _id: id }, { $set: data }, { new: true });
      } catch (err: any) {
        if (err.code === 11000 || (err.message && err.message.includes("E11000"))) {
          await ReviewRepository.create(tenantId, {
            entity: "purchase_order",
            entityId: id,
            stage: "extraction",
            priority: "HIGH",
            reason: `Duplicate PO number: ${data.poNumber || "unknown"}`,
            expectedValue: "Unique PO Number",
            actualValue: data.poNumber || "unknown",
            requestedByAgent: "ExtractionAgent",
            status: "PENDING",
            evidence: [
              {
                sourceType: "POLICY",
                documentId: id,
                documentName: "PurchaseOrder-DuplicateCheck",
                pageNumber: 1,
                section: "Extraction Check",
                claim: "Duplicate PO number collision detected during extraction persistence"
              }
            ]
          });
          return await PurchaseOrder.findOneAndUpdate(
            { tenantId, _id: id },
            { $set: { ...data, status: "HUMAN_REVIEW", failureReason: `DUPLICATE_PO: ${data.poNumber}` } },
            { new: true }
          );
        }
        throw err;
      }
    }
    const doc = inMemory.pos.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    if (data.poNumber) {
      for (const [otherId, other] of inMemory.pos.entries()) {
        if (
          otherId !== id &&
          other.tenantId === tenantId &&
          other.poNumber === data.poNumber &&
          !["REJECTED", "FAILED", "DELETED"].includes(other.status)
        ) {
          await ReviewRepository.create(tenantId, {
            entity: "purchase_order",
            entityId: id,
            stage: "extraction",
            priority: "HIGH",
            reason: `Duplicate PO number: ${data.poNumber}`,
            expectedValue: "Unique PO Number",
            actualValue: data.poNumber,
            requestedByAgent: "ExtractionAgent",
            status: "PENDING",
            evidence: [
              {
                sourceType: "POLICY",
                documentId: otherId,
                documentName: "PurchaseOrder-DuplicateCheck",
                pageNumber: 1,
                section: "Extraction Check",
                claim: `PO number ${data.poNumber} already exists in system`
              }
            ]
          });
          Object.assign(doc, data, { status: "HUMAN_REVIEW", failureReason: `DUPLICATE_PO: ${data.poNumber}`, updatedAt: new Date() });
          return doc;
        }
      }
    }
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

  /**
   * Traverses and retrieves the complete version chain (ancestors + descendants) for a given PO,
   * sorted in ascending order by version number (v1 -> v2 -> v3).
   */
  static async findVersionChain(tenantId: string, poId: string): Promise<IPurchaseOrder[]> {
    const rootTarget = await this.findById(tenantId, poId);
    if (!rootTarget) return [];

    const versionMap = new Map<string, IPurchaseOrder>();
    versionMap.set(rootTarget._id.toString(), rootTarget);

    if (isDbConnected()) {
      // 1. Walk backward up the ancestral previousVersionId chain
      let current: IPurchaseOrder | null = rootTarget;
      while (current && current.previousVersionId) {
        if (!mongoose.isValidObjectId(current.previousVersionId)) break;
        const prev: IPurchaseOrder | null = await PurchaseOrder.findOne({ tenantId, _id: current.previousVersionId });
        if (!prev || versionMap.has(prev._id.toString())) break;
        versionMap.set(prev._id.toString(), prev);
        current = prev;
      }

      // 2. Walk forward to find any newer descendant versions
      const queue = [rootTarget._id.toString()];
      while (queue.length > 0) {
        const parentId = queue.shift()!;
        const children = await PurchaseOrder.find({ tenantId, previousVersionId: parentId });
        for (const child of children) {
          const childId = child._id.toString();
          if (!versionMap.has(childId)) {
            versionMap.set(childId, child);
            queue.push(childId);
          }
        }
      }

      const chain = Array.from(versionMap.values());
      chain.sort((a, b) => (a.version || 1) - (b.version || 1));
      return chain;
    }

    // In-Memory Mode
    let current: any = rootTarget;
    while (current && current.previousVersionId) {
      const prev = inMemory.pos.get(current.previousVersionId);
      if (!prev || prev.tenantId !== tenantId || versionMap.has(prev._id.toString())) break;
      versionMap.set(prev._id.toString(), prev);
      current = prev;
    }

    const queue = [rootTarget._id.toString()];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const p of inMemory.pos.values()) {
        if (
          p.tenantId === tenantId &&
          p.previousVersionId === parentId &&
          !versionMap.has(p._id.toString())
        ) {
          versionMap.set(p._id.toString(), p);
          queue.push(p._id.toString());
        }
      }
    }

    const chain = Array.from(versionMap.values());
    chain.sort((a, b) => (a.version || 1) - (b.version || 1));
    return chain;
  }

  static async findMany(
    tenantId: string,
    params: PaginationParams
  ): Promise<PaginatedResult<IPurchaseOrder>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query: any = { tenantId };
      if (params.status) {
        query.status = params.status;
      } else {
        query.status = { $ne: "DELETED" };
      }
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

      // Default to showing only the latest version of each logical PO (exclude superseded POs)
      if (params.latestOnly !== false) {
        const supersededIds = await PurchaseOrder.distinct("previousVersionId", {
          tenantId,
          previousVersionId: { $exists: true, $ne: null }
        });
        const validSupersededIds = supersededIds
          .filter((id) => mongoose.isValidObjectId(id))
          .map((id) => new mongoose.Types.ObjectId(id));
        if (validSupersededIds.length > 0) {
          query._id = { $nin: validSupersededIds };
        }
      }

      const [data, total] = await Promise.all([
        PurchaseOrder.find(query).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
        PurchaseOrder.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    let items = Array.from(inMemory.pos.values()).filter((p) => p.tenantId === tenantId);
    if (params.status) {
      items = items.filter((p) => p.status === params.status);
    } else {
      items = items.filter((p) => p.status !== "DELETED");
    }
    if (params.customerId) items = items.filter((p) => p.customerId === params.customerId);
    if (params.search) {
      const q = params.search.toLowerCase();
      items = items.filter(
        (p) =>
          p.poNumber?.toLowerCase().includes(q) ||
          p.customerName?.toLowerCase().includes(q)
      );
    }

    // Default to latest version only in in-memory mode
    if (params.latestOnly !== false) {
      const supersededSet = new Set(
        Array.from(inMemory.pos.values())
          .filter((p) => p.tenantId === tenantId && p.previousVersionId)
          .map((p) => p.previousVersionId)
      );
      items = items.filter((p) => !supersededSet.has(p._id?.toString() || p.id));
    }

    // Always sort newest first so newly uploaded POs appear at the top
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }
}
