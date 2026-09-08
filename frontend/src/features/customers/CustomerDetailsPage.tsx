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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate("/customers")}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{customer.name}</h1>
            <p className="text-xs text-slate-500 mt-1">
              Account Code: <span className="font-mono font-bold text-slate-700">{customer.code}</span> •
              Billing Email: {customer.email}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddContract(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          <span>Ingest New Contract</span>
        </button>
      </div>

      {/* Customer Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-semibold text-emerald-800">GSTIN / Tax ID</span>
          </div>
          <div className="text-sm font-mono font-bold text-slate-900">
            {customer.gstNumber || "Not Provided"}
          </div>
          <div className="text-xs text-slate-400">Validated for invoicing</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <Calendar className="w-3.5 h-3.5" />
            <span>Default Payment Terms</span>
          </div>
          <div className="text-sm font-bold text-slate-900">{customer.paymentTerms}</div>
          <div className="text-xs text-slate-400">Currency: {customer.currency}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <FileText className="w-3.5 h-3.5 text-purple-600" />
            <span>Active Contracts Count</span>
          </div>
          <div className="text-sm font-bold text-purple-700">{contracts.length} Agreement(s)</div>
          <div className="text-xs text-slate-400">1-to-Many Multi-Contract Architecture</div>
        </div>
      </div>

      {/* 1-to-Many Contracts List (§Part C §11.3) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Governing Contracts & Service Agreements ({contracts.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Each purchase order is evaluated against the specific contract governing its product scope
            </p>
          </div>
        </div>

        {contracts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            No contracts currently indexed for this client. Default pricing applies.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {contracts.map((c) => (
              <div key={c.id} className="p-6 hover:bg-slate-50/50 transition space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="font-mono font-bold text-sm text-slate-900">
                      {c.contractNumber}
                    </span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {c.status}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    Added: {formatDate(c.createdAt)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400">Type: </span>
                    <span className="font-medium text-slate-800">{c.contractType}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Effective Window: </span>
                    <span className="font-medium text-slate-800">
                      {formatDate(c.effectiveFrom)} – {formatDate(c.effectiveTo)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Total Contract Value: </span>
                    <span className="font-medium text-slate-800">
                      {c.totalValue ? formatCurrency(c.totalValue) : "Uncapped"}
                    </span>
                  </div>
                </div>

                {c.termsSummary && (
                  <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="font-semibold text-slate-700">Terms Summary: </span>
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
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Ingest & Index Contract for Agentic RAG
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Contract Number *</label>
                <input
                  type="text"
                  value={contractNumber}
                  onChange={(e) => setContractNumber(e.target.value)}
                  placeholder="e.g. MSA-2026-ACME-01"
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Agreement Type</label>
                <select
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="MASTER_SERVICES_AGREEMENT">Master Services Agreement (MSA)</option>
                  <option value="STATEMENT_OF_WORK">Statement of Work (SOW)</option>
                  <option value="ENTERPRISE_DISCOUNT_SCHEDULE">Enterprise Discount Schedule</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Effective From</label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Effective To</label>
                  <input
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Contract Clauses Content (Chunked & Vector Indexed)
                </label>
                <textarea
                  value={contractContent}
                  onChange={(e) => setContractContent(e.target.value)}
                  placeholder="Paste pricing tiers, discount schedules, or terms clauses..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm"
                  rows={4}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddContract(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => addContractMutation.mutate()}
                disabled={!contractNumber.trim() || addContractMutation.isPending}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
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
