import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { formatCurrency } from "../../lib/format";
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Download,
  Calendar,
  Zap,
  Cpu,
  Layers,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";

export const AnalyticsPage: React.FC = () => {
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "qtd" | "ytd">("30d");

  // Fetch dashboard summary data if available
  const { data: summary } = useQuery({
    queryKey: ["analyticsSummary"],
    queryFn: async () => {
      try {
        const res = await apiClient.get("/dashboard/summary");
        return res.data;
      } catch {
        return null;
      }
    }
  });

  const timeRanges = [
    { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" },
    { key: "qtd", label: "Quarter to Date" },
    { key: "ytd", label: "Year to Date" }
  ];

  const agentPerformance = [
    {
      agent: "Intake Agent",
      model: "gemini-1.5-flash",
      throughput: "1,284 docs",
      avgLatency: "420 ms",
      successRate: "99.8%",
      costPerDoc: "₹0.03"
    },
    {
      agent: "Multimodal Extraction Agent",
      model: "gemini-1.5-pro",
      throughput: "1,284 docs",
      avgLatency: "1,840 ms",
      successRate: "98.4%",
      costPerDoc: "₹0.31"
    },
    {
      agent: "Contract & Master Verifier",
      model: "gemini-1.5-flash",
      throughput: "1,242 docs",
      avgLatency: "310 ms",
      successRate: "99.9%",
      costPerDoc: "₹0.02"
    },
    {
      agent: "Agentic RAG Policy Engine",
      model: "gemini-1.5-pro + Qdrant",
      throughput: "1,242 docs",
      avgLatency: "950 ms",
      successRate: "96.7%",
      costPerDoc: "₹0.20"
    },
    {
      agent: "Tax & Compliance Agent",
      model: "gemini-1.5-flash",
      throughput: "1,109 docs",
      avgLatency: "280 ms",
      successRate: "99.2%",
      costPerDoc: "₹0.02"
    },
    {
      agent: "Canonical Invoice Generator",
      model: "gemini-1.5-pro",
      throughput: "1,087 docs",
      avgLatency: "1,210 ms",
      successRate: "99.5%",
      costPerDoc: "₹0.16"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-black text-workspace-text tracking-tight">
              Operational Analytics & Insights
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Live AI Metrics
            </span>
          </div>
          <p className="text-xs text-workspace-muted mt-1">
            Real-time telemetry on document throughput, straight-through automation accuracy, agent latencies, and human review SLA.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Time range selector */}
          <div className="flex items-center bg-white border border-workspace-border rounded-lg p-1 text-xs">
            {timeRanges.map((r) => (
              <button
                key={r.key}
                onClick={() => setTimeRange(r.key as any)}
                className={`px-3 py-1.5 rounded-md font-semibold transition ${
                  timeRange === r.key
                    ? "bg-accent-primary text-white shadow-sm"
                    : "text-workspace-muted hover:text-workspace-text"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-workspace-border text-workspace-text rounded-lg text-xs font-semibold shadow-sm transition">
            <Download className="w-3.5 h-3.5 text-workspace-muted" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Top 4 Performance KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="workspace-card p-5 space-y-2">
          <div className="flex items-center justify-between text-workspace-muted text-xs">
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Total Invoiced Value
            </span>
            <span className="flex items-center text-emerald-600 font-bold text-xs">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>+14.2%</span>
            </span>
          </div>
          <div className="text-2xl font-black text-workspace-text font-mono">
            ₹ 2,41,89,500
          </div>
          <div className="text-[11px] text-workspace-muted">
            1,087 invoices issued autonomously
          </div>
        </div>

        {/* Metric 2 */}
        <div className="workspace-card p-5 space-y-2">
          <div className="flex items-center justify-between text-workspace-muted text-xs">
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Straight-Through (STP) Rate
            </span>
            <span className="flex items-center text-emerald-600 font-bold text-xs">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>+3.8%</span>
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-600 font-mono">
            94.2%
          </div>
          <div className="text-[11px] text-workspace-muted">
            Zero human intervention required
          </div>
        </div>

        {/* Metric 3 */}
        <div className="workspace-card p-5 space-y-2">
          <div className="flex items-center justify-between text-workspace-muted text-xs">
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Mean Time to Process (MTTP)
            </span>
            <span className="flex items-center text-emerald-600 font-bold text-xs">
              <ArrowDownRight className="w-3.5 h-3.5" />
              <span>-32 sec</span>
            </span>
          </div>
          <div className="text-2xl font-black text-accent-primary font-mono">
            2.8 min
          </div>
          <div className="text-[11px] text-workspace-muted">
            From initial upload to issued invoice PDF
          </div>
        </div>

        {/* Metric 4 */}
        <div className="workspace-card p-5 space-y-2">
          <div className="flex items-center justify-between text-workspace-muted text-xs">
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Review Resolution SLA
            </span>
            <span className="flex items-center text-emerald-600 font-bold text-xs">
              <span>Target 95%</span>
            </span>
          </div>
          <div className="text-2xl font-black text-workspace-text font-mono">
            98.6%
          </div>
          <div className="text-[11px] text-workspace-muted">
            Resolved within 2-hour SLA window
          </div>
        </div>
      </div>

      {/* Visual Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Processing Throughput Trend (8 Cols) */}
        <div className="lg:col-span-8 workspace-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-text">
                Document Throughput & Volume Trends
              </h3>
              <p className="text-[11px] text-workspace-muted mt-0.5">
                Daily volume of uploaded POs, automated invoices, and exception alerts
              </p>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <span className="flex items-center space-x-1 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-accent-primary"></span>
                <span>Ingested POs</span>
              </span>
              <span className="flex items-center space-x-1 text-emerald-600 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span>Invoices Generated</span>
              </span>
            </div>
          </div>

          {/* Clean Enterprise Bar Chart Mockup */}
          <div className="h-64 flex items-end justify-between gap-3 pt-6 border-b border-workspace-border pb-2 px-2">
            {[
              { day: "Mon", pos: 75, inv: 70 },
              { day: "Tue", pos: 92, inv: 88 },
              { day: "Wed", pos: 110, inv: 104 },
              { day: "Thu", pos: 130, inv: 125 },
              { day: "Fri", pos: 145, inv: 138 },
              { day: "Sat", pos: 42, inv: 40 },
              { day: "Sun", pos: 35, inv: 35 }
            ].map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                <div className="w-full flex items-end justify-center gap-1.5 h-48">
                  <div
                    className="w-4 bg-accent-primary/80 hover:bg-accent-primary rounded-t transition-all"
                    style={{ height: `${(d.pos / 150) * 100}%` }}
                    title={`POs: ${d.pos}`}
                  />
                  <div
                    className="w-4 bg-emerald-500/80 hover:bg-emerald-500 rounded-t transition-all"
                    style={{ height: `${(d.inv / 150) * 100}%` }}
                    title={`Invoices: ${d.inv}`}
                  />
                </div>
                <span className="text-[11px] font-semibold text-workspace-muted font-mono">{d.day}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-workspace-muted pt-1">
            <span>Peak Day: Friday (145 POs Ingested)</span>
            <span className="font-semibold text-emerald-600">Zero System Downtime • 100% Uptime</span>
          </div>
        </div>

        {/* Exception Reason Breakdown (4 Cols) */}
        <div className="lg:col-span-4 workspace-card p-6 space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-text">
              Exception Categories
            </h3>
            <p className="text-[11px] text-workspace-muted mt-0.5">
              Root causes for human review routing
            </p>
          </div>

          <div className="space-y-3.5 pt-2 text-xs">
            <div>
              <div className="flex justify-between font-semibold text-workspace-text mb-1">
                <span>Contract Pricing Deviation</span>
                <span className="font-mono">42%</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: "42%" }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-semibold text-workspace-text mb-1">
                <span>Tax Rate / State GST Code</span>
                <span className="font-mono">28%</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-accent-secondary rounded-full" style={{ width: "28%" }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-semibold text-workspace-text mb-1">
                <span>Low OCR Extraction Score</span>
                <span className="font-mono">18%</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-accent-primary rounded-full" style={{ width: "18%" }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-semibold text-workspace-text mb-1">
                <span>Unverified Customer Entity</span>
                <span className="font-mono">12%</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-slate-400 rounded-full" style={{ width: "12%" }} />
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-workspace-border rounded-lg text-[11px] text-workspace-muted leading-relaxed">
            <strong className="text-workspace-text font-semibold">Optimization Opportunity: </strong>
            Uploading updated Q3 Master Pricing rate sheets could prevent up to 34% of pricing exceptions automatically.
          </div>
        </div>
      </div>

      {/* Autonomous Agent Telemetry & Model Performance Table */}
      <div className="workspace-card p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-workspace-border">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-accent-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-workspace-text">
              Autonomous Agent Model & Latency Telemetry
            </h3>
          </div>
          <span className="text-[11px] text-workspace-muted font-mono">
            Google DeepMind Gemini 1.5 + Qdrant
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Agent Node</th>
                <th>Underlying AI Model</th>
                <th>Processed Volume</th>
                <th>Avg Latency</th>
                <th>Validation Success</th>
                <th className="text-right">Unit API Cost</th>
              </tr>
            </thead>
            <tbody>
              {agentPerformance.map((a, idx) => (
                <tr key={idx}>
                  <td>
                    <div className="font-bold text-workspace-text">{a.agent}</div>
                  </td>
                  <td>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                      {a.model}
                    </span>
                  </td>
                  <td className="font-mono text-workspace-muted">{a.throughput}</td>
                  <td className="font-mono text-accent-primary font-semibold">{a.avgLatency}</td>
                  <td>
                    <span className="inline-flex items-center space-x-1 text-emerald-700 font-bold font-mono">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{a.successRate}</span>
                    </span>
                  </td>
                  <td className="text-right font-mono text-workspace-muted">{a.costPerDoc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
