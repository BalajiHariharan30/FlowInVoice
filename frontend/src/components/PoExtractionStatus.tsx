import React from "react";
import { usePOStatus } from "../hooks/usePOStatus";
import { StatusBadge } from "./ui/StatusBadge";
import { RotateCw, AlertTriangle } from "lucide-react";

export interface PoExtractionStatusProps {
  poId: string;
}

export const PoExtractionStatus: React.FC<PoExtractionStatusProps> = ({ poId }) => {
  const { data, isPending, error } = usePOStatus(poId);

  // isPending is true ONLY on the initial load — never flips to true during background polling
  if (isPending) {
    return (
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 animate-pulse space-y-2">
        <div className="h-4 w-32 bg-slate-200 rounded" />
        <div className="h-3 w-48 bg-slate-200 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
        <span>{error || "Couldn't check extraction status."}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 text-xs">
      <StatusBadge status={data?.status || "PROCESSING"} size="sm" />
      {data?.status === "PROCESSING" && (
        <span className="inline-flex items-center gap-1.5 text-slate-500 font-mono">
          <RotateCw className="h-3 w-3 animate-spin text-accent-primary" />
          <span>Extracting document...</span>
        </span>
      )}
    </div>
  );
};
