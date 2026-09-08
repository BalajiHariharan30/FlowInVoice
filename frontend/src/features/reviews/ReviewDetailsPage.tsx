import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { HumanReview } from "../../types";
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
  BookOpen,
  Sparkles
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

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/reviews/${id}/approve`, {
        resolutionNotes: notes || "Approved by reviewer"
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
      navigate("/reviews");
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to approve review");
    }
  });

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
          className="p-2 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.05] transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Human Review Inspection
            </h1>
            <StageBadge stage={review.stage} />
            <span
              className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                review.status === "APPROVED"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : review.status === "REJECTED"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}
            >
              {review.status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Logged on {formatDate(review.createdAt, true)} by Agent:{" "}
            <strong className="text-slate-200">{review.requestedByAgent}</strong>
          </p>
        </div>
      </div>

      {actionError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-xl text-xs">
          {actionError}
        </div>
      )}

      {/* Main Glammorphic Review Card */}
      <div className="glass-card p-6 space-y-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/50 to-transparent"></div>

        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Exception Reason</h2>
          <p className="text-base font-semibold text-white mt-1">{review.reason}</p>
        </div>

        {/* Expected vs Actual */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/50 border border-white/[0.08]">
            <span className="text-[11px] font-bold uppercase text-slate-400">Expected Criterion</span>
            <p className="text-xs font-bold text-slate-100 mt-1">{review.expectedValue || "Standard Policy Limit"}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-950/50 border border-white/[0.08]">
            <span className="text-[11px] font-bold uppercase text-slate-400">Actual Extracted Value</span>
            <p className="text-xs font-bold text-slate-100 mt-1">{review.actualValue || "Value in Document"}</p>
          </div>
        </div>

        {/* Stage-Aware Outcomes Explanation (§Part C §11.2) */}
        <div className="p-5 rounded-2xl bg-indigo-950/20 border border-indigo-500/30 backdrop-blur-xl text-xs space-y-2.5 shadow-[0_0_20px_-3px_rgba(99,102,241,0.15)]">
          <div className="font-bold text-indigo-300 uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Stage Action Semantics ({review.stage})</span>
          </div>
          <div className="text-slate-300">
            <strong className="text-emerald-400">If Approved: </strong>
            {approvalConsequence}
          </div>
          <div className="text-slate-300">
            <strong className="text-rose-400">If Rejected: </strong>
            {rejectionConsequence}
          </div>
        </div>

        {/* Multi-Source Evidence List (§Part C §11.2) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              <span>Agentic RAG Evidence Sources ({review.evidence?.length || 0})</span>
            </h3>
            <span className="text-[11px] text-slate-500 font-mono">Qdrant Vector DB Citations</span>
          </div>

          {!review.evidence || review.evidence.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-white/10 text-center text-xs text-slate-500">
              No vector retrieval chunks cited for this exception type.
            </div>
          ) : (
            <div className="space-y-3">
              {review.evidence.map((ev, index) => (
                <div
                  key={index}
                  className="p-4 rounded-xl bg-slate-950/50 border border-white/[0.08] hover:border-emerald-500/40 transition space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          ev.sourceType === "CONTRACT"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {ev.sourceType}
                      </span>
                      <span className="text-xs font-bold text-white">{ev.documentName}</span>
                      <span className="text-xs text-slate-400">• {ev.section}</span>
                    </div>

                    {/* Deep Link to Document Page */}
                    <Link
                      to={`/pos/${review.entityId}`}
                      className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:underline flex items-center space-x-1"
                    >
                      <span>Jump to Page {ev.pageNumber}</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>

                  <p className="text-xs text-slate-300 italic bg-obsidian-950/80 p-3 rounded-lg border border-white/[0.05]">
                    "{ev.claim}"
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resolution Decision Section */}
        {!isResolved ? (
          <div className="pt-4 border-t border-white/[0.08] space-y-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Resolution Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Document rationale or policy justification for this decision..."
                className="w-full p-3 glass-input text-xs"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowRejectModal(true)}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                className="px-5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition"
              >
                Reject Exception
              </button>
              <button
                type="button"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 hover:from-emerald-500 hover:to-teal-300 text-obsidian-950 rounded-xl text-xs font-bold shadow-neon-emerald transition disabled:opacity-50"
              >
                {approveMutation.isPending ? "Approving & Resuming..." : "Approve & Resume Pipeline"}
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-4 border-t border-white/[0.08] p-4 rounded-xl bg-slate-950/50 border border-white/[0.06] text-xs space-y-1">
            <div className="font-bold text-white">
              Resolved as <span className="uppercase text-emerald-400 font-mono">{review.status}</span> by {review.resolvedBy}
            </div>
            {review.resolutionNotes && (
              <div className="text-slate-300">Notes: {review.resolutionNotes}</div>
            )}
            <div className="text-slate-500 text-[11px]">
              Resolved at: {formatDate(review.resolvedAt, true)}
            </div>
          </div>
        )}
      </div>

      {/* Glammorphic Rejection Confirmation Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-obsidian-950/80 backdrop-blur-2xl z-50 flex items-center justify-center p-4">
          <div className="glass-panel rounded-2xl max-w-md w-full p-6 shadow-2xl border border-rose-500/30 space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">Confirm Rejection</h3>
            </div>

            <p className="text-xs text-slate-300">
              {rejectionConsequence} Please provide a mandatory rejection reason for the immutable audit trail.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Rejection Reason *
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Specify reason for rejecting this PO or invoice..."
                className="w-full p-2.5 glass-input text-xs"
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 border border-white/10 rounded-xl text-xs font-semibold text-slate-300 hover:bg-white/[0.05]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition disabled:opacity-50 shadow-[0_0_15px_rgba(244,63,94,0.4)]"
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
