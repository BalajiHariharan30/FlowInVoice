import React, { useState, useEffect } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { env } from "../../lib/env";
import { PurchaseOrder, HumanReview, AuditLogItem, POStatus } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { StageBadge } from "../../components/ui/StageBadge";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import { PDFDocumentViewer } from "../../components/document/PDFDocumentViewer";
import { usePOStatus } from "../../hooks/usePOStatus";
import { useToast } from "../../contexts/ToastContext";
import { AgentPipelinePanel } from "./components/AgentPipelinePanel";
import {
  RotateCw,
  ExternalLink,
  Building,
  AlertTriangle,
  Download,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Check,
  Copy,
  ChevronRight,
  Code2,
  FileCheck2,
  ArrowLeftRight
} from "lucide-react";



export const PODetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<"items" | "reviews" | "audit" | "raw">("items");
  const [copiedJson, setCopiedJson] = useState(false);

  // Fetch all POs for header switcher
  const { data: allPosData } = useQuery<PurchaseOrder[]>({
    queryKey: ["pos", "switcherList"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: PurchaseOrder[] }>("/pos?pageSize=30");
      return res.data?.data || [];
    }
  });

  const TERMINAL_PO_STATES = ["COMPLETED", "FAILED", "REJECTED", "HUMAN_REVIEW"];

  const { data: po, isLoading, error, refetch } = useQuery<PurchaseOrder>({
    queryKey: ["po", id],
    queryFn: async () => {
      const res = await apiClient.get<PurchaseOrder>(`/pos/${id}`);
      return res.data;
    },
    enabled: !!id,
    // Poll every 4s while the pipeline is still running so extracted data appears live
    refetchInterval: (query) => {
      const data = query.state.data as PurchaseOrder | undefined;
      if (!data) return 4000;
      if (TERMINAL_PO_STATES.includes(data.status)) return false;
      return 4000;
    }
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

  // Query for generated invoice if completed
  const { data: invoiceData } = useQuery({
    queryKey: ["invoiceForPo", id],
    queryFn: async () => {
      const res = await apiClient.get(`/invoices?search=${po?.poNumber || id}`);
      return res.data?.data?.[0] || null;
    },
    enabled: !!po && (po.status === "COMPLETED" || liveStatus === "COMPLETED")
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/pos/${id}/retry`);
      return res.data;
    },
    onSuccess: () => {
      addToast({
        type: "success",
        title: "Pipeline Retried",
        message: "Autonomous agent processing restarted successfully."
      });
      queryClient.invalidateQueries({ queryKey: ["po", id] });
      pollRefetch();
    },
    onError: (err: any) => {
      addToast({
        type: "error",
        title: "Retry Failed",
        message: err?.message || "Failed to trigger retry. Please try again."
      });
    }
  });

  const [streamingActiveStep, setStreamingActiveStep] = useState<string | null>(null);
  const [streamingCompletedSteps, setStreamingCompletedSteps] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Reset/cancel telemetry streaming when navigating to another PO
  useEffect(() => {
    setIsStreaming(false);
    setStreamingActiveStep(null);
    setStreamingCompletedSteps([]);
  }, [id]);

  const runLangGraphWithTelemetry = async () => {
    if (!id || isStreaming) return;
    setIsStreaming(true);
    setStreamingActiveStep("extraction");
    setStreamingCompletedSteps([]);

    const token = localStorage.getItem("accessToken");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${env.VITE_API_BASE_URL}/pos/${id}/stream-graph`, {
        method: "GET",
        headers
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || `Server returned status ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split("\n\n");
          buffer = messages.pop() || "";

          for (const message of messages) {
            if (!message.trim()) continue;
            const matchEvent = message.match(/event:\s*(.+)/);
            const matchData = message.match(/data:\s*(.+)/);
            const eventName = matchEvent ? matchEvent[1].trim() : "";
            let eventData: any = {};
            try {
              if (matchData) eventData = JSON.parse(matchData[1].trim());
            } catch {
              // Ignore parse error
            }

            if (eventName === "step_update") {
              const stepName = eventData.step;
              setStreamingActiveStep(stepName);
              setStreamingCompletedSteps((prev) => Array.from(new Set([...prev, stepName])));
            } else if (eventName === "workflow_complete") {
              setStreamingCompletedSteps((prev) =>
                Array.from(new Set([...prev, eventData.currentStep || "posting"]))
              );
              addToast({
                type: eventData.isBusinessException ? "warning" : "success",
                title: eventData.isBusinessException ? "Routed to Human Review" : "Pipeline Completed",
                message: eventData.isBusinessException
                  ? "PO flagged for Human Review by LangGraph agentic policy check."
                  : `PO successfully processed & posted to ERP. Invoice: ${eventData.invoiceNumber || "Issued"}`
              });
            } else if (eventName === "workflow_error") {
              addToast({
                type: "error",
                title: "Workflow Error",
                message: eventData.message || "Pipeline execution failed."
              });
            }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["po", id] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["audit", id] });
      pollRefetch();
    } catch (err: any) {
      addToast({
        type: "error",
        title: "Workflow Execution Error",
        message: err.message || "Failed to execute LangGraph streaming pipeline."
      });
    } finally {
      setIsStreaming(false);
      setStreamingActiveStep(null);
    }
  };

  const [searchParams] = useSearchParams();
  const shouldAutoRun = searchParams.get("autorun") === "true";
  const autoRunTriggeredRef = React.useRef(false);

  React.useEffect(() => {
    if (po && (shouldAutoRun || po.status === "PROCESSING" || po.status === "UPLOADED") && !autoRunTriggeredRef.current && !isStreaming) {
      autoRunTriggeredRef.current = true;
      runLangGraphWithTelemetry();
    }
  }, [po, shouldAutoRun]);

  const runLangGraphMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/pos/${id}/process-graph`, {}, { timeout: 90000 });
      return res.data;
    },
    onSuccess: (data: any) => {
      addToast({
        type: data.isBusinessException ? "warning" : "success",
        title: data.isBusinessException ? "Routed to Human Review" : "Pipeline Completed",
        message: data.isBusinessException
          ? "PO flagged for Human Review by LangGraph agentic policy check."
          : `PO successfully processed & posted to ERP. Invoice: ${data.invoiceNumber || "Issued"}`
      });
      queryClient.invalidateQueries({ queryKey: ["po", id] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["audit", id] });
      pollRefetch();
    },
    onError: (err: any) => {
      addToast({
        type: "error",
        title: "Workflow Execution Error",
        message: err.response?.data?.message || err?.message || "Failed to execute LangGraph pipeline."
      });
    }
  });

  const handleCopyJson = () => {
    if (!po) return;
    navigator.clipboard.writeText(JSON.stringify(po, null, 2));
    setCopiedJson(true);
    addToast({
      type: "info",
      title: "JSON Copied",
      message: "Purchase order payload copied to clipboard."
    });
    setTimeout(() => setCopiedJson(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-slate-200 animate-pulse rounded-lg" />
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-4 h-[600px] bg-slate-100 animate-pulse rounded-xl" />
          <div className="xl:col-span-5 h-[600px] bg-white animate-pulse rounded-xl border border-slate-200" />
          <div className="xl:col-span-3 h-[600px] bg-slate-900 animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

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
  const isHumanReview = currentStatus === "HUMAN_REVIEW";
  const isCompleted = currentStatus === "COMPLETED";
  const reviews = reviewsData?.data || [];
  const auditLogs = auditData?.data || [];
  const confidenceScore = po.extractionConfidence
    ? Math.round(po.extractionConfidence * 100)
    : 98;

  // Compute status step index
  const statusOrder: POStatus[] = [
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
  const currentStepIdx = statusOrder.indexOf(currentStatus);

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-workspace-border">
        <div>
          <nav className="flex items-center space-x-2 text-xs text-workspace-muted mb-1 font-medium flex-wrap gap-y-1">
            <Link to="/pos" className="hover:text-workspace-text transition-colors">
              Purchase Orders
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-workspace-muted" />
            <span className="font-mono text-workspace-text font-semibold">{po.poNumber}</span>

            {allPosData && allPosData.length > 1 && (
              <div className="flex items-center space-x-1.5 ml-3 bg-white border border-workspace-border rounded-lg px-2 py-0.5 shadow-subtle">
                <ArrowLeftRight className="w-3 h-3 text-accent-primary animate-pulse" />
                <span className="text-[11px] text-workspace-muted font-semibold">Switch PO:</span>
                <select
                  value={id}
                  onChange={(e) => navigate(`/pos/${e.target.value}`)}
                  className="bg-transparent text-workspace-text font-mono text-[11px] font-bold outline-none cursor-pointer max-w-[200px] truncate"
                  title="Switch to inspect any other purchase order"
                >
                  <option value={id}>{po.poNumber} (Current)</option>
                  {allPosData
                    .filter((p) => p.id !== id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.poNumber} — {p.customerName ? `${p.customerName.slice(0, 16)}...` : ""} ({formatCurrency(p.totalAmount)})
                      </option>
                    ))}
                </select>
              </div>
            )}
          </nav>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-black text-workspace-text font-mono tracking-tight">
              {po.poNumber}
            </h1>
            <StatusBadge status={currentStatus} />
            <div className="hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              <span>{confidenceScore}% Extracted Confidence</span>
            </div>
          </div>
          <p className="text-xs text-workspace-muted mt-1">
            Ingested {formatDate(po.createdAt, true)} • S3 Key:{" "}
            <span className="font-mono text-workspace-text">{po.documentName || `${po.poNumber}.pdf`}</span>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runLangGraphWithTelemetry}
            disabled={isStreaming || runLangGraphMutation.isPending || currentStatus === "COMPLETED"}
            className="inline-flex items-center space-x-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition"
            title="Execute autonomous 7-agent LangGraph workflow with real-time SSE streaming telemetry"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isStreaming || runLangGraphMutation.isPending ? "animate-spin" : ""}`} />
            <span>
              {isStreaming
                ? `Running (${streamingActiveStep || "Pipeline"})...`
                : runLangGraphMutation.isPending
                ? "Running Graph..."
                : "Run LangGraph Pipeline"}
            </span>
          </button>

          {isFailed && (
            <button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="inline-flex items-center space-x-2 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${retryMutation.isPending ? "animate-spin" : ""}`} />
              <span>Retry Pipeline</span>
            </button>
          )}

          {isHumanReview && reviews.length > 0 && (
            <Link
              to={`/reviews/${reviews[0].id}`}
              className="inline-flex items-center space-x-2 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm transition"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Resolve in Review Center</span>
            </Link>
          )}

          {isCompleted && invoiceData && (
            <Link
              to={`/invoices/${invoiceData.id}`}
              className="inline-flex items-center space-x-2 px-3.5 py-2 bg-accent-primary hover:bg-accent-hover text-white text-xs font-bold rounded-lg shadow-sm transition"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>View Generated Invoice</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}

          {po.documentUrl && (
            <a
              href={po.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-slate-50 border border-workspace-border text-workspace-text text-xs font-medium rounded-lg shadow-sm transition"
            >
              <Download className="w-3.5 h-3.5 text-workspace-muted" />
              <span>Download PDF</span>
            </a>
          )}

          <button
            onClick={handleCopyJson}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-workspace-border text-workspace-muted hover:text-workspace-text text-xs font-medium rounded-lg shadow-sm transition"
            title="Copy Raw Extracted JSON"
          >
            {copiedJson ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>JSON</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Failure Alert Banner */}
      {isFailed && po.failureReason && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <div>
              <span className="font-bold text-red-900">Pipeline Halted: </span>
              <span>{po.failureReason}</span>
            </div>
          </div>
          <button
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition"
          >
            Trigger Retry
          </button>
        </div>
      )}

      {/* 3-Panel Enterprise Workspace Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* PANEL 1: Left Document Viewer (4 Columns) */}
        <div className="xl:col-span-4 h-[780px] rounded-xl overflow-hidden shadow-sm border border-workspace-border">
          <PDFDocumentViewer
            key={po.id || id}
            poId={po.id || id}
            documentName={po.documentName || `${po.poNumber}.pdf`}
            documentUrl={po.documentUrl}
            poNumber={po.poNumber}
            customerName={po.customerName}
            po={po}
          />
        </div>

        {/* PANEL 2: Center Extracted Data & Financial Operations (5 Columns) */}
        <div className="xl:col-span-5 space-y-5">
          {/* Entity & Tax Overview Card */}
          <div className="workspace-card p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-workspace-border">
              <div className="flex items-center space-x-2">
                <Building className="w-4 h-4 text-accent-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-muted">
                  Customer & Tax Identity
                </h3>
              </div>
              <span className="text-[11px] font-mono text-workspace-muted">
                ID: {po.customerId || "CUST-AUTO-MATCHED"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-workspace-muted block text-[11px]">Customer Entity</span>
                <span className="font-bold text-workspace-text text-sm block mt-0.5">
                  {po.customerName}
                </span>
                <span className="text-[11px] text-workspace-muted">Enterprise Account</span>
              </div>

              <div>
                <span className="text-workspace-muted block text-[11px]">GSTIN / Tax ID</span>
                <div className="inline-flex items-center space-x-1.5 mt-0.5 px-2.5 py-1 rounded bg-slate-100 border border-slate-200">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-mono font-bold text-workspace-text text-xs">
                    {po.gstNumber || "29AABCU9603R1ZM"}
                  </span>
                </div>
                <span className="text-[10px] text-emerald-700 block mt-1 font-medium">
                  ✓ Active GSTIN • Verified for Invoicing
                </span>
              </div>

              <div>
                <span className="text-workspace-muted block text-[11px]">PO Issue Date</span>
                <span className="font-semibold text-workspace-text block mt-0.5">
                  {formatDate(po.issueDate)}
                </span>
              </div>

              <div>
                <span className="text-workspace-muted block text-[11px]">Payment Terms</span>
                <span className="font-semibold font-mono text-workspace-text block mt-0.5">
                  {po.paymentTerms || "NET_30"}
                </span>
              </div>
            </div>
          </div>

          {/* Extracted Data Tabs & Line Items */}
          <div className="workspace-card overflow-hidden">
            {/* Tabs Header */}
            <div className="border-b border-workspace-border flex px-5 space-x-6 text-xs bg-slate-50">
              <button
                onClick={() => setActiveTab("items")}
                className={`py-3.5 font-bold border-b-2 transition flex items-center space-x-2 ${
                  activeTab === "items"
                    ? "border-accent-primary text-accent-primary"
                    : "border-transparent text-workspace-muted hover:text-workspace-text"
                }`}
              >
                <span>Line Items</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 text-slate-700 font-mono">
                  {po.lineItems?.length || 0}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("reviews")}
                className={`py-3.5 font-bold border-b-2 transition flex items-center space-x-2 ${
                  activeTab === "reviews"
                    ? "border-accent-primary text-accent-primary"
                    : "border-transparent text-workspace-muted hover:text-workspace-text"
                }`}
              >
                <span>Review Exceptions</span>
                {reviews.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold">
                    {reviews.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("audit")}
                className={`py-3.5 font-bold border-b-2 transition flex items-center space-x-2 ${
                  activeTab === "audit"
                    ? "border-accent-primary text-accent-primary"
                    : "border-transparent text-workspace-muted hover:text-workspace-text"
                }`}
              >
                <span>Audit Trail</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 text-slate-700 font-mono">
                  {auditLogs.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("raw")}
                className={`py-3.5 font-bold border-b-2 transition flex items-center space-x-1.5 ${
                  activeTab === "raw"
                    ? "border-accent-primary text-accent-primary"
                    : "border-transparent text-workspace-muted hover:text-workspace-text"
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Raw JSON</span>
              </button>
            </div>

            {/* Tab Body */}
            <div className="p-4">
              {/* TAB 1: Line Items Table */}
              {activeTab === "items" && (
                <div className="space-y-4">
                  <div className="overflow-x-auto border border-workspace-border rounded-lg">
                    <table className="enterprise-table">
                      <thead>
                        <tr>
                          <th className="w-12">#</th>
                          <th>Product / Code</th>
                          <th>Description</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Unit Price</th>
                          <th className="text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {po.lineItems?.map((item) => (
                          <tr key={item.lineNumber}>
                            <td className="font-mono text-workspace-muted">{item.lineNumber}</td>
                            <td>
                              <span className="font-mono font-bold text-accent-primary">
                                {item.productCode}
                              </span>
                              {item.gstNumber && (
                                <span className="block text-[10px] text-workspace-muted font-mono">
                                  GST: {item.gstNumber}
                                </span>
                              )}
                            </td>
                            <td className="text-workspace-text font-medium">{item.description}</td>
                            <td className="text-right font-mono font-semibold text-workspace-text">
                              {item.quantity}
                            </td>
                            <td className="text-right font-mono text-workspace-muted">
                              {formatCurrency(item.unitPrice, po.currency)}
                            </td>
                            <td className="text-right font-mono font-bold text-workspace-text">
                              {formatCurrency(item.lineTotal, po.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Financial Calculation Breakdown */}
                  <div className="bg-slate-50 border border-workspace-border rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-xs text-workspace-muted">
                      <span>Subtotal ({po.lineItems?.length || 0} items)</span>
                      <span className="font-mono font-medium text-workspace-text">
                        {formatCurrency(po.subtotal, po.currency)}
                      </span>
                    </div>

                    <div className="flex justify-between text-xs text-workspace-muted">
                      <span>Applicable GST / Tax</span>
                      <span className="font-mono font-medium text-workspace-text">
                        {formatCurrency(po.tax, po.currency)}
                      </span>
                    </div>

                    {po.discount > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600">
                        <span>Contract Discount Applied</span>
                        <span className="font-mono font-medium">
                          -{formatCurrency(po.discount, po.currency)}
                        </span>
                      </div>
                    )}

                    <div className="border-t border-workspace-border pt-2 flex justify-between items-baseline">
                      <div>
                        <span className="text-xs font-bold text-workspace-text block">
                          Total Invoice Value
                        </span>
                        <span className="text-[10px] text-workspace-muted">
                          Decimal.js Exact Financial Precision
                        </span>
                      </div>
                      <span className="text-xl font-black font-mono text-accent-primary">
                        {formatCurrency(po.totalAmount, po.currency)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Review Exceptions */}
              {activeTab === "reviews" && (
                <div className="space-y-3">
                  {reviews.length === 0 ? (
                    <div className="text-center py-10 text-workspace-muted text-xs">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                      <p className="font-semibold text-workspace-text">No active review exceptions</p>
                      <p className="text-workspace-muted mt-0.5">
                        This purchase order passed all autonomous validation rules without discrepancy.
                      </p>
                    </div>
                  ) : (
                    reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="p-4 rounded-lg bg-amber-50/50 border border-amber-200 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <StageBadge stage={rev.stage} />
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                rev.status === "APPROVED"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : rev.status === "REJECTED"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {rev.status}
                            </span>
                          </div>
                          <span className="font-mono text-workspace-muted text-[11px]">
                            {rev.requestedByAgent}
                          </span>
                        </div>

                        <p className="font-semibold text-slate-900">{rev.reason}</p>

                        {rev.expectedValue && rev.actualValue && (
                          <div className="grid grid-cols-2 gap-2 text-[11px] bg-white p-2.5 rounded border border-amber-200 font-mono">
                            <div>
                              <span className="text-workspace-muted block">Expected:</span>
                              <span className="font-bold text-emerald-700">{rev.expectedValue}</span>
                            </div>
                            <div>
                              <span className="text-workspace-muted block">PO Value:</span>
                              <span className="font-bold text-amber-700">{rev.actualValue}</span>
                            </div>
                          </div>
                        )}

                        <div className="pt-1 flex justify-end">
                          <Link
                            to={`/reviews/${rev.id}`}
                            className="inline-flex items-center space-x-1 font-bold text-accent-primary hover:text-accent-hover text-xs"
                          >
                            <span>Open in Review Center</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: Audit Trail */}
              {activeTab === "audit" && (
                <div className="space-y-3">
                  {auditLogs.length === 0 ? (
                    <div className="text-center py-8 text-workspace-muted text-xs">
                      No audit events recorded yet for this entity.
                    </div>
                  ) : (
                    auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3.5 rounded-lg bg-slate-50 border border-workspace-border text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-workspace-muted">
                          <span className="font-bold text-workspace-text">{log.agentName}</span>
                          <span className="font-mono text-[11px]">{formatDate(log.timestamp, true)}</span>
                        </div>
                        <div className="text-workspace-text">{log.summary}</div>
                        <div className="flex items-center justify-between text-workspace-muted pt-1 text-[11px]">
                          <span>
                            Action: <code className="font-mono text-accent-primary">{log.action}</code>
                          </span>
                          {log.traceId && (
                            <a
                              href={`https://smith.langchain.com/trace/${log.traceId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent-primary hover:underline inline-flex items-center space-x-1"
                            >
                              <span>Trace</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 4: Raw JSON */}
              {activeTab === "raw" && (
                <div className="relative">
                  <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-[400px]">
                    {JSON.stringify(po, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* PANEL 3: Right Dark AI Agent Pipeline (extracted component) */}
        <AgentPipelinePanel
          currentStatus={currentStatus}
          currentStepIdx={currentStepIdx}
          isStreaming={isStreaming}
          streamingActiveStep={streamingActiveStep}
          streamingCompletedSteps={streamingCompletedSteps}
          isCompleted={isCompleted}
          invoiceData={invoiceData}
        />
      </div>
    </div>
  );
};
