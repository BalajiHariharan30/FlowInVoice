import { Router, Request, Response } from "express";
import { authenticate } from "../../auth/auth.middleware.js";
import { AuditRepository } from "../../repositories/index.js";

export const auditRouter = Router();

auditRouter.use(authenticate);

/**
 * GET /audit/:entityId
 * Bounded audit log trail per §B24 and §C11.4
 */
auditRouter.get("/:entityId", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const entityId = req.params.entityId as string;

  const logs = await AuditRepository.findByEntityId(tenantId, entityId);

  const formattedData = logs.map((l) => ({
    id: l._id.toString(),
    agentName: l.agentName,
    action: l.action,
    status: l.status,
    entityId: l.entityId,
    workflowId: l.workflowId,
    timestamp: l.timestamp,
    model: l.model,
    latency: l.latency,
    tokenUsage: l.tokenUsage,
    summary: l.summary,
    references: l.references || [],
    traceId: l.traceId,
    traceLocation: l.traceLocation
  }));

  res.status(200).json({
    data: formattedData,
    pagination: {
      page: 1,
      pageSize: formattedData.length,
      total: formattedData.length,
      totalPages: 1
    }
  });
});
