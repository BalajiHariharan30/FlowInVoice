import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { Invoice, PaginatedResponse } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import { Search, Receipt, ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";

export const InvoiceListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") || "1", 10);
  const statusFilter = searchParams.get("status") || "";
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");

  const { data, isLoading, error, refetch } = useQuery<PaginatedResponse<Invoice>>({
    queryKey: ["invoices", { page, status: statusFilter, search: searchParams.get("search") || "" }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "15");
      if (statusFilter) params.set("status", statusFilter);
      if (searchParams.get("search")) params.set("search", searchParams.get("search")!);

      const res = await apiClient.get<PaginatedResponse<Invoice>>(`/invoices?${params.toString()}`);
      return res.data;
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (searchInput.trim()) next.set("search", searchInput.trim());
    else next.delete("search");
    next.set("page", "1");
    setSearchParams(next);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Verified Invoices</h1>
        <p className="text-xs text-slate-400 mt-1">
          Review autonomously generated invoices, verification statuses, and download signed PDFs
        </p>
      </div>

      {/* Search Bar */}
      <div className="glass-panel p-4 rounded-2xl flex items-center justify-between">
        <form onSubmit={handleSearch} className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by invoice#, PO# or customer..."
            className="w-full pl-10 pr-4 py-2 glass-input text-xs"
          />
        </form>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingSkeleton rows={8} />
      ) : error ? (
        <ErrorBanner
          message={(error as any)?.message || "Failed to load invoices"}
          code={(error as any)?.code}
          requestId={(error as any)?.requestId}
          onRetry={() => refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title="No invoices generated yet"
          description="Invoices will appear here once purchase orders pass commercial RAG validation."
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.02] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6">Invoice #</th>
                  <th className="py-3.5 px-6">PO Reference</th>
                  <th className="py-3.5 px-6">Customer</th>
                  <th className="py-3.5 px-6">GSTIN</th>
                  <th className="py-3.5 px-6">Total Amount</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6">Issue Date</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {data.data.map((inv) => (
                  <tr key={inv.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-4 px-6 font-mono font-bold text-white">
                      <Link to={`/invoices/${inv.id}`} className="hover:text-emerald-400 transition">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="py-4 px-6 font-mono text-[11px] text-slate-400">
                      <Link to={`/pos/${inv.poId}`} className="hover:underline hover:text-slate-200">
                        {inv.poNumber}
                      </Link>
                    </td>
                    <td className="py-4 px-6 text-slate-200 font-medium">{inv.customerName}</td>
                    <td className="py-4 px-6 font-mono text-[11px] text-slate-400">
                      {inv.gstNumber}
                    </td>
                    <td className="py-4 px-6 font-mono font-bold text-white">
                      {formatCurrency(inv.totalAmount, inv.currency)}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={inv.status} size="sm" />
                    </td>
                    <td className="py-4 px-6 text-slate-400">
                      {formatDate(inv.issueDate)}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <Link
                        to={`/invoices/${inv.id}`}
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

          {/* Pagination */}
          <div className="p-4 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400 bg-obsidian-950/40">
            <div>
              Showing Page <span className="font-semibold text-slate-200">{page}</span> of{" "}
              <span className="font-semibold text-slate-200">{data.pagination.totalPages || 1}</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set("page", String(page - 1));
                  setSearchParams(next);
                }}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-white/10 hover:bg-white/[0.05] disabled:opacity-30 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set("page", String(page + 1));
                  setSearchParams(next);
                }}
                disabled={page >= data.pagination.totalPages}
                className="p-1.5 rounded-lg border border-white/10 hover:bg-white/[0.05] disabled:opacity-30 transition"
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
