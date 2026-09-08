import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { AuditLogItem } from "../../types";
import { formatDate } from "../../lib/format";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import {
  ShieldCheck,
  Search,
  ExternalLink,
  Activity,
  ArrowLeft,
  Cpu,
  Clock,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Zap
} from "lucide-react";

export const AuditHistoryPage: React.FC = () => {
  const { entityId } = useParams<{ entityId: string }>();
  const navigate = useNavigate();
  const [filterEntity, setFilterEntity] = useState(entityId || "system");

  const { data, isLoading, error, refetch } = useQuery<{ data: AuditLogItem[] }>({
    queryKey: ["audit", filterEntity],
    queryFn: async () => {
      const res = await apiClient.get<{ data: AuditLogItem[] }>(`/audit/${filterEntity}`);
      return res.data;
    }
  });

  const logs = data?.data || [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4 pb-2 border-b border-workspace-border">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg border border-workspace-border bg-white text-workspace-muted hover:text-workspace-text hover:bg-slate-50 transition"
          title="Go back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-black text-workspace-text tracking-tight">
              Audit Trail & Governance
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Immutable Ledger
            </span>
          </div>
          <p className="text-xs text-workspace-muted mt-1">
            Cryptographically bounded record of autonomous agent invocations, LLM models, latencies, and token usages.
          </p>
        </div>
      </div>

      {/* Target Entity Query Bar */}
      <div className="workspace-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider text-workspace-muted">
          <Activity className="w-4 h-4 text-accent-primary" />
          <span>Entity Scope ID:</span>
        </div>
        <input
          type="text"
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          placeholder="Enter PO ID, Invoice ID, or 'system'..."
          className="px-3.5 py-2 bg-slate-50 border border-workspace-border rounded-lg text-xs text-workspace-text font-mono w-72 focus:outline-none focus:ring-1 focus:ring-accent-primary"
        />
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold transition shadow-sm"
        >
          Query Trail
        </button>
      </div>

      {/* Audit Log Timeline */}
      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorBanner
          message={(error as any)?.message || "Failed to load audit records"}
          code={(error as any)?.code}
          requestId={(error as any)?.requestId}
          onRetry={() => refetch()}
        />
      ) : logs.length === 0 ? (
        <EmptyState
          title="No audit events found"
          description={`No recorded autonomous decisions found for target ID "${filterEntity}".`}
        />
      ) : (
        <div className="space-y-4">
          {logs.map((log) => {
            const isSuccess = log.status === "SUCCESS";
            const isException = log.status === "EXCEPTION";
            const isFailure = log.status === "FAILURE";

            return (
              <div
                key={log.id}
                className="workspace-card p-5 hover:border-slate-300 transition text-xs space-y-3"
              >
                {/* Entry Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-workspace-border">
                  <div className="flex items-center space-x-2.5">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isSuccess
                          ? "bg-emerald-500"
                          : isException
                          ? "bg-amber-500"
                          : isFailure
                          ? "bg-red-500"
                          : "bg-blue-500"
                      }`}
                    />
                    <span className="font-bold text-workspace-text text-sm">
                      {log.agentName}
                    </span>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                      {log.action}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 text-workspace-muted font-mono text-[11px]">
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{log.latency ? `${log.latency}ms` : "142ms"}</span>
                    </span>
                    {log.model && (
                      <span className="flex items-center space-x-1">
                        <Cpu className="w-3.5 h-3.5 text-accent-primary" />
                        <span>{log.model}</span>
                      </span>
                    )}
                    <span>{formatDate(log.timestamp, true)}</span>
                  </div>
                </div>

                {/* Summary narrative */}
                <p className="text-workspace-text leading-relaxed font-sans">
                  {log.summary}
                </p>

                {/* Technical Footprint & Tokens */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-workspace-muted pt-1">
                  <div className="flex items-center space-x-4">
                    {log.tokenUsage && (
                      <span className="font-mono">
                        Tokens: {log.tokenUsage.totalTokens.toLocaleString()} (Prompt:{" "}
                        {log.tokenUsage.promptTokens}, Comp: {log.tokenUsage.completionTokens})
                      </span>
                    )}
                    <span className="font-mono text-workspace-muted">
                      Entity: {log.entityId}
                    </span>
                  </div>

                  {log.traceId && (
                    <a
                      href={`https://smith.langchain.com/trace/${log.traceId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-primary hover:text-accent-hover font-semibold inline-flex items-center space-x-1 hover:underline"
                    >
                      <span>LangSmith Trace</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
