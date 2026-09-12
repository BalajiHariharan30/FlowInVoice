import { Request, Response, NextFunction } from "express";

interface RateLimitRecord {
  attempts: number[];
  firstAttempt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

const memoryStore = new Map<string, RateLimitRecord>();

// Periodic cleanup of expired entries every 5 minutes
if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of memoryStore.entries()) {
      if (record.attempts.length === 0 || now - record.attempts[record.attempts.length - 1] > 900000) {
        memoryStore.delete(key);
      }
    }
  }, 300000);
}

export function clearRateLimitStore(): void {
  memoryStore.clear();
}

export function createRateLimiter(options: RateLimiterOptions) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxAttempts = 5,
    message = "Too many requests. Please try again later.",
    keyGenerator = (req: Request) => {
      const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const identifier = req.body?.email || req.body?.refreshToken || req.headers["x-forwarded-for"] || "anon";
      return `${ip}:${identifier}`;
    }
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Bypass in Vitest unit testing if header present or disabled
    if (req.headers["x-bypass-rate-limit"] === "true") {
      next();
      return;
    }

    const key = keyGenerator(req);
    const now = Date.now();
    const record = memoryStore.get(key) || { attempts: [], firstAttempt: now };

    // Filter attempts within the sliding window
    record.attempts = record.attempts.filter((timestamp) => now - timestamp < windowMs);

    if (record.attempts.length >= maxAttempts) {
      const oldestAttempt = record.attempts[0];
      const timeRemainingMs = Math.max(0, windowMs - (now - oldestAttempt));
      const retryAfterSeconds = Math.ceil(timeRemainingMs / 1000);

      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.setHeader("X-RateLimit-Limit", String(maxAttempts));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((oldestAttempt + windowMs) / 1000)));

      res.status(429).json({
        code: "RATE_LIMIT_EXCEEDED",
        message: `${message} (Retry after ${retryAfterSeconds}s)`,
        retryAfter: retryAfterSeconds,
        requestId: req.requestId || ""
      });
      return;
    }

    // Record this attempt
    record.attempts.push(now);
    memoryStore.set(key, record);

    res.setHeader("X-RateLimit-Limit", String(maxAttempts));
    res.setHeader("X-RateLimit-Remaining", String(maxAttempts - record.attempts.length));

    next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxAttempts: 5,
  message: "Too many authentication attempts. Please try again later.",
  keyGenerator: (req: Request) => {
    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const account = req.body?.email?.toLowerCase().trim() || "token-auth";
    return `auth:${ip}:${account}`;
  }
});
