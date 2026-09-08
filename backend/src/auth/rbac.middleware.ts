import { Request, Response, NextFunction } from "express";
import { Role } from "../types/index.js";

export function requireRoles(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        message: "Authentication required",
        details: {},
        requestId: req.requestId || ""
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        code: "FORBIDDEN",
        message: `Insufficient permissions. Allowed roles: ${allowedRoles.join(", ")}`,
        details: { userRole: req.user.role, requiredRoles: allowedRoles },
        requestId: req.requestId || ""
      });
      return;
    }

    next();
  };
}
