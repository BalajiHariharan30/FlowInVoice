import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRepository } from "../../repositories/index.js";
import { AuthService } from "../../auth/jwt.js";
import { authenticate } from "../../auth/auth.middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const refreshSchema = z.object({
  refreshToken: z.string()
});

authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Invalid login credentials format",
      details: parse.error.format(),
      requestId: req.requestId || ""
    });
    return;
  }

  const { email, password } = parse.data;
  const tenantId = (req.headers["x-tenant-id"] as string) || "tenant_default";

  let user = await UserRepository.findByEmail(tenantId, email);

  // Auto-seed demo admin user if not present
  if (!user && (email === "admin@p2i.ai" || email === "finance@p2i.ai")) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    user = await UserRepository.create(tenantId, {
      email,
      name: email.startsWith("admin") ? "Enterprise Administrator" : "Finance Specialist",
      passwordHash,
      role: email.startsWith("admin") ? "ADMIN" : "FINANCE",
      isActive: true
    });
  }

  if (!user || !user.passwordHash) {
    res.status(401).json({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    res.status(401).json({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  const tokens = AuthService.generateTokens({
    id: user._id.toString(),
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role
  });

  res.status(200).json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    ...tokens
  });
});

authRouter.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  const parse = refreshSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Missing or invalid refresh token",
      details: parse.error.format(),
      requestId: req.requestId || ""
    });
    return;
  }

  try {
    const payload = AuthService.verifyRefreshToken(parse.data.refreshToken);
    const user = await UserRepository.findById(payload.tenantId, payload.userId);
    if (!user || !user.isActive) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        message: "User session revoked",
        details: {},
        requestId: req.requestId || ""
      });
      return;
    }

    const tokens = AuthService.generateTokens({
      id: user._id.toString(),
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role
    });

    res.status(200).json(tokens);
  } catch (err) {
    res.status(401).json({
      code: "INVALID_TOKEN",
      message: "Refresh token is expired or invalid",
      details: {},
      requestId: req.requestId || ""
    });
  }
});

authRouter.get("/me", authenticate, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: "Not authenticated",
      details: {},
      requestId: req.requestId || ""
    });
    return;
  }

  res.status(200).json({
    id: req.user.id,
    tenantId: req.user.tenantId,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role
  });
});
