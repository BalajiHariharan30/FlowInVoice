/**
 * AgentPipelinePanel
 *
 * Right-column dark panel showing the LangGraph 7-agent pipeline progression
 * and the agentic RAG verification summary.
 *
 * All streaming state is owned by PODetailsPage and passed in as props
 * so this component stays pure / display-only.
 */
import React from "react";
import { Link } from "react-router-dom";
import { POStatus } from "../../../types";
import {
  Zap,
  Database,
  Check,
  CheckCircle2
} from "lucide-react";

export interface AgentStepDef {
  id: string;
  name: string;
  role: string;
  model: string;
  statusMatch: POStatus[];
  description: string;
}

export const AGENT_PIPELINE_STEPS: AgentStepDef[] = [
  {
    id: "extraction",
    name: "Extraction Agent",
    role: "Multimodal Structured Parsing",
    model: "gemini-1.5-pro",
    statusMatch: ["UPLOADED", "PROCESSING", "EXTRACTED"],
    description: "Line items, quantities, dates, buyer/seller entities"
  },
  {
    id: "matching",
    name: "Matching Agent",
    role: "Customer Master & SKU Resolution",
    model: "Deterministic Engine",
    statusMatch: ["VALIDATING"],
    description: "Validates customer account, billing address & SKU catalog"
  },
  {
    id: "poValidation",
    name: "PO Verification Agent",
    role: "Deterministic Math & Duplicate Check",
    model: "Decimal.js Engine",
    statusMatch: ["VALIDATING"],
    description: "Line item subtotals, tax tolerances, hash duplicate check"
  },
  {
    id: "policyEvaluation",
    name: "Agentic RAG & Policy Agent",
    role: "Qdrant Policy & Pricing Match",
    model: "gemini-1.5-pro + Qdrant",
    statusMatch: ["RAG_CHECKING", "COMPLIANCE_CHECKING"],
    description: "Retrieves rate sheets, MSA terms, volume discounts & 10% tolerance"
  },
  {
    id: "approvalDecision",
    name: "Approval Decision Agent",
    role: "Autonomous Governance Engine",
    model: "Policy Guardrails",
    statusMatch: ["APPROVED"],
    description: "Evaluates policy thresholds and flags exceptions for Human Review"
  },
  {
    id: "posting",
    name: "Posting Agent",
    role: "Canonical Invoice & Multi-ERP Posting",
    model: "ERP Connectors + PDFKit",
    statusMatch: ["INVOICE_GENERATING", "INVOICE_VALIDATING", "COMPLETED"],
    description: "Generates canonical PDF, posts voucher to ERP & completes PO"
  }
];

interface AgentPipelinePanelProps {
  currentStatus: POStatus;
  currentStepIdx: number;
  isStreaming: boolean;
  streamingActiveStep: string | null;
  streamingCompletedSteps: string[];
  isCompleted: boolean;
  invoiceData?: { id: string; invoiceNumber: string } | null;
}

export const AgentPipelinePanel: React.FC<AgentPipelinePanelProps> = ({
  currentStatus,
  currentStepIdx,
  isStreaming,
  streamingActiveStep,
  streamingCompletedSteps,
  isCompleted,
  invoiceData
}) => {
  return (
    <div className="xl:col-span-3 space-y-4">
      {/* Agent Workflow Card */}
      <div className="bg-dark-surface border border-dark-border rounded-xl p-4 text-white shadow-lg space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-dark-border">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-accent-secondary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Agentic AI Pipeline
            </h3>
          </div>
          <span className="inline-flex items-center space-x-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>Active</span>
          </span>
        </div>

        {/* Stepped Agent Progression */}
        <div className="space-y-2.5">
          {AGENT_PIPELINE_STEPS.map((step, idx) => {
            const isStepPast = isStreaming
              ? streamingCompletedSteps.includes(step.id) && streamingActiveStep !== step.id
              : currentStepIdx > idx * 2;
            const isStepActive = isStreaming
              ? streamingActiveStep === step.id
              : step.statusMatch.includes(currentStatus) ||
                (idx === 0 && currentStatus === "UPLOADED");

            return (
              <div
                key={step.id}
                className={`p-2.5 rounded-lg border transition-all text-xs ${
                  isStepActive
                    ? "bg-accent-primary/10 border-accent-secondary text-white shadow-sm"
                    : isStepPast
                    ? "bg-dark-card/60 border-dark-border text-slate-300"
                    : "bg-dark-card/30 border-dark-border/50 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {isStepPast ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : isStepActive ? (
                      <div className="w-4 h-4 rounded-full border-2 border-accent-secondary border-t-transparent animate-spin flex-shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-dark-border text-slate-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {idx + 1}
                      </div>
                    )}
                    <span className="font-bold tracking-tight text-slate-100">{step.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{step.model}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 pl-6 leading-tight">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Agentic RAG Policy & Contract Verification Panel */}
      <div className="bg-dark-surface border border-dark-border rounded-xl p-4 text-white shadow-lg space-y-3">
        <div className="flex items-center space-x-2 pb-2 border-b border-dark-border">
          <Database className="w-4 h-4 text-emerald-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Agentic RAG Verification
          </h4>
        </div>

        <div className="space-y-2 text-xs">
          <div className="p-2.5 rounded bg-dark-card border border-dark-border space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Retrieved Policy Source</span>
              <span className="font-mono text-emerald-400 font-bold">Similarity: 0.94</span>
            </div>
            <div className="font-semibold text-slate-200">
              Master Services Agreement #MSA-2024-ACME
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              Section 4.2 • Tier 1 Volume Pricing Schedule
            </div>
          </div>

          {/* Validation Checklist */}
          <div className="space-y-1.5 pt-1">
            {[
              "Contract Terms Match: Validated",
              "Pricing Tolerance: 0.00% Deviation",
              "GSTIN Validated against Master Registry",
              "Payment Terms Authorized (NET_30)"
            ].map((item) => (
              <div key={item} className="flex items-center space-x-2 text-[11px] text-emerald-400">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          {/* AI Rationale Summary */}
          <div className="p-2.5 rounded bg-slate-900/90 border border-dark-border text-[11px] text-slate-300 leading-relaxed font-sans">
            <span className="font-bold text-slate-200 block mb-0.5">Audit-Ready AI Rationale:</span>
            "All line items cross-referenced against executed MSA terms. Unit pricing aligns with
            discount bracket A-2. Interstate tax applied correctly based on supplier Karnataka registration."
          </div>
        </div>
      </div>

      {/* Pipeline Final Outcome Card */}
      {isCompleted && (
        <div className="bg-emerald-950/40 border border-emerald-700/50 rounded-xl p-4 text-emerald-200 space-y-2 text-xs">
          <div className="flex items-center space-x-2 font-bold text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Invoice Issued Successfully</span>
          </div>
          <p className="text-[11px] text-emerald-300/80">
            Purchase order verified and converted to official billing invoice.
          </p>
          {invoiceData && (
            <Link
              to={`/invoices/${invoiceData.id}`}
              className="block text-center py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition"
            >
              View Invoice #{invoiceData.invoiceNumber}
            </Link>
          )}
        </div>
      )}
    </div>
  );
};
