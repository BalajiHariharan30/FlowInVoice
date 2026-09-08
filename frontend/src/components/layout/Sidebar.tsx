import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Receipt,
  CheckSquare,
  Users,
  Building2,
  ShieldCheck
} from "lucide-react";

export const Sidebar: React.FC = () => {
  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/pos", label: "Purchase Orders", icon: FileText },
    { to: "/invoices", label: "Invoices", icon: Receipt },
    { to: "/reviews", label: "Review Center", icon: CheckSquare },
    { to: "/customers", label: "Customers & Contracts", icon: Building2 },
    { to: "/users", label: "Users", icon: Users },
    { to: "/audit/system", label: "Audit Trail", icon: ShieldCheck }
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen fixed left-0 top-0 border-r border-slate-800">
      <div className="p-6 border-b border-slate-800 flex items-center space-x-3">
        <div className="w-8 h-8 rounded bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-base">
          P
        </div>
        <div>
          <h1 className="text-white font-bold text-base tracking-wide">P2I Agentic AI</h1>
          <p className="text-xs text-slate-400">Enterprise SaaS</p>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive
                    ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 flex items-center justify-between">
        <span>v1.0.0 Enterprise</span>
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
      </div>
    </aside>
  );
};
