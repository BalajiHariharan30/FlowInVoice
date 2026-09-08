import React from "react";
import { POStatus, InvoiceStatus } from "../../types";

interface StatusBadgeProps {
  status: POStatus | InvoiceStatus | string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  let colorClasses = "bg-slate-100 text-slate-800 border-slate-300";

  switch (status) {
    case "UPLOADED":
    case "DRAFT":
      colorClasses = "bg-slate-100 text-slate-700 border-slate-300";
      break;
    case "PROCESSING":
    case "GENERATING":
    case "INVOICE_GENERATING":
      colorClasses = "bg-blue-50 text-blue-700 border-blue-200 animate-pulse";
      break;
    case "EXTRACTED":
      colorClasses = "bg-cyan-50 text-cyan-700 border-cyan-200";
      break;
    case "VALIDATING":
    case "INVOICE_VALIDATING":
      colorClasses = "bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse";
      break;
    case "RAG_CHECKING":
      colorClasses = "bg-purple-50 text-purple-700 border-purple-200";
      break;
    case "COMPLIANCE_CHECKING":
      colorClasses = "bg-amber-50 text-amber-700 border-amber-200";
      break;
    case "HUMAN_REVIEW":
      colorClasses = "bg-orange-50 text-orange-700 border-orange-300 font-semibold";
      break;
    case "APPROVED":
      colorClasses = "bg-emerald-50 text-emerald-700 border-emerald-300";
      break;
    case "ISSUED":
    case "COMPLETED":
      colorClasses = "bg-green-100 text-green-800 border-green-300 font-medium";
      break;
    case "FAILED":
    case "REJECTED":
    case "CANCELLED":
      colorClasses = "bg-red-50 text-red-700 border-red-300 font-medium";
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border uppercase tracking-wider ${colorClasses}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
};
