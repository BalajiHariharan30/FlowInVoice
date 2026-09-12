import { Router, Request, Response } from "express";
import { authenticate } from "../../auth/auth.middleware.js";
import { CustomerRepository, ContractRepository, AuditRepository } from "../../repositories/index.js";
import { DocumentChunker } from "../../rag/chunking.js";
import { QdrantService } from "../../rag/qdrant.service.js";

export const customerRouter = Router();

customerRouter.use(authenticate);

/**
 * GET /customers
 * List customers with pagination and search
 */
customerRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { page, pageSize, search } = req.query;

  const result = await CustomerRepository.findMany(tenantId, {
    page: page ? parseInt(page as string, 10) : 1,
    pageSize: pageSize ? parseInt(pageSize as string, 10) : 20,
    search: search as string
  });

  const customerIds = result.data.map((c) => c._id.toString());
  const allContracts = await ContractRepository.findByCustomerIds(tenantId, customerIds);
  const contractCountByCustomer = new Map<string, number>();
  for (const c of allContracts) {
    const custId = c.customerId.toString();
    contractCountByCustomer.set(custId, (contractCountByCustomer.get(custId) || 0) + 1);
  }

  const formattedData = result.data.map((cust) => {
    const custId = cust._id.toString();
    return {
      id: custId,
      name: cust.name,
      code: cust.code,
      email: cust.email,
      gstNumber: cust.gstNumber,
      paymentTerms: cust.paymentTerms,
      currency: cust.currency,
      contractCount: contractCountByCustomer.get(custId) || 0,
      createdAt: cust.createdAt,
      updatedAt: cust.updatedAt
    };
  });

  res.status(200).json({
    data: formattedData,
    pagination: result.pagination
  });
});

/**
 * GET /customers/:customerId
 * Customer details with 1-to-N contracts list (§C11.3)
 */
customerRouter.get("/:customerId", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const customerId = req.params.customerId as string;
  const customer = await CustomerRepository.findById(tenantId, customerId);

  if (!customer) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Customer not found",
      details: { customerId: req.params.customerId },
      requestId: req.requestId || ""
    });
    return;
  }

  // Retrieve 1-to-N contracts for this customer
  const contracts = await ContractRepository.findByCustomerId(tenantId, customer._id.toString());

  res.status(200).json({
    id: customer._id.toString(),
    name: customer.name,
    code: customer.code,
    email: customer.email,
    gstNumber: customer.gstNumber,
    paymentTerms: customer.paymentTerms,
    currency: customer.currency,
    address: customer.address,
    contracts: contracts.map((c) => ({
      id: c._id.toString(),
      contractNumber: c.contractNumber,
      contractType: c.contractType,
      effectiveFrom: c.effectiveFrom,
      effectiveTo: c.effectiveTo,
      status: c.status,
      totalValue: c.totalValue,
      termsSummary: c.termsSummary,
      createdAt: c.createdAt
    })),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt
  });
});

/**
 * POST /customers/:customerId/contracts
 * Ingests a new customer contract, chunks it, and indexes into Qdrant for RAG
 */
customerRouter.post("/:customerId/contracts", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const customerId = req.params.customerId as string;
  const { contractNumber, contractType, effectiveFrom, effectiveTo, rawContent, totalValue } = req.body;

  const customer = await CustomerRepository.findById(tenantId, customerId);
  if (!customer) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Customer not found for this tenant",
      details: { customerId },
      requestId: req.requestId || ""
    });
    return;
  }

  if (!contractNumber || !effectiveFrom || !effectiveTo) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Missing required contract fields",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  const contract = await ContractRepository.create(tenantId, {
    customerId,
    contractNumber,
    contractType: contractType || "MASTER_SERVICES_AGREEMENT",
    effectiveFrom: new Date(effectiveFrom),
    effectiveTo: new Date(effectiveTo),
    status: "ACTIVE",
    totalValue: totalValue || 50000,
    termsSummary: rawContent ? rawContent.substring(0, 200) : "Standard Agreement"
  });

  // Chunk and index into Qdrant if content provided
  if (rawContent) {
    const chunks = DocumentChunker.chunkContractOrPolicy(
      tenantId,
      contract._id.toString(),
      `Contract-${contractNumber}`,
      "CONTRACT",
      rawContent,
      customerId
    );

    await QdrantService.indexChunks(chunks);

    await AuditRepository.create(tenantId, {
      agentName: "ContractOnboardingAgent",
      action: "INDEX_CONTRACT",
      status: "SUCCESS",
      entityId: contract._id.toString(),
      workflowId: `contract_ingest_${contract._id.toString()}`,
      summary: `Indexed ${chunks.length} contract clauses in Qdrant with tenant isolation (${tenantId}, ${customerId})`
    });
  }

  res.status(201).json({
    id: contract._id.toString(),
    contractNumber: contract.contractNumber,
    contractType: contract.contractType,
    status: contract.status
  });
});
