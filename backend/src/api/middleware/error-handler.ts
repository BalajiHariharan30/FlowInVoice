import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async route handler so any thrown error or rejected promise
 * is forwarded to Express next(err) instead of crashing the process.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
import { v4 as uuidv4 } from "uuid";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId = (req.headers["x-request-id"] as string) || `req_${uuidv4()}`;
  req.requestId = reqId;
  res.setHeader("X-Request-Id", reqId);
  next();
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.requestId || `req_${uuidv4()}`;
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "An unexpected error occurred";
  const details = err.details || {};

  res.status(status).json({
    code,
    message,
    details,
    requestId
  });
}
