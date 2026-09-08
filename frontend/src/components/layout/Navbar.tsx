import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  Search,
  Building2,
  Bell,
  ChevronDown,
  Sparkles,
  HelpCircle,
  ShieldCheck
} from "lucide-react";

interface NavbarProps {
  onOpenCommandPalette?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenCommandPalette }) => {
  const { user, activeTenant, setTenant } = useAuth();
  const location = useLocation();
  const [showTenantDropdown, setShowTenantDropdown] = useState(false);

  // Generate breadcrumb from pathname
  const pathSegments = location.pathname.split("/").filter(Boolean);
  const currentSection = pathSegments[0]
    ? pathSegments[0].toUpperCase().replace(/-/g, " ")
    : "DASHBOARD";

  const tenants = ["Acme Corporation", "Globex Industries", "Stark Enterprises", "Wayne Holdings"];

  return (
    <header className="h-14 bg-dark-primary border-b border-dark-border flex items-center justify-between px-6 sticky top-0 z-20">
      {/* Left: Breadcrumbs */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="text-workspace-muted font-mono">FLOWINVOICE</span>
        <span className="text-dark-border">/</span>
        <span className="text-white font-medium tracking-wide">{currentSection}</span>
      </div>

      {/* Center: Command Palette Trigger (§6 & §28) */}
      <div className="flex-1 max-w-md mx-6">
        <button
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between px-3 py-1.5 bg-dark-secondary hover:bg-dark-hover border border-dark-border rounded-lg text-xs text-workspace-muted hover:text-slate-300 transition group"
        >
          <div className="flex items-center space-x-2">
            <Search className="w-3.5 h-3.5 text-workspace-muted group-hover:text-white transition-colors" />
            <span>Search anything...</span>
          </div>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-dark-elevated text-slate-400 border border-dark-border rounded">
            ⌘ K
          </kbd>
        </button>
      </div>

      {/* Right: AI Status, Tenant, Notifications, User */}
      <div className="flex items-center space-x-4">
        {/* AI System Status (§6) */}
        <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-dark-secondary border border-dark-border text-[11px] font-mono text-slate-300">
          <span className="w-2 h-2 rounded-full bg-semantic-success animate-pulse"></span>
          <span>AI Systems Operational</span>
        </div>

        {/* Multi-Tenancy Selector Dropdown (§26) */}
        <div className="relative">
          <button
            onClick={() => setShowTenantDropdown(!showTenantDropdown)}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-dark-secondary hover:bg-dark-hover border border-dark-border text-xs text-slate-200 transition"
          >
            <Building2 className="w-3.5 h-3.5 text-accent-secondary" />
            <span className="font-medium max-w-[120px] truncate">{activeTenant}</span>
            <ChevronDown className="w-3 h-3 text-workspace-muted" />
          </button>

          {showTenantDropdown && (
            <div className="absolute right-0 mt-1.5 w-48 bg-dark-secondary border border-dark-border rounded-xl shadow-dark-elevated py-1 z-50 text-xs">
              <div className="px-3 py-1 text-[10px] uppercase font-mono text-workspace-muted">
                Switch Organization
              </div>
              {tenants.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTenant(t);
                    setShowTenantDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-dark-hover transition flex items-center justify-between ${
                    t === activeTenant ? "text-accent-secondary font-medium" : "text-slate-300"
                  }`}
                >
                  <span className="truncate">{t}</span>
                  {t === activeTenant && <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notifications Icon */}
        <button
          onClick={onOpenCommandPalette}
          className="relative p-1.5 text-workspace-muted hover:text-white rounded-lg hover:bg-dark-hover transition"
          title="Notifications & Exceptions"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-semantic-warning"></span>
        </button>

        {/* User Role Badge */}
        <div className="flex items-center space-x-2 pl-1 border-l border-dark-border">
          <div className="text-right hidden md:block">
            <div className="text-xs font-medium text-white">{user?.name || "Admin"}</div>
            <div className="text-[10px] font-mono text-accent-secondary uppercase">
              {user?.role || "ADMIN"}
            </div>
          </div>
          <div className="w-7 h-7 rounded-md bg-accent-primary text-white flex items-center justify-center font-bold text-xs">
            {user?.name ? user.name.slice(0, 1).toUpperCase() : "A"}
          </div>
        </div>
      </div>
    </header>
  );
};
