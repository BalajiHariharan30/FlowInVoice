import React from "react";
import { ReviewStage } from "../../types";

interface StageBadgeProps {
  stage: ReviewStage;
}

export const StageBadge: React.FC<StageBadgeProps> = ({ stage }) => {
  let color = "bg-slate-100 text-slate-700 border-slate-300";
  let label: string = stage;

  switch (stage) {
    case "extraction":
      color = "bg-amber-100 text-amber-900 border-amber-300";
      label = "Extraction Stage";
      break;
    case "validation":
      color = "bg-purple-100 text-purple-900 border-purple-300";
      label = "Validation Stage";
      break;
    case "invoice":
      color = "bg-blue-100 text-blue-900 border-blue-300";
      label = "Invoice Verification Stage";
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${color}`}
    >
      {label}
    </span>
  );
};
