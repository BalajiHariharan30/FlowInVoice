import { AuditLog, IAuditLog } from "../models/index.js";
import { inMemory, isDbConnected, generateId } from "./base.js";

export class AuditRepository {
  static async create(tenantId: string, data: Partial<IAuditLog>): Promise<IAuditLog> {
    if (isDbConnected()) {
      const log = new AuditLog({ ...data, tenantId });
      return log.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId, timestamp: new Date(), references: [],
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
