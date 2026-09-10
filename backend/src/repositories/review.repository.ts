import mongoose from "mongoose";
import { HumanReview, IHumanReview } from "../models/index.js";
import { PaginationParams, PaginatedResult, ReviewStatus, ReviewStage } from "../types/index.js";
import { inMemory, isDbConnected, generateId, calcPagination } from "./base.js";

export class ReviewRepository {
  static async create(tenantId: string, data: Partial<IHumanReview>): Promise<IHumanReview> {
    if (isDbConnected()) {
      const review = new HumanReview({ ...data, tenantId });
      return review.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId, evidence: [],
      ...data,
      createdAt: new Date(), updatedAt: new Date()
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
    return doc?.tenantId === tenantId ? doc : null;
  }

  static async findByEntityId(tenantId: string, entityId: string): Promise<IHumanReview[]> {
    if (isDbConnected()) {
      return HumanReview.find({ tenantId, entityId }).sort({ createdAt: -1 });
    }
    return Array.from(inMemory.reviews.values()).filter(
      (r) => r.tenantId === tenantId && r.entityId === entityId
    );
  }

  static async findMany(
    tenantId: string,
    params: PaginationParams
  ): Promise<PaginatedResult<IHumanReview>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

    if (isDbConnected()) {
      const query: any = { tenantId };
      if (params.stage) query.stage = params.stage;
      if (params.status) query.status = params.status;
      const [data, total] = await Promise.all([
        HumanReview.find(query).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
        HumanReview.countDocuments(query)
      ]);
      return { data, pagination: calcPagination(page, pageSize, total) };
    }

    let items = Array.from(inMemory.reviews.values()).filter((r) => r.tenantId === tenantId);
    if (params.stage) items = items.filter((r) => r.stage === params.stage);
    if (params.status) items = items.filter((r) => r.status === params.status);
    // Always sort newest first
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = items.length;
    const data = items.slice((page - 1) * pageSize, page * pageSize);
    return { data, pagination: calcPagination(page, pageSize, total) };
  }

  static async updateReview(
    tenantId: string,
    id: string,
    updates: Partial<IHumanReview>
  ): Promise<IHumanReview | null> {
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return HumanReview.findOneAndUpdate(
        { tenantId, _id: id },
        { $set: { ...updates, updatedAt: new Date() } },
        { new: true }
      );
    }
    const doc = inMemory.reviews.get(id);
    if (!doc || doc.tenantId !== tenantId) return null;
    Object.assign(doc, updates, { updatedAt: new Date() });
    return doc;
  }

  static async resolveReview(
    tenantId: string,
    id: string,
    status: ReviewStatus,
    resolutionNotes: string,
    resolvedBy: string,
    extra?: { discrepancyReport?: any[]; evidence?: any[] }
  ): Promise<IHumanReview | null> {
    const updatePayload: any = {
      status,
      resolutionNotes,
      resolvedBy,
      resolvedAt: new Date()
    };
    if (extra?.discrepancyReport) {
      updatePayload.discrepancyReport = extra.discrepancyReport;
    }
    if (extra?.evidence) {
      updatePayload.evidence = extra.evidence;
    }

    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      return HumanReview.findOneAndUpdate(
        { tenantId, _id: id, status: "PENDING" },
        { $set: updatePayload },
        { new: true }
      );
    }
    const doc = inMemory.reviews.get(id);
    if (!doc || doc.tenantId !== tenantId || doc.status !== "PENDING") return null;
    Object.assign(doc, updatePayload, { updatedAt: new Date() });
    return doc;
  }
}

