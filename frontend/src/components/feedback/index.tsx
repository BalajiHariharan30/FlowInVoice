import React from "react";
import { AlertCircle, FileQuestion, RefreshCw } from "lucide-react";

export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="w-full space-y-3 p-6 workspace-card animate-pulse">
    <div className="h-6 bg-slate-200 rounded-md w-1/4"></div>
    <div className="space-y-2.5 pt-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-slate-100 rounded-md w-full"></div>
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
  <div className="flex flex-col items-center justify-center p-12 text-center workspace-card border-dashed">
    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3 border border-slate-200">
      <FileQuestion className="w-6 h-6 text-slate-500" />
    </div>
    <h3 className="text-sm font-semibold text-workspace-text">{title}</h3>
    {description && <p className="text-xs text-workspace-muted mt-1 max-w-sm">{description}</p>}
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-4 px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-subtle transition"
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
  <div className="p-4 rounded-xl bg-semantic-error-bg border border-semantic-error-border text-slate-800 flex items-start justify-between shadow-subtle">
    <div className="flex items-start space-x-3">
      <div className="p-1 rounded-lg bg-red-100 text-semantic-error mt-0.5">
        <AlertCircle className="w-4 h-4" />
      </div>
      <div>
        <h4 className="text-xs font-bold text-slate-900">
          {code ? `${code}: ` : ""}{message}
        </h4>
        {requestId && (
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
            Request ID: <span className="underline">{requestId}</span>
          </p>
        )}
      </div>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="flex items-center space-x-1 text-xs font-semibold px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 rounded-lg border border-slate-300 shadow-subtle transition"
      >
        <RefreshCw className="w-3 h-3" />
        <span>Retry</span>
      </button>
    )}
  </div>
);
