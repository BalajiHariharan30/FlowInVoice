import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { HumanReview, PaginatedResponse, ReviewStage } from "../../types";
import { formatDate } from "../../lib/format";
import { StageBadge } from "../../components/ui/StageBadge";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import { CheckSquare, ChevronLeft, ChevronRight } from "lucide-react";

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
    { key: "extraction", label: "Extraction Stage" },
    { key: "validation", label: "Validation Stage" },
    { key: "invoice", label: "Invoice Verification Stage" }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Human Review Center</h1>
        <p className="text-sm text-slate-500 mt-1">
          Inspect, evaluate RAG evidence, and resolve autonomous agent exceptions across the workflow
        </p>
      </div>

      {/* Stage Filter Tabs (§Part C §11.2) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200">
        <div className="flex space-x-6 overflow-x-auto">
          {stages.map((st) => (
            <button
              key={st.key}
              onClick={() => handleStageTab(st.key)}
              className={`py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                stageFilter === st.key
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2 pb-2 sm:pb-0 text-xs">
          <span className="text-slate-500">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
            className="px-2.5 py-1 bg-white border border-slate-200 rounded text-slate-700 font-medium focus:outline-none"
          >
            <option value="PENDING">Pending Action</option>
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
          description="All autonomous processing stages are clear of exceptions."
        />
      ) : (
        <div className="space-y-3">
          {data.data.map((review) => (
            <div
              key={review.id}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center space-x-3">
                  <StageBadge stage={review.stage} />
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                      review.priority === "CRITICAL"
                        ? "bg-red-100 text-red-800"
                        : review.priority === "HIGH"
                        ? "bg-orange-100 text-orange-800"
                        : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    {review.priority} Priority
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    By: {review.requestedByAgent}
                  </span>
                </div>

                <h3 className="text-base font-semibold text-slate-900">{review.reason}</h3>

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                  <span>Logged: {formatDate(review.createdAt, true)}</span>
                  {review.expectedValue && (
                    <span>Expected: <strong className="text-slate-800">{review.expectedValue}</strong></span>
                  )}
                  {review.actualValue && (
                    <span>Actual: <strong className="text-slate-800">{review.actualValue}</strong></span>
                  )}
                  {review.evidence && review.evidence.length > 0 && (
                    <span className="text-emerald-700 font-medium">
                      ✓ {review.evidence.length} RAG Evidence Sources Attached
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3 self-end md:self-center">
                <Link
                  to={`/reviews/${review.id}`}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                >
                  Review & Decide →
                </Link>
              </div>
            </div>
          ))}

          {/* Pagination */}
          <div className="p-4 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <div>
              Showing Page <span className="font-semibold text-slate-800">{page}</span> of{" "}
              <span className="font-semibold text-slate-800">{data.pagination.totalPages || 1}</span>
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
