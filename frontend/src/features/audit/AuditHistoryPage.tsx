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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2.5 rounded-xl bg-obsidian-card/60 hover:bg-obsidian-card-hover border border-white/10 text-slate-400 hover:text-white transition shadow-glass backdrop-blur-md"
          title="Go back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span>Audit Trail</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Immutable, bounded ledger of autonomous agent actions, models, latencies, and token usages (§B24)
          </p>
        </div>
      </div>

      {/* Target Entity Search */}
      <div className="glass-card p-4 rounded-2xl flex flex-wrap items-center gap-3 shadow-glass">
        <div className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider text-slate-400">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Target Entity ID:</span>
        </div>
        <input
          type="text"
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          placeholder="Enter PO ID, Invoice ID, or Contract ID..."
          className="px-3.5 py-2 bg-obsidian-card/60 border border-white/10 rounded-xl text-xs text-white font-mono w-72 focus:outline-none focus:border-emerald-500/50 transition backdrop-blur-md"
        />
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-obsidian-base rounded-xl text-xs font-bold shadow-neon-emerald transition-all duration-200 active:scale-[0.98]"
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
              className="glass-card p-5 rounded-2xl relative overflow-hidden group space-y-3 hover:border-white/20 transition-all duration-200"
            >
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-white/10 pb-3">
                <div className="flex items-center space-x-3">
                  <span className="font-bold text-sm text-white font-mono">{log.agentName}</span>
                  <span className="font-mono text-xs px-2.5 py-0.5 rounded-lg bg-white/5 text-slate-300 border border-white/10">
                    {log.action}
                  </span>
                  <span
                    className={`text-[10px] font-bold font-mono px-2.5 py-0.5 rounded-full uppercase ${
                      log.status === "SUCCESS"
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                        : log.status === "EXCEPTION"
                        ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                        : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                    }`}
                  >
                    {log.status}
                  </span>
                </div>

                <div className="text-xs text-slate-400 font-mono">
                  {formatDate(log.timestamp, true)}
                </div>
              </div>

              <p className="text-xs text-slate-200 leading-relaxed">{log.summary}</p>

              {/* Bounded Metadata Strip per §Part C §11.4 */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 pt-3 border-t border-white/5 font-mono">
                <div className="flex items-center space-x-4">
                  {log.model && (
                    <span>
                      Model: <strong className="text-slate-200">{log.model}</strong>
                    </span>
                  )}
                  {log.latency && (
                    <span>
                      Latency: <strong className="text-emerald-400">{log.latency}ms</strong>
                    </span>
                  )}
                  {log.tokenUsage && (
                    <span>
                      Tokens:{" "}
                      <strong className="text-purple-300">
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
                    className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors inline-flex items-center space-x-1.5 hover:underline"
                  >
                    <span>View full trace</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-slate-400">Workflow ID: {log.workflowId}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
