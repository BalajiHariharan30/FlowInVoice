import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { AuditLogItem } from "../../types";
import { formatDate } from "../../lib/format";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import { ShieldCheck, Search, ExternalLink, Activity, ArrowLeft } from "lucide-react";

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
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Audit Trail</h1>
          <p className="text-sm text-slate-500 mt-1">
            Immutable, bounded ledger of autonomous agent actions, models, latencies, and token usages (§B24)
          </p>
        </div>
      </div>

      {/* Target Entity Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-3">
        <Activity className="w-4 h-4 text-slate-400" />
        <span className="text-xs font-semibold uppercase text-slate-500">Inspecting Entity ID:</span>
        <input
          type="text"
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          placeholder="Enter PO ID, Invoice ID, or Contract ID..."
          className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 font-mono w-72 focus:outline-none focus:border-emerald-500"
        />
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition"
        >
          Query Trail
        </button>
      </div>

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
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-3">
                  <span className="font-bold text-sm text-slate-900">{log.agentName}</span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {log.action}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      log.status === "SUCCESS"
                        ? "bg-emerald-100 text-emerald-800"
                        : log.status === "EXCEPTION"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {log.status}
                  </span>
                </div>

                <div className="text-xs text-slate-400 font-mono">
                  {formatDate(log.timestamp, true)}
                </div>
              </div>

              <p className="text-sm text-slate-800">{log.summary}</p>

              {/* Bounded Metadata Strip per §Part C §11.4 */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 pt-2 border-t border-slate-50">
                <div className="flex items-center space-x-4">
                  {log.model && (
                    <span>
                      Model: <strong className="text-slate-700 font-mono">{log.model}</strong>
                    </span>
                  )}
                  {log.latency && (
                    <span>
                      Latency: <strong className="text-slate-700 font-mono">{log.latency}ms</strong>
                    </span>
                  )}
                  {log.tokenUsage && (
                    <span>
                      Tokens:{" "}
                      <strong className="text-slate-700 font-mono">
                        {log.tokenUsage.totalTokens || 0}
                      </strong>
                    </span>
                  )}
                </div>

                {/* External Trace Link (§Part C §11.4) */}
                {log.traceId ? (
                  <a
                    href={`https://smith.langchain.com/trace/${log.traceId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 font-semibold hover:underline inline-flex items-center space-x-1"
                  >
                    <span>View full trace</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-slate-400 font-mono">Workflow ID: {log.workflowId}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
