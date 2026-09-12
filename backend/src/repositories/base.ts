/**
 * Shared in-memory store, helpers, and test utilities.
 * All repository modules import from here — never from each other.
 */
import mongoose from "mongoose";

// ----------------------------------------------------------------
// In-memory storage (offline / unit-test mode)
// ----------------------------------------------------------------
export const inMemory = {
  customers: new Map<string, any>(),
  contracts: new Map<string, any>(),
  pos: new Map<string, any>(),
  invoices: new Map<string, any>(),
  reviews: new Map<string, any>(),
  audits: new Map<string, any>(),
  validations: new Map<string, any>(),
  users: new Map<string, any>(),
  products: new Map<string, any>()
};

/** Clears all in-memory stores — call in beforeEach for test isolation. */
export function clearTestRepositories(): void {
  inMemory.customers.clear();
  inMemory.contracts.clear();
  inMemory.pos.clear();
  inMemory.invoices.clear();
  inMemory.reviews.clear();
  inMemory.audits.clear();
  inMemory.validations.clear();
  inMemory.users.clear();
  inMemory.products.clear();
}

/** Returns true when Mongoose is actively connected to MongoDB. */
export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/** Generates a new ObjectId string for in-memory records. */
export function generateId(): string {
  return new mongoose.Types.ObjectId().toString();
}

/** Computes standard pagination metadata. */
export function calcPagination(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 1
  };
}
