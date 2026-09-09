import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  timestamps: number[];
}

const windowMs = 60 * 1000; // 1-minute window
const maxRequests = 20; // 20 requests per minute per user/tenant
const requestStore = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requestStore.entries()) {
    const validTimestamps = entry.timestamps.filter((t) => now - t < windowMs);
    if (validTimestamps.length === 0) {
      requestStore.delete(key);
    } else {
      entry.timestamps = validTimestamps;
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Route-scoped sliding window rate limiter for PO Workflow orchestration.
 * Isolated strictly to workflow execution; unrelated routes are unaffected.
 */
export function workflowRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = req.user
    ? `${req.user.tenantId}:${req.user.id}`
    : `anon:${req.ip || "unknown"}`;

  const now = Date.now();
  let entry = requestStore.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    requestStore.set(key, entry);
  }

  // Purge expired timestamps from sliding window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);

    res.setHeader("Retry-After", Math.max(1, retryAfterSec));
    res.setHeader("RateLimit-Limit", maxRequests);
    res.setHeader("RateLimit-Remaining", 0);
    res.status(429).json({
      code: "RATE_LIMIT_EXCEEDED",
      message: `Workflow orchestration rate limit exceeded. Please wait ${retryAfterSec} second(s) before retrying.`,
      details: {
        maxRequestsPerMinute: maxRequests,
        retryAfterSeconds: retryAfterSec
      },
      requestId: req.requestId || ""
    });
    return;
  }

  entry.timestamps.push(now);
  res.setHeader("RateLimit-Limit", maxRequests);
  res.setHeader(
    "RateLimit-Remaining",
    Math.max(0, maxRequests - entry.timestamps.length)
  );

  next();
}

/**
 * Test isolation helper to clear workflow rate limiter state.
 */
export function resetWorkflowRateLimiter(): void {
  requestStore.clear();
}
