import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { LogOut, Building, ShieldCheck, Sparkles } from "lucide-react";

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 bg-obsidian-950/60 backdrop-blur-2xl border-b border-white/[0.06] flex items-center justify-between px-8 sticky top-0 z-10 transition-all">
      {/* Tenant Pill */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-slate-300 shadow-glass-sm">
          <Building className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-400">Workspace:</span>
          <strong className="text-slate-100 font-mono tracking-tight">
            {user?.tenantId || "tenant_default"}
          </strong>
        </div>
      </div>

      {/* User Status & Actions */}
      <div className="flex items-center space-x-5">
        <div className="flex items-center space-x-3 text-right">
          <div>
            <div className="text-xs font-semibold text-slate-100 flex items-center space-x-1.5">
              <span>{user?.name || "Administrator"}</span>
            </div>
            <div className="flex items-center justify-end space-x-1 mt-0.5">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-mono text-emerald-400/90 tracking-wider uppercase">
                {user?.role || "VIEWER"}
              </span>
            </div>
          </div>

          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 border border-white/10 flex items-center justify-center text-slate-200 font-bold text-xs shadow-glass-sm">
            {user?.name ? user.name.slice(0, 2).toUpperCase() : "AD"}
          </div>
        </div>

        <button
          onClick={logout}
          title="Sign Out"
          className="p-2 text-slate-400 hover:text-rose-300 rounded-xl hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all duration-200"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
