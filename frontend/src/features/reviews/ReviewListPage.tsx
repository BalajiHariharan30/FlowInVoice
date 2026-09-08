import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { HumanReview, PaginatedResponse, ReviewStage } from "../../types";
import { formatDate } from "../../lib/format";
import { StageBadge } from "../../components/ui/StageBadge";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  FileCheck2,
  Clock,
  Filter,
  Layers,
  Search
} from "lucide-react";

export const ReviewListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") || "1", 10);
  const stageFilter = (searchParams.get("stage") as ReviewStage) || "";
  const statusFilter = searchParams.get("status") || "PENDING";
  const searchQuery = searchParams.get("search") || "";

  const { data, isLoading, error, refetch } = useQuery<PaginatedResponse<HumanReview>>({
    queryKey: ["reviews", { page, stage: stageFilter, status: statusFilter, search: searchQuery }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "15");
      if (stageFilter) params.set("stage", stageFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (searchQuery) params.set("search", searchQuery);

      const res = await apiClient.get<PaginatedResponse<HumanReview>>(`/reviews?${params.toString()}`);
      return res.data;
    }
  });

  const handleStageTab = (stage: string) => {
    const next = new URLSearchParams(searchParams);
    if (stage) {
      next.set("stage", stage);
    } else {
      next.delete("stage");
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleStatusFilter = (status: string) => {
    const next = new URLSearchParams(searchParams);
    if (status) {
      next.set("status", status);
    } else {
      next.delete("status");
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const input = (form.elements.namedItem("search") as HTMLInputElement).value;
    const next = new URLSearchParams(searchParams);
    if (input.trim()) {
      next.set("search", input.trim());
    } else {
      next.delete("search");
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const stages: Array<{ key: string; label: string; desc: string }> = [
    { key: "", label: "All Stages", desc: "All workflow checkpoints" },
    { key: "extraction", label: "Extraction Exceptions", desc: "OCR & field confidence" },
    { key: "validation", label: "Validation & RAG Deviations", desc: "Contract & pricing mismatch" },
    { key: "invoice", label: "Invoice Discrepancies", desc: "Tax & line calculation" }
  ];

  const totalReviews = data?.pagination?.total || 0;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-black text-workspace-text tracking-tight">
              Human Review Center
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
              {totalReviews} Exceptions
            </span>
          </div>
          <p className="text-xs text-workspace-muted mt-1">
            Evaluate autonomous AI agent exceptions, inspect RAG vector evidence citations, and decide operational outcomes.
          </p>
        </div>

        {/* Queue Metrics Summary Chips */}
        <div className="flex items-center gap-3">
          <div className="workspace-card px-4 py-2 flex items-center space-x-3 text-xs">
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
            <div>
              <span className="text-workspace-muted block text-[10px] font-semibold uppercase">Pending</span>
              <span className="font-bold text-workspace-text text-sm">18</span>
            </div>
          </div>

          <div className="workspace-card px-4 py-2 flex items-center space-x-3 text-xs">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <div>
              <span className="text-workspace-muted block text-[10px] font-semibold uppercase">Critical / High</span>
              <span className="font-bold text-red-600 text-sm">4</span>
            </div>
          </div>

          <div className="workspace-card px-4 py-2 flex items-center space-x-3 text-xs">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <div>
              <span className="text-workspace-muted block text-[10px] font-semibold uppercase">Resolved Today</span>
              <span className="font-bold text-emerald-600 text-sm">31</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Tab Navigation Bar */}
      <div className="workspace-card p-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Stage Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto">
          {stages.map((st) => {
            const isActive = stageFilter === st.key;
            return (
              <button
                key={st.key}
                onClick={() => handleStageTab(st.key)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-accent-primary text-white shadow-sm"
                    : "text-workspace-muted hover:text-workspace-text hover:bg-slate-100"
                }`}
              >
                {st.label}
              </button>
            );
          })}
        </div>

        {/* Status Dropdown & Search */}
        <div className="flex items-center gap-3">
          <form onSubmit={handleSearch} className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-workspace-muted" />
            <input
              name="search"
              defaultValue={searchQuery}
              placeholder="Search PO / Reason..."
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-workspace-border rounded-lg text-workspace-text placeholder-workspace-muted focus:outline-none focus:ring-1 focus:ring-accent-primary w-48 sm:w-56"
            />
          </form>

          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text font-medium text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            <option value="PENDING">Pending Review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All Statuses</option>
          </select>
        </div>
      </div>

      {/* Exception Items List */}
      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorBanner
          message={(error as any)?.message || "Failed to load review items"}
          code={(error as any)?.code}
          requestId={(error as any)?.requestId}
          onRetry={() => refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title="No pending review items"
          description="All autonomous processing stages are operating cleanly without exceptions."
        />
      ) : (
        <div className="space-y-3">
          {data.data.map((review) => {
            const isCritical = review.priority === "CRITICAL";
            const isHigh = review.priority === "HIGH";

            return (
              <div
                key={review.id}
                className="workspace-card p-5 hover:border-slate-300 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-2.5 max-w-3xl">
                  {/* Metadata Chips Row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <StageBadge stage={review.stage} />

                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        isCritical
                          ? "bg-red-100 text-red-700 border border-red-200"
                          : isHigh
                          ? "bg-orange-100 text-orange-700 border border-orange-200"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}
                    >
                      {review.priority} Priority
                    </span>

                    <span className="text-xs text-workspace-muted font-mono">
                      Agent: <strong className="text-workspace-text">{review.requestedByAgent}</strong>
                    </span>

                    <span className="text-xs text-workspace-muted">•</span>
                    <span className="text-xs text-workspace-muted">
                      {formatDate(review.createdAt, true)}
                    </span>
                  </div>

                  {/* Exception Reason Title */}
                  <h3 className="text-sm font-bold text-workspace-text tracking-tight">
                    {review.reason}
                  </h3>

                  {/* Discrepancy Comparison (Expected vs Actual) */}
                  {(review.expectedValue || review.actualValue) && (
                    <div className="inline-flex flex-wrap items-center gap-4 bg-slate-50 border border-workspace-border rounded-lg px-3 py-1.5 text-xs">
                      {review.expectedValue && (
                        <div>
                          <span className="text-workspace-muted text-[11px] mr-1">Expected:</span>
                          <strong className="font-mono text-emerald-700">{review.expectedValue}</strong>
                        </div>
                      )}
                      {review.actualValue && (
                        <div>
                          <span className="text-workspace-muted text-[11px] mr-1">Extracted:</span>
                          <strong className="font-mono text-red-600">{review.actualValue}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  {/* RAG Vector Citation Indicator */}
                  {review.evidence && review.evidence.length > 0 && (
                    <div className="flex items-center space-x-1.5 text-xs text-accent-primary font-medium">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{review.evidence.length} Contract Citation(s) available for inspection</span>
                    </div>
                  )}
                </div>

                {/* Inspection CTA Button */}
                <div className="flex items-center space-x-3 flex-shrink-0">
                  <Link
                    to={`/reviews/${review.id}`}
                    className="inline-flex items-center space-x-2 px-4 py-2.5 bg-accent-primary hover:bg-accent-hover text-white text-xs font-bold rounded-lg shadow-sm transition"
                  >
                    <span>Inspect & Resolve</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}

          {/* Pagination Controls */}
          {data.pagination && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-workspace-border text-xs text-workspace-muted">
              <div>
                Showing page <span className="font-bold text-workspace-text">{data.pagination.page}</span> of{" "}
                <span className="font-bold text-workspace-text">{data.pagination.totalPages}</span> (
                {data.pagination.total} total exceptions)
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
