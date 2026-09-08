import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { PurchaseOrder, HumanReview, AuditLogItem, POStatus } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { StageBadge } from "../../components/ui/StageBadge";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import { usePOStatus } from "../../hooks/usePOStatus";
import {
  FileText,
  RotateCw,
  ExternalLink,
  Building,
  Calendar,
  AlertTriangle,
  Receipt,
  Download,
  ShieldCheck,
  CheckCircle,
  Clock,
  Sparkles,
  ArrowRight
} from "lucide-react";

const WORKFLOW_STEPS: POStatus[] = [
  "UPLOADED",
  "PROCESSING",
  "EXTRACTED",
  "VALIDATING",
  "RAG_CHECKING",
  "COMPLIANCE_CHECKING",
  "HUMAN_REVIEW",
  "APPROVED",
  "INVOICE_GENERATING",
  "INVOICE_VALIDATING",
  "COMPLETED"
];

export const PODetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"items" | "reviews" | "audit" | "document">("items");

  const { data: po, isLoading, error, refetch } = useQuery<PurchaseOrder>({
    queryKey: ["po", id],
    queryFn: async () => {
      const res = await apiClient.get<PurchaseOrder>(`/pos/${id}`);
      return res.data;
    },
    enabled: !!id
  });

  const { status: liveStatus, refetch: pollRefetch } = usePOStatus(id, po?.status);

  const { data: reviewsData } = useQuery<{ data: HumanReview[] }>({
    queryKey: ["reviews", { poId: id }],
    queryFn: async () => {
      const res = await apiClient.get<{ data: HumanReview[] }>(`/reviews?search=${id}`);
      return res.data;
    },
    enabled: !!id
  });

  const { data: auditData } = useQuery<{ data: AuditLogItem[] }>({
    queryKey: ["audit", id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: AuditLogItem[] }>(`/audit/${id}`);
      return res.data;
    },
    enabled: !!id
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/pos/${id}/retry`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["po", id] });
      pollRefetch();
    }
  });

  if (isLoading) return <LoadingSkeleton rows={10} />;
  if (error || !po) {
    return (
      <ErrorBanner
        message={(error as any)?.message || "Purchase order not found"}
        code={(error as any)?.code}
        requestId={(error as any)?.requestId}
        onRetry={() => refetch()}
      />
    );
  }

  const currentStatus = liveStatus || po.status;
  const isFailed = currentStatus === "FAILED";
  const reviews = reviewsData?.data || [];
  const auditLogs = auditData?.data || [];

  const currentStepIdx = WORKFLOW_STEPS.indexOf(currentStatus);

  return (
    <div className="space-y-8">
      {/* Glammorphic Header Card */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
        <div className="space-y-1.5">
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-black text-white font-mono tracking-tight">
              {po.poNumber}
            </h1>
            <StatusBadge status={currentStatus} />
          </div>
          <p className="text-xs text-slate-400">
            Received {formatDate(po.createdAt, true)} • S3 Vault:{" "}
            <span className="font-mono text-slate-300">{po.documentName || "document.pdf"}</span>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {isFailed && (
            <button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="flex items-center space-x-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl shadow-[0_0_15px_-2px_rgba(244,63,94,0.4)] transition"
            >
              <RotateCw className={`w-3.5 h-3.5 ${retryMutation.isPending ? "animate-spin" : ""}`} />
              <span>Retry Pipeline</span>
            </button>
          )}

          {po.documentUrl && (
            <a
              href={po.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-slate-200 text-xs font-semibold rounded-xl transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Original Document</span>
            </a>
          )}
        </div>
      </div>

      {/* Failure Alert Banner */}
      {isFailed && po.failureReason && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 backdrop-blur-xl text-rose-200 text-xs flex items-center justify-between shadow-[0_0_20px_-3px_rgba(244,63,94,0.25)]">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <div>
              <span className="font-bold text-rose-100">Workflow Paused on Error: </span>
              <span>{po.failureReason}</span>
            </div>
          </div>
          <button
            onClick={() => retryMutation.mutate()}
            className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 font-bold rounded-lg border border-rose-500/40"
          >
            Trigger Retry
          </button>
        </div>
      )}

      {/* Luminous 13-State Pipeline Timeline (§Part C §10) */}
      <div className="glass-card p-6 space-y-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Autonomous State Graph Progression</span>
          </h3>
          <span className="text-[11px] font-mono text-emerald-400">
            State: {currentStatus}
          </span>
        </div>

        <div className="overflow-x-auto pb-3 pt-2">
          <div className="flex items-center min-w-max space-x-2">
            {WORKFLOW_STEPS.map((step, idx) => {
              const isPast = currentStepIdx > idx;
              const isCurrent = currentStatus === step;

              let nodeStyle = "bg-slate-900 border-white/10 text-slate-500";
              if (isPast) nodeStyle = "bg-emerald-500/20 border-emerald-400/50 text-emerald-300 shadow-neon-emerald";
              if (isCurrent) nodeStyle = "bg-blue-500 border-blue-300 text-white ring-4 ring-blue-500/20 shadow-neon-blue";

              return (
                <div key={step} className="flex items-center">
                  <div className="flex flex-col items-center space-y-2 px-2">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all duration-300 ${nodeStyle}`}
                    >
                      {isPast ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                    </div>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-tight text-center max-w-[80px] ${
                        isCurrent
                          ? "text-blue-400 font-extrabold"
                          : isPast
                          ? "text-emerald-400/80"
                          : "text-slate-500"
                      }`}
                    >
                      {step.replace(/_/g, " ")}
                    </span>
                  </div>
                  {idx < WORKFLOW_STEPS.length - 1 && (
                    <div
                      className={`w-8 h-[2px] rounded ${
                        isPast
                          ? "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-neon-emerald"
                          : "bg-white/[0.08]"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Extracted Metadata Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5 space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Building className="w-3.5 h-3.5" />
            <span>Customer Account</span>
          </div>
          <div className="text-sm font-bold text-white">{po.customerName}</div>
          <div className="text-[11px] text-slate-400 font-mono">ID: {po.customerId || "Auto-detected"}</div>
        </div>

        {/* Labeled GST Number field (§Part C §10) */}
        <div className="glass-card p-5 space-y-1 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl pointer-events-none"></div>
          <div className="flex items-center space-x-2 text-xs text-emerald-400 font-bold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="uppercase tracking-wider">GSTIN / Tax ID</span>
          </div>
          <div className="text-sm font-mono font-extrabold text-white tracking-wide">
            {po.gstNumber || "Not Specified"}
          </div>
          <div className="text-[11px] text-emerald-400/70">Verified for tax calculation</div>
        </div>

        <div className="glass-card p-5 space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Calendar className="w-3.5 h-3.5" />
            <span>Contract Terms</span>
          </div>
          <div className="text-sm font-semibold text-slate-200">
            Issue: {formatDate(po.issueDate)}
          </div>
          <div className="text-[11px] text-slate-400">Payment: {po.paymentTerms || "NET_30"}</div>
        </div>

        <div className="glass-card p-5 space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Receipt className="w-3.5 h-3.5 text-emerald-400" />
            <span className="uppercase tracking-wider font-semibold">Total Amount</span>
          </div>
          <div className="text-xl font-extrabold text-emerald-400 font-mono">
            {formatCurrency(po.totalAmount, po.currency)}
          </div>
          <div className="text-[11px] text-slate-400">
            Subtotal: {formatCurrency(po.subtotal, po.currency)} • Tax: {formatCurrency(po.tax, po.currency)}
          </div>
        </div>
      </div>

      {/* Tabs Container */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-white/[0.08] flex px-6 space-x-6 text-xs bg-white/[0.02]">
          <button
            onClick={() => setActiveTab("items")}
            className={`py-4 font-bold border-b-2 transition ${
              activeTab === "items"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Extracted Line Items ({po.lineItems?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("reviews")}
            className={`py-4 font-bold border-b-2 transition flex items-center space-x-2 ${
              activeTab === "reviews"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>Review Exceptions</span>
            {reviews.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {reviews.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`py-4 font-bold border-b-2 transition ${
              activeTab === "audit"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Audit Trail ({auditLogs.length})
          </button>
          <button
            onClick={() => setActiveTab("document")}
            className={`py-4 font-bold border-b-2 transition ${
              activeTab === "document"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Document Viewer
          </button>
        </div>

        <div className="p-6">
          {/* Line Items Table */}
          {activeTab === "items" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Line #</th>
                    <th className="py-3 px-4">Product Code</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">GST Number</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4 text-right">Unit Price</th>
                    <th className="py-3 px-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {po.lineItems?.map((item) => (
                    <tr key={item.lineNumber} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4 font-mono text-slate-400">{item.lineNumber}</td>
                      <td className="py-3 px-4 font-mono font-semibold text-emerald-300">
                        {item.productCode}
                      </td>
                      <td className="py-3 px-4 text-slate-300">{item.description}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {item.gstNumber || po.gstNumber || "—"}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-200">{item.quantity}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">
                        {formatCurrency(item.unitPrice, po.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        {formatCurrency(item.lineTotal, po.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Human Review Records Tab (§Part C §10 & §11.2) */}
          {activeTab === "reviews" && (
            <div className="space-y-4">
              {reviews.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No human review exceptions recorded for this purchase order.
                </div>
              ) : (
                reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-5 rounded-xl bg-slate-950/60 border border-white/[0.08] flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center space-x-3">
                        <StageBadge stage={rev.stage} />
                        <span
                          className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                            rev.status === "APPROVED"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : rev.status === "REJECTED"
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          }`}
                        >
                          {rev.status}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          Agent: {rev.requestedByAgent}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-200">{rev.reason}</p>
                    </div>

                    <Link
                      to={`/reviews/${rev.id}`}
                      className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-obsidian-950 rounded-xl text-xs font-bold transition shadow-neon-emerald"
                    >
                      Open Inspection →
                    </Link>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Audit Logs Tab */}
          {activeTab === "audit" && (
            <div className="space-y-3">
              {auditLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No audit logs recorded for this entity.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl bg-slate-950/50 border border-white/[0.06] text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-bold text-slate-200">{log.agentName}</span>
                      <span className="font-mono text-[11px]">{formatDate(log.timestamp, true)}</span>
                    </div>
                    <div className="text-slate-300">{log.summary}</div>
                    <div className="flex items-center justify-between text-slate-400 pt-1 text-[11px]">
                      <span>Action: <code className="font-mono text-emerald-400">{log.action}</code></span>
                      {log.traceId && (
                        <a
                          href={`https://smith.langchain.com/trace/${log.traceId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:underline inline-flex items-center space-x-1"
                        >
                          <span>Full Trace</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Document Preview */}
          {activeTab === "document" && (
            <div className="border border-white/10 rounded-xl overflow-hidden bg-slate-950/60 p-4">
              {po.documentUrl ? (
                <iframe
                  src={po.documentUrl}
                  title="Purchase Order PDF"
                  className="w-full h-[650px] rounded-lg border border-white/10"
                />
              ) : (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No preview available for this document format.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
