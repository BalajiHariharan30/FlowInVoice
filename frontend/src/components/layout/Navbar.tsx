import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { LogOut, User as UserIcon, Building } from "lucide-react";

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
      <div className="flex items-center space-x-3">
        <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
          <Building className="w-3.5 h-3.5 text-slate-500" />
          <span>Tenant: <strong className="text-slate-900">{user?.tenantId || "tenant_default"}</strong></span>
        </span>
      </div>

      <div className="flex items-center space-x-5">
        <div className="flex items-center space-x-3 text-right">
          <div>
            <div className="text-sm font-semibold text-slate-800">{user?.name || "Anonymous"}</div>
            <div className="text-xs text-slate-500 font-mono">{user?.role}</div>
          </div>
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700">
            <UserIcon className="w-4 h-4" />
          </div>
        </div>

        <button
          onClick={logout}
          title="Sign Out"
          className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
