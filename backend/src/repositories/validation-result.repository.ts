import { ValidationResult, IValidationResult } from "../models/index.js";
import { inMemory, isDbConnected, generateId } from "./base.js";

export class ValidationResultRepository {
  static async create(
    tenantId: string,
    data: Partial<IValidationResult>
  ): Promise<IValidationResult> {
    if (isDbConnected()) {
      const res = new ValidationResult({ ...data, tenantId });
      return res.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId, checks: [], errors: [],
      ...data,
      createdAt: new Date(), updatedAt: new Date()
    };
    inMemory.validations.set(id, doc);
    return doc;
  }

  static async findLatestByPoId(
    tenantId: string,
    poId: string
  ): Promise<IValidationResult | null> {
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
