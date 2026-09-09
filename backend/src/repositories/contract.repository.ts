import mongoose from "mongoose";
import { Contract, IContract } from "../models/index.js";
import { inMemory, isDbConnected, generateId } from "./base.js";

export class ContractRepository {
  static async create(tenantId: string, data: Partial<IContract>): Promise<IContract> {
    if (isDbConnected()) {
      const contract = new Contract({ ...data, tenantId });
      return contract.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId, ...data,
      createdAt: new Date(), updatedAt: new Date()
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
    return doc?.tenantId === tenantId ? doc : null;
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
        tenantId, customerId, status: "ACTIVE",
        effectiveFrom: { $lte: now }, effectiveTo: { $gte: now }
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
