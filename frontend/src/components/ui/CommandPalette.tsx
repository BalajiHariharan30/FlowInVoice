import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  FileText,
  Receipt,
  CheckSquare,
  Building2,
  BarChart3,
  Code2,
  Settings,
  Upload,
  ArrowRight,
  Sparkles,
  X
} from "lucide-react";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  category: "Actions" | "Purchase Orders" | "Invoices" | "Customers" | "System";
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const commands: CommandItem[] = [
    // Primary Actions
    {
      id: "act_upload",
      category: "Actions",
      title: "Upload Purchase Order",
      subtitle: "Ingest new PO document for autonomous extraction",
      icon: Upload,
      action: () => {
        navigate("/pos/upload");
        onClose();
      }
    },
    {
      id: "act_review",
      category: "Actions",
      title: "Review Pending Exceptions",
      subtitle: "18 exceptions require human verification",
      icon: CheckSquare,
      action: () => {
        navigate("/reviews");
        onClose();
      }
    },
    {
      id: "act_invoices",
      category: "Actions",
      title: "View Invoices Ledger",
      subtitle: "Inspect generated, verified & issued invoices",
      icon: Receipt,
      action: () => {
        navigate("/invoices");
        onClose();
      }
    },
    // Navigation / Modules
    {
      id: "nav_pos",
      category: "Purchase Orders",
      title: "PO-2026-1042 — ACME Corp",
      subtitle: "Amount: ₹284,500 • Status: PROCESSING",
      icon: FileText,
      action: () => {
        navigate("/pos");
        onClose();
      }
    },
    {
      id: "nav_po_2",
      category: "Purchase Orders",
      title: "PO-2026-1039 — Globex Corp",
      subtitle: "Amount: ₹125,000 • Status: HUMAN_REVIEW",
      icon: FileText,
      action: () => {
        navigate("/reviews");
        onClose();
      }
    },
    {
      id: "nav_inv_1",
      category: "Invoices",
      title: "INV-2026-889 — Stark Enterprises",
      subtitle: "Total: ₹12,450.00 • Status: ISSUED",
      icon: Receipt,
      action: () => {
        navigate("/invoices");
        onClose();
      }
    },
    {
      id: "nav_cust_1",
      category: "Customers",
      title: "Acme Industrial Corporation",
      subtitle: "Code: ACME • 3 Active MSAs",
      icon: Building2,
      action: () => {
        navigate("/customers");
        onClose();
      }
    },
    {
      id: "nav_analytics",
      category: "System",
      title: "Open Financial Analytics",
      subtitle: "Straight-through processing rates & SLA reports",
      icon: BarChart3,
      action: () => {
        navigate("/analytics");
        onClose();
      }
    },
    {
      id: "nav_developer",
      category: "System",
      title: "Open Developer Center",
      subtitle: "API Keys, Webhooks, and Request Explorer",
      icon: Code2,
      action: () => {
        navigate("/developer");
        onClose();
      }
    },
    {
      id: "nav_settings",
      category: "System",
      title: "Open Settings & RBAC",
      subtitle: "Organization profile, roles, and AI models",
      icon: Settings,
      action: () => {
        navigate("/settings");
        onClose();
      }
    }
  ];

  const filteredCommands = commands.filter(
    (c) =>
      c.title.toLowerCase().includes(query.toLowerCase()) ||
      c.subtitle?.toLowerCase().includes(query.toLowerCase()) ||
      c.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filteredCommands.length || 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1));
      } else if (e.key === "Enter" && filteredCommands[selectedIndex]) {
        e.preventDefault();
        filteredCommands[selectedIndex].action();
      } else if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-dark-secondary border border-dark-border rounded-2xl w-full max-w-xl shadow-dark-elevated overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-dark-border">
          <Search className="w-4 h-4 text-workspace-muted mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search POs, invoices, customers, or actions..."
            className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-workspace-muted text-sm"
          />
          <button
            onClick={onClose}
            className="text-workspace-muted hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command List */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-dark-border/40">
          {filteredCommands.length === 0 ? (
            <div className="p-8 text-center text-xs text-workspace-muted font-mono">
              No matching commands or entities found for &quot;{query}&quot;
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const Icon = cmd.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => cmd.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition text-xs ${
                    isSelected ? "bg-accent-primary text-white" : "text-slate-300 hover:bg-dark-hover"
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className={`p-1.5 rounded-lg ${
                        isSelected ? "bg-white/20 text-white" : "bg-dark-elevated text-accent-secondary"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <div className="font-medium truncate">{cmd.title}</div>
                      {cmd.subtitle && (
                        <div
                          className={`text-[11px] truncate ${
                            isSelected ? "text-white/80" : "text-workspace-muted"
                          }`}
                        >
                          {cmd.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 text-[10px] uppercase font-mono tracking-wider opacity-60">
                    <span>{cmd.category}</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2.5 bg-dark-primary border-t border-dark-border flex items-center justify-between text-[11px] text-workspace-muted font-mono">
          <div className="flex items-center space-x-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <div className="flex items-center space-x-1.5 text-accent-secondary">
            <Sparkles className="w-3 h-3" />
            <span>FlowInvoice AI Global Palette</span>
          </div>
        </div>
      </div>
    </div>
  );
};
