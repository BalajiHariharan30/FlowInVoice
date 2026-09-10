import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiClient } from "../lib/axios";
import { AuthUser } from "../types";

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  activeTenant: string;
  setTenant: (tenantId: string) => void;
  can: (permission: string) => boolean;
  login: (token: string, refreshToken: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTenant, setActiveTenant] = useState<string>(
    localStorage.getItem("activeTenant") || "Acme Corporation"
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const logout = useCallback(() => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    localStorage.removeItem("tenantId");
    setUser(null);
  }, []);

  const login = useCallback((accessToken: string, refreshToken: string, userData: AuthUser) => {
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("tenantId", userData.tenantId);
    setUser(userData);
  }, []);

  const setTenant = useCallback((tenantId: string) => {
    setActiveTenant(tenantId);
    localStorage.setItem("activeTenant", tenantId);
  }, []);

  // Strict RBAC capability evaluator per §25
  const can = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      const role = user.role;
      if (role === "ADMIN") return true;

      switch (permission) {
        case "po.upload":
          return ["FINANCE", "OPERATIONS"].includes(role);
        case "invoice.approve":
          return role === "FINANCE";
        case "review.resolve":
          return ["FINANCE", "OPERATIONS", "REVIEWER"].includes(role);
        case "settings.manage":
        case "api.manage":
          return false;
        case "view":
          return true;
        default:
          return false;
      }
    },
    [user]
  );

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem("accessToken");
      const cachedUser = localStorage.getItem("user");

      if (!token) {
        setIsLoading(false);
        return;
      }

      if (cachedUser) {
        try {
          setUser(JSON.parse(cachedUser));
        } catch {
          // ignore cache parse error
        }
      }

      try {
        const res = await apiClient.get<AuthUser>("/auth/me");
        setUser(res.data);
        localStorage.setItem("user", JSON.stringify(res.data));
      } catch (err: any) {
        // Only log out if backend explicitly returns 401 (token truly invalid/expired)
        // Network timeouts, cold-start delays, or 502s should NOT log out the user
        if (err?.status === 401 || err?.response?.status === 401) {
          logout();
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        activeTenant,
        setTenant,
        can,
        login,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
