import mongoose from "mongoose";
import { User, IUser } from "../models/index.js";
import { PaginationParams, PaginatedResult } from "../types/index.js";
import { inMemory, isDbConnected, generateId, calcPagination } from "./base.js";

export class UserRepository {
  static async create(tenantId: string, data: Partial<IUser>): Promise<IUser> {
    if (isDbConnected()) {
      const user = new User({ ...data, tenantId });
      return user.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId, isActive: true,
      ...data,
      createdAt: new Date(), updatedAt: new Date()
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
    return doc?.tenantId === tenantId ? doc : null;
  }

  static async findByEmail(tenantId: string, email: string): Promise<IUser | null> {
    if (isDbConnected()) {
      return User.findOne({ tenantId, email });
    }
    for (const doc of inMemory.users.values()) {
      if (doc.tenantId === tenantId && doc.email.toLowerCase() === email.toLowerCase()) return doc;
    }
    return null;
  }

  static async findMany(
    tenantId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<IUser>> {
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

  static async updateRole(
    tenantId: string,
    id: string,
    role: "ADMIN" | "FINANCE" | "REVIEWER"
  ): Promise<void> {
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
