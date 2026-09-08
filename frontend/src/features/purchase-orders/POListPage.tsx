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
  ArrowUpDown
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
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-slate-500 mt-1">
            Browse, track, and inspect customer purchase orders and their AI validation pipeline
          </p>
        </div>
        <Link
          to="/pos/upload"
          className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition"
        >
          <UploadCloud className="w-4 h-4" />
          <span>Upload PO</span>
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by PO# or customer..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </form>

        <div className="flex items-center space-x-3 w-full md:w-auto">
          <div className="flex items-center space-x-2 text-sm text-slate-600">
            <Filter className="w-4 h-4 text-slate-400" />
            <span>Status:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-emerald-500"
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

      {/* Content */}
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3.5 px-6">PO Number</th>
                  <th className="py-3.5 px-6">Customer</th>
                  <th className="py-3.5 px-6">GSTIN / Tax ID</th>
                  <th className="py-3.5 px-6">Amount</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6">Confidence</th>
                  <th className="py-3.5 px-6">Received</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-4 px-6 font-semibold text-slate-900 font-mono">
                      <Link to={`/pos/${po.id}`} className="hover:text-emerald-600">
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="py-4 px-6 text-slate-800">{po.customerName}</td>
                    <td className="py-4 px-6 font-mono text-xs text-slate-600">
                      {po.gstNumber || "—"}
                    </td>
                    <td className="py-4 px-6 font-medium text-slate-900">
                      {formatCurrency(po.totalAmount, po.currency)}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={po.status} />
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      {po.extractionConfidence ? `${(po.extractionConfidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-500">
                      {formatDate(po.createdAt)}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <Link
                        to={`/pos/${po.id}`}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
                      >
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-800">{(page - 1) * 15 + 1}</span> to{" "}
              <span className="font-semibold text-slate-800">
                {Math.min(page * 15, data.pagination.total)}
              </span>{" "}
              of <span className="font-semibold text-slate-800">{data.pagination.total}</span> POs
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-medium text-slate-700">
                Page {page} of {data.pagination.totalPages || 1}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= data.pagination.totalPages}
                className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
