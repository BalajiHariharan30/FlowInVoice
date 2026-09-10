import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AuthUser, Role } from "../types/index.js";

export interface TokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
}

export class AuthService {
  static generateTokens(user: AuthUser) {
    const payload: TokenPayload = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role
    };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as any
    });

    const refreshToken = jwt.sign(
      { userId: user.id, tenantId: user.tenantId },
      env.REFRESH_TOKEN_SECRET,
      { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as any }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 86400 // 24 hours in seconds
    };
  }

  static verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  }

  static verifyRefreshToken(token: string): { userId: string; tenantId: string } {
    return jwt.verify(token, env.REFRESH_TOKEN_SECRET) as { userId: string; tenantId: string };
  }
}
