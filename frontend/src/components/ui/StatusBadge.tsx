import React from "react";
import { POStatus, InvoiceStatus } from "../../types";

interface StatusBadgeProps {
  status: POStatus | InvoiceStatus | string;
  size?: "sm" | "md";
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = "md" }) => {
  let badgeStyle = "bg-slate-800/60 text-slate-300 border-slate-700/60";
  let dotStyle = "bg-slate-400";
  let isPulsing = false;

  switch (status) {
    case "UPLOADED":
    case "DRAFT":
      badgeStyle = "bg-slate-800/50 text-slate-400 border-slate-700/50";
      dotStyle = "bg-slate-400";
      break;
    case "PROCESSING":
    case "GENERATING":
    case "INVOICE_GENERATING":
      badgeStyle = "bg-blue-500/10 text-blue-400 border-blue-500/30 shadow-[0_0_12px_-2px_rgba(59,130,246,0.3)]";
      dotStyle = "bg-blue-400";
      isPulsing = true;
      break;
    case "EXTRACTED":
      badgeStyle = "bg-cyan-500/10 text-cyan-300 border-cyan-500/30";
      dotStyle = "bg-cyan-400";
      break;
    case "VALIDATING":
    case "INVOICE_VALIDATING":
      badgeStyle = "bg-indigo-500/10 text-indigo-300 border-indigo-500/30 shadow-[0_0_12px_-2px_rgba(99,102,241,0.3)]";
      dotStyle = "bg-indigo-400";
      isPulsing = true;
      break;
    case "RAG_CHECKING":
      badgeStyle = "bg-purple-500/10 text-purple-300 border-purple-500/30 shadow-[0_0_12px_-2px_rgba(168,85,247,0.25)]";
      dotStyle = "bg-purple-400";
      isPulsing = true;
      break;
    case "COMPLIANCE_CHECKING":
      badgeStyle = "bg-amber-500/10 text-amber-300 border-amber-500/30";
      dotStyle = "bg-amber-400";
      isPulsing = true;
      break;
    case "HUMAN_REVIEW":
      badgeStyle = "bg-orange-500/15 text-orange-300 border-orange-500/40 shadow-[0_0_16px_-2px_rgba(249,115,22,0.35)]";
      dotStyle = "bg-orange-400";
      isPulsing = true;
      break;
    case "APPROVED":
      badgeStyle = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
      dotStyle = "bg-emerald-400";
      break;
    case "ISSUED":
    case "COMPLETED":
      badgeStyle = "bg-emerald-500/20 text-emerald-300 border-emerald-400/40 shadow-[0_0_16px_-2px_rgba(16,185,129,0.3)]";
      dotStyle = "bg-emerald-400";
      break;
    case "FAILED":
    case "REJECTED":
    case "CANCELLED":
      badgeStyle = "bg-rose-500/15 text-rose-300 border-rose-500/40 shadow-[0_0_14px_-2px_rgba(244,63,94,0.3)]";
      dotStyle = "bg-rose-400";
      break;
  }

  const padding = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`inline-flex items-center space-x-1.5 rounded-full font-medium tracking-wide uppercase border backdrop-blur-md transition-all duration-200 ${padding} ${badgeStyle}`}
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
