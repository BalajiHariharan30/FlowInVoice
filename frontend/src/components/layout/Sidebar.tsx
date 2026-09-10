import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Receipt,
  CheckSquare,
  Building2,
  BarChart3,
  ShieldCheck,
  Code2,
  Settings,
  Zap,
  LogOut
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

export const Sidebar: React.FC = () => {
  const { user, activeTenant, logout } = useAuth();

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/pos", label: "Purchase Orders", icon: FileText },
    { to: "/invoices", label: "Invoices", icon: Receipt },
    { to: "/reviews", label: "Review Center", icon: CheckSquare, badge: "18" },
    { to: "/customers", label: "Customers", icon: Building2 },
    { to: "/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/audit/system", label: "Audit Logs", icon: ShieldCheck },
    { to: "/developer", label: "Developer", icon: Code2 },
    { to: "/settings", label: "Settings", icon: Settings }
  ];

  return (
    <aside className="w-64 bg-[#010308] text-slate-400 flex flex-col h-screen fixed left-0 top-0 border-r border-[#1D2430] z-30 select-none shadow-2xl">
      {/* Brand Header */}
      <div className="p-5 border-b border-[#1D2430] flex items-center space-x-3 bg-[#010308]">
        <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center text-white shadow-md flex-shrink-0">
          <Zap className="w-4 h-4 fill-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center space-x-1.5">
            <span className="text-white font-black text-sm tracking-tight truncate">FlowInvoice AI</span>
          </div>
          <p className="text-[10px] text-slate-400 font-mono tracking-tight truncate">
            Enterprise PO → Invoice
          </p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto bg-[#010308]">
        <div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
          Platform Operations
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-accent-primary text-white shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-[#171D2A]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 flex-shrink-0 ${
                        isActive ? "text-white" : "text-slate-400 group-hover:text-white"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full font-bold ${
                        isActive
                          ? "bg-white/20 text-white"
                          : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom User & Tenant Profile */}
      <div className="p-3 border-t border-[#1D2430] bg-[#0A0D14]">
        <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-[#10141D] border border-[#1D2430]">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-accent-primary/20 text-accent-secondary border border-accent-border/30 flex items-center justify-center font-bold text-xs flex-shrink-0">
              {user?.name ? user.name.slice(0, 1).toUpperCase() : "A"}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">{user?.name || "Administrator"}</div>
              <div className="text-[10px] text-slate-400 truncate font-mono">{activeTenant}</div>
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="p-1.5 text-slate-400 hover:text-rose-400 rounded-md hover:bg-[#171D2A] transition ml-1"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
};
