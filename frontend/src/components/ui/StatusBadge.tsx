import React from "react";
import { POStatus, InvoiceStatus } from "../../types";

interface StatusBadgeProps {
  status: POStatus | InvoiceStatus | string;
  size?: "sm" | "md";
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = "md" }) => {
  let badgeStyle = "bg-slate-100 text-slate-700 border-slate-200";
  let dotStyle = "bg-slate-500";
  let isPulsing = false;

  switch (status) {
    case "UPLOADED":
    case "DRAFT":
      badgeStyle = "bg-slate-100 text-slate-700 border-slate-200";
      dotStyle = "bg-slate-400";
      break;
    case "PROCESSING":
    case "GENERATING":
    case "INVOICE_GENERATING":
      badgeStyle = "bg-blue-50 text-accent-primary border-accent-border";
      dotStyle = "bg-accent-primary";
      isPulsing = true;
      break;
    case "EXTRACTED":
      badgeStyle = "bg-sky-50 text-sky-800 border-sky-200";
      dotStyle = "bg-sky-500";
      break;
    case "VALIDATING":
    case "INVOICE_VALIDATING":
      badgeStyle = "bg-indigo-50 text-indigo-800 border-indigo-200";
      dotStyle = "bg-indigo-600";
      isPulsing = true;
      break;
    case "RAG_CHECKING":
      badgeStyle = "bg-purple-50 text-purple-800 border-purple-200";
      dotStyle = "bg-purple-600";
      isPulsing = true;
      break;
    case "COMPLIANCE_CHECKING":
      badgeStyle = "bg-amber-50 text-amber-800 border-amber-200";
      dotStyle = "bg-amber-500";
      isPulsing = true;
      break;
    case "HUMAN_REVIEW":
      badgeStyle = "bg-amber-50 text-amber-900 border-amber-300 font-semibold";
      dotStyle = "bg-amber-600";
      isPulsing = true;
      break;
    case "APPROVED":
    case "ISSUED":
    case "COMPLETED":
      badgeStyle = "bg-emerald-50 text-emerald-800 border-emerald-200";
      dotStyle = "bg-emerald-600";
      break;
    case "FAILED":
    case "REJECTED":
    case "CANCELLED":
      badgeStyle = "bg-rose-50 text-rose-800 border-rose-200";
      dotStyle = "bg-rose-600";
      break;
  }

  const padding = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`inline-flex items-center space-x-1.5 rounded-full font-medium tracking-tight border transition-colors ${padding} ${badgeStyle}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isPulsing && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotStyle}`}
          ></span>
        )}
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dotStyle}`}></span>
      </span>
      <span>{status.replace(/_/g, " ")}</span>
    </span>
  );
};
