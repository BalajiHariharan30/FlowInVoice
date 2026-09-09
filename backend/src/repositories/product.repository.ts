import { Product, IProduct } from "../models/index.js";
import { inMemory, isDbConnected, generateId } from "./base.js";

export class ProductRepository {
  static async create(tenantId: string, data: Partial<IProduct>): Promise<IProduct> {
    if (isDbConnected()) {
      const product = new Product({ ...data, tenantId });
      return product.save();
    }
    const id = generateId();
    const doc: any = {
      _id: id, id, tenantId,
      ...data,
      createdAt: new Date(), updatedAt: new Date()
    };
    inMemory.products.set(id, doc);
    return doc;
  }

  static async findBySku(tenantId: string, sku: string): Promise<IProduct | null> {
    if (isDbConnected()) {
      return Product.findOne({ tenantId, sku });
    }
    for (const doc of inMemory.products.values()) {
      if (doc.tenantId === tenantId && doc.sku === sku) return doc;
    }
    return null;
  }
}
