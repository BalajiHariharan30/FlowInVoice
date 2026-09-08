import React from "react";
import { AlertCircle, FileQuestion, RefreshCw } from "lucide-react";

export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="w-full space-y-4 animate-pulse p-4">
    <div className="h-8 bg-slate-200 rounded w-1/4"></div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-12 bg-slate-100 rounded w-full"></div>
    ))}
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="flex flex-col items-center justify-center p-12 text-center bg-white rounded-lg border border-slate-200">
    <FileQuestion className="w-12 h-12 text-slate-400 mb-3" />
    <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
    {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-sm font-medium transition"
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
  <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 flex items-start justify-between">
    <div className="flex items-start space-x-3">
      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
      <div>
        <h4 className="text-sm font-bold">{code ? `${code}: ` : ""}{message}</h4>
        {requestId && (
          <p className="text-xs text-red-600 mt-1">
            Support Trace ID: <span className="font-mono">{requestId}</span>
          </p>
        )}
      </div>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="flex items-center space-x-1 text-xs font-semibold px-2.5 py-1.5 bg-red-100 hover:bg-red-200 text-red-900 rounded transition"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Retry</span>
      </button>
    )}
  </div>
);
