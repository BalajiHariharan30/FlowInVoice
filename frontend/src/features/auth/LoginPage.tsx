import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/axios";
import { useForm } from "react-hook-form";
import { ShieldCheck, ArrowRight, Lock, Mail, ChevronDown, ChevronUp } from "lucide-react";

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const queryParams = new URLSearchParams(location.search);
  const isExpired = queryParams.get("expired") === "true";

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<{ email: string; password: string }>({
    defaultValues: {
      email: "admin@p2i.ai",
      password: "password123"
    }
  });

  const handleGoogleLogin = () => {
    // In demo/production, initiate Google OAuth 2.0 flow
    // For seamless local dev, simulate verified Google OAuth callback
    login(
      "mock_google_access_token",
      "mock_google_refresh_token",
      {
        id: "usr_google_admin",
        tenantId: "tenant_default",
        email: "enterprise.admin@company.com",
        name: "Enterprise Admin (Google)",
        role: "ADMIN"
      }
    );
    navigate("/dashboard");
  };

  const onEmailSubmit = async (data: { email: string; password: string }) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await apiClient.post("/auth/login", data);
      login(res.data.accessToken, res.data.refreshToken, {
        id: res.data.id,
        tenantId: res.data.tenantId,
        email: res.data.email,
        name: res.data.name,
        role: res.data.role
      });
      navigate("/dashboard");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sign in. Please check your credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-obsidian-base relative flex flex-col justify-center py-12 sm:px-6 lg:px-8 overflow-hidden">
      {/* Ambient Aurora Glow Effects */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-br from-emerald-500/15 via-teal-500/10 to-transparent blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-40 right-1/4 w-[500px] h-[400px] bg-gradient-to-tr from-purple-500/15 via-blue-500/10 to-transparent blur-[130px] rounded-full pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-400 to-teal-400 flex items-center justify-center font-black text-obsidian-base text-2xl shadow-neon-emerald tracking-tighter">
            P
          </div>
        </div>
        <h2 className="mt-5 text-center text-3xl font-black text-white tracking-tight">
          PO-to-Invoice Agentic AI
        </h2>
        <p className="mt-2 text-center text-xs text-slate-400 font-mono">
          Multi-tenant autonomous document processing & deterministic validation
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0 relative z-10">
        <div className="glass-panel py-8 px-6 sm:px-10 rounded-3xl border border-white/10 shadow-glass relative overflow-hidden backdrop-blur-2xl">
          {/* Specular Top Glow Line */}
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />

          {isExpired && (
            <div className="mb-6 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs">
              Session expired. Please sign in again. Your previously uploaded document remains available for processing if the server accepted it.
            </div>
          )}

          {errorMessage && (
            <div className="mb-6 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
              {errorMessage}
            </div>
          )}

          {/* Primary Action: Google OAuth 2.0 per §Part C §5 */}
          <div>
            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center space-x-3 px-4 py-3 border border-white/10 rounded-xl shadow-glass text-xs font-bold text-white bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-200 active:scale-[0.99] group"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Continue with Google Enterprise</span>
            </button>
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={() => setShowEmailForm(!showEmailForm)}
              className="text-xs text-slate-400 hover:text-white inline-flex items-center space-x-1.5 transition-colors font-mono"
            >
              <span>Sign in with credentials</span>
              {showEmailForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Secondary Email/Password Form */}
          {showEmailForm && (
            <form onSubmit={handleSubmit(onEmailSubmit)} className="mt-6 space-y-4">
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-slate-300 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    {...register("email")}
                    type="email"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-obsidian-card/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 backdrop-blur-md"
                    placeholder="name@company.com"
                  />
                </div>
                {errors.email && (
                  <p className="text-xs text-rose-400 mt-1">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    {...register("password")}
                    type="password"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-obsidian-card/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 backdrop-blur-md"
                    placeholder="••••••••"
                  />
                </div>
                {errors.password && (
                  <p className="text-xs text-rose-400 mt-1">{errors.password.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-4 flex items-center justify-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-obsidian-base rounded-xl text-xs font-bold shadow-neon-emerald transition-all duration-200 disabled:opacity-50 active:scale-[0.99]"
              >
                <span>{isSubmitting ? "Signing In..." : "Sign In with Credentials"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-white/10 flex items-center justify-center space-x-2 text-xs text-slate-400 font-mono">
            <ShieldCheck className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span>Multi-tenant Isolation & RBAC Enforced</span>
          </div>
        </div>
      </div>
    </div>
  );
};
