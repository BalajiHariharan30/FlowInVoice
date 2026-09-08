import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { Customer, PaginatedResponse } from "../../types";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import { Building2, Search, FileText, ChevronLeft, ChevronRight } from "lucide-react";

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
          <Building2 className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          <span>Customers & Contracts</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Directory of client accounts and their governing Master Services & Pricing Agreements (1-to-N)
        </p>
      </div>

      {/* Search Bar */}
      <div className="glass-card p-4 rounded-2xl flex items-center justify-between shadow-glass">
        <form onSubmit={handleSearch} className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers by name, code or email..."
            className="w-full pl-10 pr-4 py-2 bg-obsidian-card/60 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition backdrop-blur-md"
          />
        </form>
      </div>

      {/* Content */}
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
          description="Customers are registered during onboarding or auto-provisioned upon verified PO receipt."
        />
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden shadow-glass">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-white/[0.02] border-b border-white/10 text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6">Customer Name</th>
                  <th className="py-3.5 px-6">Account Code</th>
                  <th className="py-3.5 px-6">Billing Email</th>
                  <th className="py-3.5 px-6">GSTIN / Tax ID</th>
                  <th className="py-3.5 px-6">Payment Terms</th>
                  <th className="py-3.5 px-6">Active Contracts</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {data.data.map((cust) => (
                  <tr key={cust.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 px-6 font-bold text-white">
                      <Link to={`/customers/${cust.id}`} className="hover:text-emerald-400 transition-colors">
                        {cust.name}
                      </Link>
                    </td>
                    <td className="py-4 px-6">
                      <span className="font-mono text-xs text-slate-300 bg-white/[0.04] px-2 py-0.5 rounded border border-white/5">
                        {cust.code}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-slate-400 font-mono text-xs">{cust.email}</td>
                    <td className="py-4 px-6 font-mono text-xs text-emerald-400/90">
                      {cust.gstNumber || "—"}
                    </td>
                    <td className="py-4 px-6 text-slate-300 text-xs font-mono">{cust.paymentTerms}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/20">
                        <FileText className="w-3 h-3 text-purple-400" />
                        <span>{cust.contractCount ?? 1} Agreement(s)</span>
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <Link
                        to={`/customers/${cust.id}`}
                        className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors inline-flex items-center gap-1 hover:underline"
                      >
                        Inspect Contracts →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 font-mono">
            <div>
              Page {page} of {data.pagination.totalPages || 1}
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set("page", String(page - 1));
                  setSearchParams(next);
                }}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 disabled:opacity-30 transition"
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
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 disabled:opacity-30 transition"
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
