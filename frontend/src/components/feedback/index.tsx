import React from "react";
import { AlertCircle, FileQuestion, RefreshCw, Sparkles } from "lucide-react";

export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="w-full space-y-4 p-6 glass-card animate-pulse">
    <div className="h-7 bg-white/[0.06] rounded-xl w-1/4"></div>
    <div className="space-y-3 pt-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 bg-white/[0.03] rounded-xl w-full border border-white/[0.04]"></div>
      ))}
    </div>
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="flex flex-col items-center justify-center p-14 text-center glass-card border-dashed">
    <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 mb-4 shadow-glass-sm">
      <FileQuestion className="w-7 h-7 text-slate-300" />
    </div>
    <h3 className="text-base font-bold text-slate-100">{title}</h3>
    {description && <p className="text-xs text-slate-400 mt-1 max-w-sm">{description}</p>}
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-5 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white rounded-xl text-xs font-semibold shadow-neon-emerald transition-all duration-200"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const ErrorBanner: React.FC<{
  message: string;
  code?: string;
  requestId?: string;
  onRetry?: () => void;
}> = ({ message, code, requestId, onRetry }) => (
  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 backdrop-blur-xl text-rose-200 flex items-start justify-between shadow-[0_0_20px_-3px_rgba(244,63,94,0.2)]">
    <div className="flex items-start space-x-3">
      <div className="p-1 rounded-lg bg-rose-500/20 text-rose-300 mt-0.5">
        <AlertCircle className="w-4 h-4" />
      </div>
      <div>
        <h4 className="text-xs font-bold text-rose-100">
          {code ? `${code}: ` : ""}{message}
        </h4>
        {requestId && (
          <p className="text-[11px] text-rose-300/80 mt-1 font-mono">
            Trace ID: <span className="underline decoration-rose-500/40">{requestId}</span>
          </p>
        )}
      </div>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="flex items-center space-x-1.5 text-xs font-semibold px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 rounded-lg border border-rose-500/30 transition"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Retry</span>
      </button>
    )}
  </div>
);
