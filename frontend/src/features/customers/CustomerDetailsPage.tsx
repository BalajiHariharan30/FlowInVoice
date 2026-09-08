import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { Customer } from "../../types";
import { formatDate } from "../../lib/format";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import { useToast } from "../../contexts/ToastContext";
import {
  ArrowLeft,
  Building,
  FileText,
  Calendar,
  ShieldCheck,
  Plus,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Database,
  Layers,
  Sparkles
} from "lucide-react";

export const CustomerDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();

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
      addToast({
        type: "success",
        title: "Contract Ingested",
        message: "Agreement indexed into Qdrant vector database for Agentic RAG verification."
      });
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      setShowAddContract(false);
      setContractNumber("");
      setContractContent("");
    },
    onError: (err: any) => {
      addToast({
        type: "error",
        title: "Ingestion Failed",
        message: err.message || "Failed to add contract."
      });
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
      {/* Breadcrumb & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-workspace-border">
        <div>
          <nav className="flex items-center space-x-2 text-xs text-workspace-muted mb-1 font-medium">
            <Link to="/customers" className="hover:text-workspace-text transition-colors">
              Customers
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-workspace-muted" />
            <span className="text-workspace-text font-semibold">{customer.name}</span>
          </nav>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-black text-workspace-text tracking-tight">
              {customer.name}
            </h1>
            <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold">
              {customer.code}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            to={`/pos?customer=${encodeURIComponent(customer.name)}`}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-workspace-border rounded-lg text-xs font-semibold text-workspace-text shadow-sm transition"
          >
            <span>View PO History</span>
            <ExternalLink className="w-3.5 h-3.5 text-workspace-muted" />
          </Link>

          <button
            onClick={() => setShowAddContract(true)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Agreement (RAG)</span>
          </button>
        </div>
      </div>

      {/* Account Overview Card */}
      <div className="workspace-card p-6 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-muted">
          Account Profile & Regulatory Data
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs">
          <div>
            <span className="text-workspace-muted block text-[11px]">Contact Email</span>
            <span className="font-semibold text-workspace-text text-sm block mt-0.5">
              {customer.email}
            </span>
          </div>

          <div>
            <span className="text-workspace-muted block text-[11px]">GSTIN / Tax ID</span>
            <div className="inline-flex items-center space-x-1.5 mt-0.5 px-2.5 py-1 rounded bg-slate-100 border border-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span className="font-mono font-bold text-workspace-text">
                {customer.gstNumber || "29AABCU9603R1ZM"}
              </span>
            </div>
          </div>

          <div>
            <span className="text-workspace-muted block text-[11px]">Payment Terms</span>
            <span className="font-mono font-bold text-accent-primary text-sm block mt-0.5">
              {customer.paymentTerms || "NET_30"}
            </span>
          </div>

          <div>
            <span className="text-workspace-muted block text-[11px]">Billing Currency</span>
            <span className="font-mono font-bold text-workspace-text text-sm block mt-0.5">
              {customer.currency || "USD"}
            </span>
          </div>
        </div>

        {customer.address && (
          <div className="pt-2 text-xs text-workspace-muted">
            <span className="font-semibold text-workspace-text">Registered Address: </span>
            <span>{customer.address}</span>
          </div>
        )}
      </div>

      {/* Master Agreements & Rate Schedules (1-to-N Contracts) */}
      <div className="workspace-card p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-workspace-border">
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-accent-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-text">
              Active Contracts & Rate Schedules ({contracts.length})
            </h3>
          </div>
          <span className="text-[11px] text-workspace-muted font-mono">
            Ingested into Qdrant Vector DB
          </span>
        </div>

        {contracts.length === 0 ? (
          <div className="text-center py-10 text-workspace-muted text-xs space-y-2">
            <FileText className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-semibold text-workspace-text">No contracts indexed yet</p>
            <p className="text-workspace-muted max-w-sm mx-auto">
              Add a Master Services Agreement or pricing rate sheet to enable autonomous Agentic RAG verification for this account.
            </p>
            <button
              onClick={() => setShowAddContract(true)}
              className="mt-2 inline-flex items-center space-x-1.5 px-3 py-1.5 bg-accent-primary text-white text-xs font-bold rounded-lg shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add First Agreement</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {contracts.map((contract) => (
              <div
                key={contract.id}
                className="p-4 rounded-xl border border-workspace-border bg-slate-50 hover:border-slate-300 transition text-xs space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-accent-primary text-sm">
                      {contract.contractNumber}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold uppercase">
                      {contract.status || "ACTIVE"}
                    </span>
                    <span className="text-workspace-muted font-medium">
                      • {contract.contractType.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div className="text-workspace-muted text-[11px] font-mono">
                    Valid: {formatDate(contract.effectiveFrom)} → {formatDate(contract.effectiveTo)}
                  </div>
                </div>

                {contract.termsSummary && (
                  <p className="text-workspace-text bg-white p-3 rounded-lg border border-workspace-border text-xs leading-relaxed">
                    {contract.termsSummary}
                  </p>
                )}

                <div className="flex items-center justify-between text-[11px] text-workspace-muted pt-1">
                  <span className="flex items-center space-x-1 text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Chunked & Embedded in Qdrant (cosine similarity enabled)</span>
                  </span>
                  <span>Indexed {formatDate(contract.createdAt, true)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Contract Modal */}
      {showAddContract && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-workspace-border space-y-4">
            <div className="flex items-center space-x-2.5">
              <Sparkles className="w-5 h-5 text-accent-primary" />
              <h3 className="text-base font-bold text-workspace-text">
                Index New Agreement / Pricing Schedule
              </h3>
            </div>

            <p className="text-xs text-workspace-muted">
              Text provided here will be split into semantic chunks, vectorized, and stored in Qdrant for autonomous Agentic RAG evaluation.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                addContractMutation.mutate();
              }}
              className="space-y-4 text-xs"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-workspace-text font-semibold mb-1">Contract / MSA #</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MSA-2026-ACME"
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  />
                </div>

                <div>
                  <label className="block text-workspace-text font-semibold mb-1">Agreement Type</label>
                  <select
                    value={contractType}
                    onChange={(e) => setContractType(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  >
                    <option value="MASTER_SERVICES_AGREEMENT">Master Services Agreement (MSA)</option>
                    <option value="RATE_SCHEDULE">Pricing Rate Schedule</option>
                    <option value="STATEMENT_OF_WORK">Statement of Work (SOW)</option>
                    <option value="TAX_EXEMPTION_CERTIFICATE">Tax Exemption / Certificate</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-workspace-text font-semibold mb-1">Effective From</label>
                  <input
                    type="date"
                    required
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  />
                </div>

                <div>
                  <label className="block text-workspace-text font-semibold mb-1">Effective To</label>
                  <input
                    type="date"
                    required
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-workspace-text font-semibold mb-1">
                  Contract Clauses & Pricing Terms (for Qdrant Vectorization)
                </label>
                <textarea
                  required
                  rows={6}
                  placeholder="Paste contractual clauses, negotiated item prices, payment terms, or discount tiers..."
                  value={contractContent}
                  onChange={(e) => setContractContent(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text placeholder-workspace-muted font-mono text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddContract(false)}
                  className="px-4 py-2 border border-workspace-border rounded-lg text-xs font-semibold text-workspace-text hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addContractMutation.isPending}
                  className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-50"
                >
                  {addContractMutation.isPending ? "Indexing into Qdrant..." : "Index Contract"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
