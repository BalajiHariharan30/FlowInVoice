/**
 * repositories/index.ts — barrel export
 *
 * Re-exports all repository classes and the test-utility helpers so every
 * existing import site (`from "../../repositories/index.js"`) continues to work
 * with zero changes to callers.
 */

// Shared helpers & test utilities
export { clearTestRepositories } from "./base.js";

// Domain repositories (one class per file)
export { CustomerRepository } from "./customer.repository.js";
export { ContractRepository } from "./contract.repository.js";
export { PurchaseOrderRepository } from "./purchase-order.repository.js";
export { InvoiceRepository } from "./invoice.repository.js";
export { ReviewRepository, reconcileTaxFromLineItems, computeReviewDedupKey, mergeEvidenceArrays } from "./review.repository.js";
export { AuditRepository } from "./audit.repository.js";
export { ValidationResultRepository } from "./validation-result.repository.js";
export { UserRepository } from "./user.repository.js";
export { ProductRepository } from "./product.repository.js";
