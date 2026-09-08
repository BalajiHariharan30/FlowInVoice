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
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Customers & Contracts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Directory of client accounts and their governing Master Services & Pricing Agreements (1-to-N)
        </p>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <form onSubmit={handleSearch} className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers by name, code or email..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                  <th className="py-3.5 px-6">Customer Name</th>
                  <th className="py-3.5 px-6">Account Code</th>
                  <th className="py-3.5 px-6">Billing Email</th>
                  <th className="py-3.5 px-6">GSTIN / Tax ID</th>
                  <th className="py-3.5 px-6">Payment Terms</th>
                  <th className="py-3.5 px-6">Active Contracts</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50 transition">
                    <td className="py-4 px-6 font-bold text-slate-900">
                      <Link to={`/customers/${cust.id}`} className="hover:text-emerald-600">
                        {cust.name}
                      </Link>
                    </td>
                    <td className="py-4 px-6 font-mono text-xs text-slate-600">{cust.code}</td>
                    <td className="py-4 px-6 text-slate-600">{cust.email}</td>
                    <td className="py-4 px-6 font-mono text-xs text-slate-600">
                      {cust.gstNumber || "—"}
                    </td>
                    <td className="py-4 px-6 text-slate-600">{cust.paymentTerms}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        <FileText className="w-3 h-3" />
                        <span>{cust.contractCount ?? 1} Agreement(s)</span>
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <Link
                        to={`/customers/${cust.id}`}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
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
          <div className="p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
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
                className="p-1.5 rounded border border-slate-200 disabled:opacity-40"
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
                className="p-1.5 rounded border border-slate-200 disabled:opacity-40"
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
