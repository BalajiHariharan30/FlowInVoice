import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Receipt,
  CheckSquare,
  Users,
  Building2,
  ShieldCheck,
  Sparkles
} from "lucide-react";

export const Sidebar: React.FC = () => {
  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/pos", label: "Purchase Orders", icon: FileText },
    { to: "/invoices", label: "Invoices", icon: Receipt },
    { to: "/reviews", label: "Review Center", icon: CheckSquare },
    { to: "/customers", label: "Customers & Contracts", icon: Building2 },
    { to: "/users", label: "Users & Roles", icon: Users },
    { to: "/audit/system", label: "Audit Ledger", icon: ShieldCheck }
  ];

  return (
    <aside className="w-64 bg-obsidian-900/80 backdrop-blur-2xl text-slate-300 flex flex-col h-screen fixed left-0 top-0 border-r border-white/[0.06] z-20">
      {/* Brand Header */}
      <div className="p-6 border-b border-white/[0.06] flex items-center space-x-3.5">
        <div className="relative">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 flex items-center justify-center font-black text-obsidian-950 text-base shadow-neon-emerald">
            P
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-obsidian-900 animate-pulse"></div>
        </div>
        <div>
          <div className="flex items-center space-x-1.5">
            <h1 className="text-white font-bold text-base tracking-tight">P2I Agentic</h1>
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-[11px] text-slate-400 font-medium tracking-wide uppercase">
            Autonomous SaaS
          </p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 shadow-[0_0_20px_-3px_rgba(16,185,129,0.25)]"
                    : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
                  )}
                  <Icon
                    className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${
                      isActive ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-200"
                    }`}
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer System Status */}
      <div className="p-4 border-t border-white/[0.06] bg-obsidian-950/40">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-slate-400 font-medium">Agents Online</span>
          </div>
          <span className="font-mono text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
            v1.0-PROD
          </span>
        </div>
      </div>
    </aside>
  );
};
