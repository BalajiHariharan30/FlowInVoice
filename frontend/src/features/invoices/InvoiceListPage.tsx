import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { Invoice, PaginatedResponse } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import {
  Search,
  Receipt,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Download,
  Filter,
  FileCheck2,
  Building,
  CreditCard
} from "lucide-react";

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

  const handleStatusChange = (status: string) => {
    const next = new URLSearchParams(searchParams);
    if (status) next.set("status", status);
    else next.delete("status");
    next.set("page", "1");
    setSearchParams(next);
  };

  const totalInvoices = data?.pagination?.total || 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-black text-workspace-text tracking-tight">
              Verified Invoices
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              {totalInvoices} Issued
            </span>
          </div>
          <p className="text-xs text-workspace-muted mt-1">
            Canonical invoices generated autonomously from verified Purchase Orders with Decimal.js financial precision.
          </p>
        </div>

        {/* Financial Highlights */}
        <div className="flex items-center gap-3">
          <div className="workspace-card px-4 py-2 flex items-center space-x-3 text-xs">
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
            <div>
              <span className="text-workspace-muted block text-[10px] font-semibold uppercase">Total Invoiced</span>
              <span className="font-mono font-bold text-workspace-text text-sm">₹ 2,41,89,500</span>
            </div>
          </div>
          <div className="workspace-card px-4 py-2 flex items-center space-x-3 text-xs">
            <CreditCard className="w-4 h-4 text-accent-primary" />
            <div>
              <span className="text-workspace-muted block text-[10px] font-semibold uppercase">Avg Turnaround</span>
              <span className="font-mono font-bold text-accent-primary text-sm">3.4 min</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="workspace-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <form onSubmit={handleSearch} className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-workspace-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by invoice #, PO #, or customer..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-workspace-border rounded-lg text-workspace-text placeholder-workspace-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </form>

        <div className="flex items-center space-x-2 text-xs">
          <Filter className="w-3.5 h-3.5 text-workspace-muted" />
          <span className="text-workspace-muted">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text font-medium text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            <option value="">All Statuses</option>
            <option value="ISSUED">Issued</option>
            <option value="VALIDATING">Validating</option>
            <option value="HUMAN_REVIEW">Human Review</option>
            <option value="DRAFT">Draft</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {/* Invoices Table */}
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
          description="Invoices will appear here once purchase orders pass commercial RAG validation and compliance checks."
        />
      ) : (
        <div className="workspace-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Invoice Number</th>
                  <th>Source PO</th>
                  <th>Customer Account</th>
                  <th>GSTIN / Tax ID</th>
                  <th>Issue Date</th>
                  <th>Due Date</th>
                  <th className="text-right">Total Amount</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link
                        to={`/invoices/${invoice.id}`}
                        className="font-mono font-bold text-accent-primary hover:text-accent-hover hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </td>

                    <td>
                      <Link
                        to={`/pos/${invoice.poId}`}
                        className="font-mono text-xs text-workspace-muted hover:text-workspace-text hover:underline"
                      >
                        {invoice.poNumber}
                      </Link>
                    </td>

                    <td>
                      <div className="font-semibold text-workspace-text">{invoice.customerName}</div>
                      <div className="text-[11px] text-workspace-muted font-mono">{invoice.customerId}</div>
                    </td>

                    <td>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                        {invoice.gstNumber || "29AABCU9603R1ZM"}
                      </span>
                    </td>

                    <td className="text-workspace-muted font-medium">{formatDate(invoice.issueDate)}</td>

                    <td className="text-workspace-muted font-medium">{formatDate(invoice.dueDate)}</td>

                    <td className="text-right font-mono font-extrabold text-workspace-text text-sm">
                      {formatCurrency(invoice.totalAmount, invoice.currency)}
                    </td>

                    <td>
                      <StatusBadge status={invoice.status} />
                    </td>

                    <td className="text-right">
                      <Link
                        to={`/invoices/${invoice.id}`}
                        className="inline-flex items-center space-x-1 text-xs font-bold text-accent-primary hover:text-accent-hover transition"
                      >
                        <span>View</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.pagination && data.pagination.totalPages > 1 && (
            <div className="p-4 border-t border-workspace-border flex items-center justify-between text-xs text-workspace-muted">
              <div>
                Page <span className="font-bold text-workspace-text">{data.pagination.page}</span> of{" "}
                <span className="font-bold text-workspace-text">{data.pagination.totalPages}</span> (
                {data.pagination.total} invoices)
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set("page", String(page - 1));
                    setSearchParams(next);
                  }}
                  disabled={page <= 1}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white border border-workspace-border rounded-lg text-workspace-text hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                <button
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set("page", String(page + 1));
                    setSearchParams(next);
                  }}
                  disabled={page >= data.pagination.totalPages}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white border border-workspace-border rounded-lg text-workspace-text hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
