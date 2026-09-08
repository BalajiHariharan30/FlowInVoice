import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { Customer } from "../../types";
import { formatDate, formatCurrency } from "../../lib/format";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import {
  ArrowLeft,
  Building,
  FileText,
  Calendar,
  ShieldCheck,
  Plus,
  CheckCircle,
  AlertCircle
} from "lucide-react";

export const CustomerDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showAddContract, setShowAddContract] = useState(false);
  const [contractNumber, setContractNumber] = useState("");
  const [contractType, setContractType] = useState("MASTER_SERVICES_AGREEMENT");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split("T")[0]);
  const [effectiveTo, setEffectiveTo] = useState(
    new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0]
  );
  const [contractContent, setContractContent] = useState("");

  const { data: customer, isLoading, error, refetch } = useQuery<Customer>({
    queryKey: ["customer", id],
    queryFn: async () => {
      const res = await apiClient.get<Customer>(`/customers/${id}`);
      return res.data;
    },
    enabled: !!id
  });

  const addContractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/customers/${id}/contracts`, {
        contractNumber,
        contractType,
        effectiveFrom,
        effectiveTo,
        rawContent: contractContent
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      setShowAddContract(false);
      setContractNumber("");
      setContractContent("");
    }
  });

  if (isLoading) return <LoadingSkeleton rows={8} />;
  if (error || !customer) {
    return (
      <ErrorBanner
        message={(error as any)?.message || "Customer not found"}
        code={(error as any)?.code}
        requestId={(error as any)?.requestId}
        onRetry={() => refetch()}
      />
    );
  }

  const contracts = customer.contracts || [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate("/customers")}
            className="p-2.5 rounded-xl bg-obsidian-card/60 hover:bg-obsidian-card-hover border border-white/10 text-slate-400 hover:text-white transition shadow-glass backdrop-blur-md"
            title="Back to Customers"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
              <Building className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span>{customer.name}</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
              <span>Account Code:</span>
              <span className="font-mono font-bold text-slate-200 bg-white/5 px-2 py-0.5 rounded border border-white/10">{customer.code}</span>
              <span>• Billing Email: {customer.email}</span>
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddContract(true)}
          className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-obsidian-base rounded-xl text-xs font-bold shadow-neon-emerald transition-all duration-200 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Ingest New Contract</span>
        </button>
      </div>

      {/* Customer Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card p-5 rounded-2xl relative overflow-hidden border-emerald-500/20 group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
          <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-wider text-emerald-400 mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span className="font-semibold">GSTIN / Tax ID</span>
          </div>
          <div className="text-sm font-mono font-bold text-white">
            {customer.gstNumber || "Not Provided"}
          </div>
          <div className="text-[11px] text-emerald-400/70 mt-1">Validated for invoicing</div>
        </div>

        <div className="glass-card p-5 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2">
            <Calendar className="w-3.5 h-3.5 text-purple-400" />
            <span>Default Payment Terms</span>
          </div>
          <div className="text-sm font-bold text-white">{customer.paymentTerms}</div>
          <div className="text-[11px] text-slate-400 font-mono mt-1">Currency: {customer.currency}</div>
        </div>

        <div className="glass-card p-5 rounded-2xl relative overflow-hidden border-purple-500/20 group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/40 to-transparent" />
          <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-wider text-purple-300 mb-2">
            <FileText className="w-3.5 h-3.5 text-purple-400" />
            <span>Active Contracts Count</span>
          </div>
          <div className="text-sm font-bold text-purple-200">{contracts.length} Agreement(s)</div>
          <div className="text-[11px] text-purple-400/70 mt-1">1-to-Many Multi-Contract Architecture</div>
        </div>
      </div>

      {/* 1-to-Many Contracts List (§Part C §11.3) */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-glass">
        <div className="p-6 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              Governing Contracts & Service Agreements ({contracts.length})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Each purchase order is evaluated against the specific contract governing its product scope
            </p>
          </div>
        </div>

        {contracts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs font-mono">
            No contracts currently indexed for this client. Default pricing applies.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {contracts.map((c) => (
              <div key={c.id} className="p-6 hover:bg-white/[0.02] transition space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="font-mono font-bold text-sm text-white">
                      {c.contractNumber}
                    </span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      {c.status}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    Added: {formatDate(c.createdAt)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300">
                  <div>
                    <span className="text-slate-400">Type: </span>
                    <span className="font-mono font-medium text-slate-200">{c.contractType}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Effective Window: </span>
                    <span className="font-mono font-medium text-slate-200">
                      {formatDate(c.effectiveFrom)} – {formatDate(c.effectiveTo)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Total Contract Value: </span>
                    <span className="font-mono font-medium text-slate-200">
                      {c.totalValue ? formatCurrency(c.totalValue) : "Uncapped"}
                    </span>
                  </div>
                </div>

                {c.termsSummary && (
                  <div className="text-xs text-slate-300 bg-white/[0.03] p-3.5 rounded-xl border border-white/5">
                    <span className="font-semibold text-emerald-400">Terms Summary: </span>
                    <span>{c.termsSummary}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ingest Contract Modal */}
      {showAddContract && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-white/15 space-y-4">
            <h3 className="text-base font-bold text-white tracking-tight">
              Ingest & Index Contract for Agentic RAG
            </h3>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Contract Number *</label>
                <input
                  type="text"
                  value={contractNumber}
                  onChange={(e) => setContractNumber(e.target.value)}
                  placeholder="e.g. MSA-2026-ACME-01"
                  className="w-full p-2.5 bg-obsidian-card/70 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Agreement Type</label>
                <select
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                  className="w-full p-2.5 bg-obsidian-card border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="MASTER_SERVICES_AGREEMENT" className="bg-obsidian-card text-white">Master Services Agreement (MSA)</option>
                  <option value="STATEMENT_OF_WORK" className="bg-obsidian-card text-white">Statement of Work (SOW)</option>
                  <option value="ENTERPRISE_DISCOUNT_SCHEDULE" className="bg-obsidian-card text-white">Enterprise Discount Schedule</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Effective From</label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full p-2.5 bg-obsidian-card/70 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Effective To</label>
                  <input
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    className="w-full p-2.5 bg-obsidian-card/70 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Contract Clauses Content (Chunked & Vector Indexed)
                </label>
                <textarea
                  value={contractContent}
                  onChange={(e) => setContractContent(e.target.value)}
                  placeholder="Paste pricing tiers, discount schedules, or terms clauses..."
                  className="w-full p-2.5 bg-obsidian-card/70 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                  rows={4}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddContract(false)}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-slate-300 hover:bg-white/10 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => addContractMutation.mutate()}
                disabled={!contractNumber.trim() || addContractMutation.isPending}
                className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-obsidian-base rounded-xl text-xs font-bold shadow-neon-emerald transition-all duration-200 disabled:opacity-50"
              >
                {addContractMutation.isPending ? "Indexing..." : "Index Contract"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
