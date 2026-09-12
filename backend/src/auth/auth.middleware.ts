import { Request, Response, NextFunction } from "express";
import { AuthService } from "./jwt.js";
import { AuthUser } from "../types/index.js";

// Augment Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (typeof req.query.token === "string" && req.query.token.trim().length > 0) {
    token = req.query.token.trim();
  }

  if (!token) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: "Missing or invalid authorization token",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }
  try {
    const payload = AuthService.verifyAccessToken(token);
    req.user = {
      id: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
      name: payload.name,
      role: payload.role
    };
    next();
  } catch (error) {
    res.status(401).json({
      code: "INVALID_TOKEN",
      message: "Token is expired or invalid",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }
}
