import React from "react";
import { ReviewStage } from "../../types";

interface StageBadgeProps {
  stage: ReviewStage;
}

export const StageBadge: React.FC<StageBadgeProps> = ({ stage }) => {
  let style = "bg-slate-800/60 text-slate-300 border-slate-700/60";
  let dotColor = "bg-slate-400";
  let label: string = stage;

  switch (stage) {
    case "extraction":
      style = "bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-[0_0_12px_-2px_rgba(245,158,11,0.25)]";
      dotColor = "bg-amber-400";
      label = "Extraction Stage";
      break;
    case "validation":
      style = "bg-purple-500/15 text-purple-300 border-purple-500/30 shadow-[0_0_12px_-2px_rgba(168,85,247,0.25)]";
      dotColor = "bg-purple-400";
      label = "Validation Stage";
      break;
    case "invoice":
      style = "bg-cyan-500/15 text-cyan-300 border-cyan-500/30 shadow-[0_0_12px_-2px_rgba(6,182,212,0.25)]";
      dotColor = "bg-cyan-400";
      label = "Invoice Verification Stage";
      break;
  }

  return (
    <span
      className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border backdrop-blur-md ${style}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
      <span>{label}</span>
    </span>
  );
};
