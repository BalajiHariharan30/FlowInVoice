import { Router, Request, Response } from "express";
import { StorageService } from "../../storage/s3.service.js";

export const storageRouter = Router();

/**
 * GET /storage/download?key=...
 * Serves stored files for mock storage provider mode
 */
storageRouter.get("/download", async (req: Request, res: Response): Promise<void> => {
  const key = req.query.key as string;
  if (!key) {
    res.status(400).send("Missing storage key parameter");
    return;
  }

  const buffer = await StorageService.getFileBuffer(key);
  if (!buffer) {
    res.status(404).send("File not found");
    return;
  }

  const isPdf = key.toLowerCase().endsWith(".pdf");
  res.setHeader("Content-Type", isPdf ? "application/pdf" : "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${key.split("/").pop()}"`);
  res.send(buffer);
});
