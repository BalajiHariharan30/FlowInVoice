import { Router, Request, Response } from "express";
import { authenticate } from "../../auth/auth.middleware.js";
import { StorageService } from "../../storage/s3.service.js";

export const storageRouter = Router();

storageRouter.use(authenticate);

/**
 * GET /storage/download?key=...
 * Serves stored files for mock storage provider mode with tenant isolation enforcement.
 */
storageRouter.get("/download", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const key = req.query.key as string;

  if (!key || typeof key !== "string" || key.trim().length === 0) {
    res.status(400).json({
      code: "VALIDATION_FAILURE",
      message: "Missing storage key parameter",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  // Tenant prefix check: verify the key belongs to the authenticated user's tenant
  const validTenantPrefixes = [`tenants/${tenantId}/`, `${tenantId}/`];
  const isTenantScoped =
    !key.includes("..") &&
    validTenantPrefixes.some((prefix) => key.startsWith(prefix));

  if (!isTenantScoped) {
    res.status(403).json({
      code: "FORBIDDEN",
      message: "Access to storage resource is forbidden for this tenant",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  const buffer = await StorageService.getFileBuffer(key);
  if (!buffer) {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "File not found",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  const isPdf = key.toLowerCase().endsWith(".pdf");
  res.setHeader("Content-Type", isPdf ? "application/pdf" : "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${key.split("/").pop()}"`);
  res.send(buffer);
});

