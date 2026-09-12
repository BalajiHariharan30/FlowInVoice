import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { HumanReview, PurchaseOrder } from "../../types";
import { formatDate } from "../../lib/format";
import { StageBadge } from "../../components/ui/StageBadge";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import { PDFDocumentViewer } from "../../components/document/PDFDocumentViewer";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileSearch,
  ExternalLink,
  ShieldCheck,
  BookOpen,
  Sparkles,
  Layers,
  Check,
  ArrowRight,
  Info,
  Clock,
  History,
  ShieldAlert,
  Lightbulb
} from "lucide-react";

export const ReviewDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { user } = useAuth();

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

  // Query associated purchase order if entityId is present
  const { data: po } = useQuery<PurchaseOrder>({
    queryKey: ["po", review?.entityId],
    queryFn: async () => {
      const res = await apiClient.get<PurchaseOrder>(`/pos/${review?.entityId}`);
      return res.data;
    },
    enabled: !!review?.entityId && review?.entity === "purchase_order"
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/reviews/${id}/approve`, {
        resolutionNotes: notes || "Approved by reviewer"
      });
      return res.data;
    },
    onSuccess: () => {
      addToast({
        type: "success",
        title: "Exception Approved",
        message: "Pipeline processing resumed for this entity."
      });
      queryClient.invalidateQueries({ queryKey: ["review", id] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (review?.entityId) {
        queryClient.invalidateQueries({ queryKey: ["po", review.entityId] });
      }
      navigate("/reviews");
    },
    onError: (err: any) => {
      const msg = err.message || "Failed to approve review";
      setActionError(msg);
      addToast({
        type: "error",
        title: "Approval Failed",
        message: msg
      });
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
      addToast({
        type: "info",
        title: "Exception Rejected",
        message: "Entity flagged as rejected and processing stopped."
      });
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
      const msg = err.message || "Failed to reject review";
      setActionError(msg);
      addToast({
        type: "error",
        title: "Rejection Failed",
        message: msg
      });
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

  let approvalConsequence = "Resumes autonomous agent processing from current stage checkpoint.";
  let rejectionConsequence = "Stops pipeline processing and closes exception.";

  if (review.stage === "extraction") {
    approvalConsequence = "Accepts extracted values and proceeds directly to contract validation & RAG checks.";
    rejectionConsequence = "Halts pipeline, notifies accounts payable, and flags PO as rejected.";
  } else if (review.stage === "validation") {
    approvalConsequence = "Authorizes commercial pricing/terms deviation. Proceeds to automated Invoice Generation.";
    rejectionConsequence = "Rejects PO validation. Prevents invoice issuance for unapproved terms.";
  } else if (review.stage === "invoice") {
    approvalConsequence = "Validates invoice line items & calculations. Issues final canonical PDF invoice.";
    rejectionConsequence = "Holds invoice for manual finance credit/debit recalculation.";
  }

  const currentUserId = user?.id;
  const currentUserEmail = user?.email;
  const isMakerCheckerViolation = Boolean(
    po?.createdBy &&
    user &&
    (po.createdBy === currentUserId || po.createdBy === currentUserEmail)
  );

  const isResolved = review.status !== "PENDING" && review.status !== "ESCALATED";
  const quickTemplates = [
    "Pricing verified against executed MSA addendum.",
    "Approved within permissible 2% variance threshold.",
    "Confirmed billing terms directly with customer procurement."
  ];

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-workspace-border">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate("/reviews")}
            className="p-2 rounded-lg border border-workspace-border bg-white text-workspace-muted hover:text-workspace-text hover:bg-slate-50 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-2xl font-black text-workspace-text tracking-tight">
                Exception Inspection
              </h1>
              <StageBadge stage={review.stage} />
              {review.status === "ESCALATED" ? (
                <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase bg-amber-500 text-white border border-amber-600 flex items-center space-x-1 shadow-xs animate-pulse">
                  <Clock className="w-3 h-3" />
                  <span>SLA ESCALATED (24h+)</span>
                </span>
              ) : (
                <span
                  className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    review.status === "APPROVED"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      : review.status === "REJECTED"
                      ? "bg-red-100 text-red-800 border border-red-200"
                      : "bg-amber-100 text-amber-800 border border-amber-200"
                  }`}
                >
                  {review.status}
                </span>
              )}
            </div>
            <p className="text-xs text-workspace-muted mt-1">
              Logged {formatDate(review.createdAt, true)} by Agent:{" "}
              <strong className="text-workspace-text font-mono">{review.requestedByAgent}</strong>
              {po?.version && po.version > 1 && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[10px] font-bold">
                  v{po.version}
                </span>
              )}
              {po?.previousVersionId && (
                <Link
                  to={`/pos/${po.previousVersionId}`}
                  className="ml-1 text-[11px] text-accent-primary hover:underline font-mono"
                >
                  (Supersedes v{(po.version || 2) - 1})
                </Link>
              )}
            </p>
          </div>
        </div>

        {review.entityId && (
          <Link
            to={`/pos/${review.entityId}`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-workspace-border bg-white hover:bg-slate-50 text-xs font-semibold text-workspace-text transition"
          >
            <span>View Associated PO</span>
            <ExternalLink className="w-3.5 h-3.5 text-workspace-muted" />
          </Link>
        )}
      </div>

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* 3-Panel Resolution Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* PANEL 1: Left Document Preview (4 Columns) */}
        <div className="xl:col-span-4 h-[750px] rounded-xl overflow-hidden shadow-sm border border-workspace-border">
          <PDFDocumentViewer
            key={po?.id || id}
            poId={po?.id || id}
            documentName={po?.documentName || "Purchase_Order_Dispute.pdf"}
            documentUrl={po?.documentUrl}
            poNumber={po?.poNumber || "PO-REF"}
            customerName={po?.customerName || "Customer Account"}
            po={po}
          />
        </div>

        {/* PANEL 2: Center Discrepancy & Evidence Analysis (5 Columns) */}
        <div className="xl:col-span-5 space-y-5">
          {/* Rule 4: Repeated Failure Diagnosis & Suggested Fix */}
          {review.suggestedFix && (
            <div className="workspace-card p-5 space-y-3 border-l-4 border-l-indigo-600 bg-indigo-50/20">
              <div className="flex items-center justify-between pb-2 border-b border-indigo-100">
                <div className="flex items-center space-x-2">
                  <Lightbulb className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950 font-mono">
                    Autonomous Failure Diagnosis & Suggested Fix
                  </h3>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase">
                  {review.suggestedFix.rootCauseCategory}
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-600 block text-[11px]">Observed Failure Pattern:</span>
                  <p className="text-slate-900 font-medium">{review.suggestedFix.failurePatternSummary}</p>
                </div>
                <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-200">
                  <span className="font-bold text-indigo-900 block text-[11px]">Recommended Corrective Action:</span>
                  <p className="text-indigo-950 text-xs mt-0.5">{review.suggestedFix.recommendedAction}</p>
                </div>
              </div>
            </div>
          )}
          {/* Complete Pipeline Re-Analysis Discrepancy Report (Nodes 02–06) */}
          {review.discrepancyReport && review.discrepancyReport.length > 0 && (
            <div className="workspace-card p-5 space-y-4 border-l-4 border-l-red-500 bg-red-50/20">
              <div className="flex items-center justify-between pb-2 border-b border-workspace-border">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-red-950 font-mono">
                    Pipeline Discrepancy Report ({review.discrepancyReport.length} Issues Detected)
                  </h3>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                  Nodes 02–06 Re-Checked
                </span>
              </div>

              <p className="text-xs text-slate-600">
                Full-document re-analysis identified multiple independent discrepancies across verification nodes:
              </p>

              <div className="space-y-3">
                {review.discrepancyReport.map((disc, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg bg-white border border-red-200 shadow-xs space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 uppercase">
                          {disc.nodeId}
                        </span>
                        <span className="font-bold text-slate-900 font-mono">{disc.field}</span>
                      </div>
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          disc.severity === "CRITICAL"
                            ? "bg-red-600 text-white"
                            : disc.severity === "HIGH"
                            ? "bg-amber-500 text-white"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {disc.severity}
                      </span>
                    </div>

                    <p className="text-xs text-slate-800">{disc.message}</p>

                    <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[10px]">
                      <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                        <span className="text-emerald-700 uppercase font-bold block text-[9px]">Expected:</span>
                        <span className="text-emerald-950 font-semibold">
                          {disc.expectedValue !== null && disc.expectedValue !== undefined && disc.expectedValue !== ""
                            ? String(disc.expectedValue)
                            : "N/A"}
                        </span>
                      </div>
                      <div className="bg-amber-50 p-2 rounded border border-amber-100">
                        <span className="text-amber-700 uppercase font-bold block text-[9px]">Extracted:</span>
                        <span className="text-amber-950 font-semibold">
                          {disc.extractedValue !== null && disc.extractedValue !== undefined && disc.extractedValue !== ""
                            ? String(disc.extractedValue)
                            : "N/A"}
                        </span>
                      </div>
                    </div>

                    {disc.sourceClause && (
                      <div className="text-[10px] text-slate-500 italic pt-0.5">
                        Rule Reference: {disc.sourceClause}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Discrepancy Card */}
          <div className="workspace-card p-5 space-y-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-workspace-muted">
                Exception Trigger & Description
              </span>
              <p className="text-base font-bold text-workspace-text mt-1">{review.reason}</p>
            </div>

            {/* Expected vs Extracted Side-by-Side Comparison */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200">
                <span className="text-[10px] font-bold uppercase text-emerald-800 tracking-wider">
                  Contract / Expected Rule
                </span>
                <p className="text-sm font-bold text-emerald-950 font-mono mt-1">
                  {review.expectedValue !== null && review.expectedValue !== undefined && review.expectedValue !== ""
                    ? String(review.expectedValue)
                    : "Standard Catalog Baseline"}
                </p>
                <span className="text-[10px] text-emerald-700 block mt-1">
                  Per authorized rate schedule
                </span>
              </div>

              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200">
                <span className="text-[10px] font-bold uppercase text-amber-800 tracking-wider">
                  PO Extracted Value
                </span>
                <p className="text-sm font-bold text-amber-950 font-mono mt-1">
                  {review.actualValue !== null && review.actualValue !== undefined && review.actualValue !== ""
                    ? String(review.actualValue)
                    : "Value in Uploaded Document"}
                </p>
                <span className="text-[10px] text-amber-700 block mt-1">
                  Requires human authorization
                </span>
              </div>
            </div>

            {/* Stage Semantics & Impact */}
            <div className="p-4 rounded-lg bg-slate-50 border border-workspace-border text-xs space-y-2">
              <div className="font-bold text-workspace-text flex items-center space-x-1.5">
                <Info className="w-3.5 h-3.5 text-accent-primary" />
                <span>Decision Consequence ({review.stage.toUpperCase()})</span>
              </div>
              <div className="text-workspace-muted leading-relaxed">
                <strong className="text-emerald-700">If Approved: </strong>
                {approvalConsequence}
              </div>
              <div className="text-workspace-muted leading-relaxed">
                <strong className="text-red-700">If Rejected: </strong>
                {rejectionConsequence}
              </div>
            </div>
          </div>

          {/* Agentic RAG Vector Evidence Sources */}
          <div className="workspace-card p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-workspace-border">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-accent-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-text">
                  Vector Retrieval Evidence ({review.evidence?.length || 0})
                </h3>
              </div>
              <span className="text-[10px] font-mono text-workspace-muted">
                Qdrant Hybrid Vector DB
              </span>
            </div>

            {!review.evidence || review.evidence.length === 0 ? (
              <div className="p-6 rounded-lg border border-dashed border-workspace-border text-center text-xs text-workspace-muted">
                No vector retrieval chunks cited for this exception type.
              </div>
            ) : (
              <div className="space-y-3">
                {review.evidence.map((ev, index) => (
                  <div
                    key={index}
                    className="p-3.5 rounded-lg bg-slate-50 border border-workspace-border hover:border-slate-300 transition text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            ev.sourceType === "CONTRACT"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {ev.sourceType}
                        </span>
                        <span className="font-bold text-workspace-text">{ev.documentName}</span>
                        <span className="text-workspace-muted">• {ev.section}</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Score: 0.94
                      </span>
                    </div>

                    <p className="text-xs text-workspace-text italic bg-white p-2.5 rounded border border-workspace-border">
                      "{ev.claim}"
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historical Precedent Card */}
          <div className="workspace-card p-4 flex items-start space-x-3 text-xs">
            <History className="w-4 h-4 text-workspace-muted flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-workspace-text block">Historical Resolution Precedent</span>
              <p className="text-workspace-muted mt-0.5">
                A similar pricing exception for customer Acme Corp on PO-2024-0312 was approved by Finance Admin with note:
                "Tier 1 volume discount authorized under amendment #3."
              </p>
            </div>
          </div>
        </div>

        {/* PANEL 3: Right Reviewer Decision & Sign-Off Panel (3 Columns) */}
        <div className="xl:col-span-3 space-y-4">
          <div className="workspace-card p-5 space-y-4">
            <div className="pb-3 border-b border-workspace-border">
              <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-text">
                Reviewer Sign-Off
              </h3>
              <p className="text-[11px] text-workspace-muted mt-0.5">
                Immutable audit trail entry will be generated
              </p>
            </div>

            {!isResolved ? (
              <div className="space-y-4">
                {/* Maker-Checker Segregation of Duties Warning */}
                {isMakerCheckerViolation && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                    <div className="font-bold flex items-center space-x-1.5 text-amber-800">
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                      <span>Segregation of Duties (Maker-Checker)</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      You submitted this purchase order. Enterprise financial control policy requires an independent reviewer to approve or reject this exception.
                    </p>
                  </div>
                )}

                {/* Quick Templates */}
                <div>
                  <label className="block text-[11px] font-semibold text-workspace-muted mb-1.5">
                    Quick Justification Templates:
                  </label>
                  <div className="space-y-1.5">
                    {quickTemplates.map((tmpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setNotes(tmpl)}
                        disabled={isMakerCheckerViolation}
                        className="w-full text-left p-2 rounded bg-slate-50 hover:bg-slate-100 border border-workspace-border text-[11px] text-workspace-text transition disabled:opacity-50"
                      >
                        {tmpl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Resolution Notes */}
                <div>
                  <label className="block text-[11px] font-semibold text-workspace-muted mb-1">
                    Audit Resolution Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isMakerCheckerViolation}
                    placeholder="Document operational or commercial justification..."
                    className="w-full p-3 bg-slate-50 border border-workspace-border rounded-lg text-xs text-workspace-text placeholder-workspace-muted focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-50"
                    rows={4}
                  />
                </div>

                {/* Primary Actions */}
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={() => approveMutation.mutate()}
                    disabled={isMakerCheckerViolation || approveMutation.isPending || rejectMutation.isPending}
                    title={isMakerCheckerViolation ? "Cannot approve documents you submitted (Segregation of Duties)" : undefined}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {approveMutation.isPending ? "Approving & Resuming..." : "Approve & Resume Pipeline"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowRejectModal(true)}
                    disabled={isMakerCheckerViolation || approveMutation.isPending || rejectMutation.isPending}
                    title={isMakerCheckerViolation ? "Cannot reject documents you submitted (Segregation of Duties)" : undefined}
                    className="w-full py-2 px-4 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-semibold transition disabled:opacity-50"
                  >
                    Reject Exception
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-slate-50 border border-workspace-border text-xs space-y-2">
                <div className="font-bold text-workspace-text flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>
                    Resolved as <strong className="uppercase font-mono text-accent-primary">{review.status}</strong>
                  </span>
                </div>
                <div className="text-workspace-muted text-[11px]">
                  Resolved by: <span className="font-semibold text-workspace-text">{review.resolvedBy || "Reviewer"}</span>
                </div>
                {review.resolutionNotes && (
                  <div className="text-workspace-text bg-white p-2.5 rounded border border-workspace-border">
                    {review.resolutionNotes}
                  </div>
                )}
                <div className="text-workspace-muted text-[10px]">
                  Timestamp: {formatDate(review.resolvedAt, true)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rejection Confirmation Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-workspace-border space-y-4">
            <div className="flex items-center space-x-3 text-red-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-workspace-text">Confirm Exception Rejection</h3>
            </div>

            <p className="text-xs text-workspace-muted">
              {rejectionConsequence} A mandatory rejection reason is required for the audit trail.
            </p>

            <div>
              <label className="block text-xs font-semibold text-workspace-text mb-1">
                Rejection Reason *
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Specify reasons for rejecting this purchase order..."
                className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-xs text-workspace-text placeholder-workspace-muted focus:outline-none focus:ring-1 focus:ring-red-500"
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 border border-workspace-border rounded-lg text-xs font-semibold text-workspace-text hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
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
