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
  ArrowUpRight,
  Receipt,
  Clock,
  Sparkles
} from "lucide-react";

export const POListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") || "1", 10);
  const statusFilter = searchParams.get("status") || "";
  const customerFilter = searchParams.get("customer") || "";
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");

  const { data, isLoading, error, refetch } = useQuery<PaginatedResponse<PurchaseOrder>>({
    queryKey: ["pos", { page, status: statusFilter, customer: customerFilter, search: searchParams.get("search") || "" }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "15");
      if (statusFilter) params.set("status", statusFilter);
      if (customerFilter) params.set("customer", customerFilter);
      if (searchParams.get("search")) params.set("search", searchParams.get("search")!);

      const res = await apiClient.get<PaginatedResponse<PurchaseOrder>>(`/pos?${params.toString()}`);
      return res.data;
    },
    staleTime: 0,
    refetchOnMount: "always"
  });

  const displayPOs = React.useMemo(() => {
    if (!data?.data) return [];
    return [...data.data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [data?.data]);

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

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
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
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-workspace-text tracking-tight">Purchase Orders</h1>
          <p className="text-xs text-workspace-muted mt-0.5">
            Directory of incoming purchase orders with autonomous validation and invoice generation status
          </p>
        </div>
        <Link
          to="/pos/upload"
          className="inline-flex items-center space-x-2 px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold rounded-lg shadow-subtle transition"
        >
          <UploadCloud className="w-4 h-4" />
          <span>Upload Purchase Order</span>
        </Link>
      </div>

      {/* Filter and Search Controls (§12) */}
      <div className="workspace-card p-3.5 flex flex-col md:flex-row items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <Search className="w-3.5 h-3.5 text-workspace-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search PO number, customer..."
            className="w-full pl-9 pr-3 py-1.5 bg-workspace-subtle border border-workspace-border rounded-lg text-xs text-workspace-text placeholder:text-workspace-muted focus:outline-none focus:border-accent-primary"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Status Filter */}
          <div className="flex items-center space-x-1 text-xs">
            <Filter className="w-3 h-3 text-workspace-muted" />
            <select
              value={statusFilter}
              onChange={(e) => updateParam("status", e.target.value)}
              className="px-2.5 py-1.5 bg-workspace-subtle border border-workspace-border rounded-lg text-xs text-workspace-text cursor-pointer focus:outline-none focus:border-accent-primary"
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

          {/* Customer Filter */}
          <select
            value={customerFilter}
            onChange={(e) => updateParam("customer", e.target.value)}
            className="px-2.5 py-1.5 bg-workspace-subtle border border-workspace-border rounded-lg text-xs text-workspace-text cursor-pointer focus:outline-none focus:border-accent-primary"
          >
            <option value="">All Customers</option>
            <option value="Acme">Acme Technologies</option>
            <option value="Stark">Stark Enterprises</option>
            <option value="Globex">Globex Corporation</option>
          </select>

          {(statusFilter || customerFilter || searchInput) && (
            <button
              onClick={() => {
                setSearchInput("");
                setSearchParams(new URLSearchParams());
              }}
              className="text-xs text-workspace-muted hover:text-workspace-text underline px-2"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Enterprise Data Table (§12) */}
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
          description="Upload your first PO and let FlowInvoice AI handle the extraction and validation."
          actionLabel="Upload Purchase Order"
          onAction={() => (window.location.href = "/pos/upload")}
        />
      ) : (
        <div className="workspace-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Customer</th>
                  <th>Upload Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>AI Confidence</th>
                  <th>Processing Time</th>
                  <th>Invoice</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayPOs.map((po) => (
                  <tr key={po.id}>
                    <td className="font-mono font-semibold text-accent-primary">
                      <Link to={`/pos/${po.id}`} className="hover:underline">
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="font-medium text-workspace-text">{po.customerName}</td>
                    <td className="text-workspace-muted font-mono text-[11px]">
                      {formatDate(po.createdAt)}
                    </td>
                    <td className="font-mono font-semibold text-workspace-text">
                      {formatCurrency(po.totalAmount, po.currency)}
                    </td>
                    <td>
                      <StatusBadge status={po.status} size="sm" />
                    </td>
                    <td className="font-mono text-xs">
                      {po.extractionConfidence ? (
                        <span
                          className={`inline-flex items-center space-x-1 ${
                            po.extractionConfidence > 0.9
                              ? "text-semantic-success font-semibold"
                              : "text-semantic-warning"
                          }`}
                        >
                          <span>{(po.extractionConfidence * 100).toFixed(0)}%</span>
                        </span>
                      ) : (
                        <span className="text-workspace-muted">—</span>
                      )}
                    </td>
                    <td className="text-workspace-muted font-mono text-[11px]">
                      4.2s
                    </td>
                    <td>
                      {po.status === "COMPLETED" ? (
                        <Link
                          to={`/invoices`}
                          className="inline-flex items-center space-x-1 text-accent-primary hover:underline font-mono text-[11px]"
                        >
                          <Receipt className="w-3 h-3" />
                          <span>Generated</span>
                        </Link>
                      ) : (
                        <span className="text-workspace-muted font-mono text-[11px]">Pending</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Link
                        to={`/pos/${po.id}`}
                        className="inline-flex items-center space-x-1 text-xs font-semibold text-accent-primary hover:text-accent-hover"
                      >
                        <span>Inspect</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="p-3.5 border-t border-workspace-border flex items-center justify-between text-xs text-workspace-muted bg-workspace-subtle">
            <div>
              Showing <span className="font-semibold text-workspace-text">{(page - 1) * 15 + 1}</span> to{" "}
              <span className="font-semibold text-workspace-text">
                {Math.min(page * 15, data.pagination.total)}
              </span>{" "}
              of <span className="font-semibold text-workspace-text">{data.pagination.total}</span> documents
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="p-1 rounded-md bg-white border border-workspace-border hover:bg-workspace-hover disabled:opacity-30 disabled:cursor-not-allowed shadow-subtle transition"
                title="Previous Page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono text-[11px] text-workspace-text">
                {page} / {data.pagination.totalPages || 1}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= data.pagination.totalPages}
                className="p-1 rounded-md bg-white border border-workspace-border hover:bg-workspace-hover disabled:opacity-30 disabled:cursor-not-allowed shadow-subtle transition"
                title="Next Page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
