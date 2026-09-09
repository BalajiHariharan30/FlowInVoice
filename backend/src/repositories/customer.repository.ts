import mongoose from "mongoose";
import { Customer, ICustomer } from "../models/index.js";
import { PaginationParams, PaginatedResult } from "../types/index.js";
import { inMemory, isDbConnected, generateId, calcPagination } from "./base.js";

export class CustomerRepository {
  static async create(tenantId: string, data: Partial<ICustomer>): Promise<ICustomer> {
    if (isDbConnected()) {
      const customer = new Customer({ ...data, tenantId });
      return customer.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId, ...data,
      createdAt: new Date(), updatedAt: new Date()
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
    return doc?.tenantId === tenantId ? doc : null;
  }

  static async findByCode(tenantId: string, code: string): Promise<ICustomer | null> {
    if (isDbConnected()) {
      return Customer.findOne({ tenantId, code });
    }
    for (const doc of inMemory.customers.values()) {
      if (doc.tenantId === tenantId && doc.code.toLowerCase() === code.toLowerCase()) return doc;
    }
    return null;
  }

  static async findByName(tenantId: string, name: string): Promise<ICustomer | null> {
    if (isDbConnected()) {
      return Customer.findOne({ tenantId, name: { $regex: new RegExp(`^${name}$`, "i") } });
    }
    for (const doc of inMemory.customers.values()) {
      if (doc.tenantId === tenantId && doc.name.toLowerCase() === name.toLowerCase()) return doc;
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
