import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { HumanReview, PaginatedResponse, ReviewStage } from "../../types";
import { formatDate } from "../../lib/format";
import { StageBadge } from "../../components/ui/StageBadge";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import { CheckSquare, ChevronLeft, ChevronRight, Sparkles, ArrowUpRight } from "lucide-react";

export const ReviewListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") || "1", 10);
  const stageFilter = (searchParams.get("stage") as ReviewStage) || "";
  const statusFilter = searchParams.get("status") || "PENDING";

  const { data, isLoading, error, refetch } = useQuery<PaginatedResponse<HumanReview>>({
    queryKey: ["reviews", { page, stage: stageFilter, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "15");
      if (stageFilter) params.set("stage", stageFilter);
      if (statusFilter) params.set("status", statusFilter);

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

  const stages: Array<{ key: string; label: string }> = [
    { key: "", label: "All Stages" },
    { key: "extraction", label: "Extraction Exceptions" },
    { key: "validation", label: "Validation & RAG Deviations" },
    { key: "invoice", label: "Invoice Discrepancies" }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center space-x-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">Review Center</h1>
          <Sparkles className="w-4 h-4 text-emerald-400" />
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Inspect, evaluate RAG evidence citations, and decide autonomous agent exceptions across all workflow checkpoints
        </p>
      </div>

      {/* Glammorphic Stage Filter Tabs (§Part C §11.2) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/[0.08]">
        <div className="flex space-x-6 overflow-x-auto">
          {stages.map((st) => (
            <button
              key={st.key}
              onClick={() => handleStageTab(st.key)}
              className={`py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition whitespace-nowrap ${
                stageFilter === st.key
                  ? "border-emerald-400 text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2 pb-2 sm:pb-0 text-xs">
          <span className="text-slate-400">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-slate-200 font-medium focus:outline-none"
          >
            <option value="PENDING">Pending Review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All Statuses</option>
          </select>
        </div>
      </div>

      {/* Content */}
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
          {data.data.map((review) => (
            <div
              key={review.id}
              className="glass-card-hover p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-2.5 max-w-2xl">
                <div className="flex items-center space-x-3">
                  <StageBadge stage={review.stage} />
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                      review.priority === "CRITICAL"
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        : review.priority === "HIGH"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-slate-800 text-slate-400 border border-slate-700"
                    }`}
                  >
                    {review.priority} Priority
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    By: {review.requestedByAgent}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-white tracking-tight">{review.reason}</h3>

                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
                  <span>Logged: {formatDate(review.createdAt, true)}</span>
                  {review.expectedValue && (
                    <span>Expected: <strong className="text-slate-200">{review.expectedValue}</strong></span>
                  )}
                  {review.actualValue && (
                    <span>Actual: <strong className="text-slate-200">{review.actualValue}</strong></span>
                  )}
                  {review.evidence && review.evidence.length > 0 && (
                    <span className="text-emerald-400 font-semibold flex items-center space-x-1">
                      <span>✓ {review.evidence.length} Vector Citations Attached</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3 self-end md:self-center">
                <Link
                  to={`/reviews/${review.id}`}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-obsidian-950 rounded-xl text-xs font-bold transition shadow-neon-emerald"
                >
                  <span>Inspect Decision</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}

          {/* Pagination */}
          <div className="p-4 glass-card flex items-center justify-between text-xs text-slate-400">
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
                className="p-1.5 rounded-lg border border-white/10 hover:bg-white/[0.05] disabled:opacity-30"
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
                className="p-1.5 rounded-lg border border-white/10 hover:bg-white/[0.05] disabled:opacity-30"
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
