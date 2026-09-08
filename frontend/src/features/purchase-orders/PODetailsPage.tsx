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
  Clock
} from "lucide-react";

// Public 13-state timeline sequence per §backend §31 and §Part C §10
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

  // Fetch initial PO data
  const { data: po, isLoading, error, refetch } = useQuery<PurchaseOrder>({
    queryKey: ["po", id],
    queryFn: async () => {
      const res = await apiClient.get<PurchaseOrder>(`/pos/${id}`);
      return res.data;
    },
    enabled: !!id
  });

  // Polling hook with progressive backoff per §Part C §10
  const { status: liveStatus, refetch: pollRefetch } = usePOStatus(id, po?.status);

  // Fetch all human reviews tied to this PO
  const { data: reviewsData } = useQuery<{ data: HumanReview[] }>({
    queryKey: ["reviews", { poId: id }],
    queryFn: async () => {
      const res = await apiClient.get<{ data: HumanReview[] }>(`/reviews?search=${id}`);
      return res.data;
    },
    enabled: !!id
  });

  // Fetch audit trail for this PO
  const { data: auditData } = useQuery<{ data: AuditLogItem[] }>({
    queryKey: ["audit", id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: AuditLogItem[] }>(`/audit/${id}`);
      return res.data;
    },
    enabled: !!id
  });

  // Manual retry mutation (only enabled when status === 'FAILED' per §C10)
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

  // Determine timeline progress index
  const currentStepIdx = WORKFLOW_STEPS.indexOf(currentStatus);

  return (
    <div className="space-y-8">
      {/* Header with Title, Status & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-slate-900 font-mono tracking-tight">
              {po.poNumber}
            </h1>
            <StatusBadge status={currentStatus} />
          </div>
          <p className="text-xs text-slate-500">
            Received {formatDate(po.createdAt, true)} • S3 Asset Key: {po.documentName || "document.pdf"}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {isFailed && (
            <button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${retryMutation.isPending ? "animate-spin" : ""}`} />
              <span>Retry Workflow</span>
            </button>
          )}

          {po.documentUrl && (
            <a
              href={po.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Original Document</span>
            </a>
          )}
        </div>
      </div>

      {/* Failure Alert Banner if Failed */}
      {isFailed && po.failureReason && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <div>
              <span className="font-bold">Workflow Failed: </span>
              <span>{po.failureReason}</span>
            </div>
          </div>
          <button
            onClick={() => retryMutation.mutate()}
            className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-semibold rounded"
          >
            Retry Now
          </button>
        </div>
      )}

      {/* Public 13-State Workflow Timeline (§Part C §10) */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Agentic AI Pipeline Status
        </h3>

        <div className="overflow-x-auto pb-2">
          <div className="flex items-center min-w-max space-x-2">
            {WORKFLOW_STEPS.map((step, idx) => {
              const isPast = currentStepIdx > idx;
              const isCurrent = currentStatus === step;
              const isRejected = currentStatus === "REJECTED" && idx === 7;

              let circleColor = "bg-slate-200 text-slate-500 border-slate-300";
              if (isPast) circleColor = "bg-emerald-500 text-white border-emerald-600";
              if (isCurrent) circleColor = "bg-blue-600 text-white border-blue-700 ring-2 ring-blue-200";
              if (isRejected) circleColor = "bg-red-600 text-white border-red-700";

              return (
                <div key={step} className="flex items-center">
                  <div className="flex flex-col items-center space-y-1.5 px-2">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition ${circleColor}`}
                    >
                      {isPast ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                    </div>
                    <span
                      className={`text-[10px] font-medium uppercase tracking-tight text-center max-w-[80px] ${
                        isCurrent ? "text-blue-700 font-bold" : "text-slate-500"
                      }`}
                    >
                      {step.replace(/_/g, " ")}
                    </span>
                  </div>
                  {idx < WORKFLOW_STEPS.length - 1 && (
                    <div
                      className={`w-8 h-0.5 ${
                        isPast ? "bg-emerald-500" : "bg-slate-200"
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <Building className="w-3.5 h-3.5" />
            <span>Customer</span>
          </div>
          <div className="text-sm font-bold text-slate-900">{po.customerName}</div>
          <div className="text-xs text-slate-400">ID: {po.customerId || "Auto-detected"}</div>
        </div>

        {/* Labeled GST Number Field (§Part C §10) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-semibold text-emerald-800">GST Number / Tax ID</span>
          </div>
          <div className="text-sm font-mono font-bold text-slate-900">
            {po.gstNumber || "Not Specified"}
          </div>
          <div className="text-xs text-slate-400">Verified for tax compliance</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <Calendar className="w-3.5 h-3.5" />
            <span>Key Dates & Terms</span>
          </div>
          <div className="text-sm font-semibold text-slate-900">
            Issue: {formatDate(po.issueDate)}
          </div>
          <div className="text-xs text-slate-500">Terms: {po.paymentTerms || "NET_30"}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <Receipt className="w-3.5 h-3.5" />
            <span>Total Financials</span>
          </div>
          <div className="text-base font-bold text-emerald-600">
            {formatCurrency(po.totalAmount, po.currency)}
          </div>
          <div className="text-xs text-slate-500">
            Subtotal: {formatCurrency(po.subtotal, po.currency)} • Tax: {formatCurrency(po.tax, po.currency)}
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 flex px-6 space-x-6 text-sm">
          <button
            onClick={() => setActiveTab("items")}
            className={`py-4 font-semibold border-b-2 transition ${
              activeTab === "items"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Extracted Line Items ({po.lineItems?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("reviews")}
            className={`py-4 font-semibold border-b-2 transition flex items-center space-x-2 ${
              activeTab === "reviews"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <span>Review Center Records</span>
            {reviews.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
                {reviews.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`py-4 font-semibold border-b-2 transition ${
              activeTab === "audit"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Agentic Audit Trail ({auditLogs.length})
          </button>
          <button
            onClick={() => setActiveTab("document")}
            className={`py-4 font-semibold border-b-2 transition ${
              activeTab === "document"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Original Document Preview
          </button>
        </div>

        <div className="p-6">
          {/* Line Items Tab */}
          {activeTab === "items" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                    <th className="py-3 px-4">Line #</th>
                    <th className="py-3 px-4">SKU / Code</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">GST Number</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4 text-right">Unit Price</th>
                    <th className="py-3 px-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {po.lineItems?.map((item) => (
                    <tr key={item.lineNumber} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-mono text-slate-500">{item.lineNumber}</td>
                      <td className="py-3.5 px-4 font-semibold font-mono text-slate-800">
                        {item.productCode}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">{item.description}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-600">
                        {item.gstNumber || po.gstNumber || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium">{item.quantity}</td>
                      <td className="py-3.5 px-4 text-right text-slate-700">
                        {formatCurrency(item.unitPrice, po.currency)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold text-slate-900">
                        {formatCurrency(item.lineTotal, po.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Human Review Records List Tab (§Part C §10 & §11.2) */}
          {activeTab === "reviews" && (
            <div className="space-y-4">
              {reviews.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No human review exceptions logged for this purchase order.
                </div>
              ) : (
                reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center space-x-3">
                        <StageBadge stage={rev.stage} />
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                            rev.status === "APPROVED"
                              ? "bg-emerald-100 text-emerald-800"
                              : rev.status === "REJECTED"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {rev.status}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          Agent: {rev.requestedByAgent}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-800">{rev.reason}</p>
                      {rev.evidence && rev.evidence.length > 0 && (
                        <div className="text-xs text-slate-500">
                          Supporting Evidence: {rev.evidence.length} RAG clauses referenced
                        </div>
                      )}
                    </div>

                    <Link
                      to={`/reviews/${rev.id}`}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold self-start md:self-center transition"
                    >
                      Open Review Inspection →
                    </Link>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Audit Logs Tab (§Part C §11.4) */}
          {activeTab === "audit" && (
            <div className="space-y-3">
              {auditLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No audit logs recorded for this entity.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-slate-500">
                      <span className="font-semibold text-slate-800">{log.agentName}</span>
                      <span className="font-mono">{formatDate(log.timestamp, true)}</span>
                    </div>
                    <div className="text-slate-700">{log.summary}</div>
                    <div className="flex items-center justify-between text-slate-400 pt-1">
                      <span>Action: <code className="font-mono">{log.action}</code></span>
                      {log.latency && <span>Latency: {log.latency}ms</span>}
                      {log.traceId && (
                        <a
                          href={`https://smith.langchain.com/trace/${log.traceId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center"
                        >
                          <span>View full trace</span>
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Document Preview Tab */}
          {activeTab === "document" && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-100 p-4">
              {po.documentUrl ? (
                <iframe
                  src={po.documentUrl}
                  title="Purchase Order PDF"
                  className="w-full h-[650px] rounded-lg border border-slate-300"
                />
              ) : (
                <div className="py-12 text-center text-slate-500 text-sm">
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
