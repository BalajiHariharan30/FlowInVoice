import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { HumanReview, EvidenceItem } from "../../types";
import { formatDate } from "../../lib/format";
import { StageBadge } from "../../components/ui/StageBadge";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileSearch,
  ExternalLink,
  ShieldCheck,
  BookOpen
} from "lucide-react";

export const ReviewDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: review, isLoading, error, refetch } = useQuery<HumanReview>({
    queryKey: ["review", id],
    queryFn: async () => {
      const res = await apiClient.get<HumanReview>(`/reviews/${id}`);
      return res.data;
    },
    enabled: !!id
  });

  // Approve Mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/reviews/${id}/approve`, {
        resolutionNotes: notes || "Approved by reviewer"
      });
      return res.data;
    },
    onSuccess: () => {
      // Invalidate relevant queries per §Part C §11.2
      queryClient.invalidateQueries({ queryKey: ["review", id] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (review?.entityId) {
        queryClient.invalidateQueries({ queryKey: ["po", review.entityId] });
      }
      navigate("/reviews");
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to approve review");
    }
  });

  // Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/reviews/${id}/reject`, {
        reason: rejectReason
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", id] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (review?.entityId) {
        queryClient.invalidateQueries({ queryKey: ["po", review.entityId] });
      }
      setShowRejectModal(false);
      navigate("/reviews");
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to reject review");
    }
  });

  if (isLoading) return <LoadingSkeleton rows={10} />;
  if (error || !review) {
    return (
      <ErrorBanner
        message={(error as any)?.message || "Review record not found"}
        code={(error as any)?.code}
        requestId={(error as any)?.requestId}
        onRetry={() => refetch()}
      />
    );
  }

  // Stage-specific consequences per §Part C §11.2
  let approvalConsequence = "Resumes processing from the current stage checkpoint.";
  let rejectionConsequence = "Rejects the current document exception.";

  if (review.stage === "extraction") {
    approvalConsequence = "Resumes extraction and verification, proceeding to business validation.";
    rejectionConsequence = "Notifies the customer and closes the purchase order as rejected.";
  } else if (review.stage === "validation") {
    approvalConsequence = "Commercial exception approved. Proceeds directly to automated Invoice Generation.";
    rejectionConsequence = "Purchase order is formally marked REJECTED in the pipeline.";
  } else if (review.stage === "invoice") {
    approvalConsequence = "Invoice calculation/verification approved. Proceeds to issue invoice PDF.";
    rejectionConsequence = "Invoice held for finance team manual correction.";
  }

  const isResolved = review.status !== "PENDING";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => navigate("/reviews")}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Human Review Inspection
            </h1>
            <StageBadge stage={review.stage} />
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                review.status === "APPROVED"
                  ? "bg-emerald-100 text-emerald-800"
                  : review.status === "REJECTED"
                  ? "bg-red-100 text-red-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {review.status}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Logged on {formatDate(review.createdAt, true)} by Agent:{" "}
            <strong className="text-slate-800">{review.requestedByAgent}</strong>
          </p>
        </div>
      </div>

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm">
          {actionError}
        </div>
      )}

      {/* Main Review Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Exception Reason</h2>
          <p className="text-base font-semibold text-slate-900 mt-1">{review.reason}</p>
        </div>

        {/* Expected vs Actual */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-semibold uppercase text-slate-500">Expected Criterion</span>
            <p className="text-sm font-bold text-slate-800 mt-1">{review.expectedValue || "Standard Policy Limit"}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-semibold uppercase text-slate-500">Actual Extracted Value</span>
            <p className="text-sm font-bold text-slate-800 mt-1">{review.actualValue || "Value in Document"}</p>
          </div>
        </div>

        {/* Stage-Aware Outcomes Explanation Box (§Part C §11.2) */}
        <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs space-y-2">
          <div className="font-bold text-blue-900 uppercase tracking-wider">
            Stage Action Semantics ({review.stage})
          </div>
          <div className="text-blue-800">
            <strong className="text-emerald-700">If Approved: </strong>
            {approvalConsequence}
          </div>
          <div className="text-blue-800">
            <strong className="text-red-700">If Rejected: </strong>
            {rejectionConsequence}
          </div>
        </div>

        {/* Multi-Source Evidence List (§Part C §11.2) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
              <BookOpen className="w-4 h-4 text-slate-400" />
              <span>Agentic RAG Evidence Sources ({review.evidence?.length || 0})</span>
            </h3>
            <span className="text-xs text-slate-400">Retrieved from Contract & Policy Vector Stores</span>
          </div>

          {!review.evidence || review.evidence.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
              No vector retrieval chunks cited for this exception type.
            </div>
          ) : (
            <div className="space-y-3">
              {review.evidence.map((ev, index) => (
                <div
                  key={index}
                  className="p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-emerald-300 transition space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          ev.sourceType === "CONTRACT"
                            ? "bg-purple-100 text-purple-800 border border-purple-200"
                            : "bg-amber-100 text-amber-800 border border-amber-200"
                        }`}
                      >
                        {ev.sourceType}
                      </span>
                      <span className="text-xs font-bold text-slate-800">{ev.documentName}</span>
                      <span className="text-xs text-slate-400">• {ev.section}</span>
                    </div>

                    {/* Deep Link to Document Page (§Part C §11.2) */}
                    <Link
                      to={`/pos/${review.entityId}`}
                      className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center space-x-1"
                    >
                      <span>Jump to Page {ev.pageNumber}</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>

                  <p className="text-xs text-slate-700 italic bg-white p-3 rounded-lg border border-slate-200/80">
                    "{ev.claim}"
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resolution Notes & Actions */}
        {!isResolved ? (
          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                Resolution Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Document rationale or policy justification for this decision..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowRejectModal(true)}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                className="px-5 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-sm font-semibold transition"
              >
                Reject Exception
              </button>
              <button
                type="button"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold shadow-sm transition disabled:opacity-50"
              >
                {approveMutation.isPending ? "Approving & Resuming..." : "Approve & Resume Pipeline"}
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-4 border-t border-slate-200 p-4 bg-slate-50 rounded-xl text-xs space-y-1">
            <div className="font-bold text-slate-800">
              Resolved as <span className="uppercase">{review.status}</span> by {review.resolvedBy}
            </div>
            {review.resolutionNotes && (
              <div className="text-slate-600">Notes: {review.resolutionNotes}</div>
            )}
            <div className="text-slate-400">
              Resolved at: {formatDate(review.resolvedAt, true)}
            </div>
          </div>
        )}
      </div>

      {/* Rejection Confirmation Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3 text-red-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900">Confirm Rejection</h3>
            </div>

            <p className="text-xs text-slate-600">
              {rejectionConsequence} Please provide a mandatory rejection reason for the audit trail.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Rejection Reason *
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Specify reason for rejecting this PO or invoice..."
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-red-500"
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
              >
                {rejectMutation.isPending ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
