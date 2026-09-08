import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { PurchaseOrder, PaginatedResponse, POStatus } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import {
  Search,
  UploadCloud,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowUpRight
} from "lucide-react";

export const POListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") || "1", 10);
  const statusFilter = searchParams.get("status") || "";
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");

  const { data, isLoading, error, refetch } = useQuery<PaginatedResponse<PurchaseOrder>>({
    queryKey: ["pos", { page, status: statusFilter, search: searchParams.get("search") || "" }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "15");
      if (statusFilter) params.set("status", statusFilter);
      if (searchParams.get("search")) params.set("search", searchParams.get("search")!);

      const res = await apiClient.get<PaginatedResponse<PurchaseOrder>>(`/pos?${params.toString()}`);
      return res.data;
    }
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (searchInput.trim()) {
      next.set("search", searchInput.trim());
    } else {
      next.delete("search");
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleStatusChange = (status: string) => {
    const next = new URLSearchParams(searchParams);
    if (status) {
      next.set("status", status);
    } else {
      next.delete("status");
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const handlePageChange = (newPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(newPage));
    setSearchParams(next);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Purchase Orders</h1>
          <p className="text-xs text-slate-400 mt-1">
            Browse, monitor, and trace autonomous ingestion across the 13-stage workflow
          </p>
        </div>
        <Link
          to="/pos/upload"
          className="inline-flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-obsidian-950 text-xs font-bold rounded-xl shadow-neon-emerald transition-all duration-200"
        >
          <UploadCloud className="w-4 h-4" />
          <span>Upload PO</span>
        </Link>
      </div>

      {/* Glass Filter and Search Bar */}
      <div className="glass-panel p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by PO# or customer..."
            className="w-full pl-10 pr-4 py-2 glass-input text-xs"
          />
        </form>

        <div className="flex items-center space-x-3 w-full md:w-auto">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Pipeline Stage:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="px-3 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="">All Statuses</option>
            <option value="PROCESSING">Processing</option>
            <option value="EXTRACTED">Extracted</option>
            <option value="VALIDATING">Validating</option>
            <option value="RAG_CHECKING">RAG Checking</option>
            <option value="COMPLIANCE_CHECKING">Compliance Checking</option>
            <option value="HUMAN_REVIEW">Human Review</option>
            <option value="APPROVED">Approved</option>
            <option value="INVOICE_GENERATING">Invoice Generating</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {/* Glass Table */}
      {isLoading ? (
        <LoadingSkeleton rows={8} />
      ) : error ? (
        <ErrorBanner
          message={(error as any)?.message || "Failed to load purchase orders"}
          code={(error as any)?.code}
          requestId={(error as any)?.requestId}
          onRetry={() => refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title="No purchase orders found"
          description="Try adjusting your filters or upload a new purchase order document."
          actionLabel="Upload First PO"
          onAction={() => (window.location.href = "/pos/upload")}
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.02] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6">PO Number</th>
                  <th className="py-3.5 px-6">Customer</th>
                  <th className="py-3.5 px-6">GSTIN / Tax ID</th>
                  <th className="py-3.5 px-6">Amount</th>
                  <th className="py-3.5 px-6">Pipeline Status</th>
                  <th className="py-3.5 px-6">Confidence</th>
                  <th className="py-3.5 px-6">Received</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {data.data.map((po) => (
                  <tr
                    key={po.id}
                    className="hover:bg-white/[0.03] transition-colors duration-150"
                  >
                    <td className="py-4 px-6 font-semibold text-white font-mono">
                      <Link to={`/pos/${po.id}`} className="hover:text-emerald-400 transition">
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="py-4 px-6 text-slate-200 font-medium">{po.customerName}</td>
                    <td className="py-4 px-6 font-mono text-[11px] text-slate-400">
                      {po.gstNumber || "—"}
                    </td>
                    <td className="py-4 px-6 font-mono font-bold text-slate-100">
                      {formatCurrency(po.totalAmount, po.currency)}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={po.status} size="sm" />
                    </td>
                    <td className="py-4 px-6 font-mono text-[11px] text-slate-400">
                      {po.extractionConfidence ? `${(po.extractionConfidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-4 px-6 text-slate-400">
                      {formatDate(po.createdAt)}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <Link
                        to={`/pos/${po.id}`}
                        className="inline-flex items-center space-x-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition"
                      >
                        <span>Inspect</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="p-4 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400 bg-obsidian-950/40">
            <div>
              Showing <span className="font-semibold text-slate-200">{(page - 1) * 15 + 1}</span> to{" "}
              <span className="font-semibold text-slate-200">
                {Math.min(page * 15, data.pagination.total)}
              </span>{" "}
              of <span className="font-semibold text-slate-200">{data.pagination.total}</span> documents
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-white/10 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-medium text-slate-300">
                {page} / {data.pagination.totalPages || 1}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= data.pagination.totalPages}
                className="p-1.5 rounded-lg border border-white/10 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
