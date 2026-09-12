import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRepository } from "../../repositories/index.js";
import { AuthService } from "../../auth/jwt.js";
import { authenticate } from "../../auth/auth.middleware.js";
import { authRateLimiter } from "../middleware/rate-limiter.js";
import { env } from "../../config/env.js";
import { User } from "../../models/index.js";
import jwt from "jsonwebtoken";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const refreshSchema = z.object({
  refreshToken: z.string()
});

authRouter.post("/login", authRateLimiter, async (req: Request, res: Response): Promise<void> => {
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

  // Auto-seed demo users or configured admin emails if not present
  const isAdminEmail =
    email === "h.balaji1964@gmail.com" ||
    email === "balaji.hdev@gmail.com" ||
    email === "admin@flowinvoice.ai" ||
    email === "admin@p2i.ai";

  const isDemoEmail =
    isAdminEmail ||
    email.endsWith("@flowinvoice.ai") ||
    email.endsWith("@p2i.ai") ||
    email === "finance@p2i.ai";

  if (!user && isDemoEmail) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    let role: "ADMIN" | "FINANCE" | "REVIEWER" = "ADMIN";
    let name = "Admin";

    if (isAdminEmail) {
      role = "ADMIN";
      name = "Admin";
    } else if (email.startsWith("finance")) {
      role = "FINANCE";
      name = "Finance";
    } else if (email.startsWith("reviewer")) {
      role = "REVIEWER";
      name = "Reviewer";
    }

    user = await UserRepository.create(tenantId, {
      email,
      name,
      passwordHash,
      role,
      isActive: true
    });
  }

  // Ensure demo accounts always have clean role names without personal names
  if (user && isDemoEmail) {
    let cleanName = "Admin";
    if (user.role === "FINANCE" || email.startsWith("finance")) cleanName = "Finance";
    else if (user.role === "REVIEWER" || email.startsWith("reviewer")) cleanName = "Reviewer";
    else cleanName = "Admin";

    if (user.name !== cleanName) {
      user.name = cleanName;
      await User.updateOne({ _id: user._id }, { name: cleanName });
    }
  }

  if (user && isAdminEmail && !user.passwordHash && password === "password123") {
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(password, salt);
    await User.updateOne({ _id: user._id }, { passwordHash: user.passwordHash });
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

authRouter.post("/refresh", authRateLimiter, async (req: Request, res: Response): Promise<void> => {
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

const googleAuthSchema = z.object({
  credential: z.string().min(10)
});

authRouter.post("/google", async (req: Request, res: Response): Promise<void> => {
  const parse = googleAuthSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Missing or invalid Google credential token",
      details: parse.error.format(),
      requestId: req.requestId || ""
    });
    return;
  }

  const { credential } = parse.data;
  const tenantId = (req.headers["x-tenant-id"] as string) || "tenant_default";

  try {
    let payload: any = null;

    try {
      const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
      const googleRes = await fetch(verifyUrl, { signal: AbortSignal.timeout(5000) });
      if (googleRes.ok) {
        payload = await googleRes.json();
      } else {
        res.status(401).json({
          code: "GOOGLE_AUTH_FAILED",
          message: "Failed to verify Google ID token with Google OAuth servers",
          details: {},
          requestId: req.requestId || ""
        });
        return;
      }
    } catch (networkErr: any) {
      res.status(401).json({
        code: "GOOGLE_AUTH_FAILED",
        message: "Failed to verify Google ID token with Google OAuth servers",
        details: {},
        requestId: req.requestId || ""
      });
      return;
    }

    if (!payload) {
      res.status(401).json({
        code: "INVALID_GOOGLE_TOKEN",
        message: "Google verification rejected the token",
        details: {},
        requestId: req.requestId || ""
      });
      return;
    }

    // Verify audience matches our Google Client ID
    const expectedClientId = env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    if (expectedClientId && expectedClientId !== "mock-google-client-id") {
      if (payload.aud !== expectedClientId) {
        res.status(401).json({
          code: "AUDIENCE_MISMATCH",
          message: "Google token audience does not match configured client ID",
          details: {},
          requestId: req.requestId || ""
        });
        return;
      }
    }

    const email = payload.email?.toLowerCase().trim();
    const name = payload.name || payload.given_name || (email ? email.split("@")[0] : "Google User");
    const googleId = payload.sub;

    if (!email) {
      res.status(400).json({
        code: "INVALID_PROFILE",
        message: "Google user profile does not contain an email address",
        details: {},
        requestId: req.requestId || ""
      });
      return;
    }

    const ADMIN_EMAILS = [
      "h.balaji1964@gmail.com",
      "balaji.hdev@gmail.com",
      "admin@flowinvoice.ai",
      "admin@p2i.ai"
    ];

    const isAdmin = ADMIN_EMAILS.includes(email);
    const assignedRole: "ADMIN" | "FINANCE" | "REVIEWER" = isAdmin ? "ADMIN" : "FINANCE";

    let user = await UserRepository.findByEmail(tenantId, email);

    if (!user) {
      user = await UserRepository.create(tenantId, {
        email,
        name: isAdmin && !payload.name ? "Admin" : name,
        googleId,
        role: assignedRole,
        isActive: true
      });
    } else if (isAdmin && user.role !== "ADMIN") {
      await UserRepository.updateRole(tenantId, user._id.toString(), "ADMIN");
      user.role = "ADMIN";
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
  } catch (err: any) {
    res.status(500).json({
      code: "GOOGLE_AUTH_ERROR",
      message: err.message || "Failed to authenticate with Google",
      details: {},
      requestId: req.requestId || ""
    });
  }
});

