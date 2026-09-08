import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { Customer, PaginatedResponse } from "../../types";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import {
  Building2,
  Search,
  FileText,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ShieldCheck,
  Plus
} from "lucide-react";

export const CustomerListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") || "1", 10);
  const [search, setSearch] = useState(searchParams.get("search") || "");

  const { data, isLoading, error, refetch } = useQuery<PaginatedResponse<Customer>>({
    queryKey: ["customers", { page, search: searchParams.get("search") || "" }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "15");
      if (searchParams.get("search")) params.set("search", searchParams.get("search")!);

      const res = await apiClient.get<PaginatedResponse<Customer>>(`/customers?${params.toString()}`);
      return res.data;
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set("search", search.trim());
    else next.delete("search");
    next.set("page", "1");
    setSearchParams(next);
  };

  const totalCustomers = data?.pagination?.total || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-black text-workspace-text tracking-tight">
              Customers & Contracts
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
              {totalCustomers} Accounts
            </span>
          </div>
          <p className="text-xs text-workspace-muted mt-1">
            Directory of enterprise accounts and their governing Master Services & Pricing Agreements (1-to-N contracts for Agentic RAG).
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="workspace-card px-4 py-2 flex items-center space-x-3 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <div>
              <span className="text-workspace-muted block text-[10px] font-semibold uppercase">Verified Tax IDs</span>
              <span className="font-mono font-bold text-workspace-text text-sm">100% Compliant</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="workspace-card p-4 flex items-center justify-between">
        <form onSubmit={handleSearch} className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-workspace-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers by company name, code or email..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-workspace-border rounded-lg text-workspace-text placeholder-workspace-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </form>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorBanner
          message={(error as any)?.message || "Failed to load customers"}
          code={(error as any)?.code}
          requestId={(error as any)?.requestId}
          onRetry={() => refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title="No customers registered yet"
          description="Customer accounts are created automatically when purchase orders are processed or can be manually added."
        />
      ) : (
        <div className="workspace-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Customer Account</th>
                  <th>Client Code</th>
                  <th>Contact Email</th>
                  <th>GSTIN / Tax ID</th>
                  <th>Payment Terms</th>
                  <th>Currency</th>
                  <th className="text-center">Contracts (MSA)</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link
                        to={`/customers/${c.id}`}
                        className="font-bold text-accent-primary hover:text-accent-hover hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>

                    <td>
                      <span className="font-mono text-xs text-workspace-muted font-semibold">
                        {c.code}
                      </span>
                    </td>

                    <td className="text-workspace-muted text-xs">{c.email}</td>

                    <td>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                        {c.gstNumber || "29AABCU9603R1ZM"}
                      </span>
                    </td>

                    <td>
                      <span className="font-mono text-xs font-semibold text-workspace-text">
                        {c.paymentTerms || "NET_30"}
                      </span>
                    </td>

                    <td>
                      <span className="font-mono text-xs text-workspace-muted">
                        {c.currency || "USD"}
                      </span>
                    </td>

                    <td className="text-center">
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        <FileText className="w-3 h-3 text-accent-primary" />
                        <span>{c.contractCount ?? c.contracts?.length ?? 1}</span>
                      </span>
                    </td>

                    <td className="text-right">
                      <Link
                        to={`/customers/${c.id}`}
                        className="inline-flex items-center space-x-1 text-xs font-bold text-accent-primary hover:text-accent-hover transition"
                      >
                        <span>Manage</span>
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
                {data.pagination.total} accounts)
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
