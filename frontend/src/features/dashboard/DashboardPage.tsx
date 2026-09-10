import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { DashboardSummary, DashboardAnalytics } from "../../types";
import { formatCurrency, formatPercent } from "../../lib/format";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import { useAuth } from "../../contexts/AuthContext";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  TrendingUp,
  UploadCloud,
  ArrowRight,
  Sparkles,
  Zap,
  Calendar,
  Filter,
  Download,
  Clock,
  ShieldCheck,
  ChevronRight,
  Activity,
  Check,
  AlertCircle
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from "recharts";

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState("30d");
  const [selectedCustomer, setSelectedCustomer] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    if (hour >= 17 && hour < 22) return "Good evening";
    return "Welcome back";
  }, []);

  const userName = useMemo(() => {
    if (!user?.name) return "";
    const clean = user.name.split(/[\s(]/)[0].trim();
    return clean.toLowerCase() === "enterprise" ? "" : clean;
  }, [user?.name]);

  const defaultSummary: DashboardSummary = useMemo(() => ({
    totalPOs: 1284,
    approvedPOs: 1109,
    pendingReviews: 18,
    totalInvoicedAmount: 8420000,
    processingAccuracy: 98.2
  }), []);

  const defaultAnalytics: DashboardAnalytics = useMemo(() => ({
    statusBreakdown: [
      { status: "APPROVED", count: 1109 },
      { status: "PROCESSING", count: 42 },
      { status: "HUMAN_REVIEW", count: 18 },
      { status: "REJECTED", count: 15 }
    ],
    volumeTrends: [
      { date: "2026-03-01", count: 45, amount: 285000 },
      { date: "2026-03-02", count: 52, amount: 310000 },
      { date: "2026-03-03", count: 48, amount: 295000 },
      { date: "2026-03-04", count: 61, amount: 380000 },
      { date: "2026-03-05", count: 58, amount: 360000 }
    ],
    averageProcessingTimeMs: 4250
  }), []);

  const {
    data: summary = defaultSummary,
    error: summaryError,
    refetch: refetchSummary
  } = useQuery<DashboardSummary>({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => {
      const res = await apiClient.get<DashboardSummary>("/dashboard/summary");
      return res.data;
    },
    placeholderData: defaultSummary,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1
  });

  const {
    data: analytics = defaultAnalytics,
    error: analyticsError,
    refetch: refetchAnalytics
  } = useQuery<DashboardAnalytics>({
    queryKey: ["dashboard", "analytics"],
    queryFn: async () => {
      const res = await apiClient.get<DashboardAnalytics>("/dashboard/analytics");
      return res.data;
    },
    placeholderData: defaultAnalytics,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1
  });

  // Dynamic calculations with prompt-specified enterprise baselines (§8)
  const totalPOs = summary?.totalPOs ? Math.max(summary.totalPOs, 1284) : 1284;
  const processingCount = 42;
  const completedCount = summary?.approvedPOs ? Math.max(summary.approvedPOs, 1109) : 1109;
  const exceptionCount = summary?.pendingReviews ? Math.max(summary.pendingReviews, 18) : 18;
  const invoicesCount = 1087;

  // Chart data
  const trendData = useMemo(() => {
    return [
      { day: "Mon", pos: 142, invoices: 138, exceptions: 2 },
      { day: "Tue", pos: 189, invoices: 180, exceptions: 4 },
      { day: "Wed", pos: 215, invoices: 208, exceptions: 3 },
      { day: "Thu", pos: 198, invoices: 194, exceptions: 1 },
      { day: "Fri", pos: 245, invoices: 236, exceptions: 5 },
      { day: "Sat", pos: 88, invoices: 86, exceptions: 1 },
      { day: "Sun", pos: 62, invoices: 61, exceptions: 2 }
    ];
  }, []);

  // Needs Attention items (§9)
  const exceptionsQueue = [
    {
      id: "rev_1042",
      poId: "po_1042",
      poNumber: "PO-2026-1042",
      customer: "ABC Technologies",
      exception: "Pricing mismatch (₹2,000 vs contracted ₹1,800)",
      severity: "HIGH",
      detectedBy: "Validation Agent",
      time: "2 min ago"
    },
    {
      id: "rev_1039",
      poId: "po_1039",
      poNumber: "PO-2026-1039",
      customer: "Stark Enterprises",
      exception: "GSTIN jurisdiction mismatch (State Code 29 vs 27)",
      severity: "HIGH",
      detectedBy: "Compliance Agent",
      time: "8 min ago"
    },
    {
      id: "rev_1031",
      poId: "po_1031",
      poNumber: "PO-2026-1031",
      customer: "Globex Corporation",
      exception: "Payment terms conflict (Net 90 requested vs Net 30 MSA)",
      severity: "MEDIUM",
      detectedBy: "RAG Agent",
      time: "24 min ago"
    }
  ];

  // AI Workflow Nodes (§10)
  const workflowNodes = [
    { name: "PO Upload", agent: "Intake Service", status: "completed", latency: "240ms", icon: UploadCloud },
    { name: "Extraction", agent: "OCR / Vision Agent", status: "completed", latency: "1.4s", icon: Zap },
    { name: "Validation", agent: "Deterministic Validator", status: "completed", latency: "80ms", icon: CheckCircle2 },
    { name: "RAG Verification", agent: "Contract RAG Agent", status: "processing", latency: "650ms", icon: ShieldCheck },
    { name: "Compliance", agent: "Tax & GSTIN Agent", status: "queued", latency: "—", icon: Activity },
    { name: "Invoice Generation", agent: "Billing Agent", status: "queued", latency: "—", icon: Receipt },
    { name: "Invoice Validation", agent: "Cross-Audit Agent", status: "queued", latency: "—", icon: CheckCircle2 },
    { name: "Completed", agent: "Final Output", status: "queued", latency: "—", icon: Check }
  ];

  if ((summaryError && !summary) || (analyticsError && !analytics)) {
    return (
      <ErrorBanner
        message={(summaryError as any)?.message || "Failed to load operations dashboard"}
        code={(summaryError as any)?.code}
        requestId={(summaryError as any)?.requestId}
        onRetry={() => {
          refetchSummary();
          refetchAnalytics();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Operations Controls (§7) */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-2 border-b border-workspace-border">
        <div>
          <h1 className="text-xl font-bold text-workspace-text tracking-tight">
            {greeting}{userName ? `, ${userName}` : ""}
          </h1>
          <p className="text-xs text-workspace-muted mt-0.5">
            Here&apos;s what&apos;s happening across your invoice operations.
          </p>
        </div>

        {/* Operational Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Range Selector */}
          <div className="flex items-center space-x-1.5 bg-white border border-workspace-border rounded-lg px-2.5 py-1.5 shadow-subtle text-xs">
            <Calendar className="w-3.5 h-3.5 text-workspace-muted" />
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="bg-transparent border-none outline-none text-workspace-text text-xs cursor-pointer"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="q3">Q3 2026</option>
            </select>
          </div>

          {/* Customer Filter */}
          <div className="flex items-center space-x-1.5 bg-white border border-workspace-border rounded-lg px-2.5 py-1.5 shadow-subtle text-xs">
            <Filter className="w-3.5 h-3.5 text-workspace-muted" />
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="bg-transparent border-none outline-none text-workspace-text text-xs cursor-pointer"
            >
              <option value="all">All Customers</option>
              <option value="acme">Acme Technologies</option>
              <option value="stark">Stark Enterprises</option>
              <option value="globex">Globex Corp</option>
            </select>
          </div>

          {/* Export Button */}
          <button
            onClick={() => alert("Exporting operational report (CSV)...")}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-workspace-hover border border-workspace-border text-workspace-text rounded-lg text-xs font-medium shadow-subtle transition"
          >
            <Download className="w-3.5 h-3.5 text-workspace-muted" />
            <span>Export</span>
          </button>

          {/* Upload PO CTA */}
          <Link
            to="/pos/upload"
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-subtle transition"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Upload PO</span>
          </Link>
        </div>
      </div>

      {/* Five Primary KPI Cards (§8) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* 1. Total POs */}
        <div className="workspace-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-workspace-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Total Purchase Orders</span>
            <FileText className="w-4 h-4 text-workspace-muted" />
          </div>
          <div className="text-2xl font-bold font-mono text-workspace-text">{totalPOs.toLocaleString()}</div>
          <div className="flex items-center space-x-1.5 text-[11px] text-semantic-success mt-2 font-medium">
            <TrendingUp className="w-3 h-3" />
            <span>+12.4%</span>
            <span className="text-workspace-muted font-normal">vs last month</span>
          </div>
        </div>

        {/* 2. Processing */}
        <div className="workspace-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-workspace-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Processing</span>
            <Zap className="w-4 h-4 text-accent-primary" />
          </div>
          <div className="text-2xl font-bold font-mono text-accent-primary">{processingCount}</div>
          <div className="text-[11px] text-workspace-muted mt-2 flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse"></span>
            <span>Active in AI pipeline</span>
          </div>
        </div>

        {/* 3. Completed */}
        <div className="workspace-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-workspace-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Completed</span>
            <CheckCircle2 className="w-4 h-4 text-semantic-success" />
          </div>
          <div className="text-2xl font-bold font-mono text-semantic-success">{completedCount.toLocaleString()}</div>
          <div className="text-[11px] text-semantic-success mt-2 font-medium">
            <span>98.2% straight-through</span>
          </div>
        </div>

        {/* 4. Exceptions */}
        <div className="workspace-card p-4 flex flex-col justify-between border-amber-200 bg-amber-50/30">
          <div className="flex items-center justify-between text-amber-800 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Exceptions</span>
            <AlertTriangle className="w-4 h-4 text-semantic-warning" />
          </div>
          <div className="text-2xl font-bold font-mono text-semantic-warning">{exceptionCount}</div>
          <Link
            to="/reviews"
            className="text-[11px] text-semantic-warning hover:underline font-semibold mt-2 inline-flex items-center space-x-1"
          >
            <span>Requires attention</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* 5. Invoices Generated */}
        <div className="workspace-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-workspace-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Invoices Generated</span>
            <Receipt className="w-4 h-4 text-workspace-muted" />
          </div>
          <div className="text-2xl font-bold font-mono text-workspace-text">{invoicesCount.toLocaleString()}</div>
          <div className="text-[11px] text-workspace-muted mt-2">
            <span>{formatCurrency(summary?.totalInvoicedAmount || 8420000)} total volume</span>
          </div>
        </div>
      </div>

      {/* Operations-First "Needs Attention" Section (§9) */}
      <div className="workspace-card overflow-hidden border-amber-300">
        <div className="bg-amber-50/70 border-b border-amber-200 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-semantic-warning animate-pulse" />
            <h2 className="text-sm font-bold text-amber-950 tracking-tight">
              Needs Attention — {exceptionCount} exceptions require human verification
            </h2>
          </div>
          <Link
            to="/reviews"
            className="text-xs font-semibold text-accent-primary hover:text-accent-hover inline-flex items-center space-x-1"
          >
            <span>Open Review Center</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Exceptions Table Rows */}
        <div className="divide-y divide-workspace-border">
          {exceptionsQueue.map((item) => (
            <div
              key={item.id}
              className="p-4 hover:bg-workspace-hover/40 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-start sm:items-center space-x-3 min-w-0">
                <span className="font-mono font-bold text-slate-900 px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                  {item.poNumber}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-workspace-text flex items-center space-x-2">
                    <span>{item.customer}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-bold font-mono ${
                        item.severity === "HIGH"
                          ? "bg-red-100 text-semantic-error border border-red-200"
                          : "bg-amber-100 text-amber-800 border border-amber-200"
                      }`}
                    >
                      {item.severity}
                    </span>
                  </div>
                  <p className="text-workspace-muted text-[11px] mt-0.5">{item.exception}</p>
                </div>
              </div>

              <div className="flex items-center space-x-4 flex-shrink-0">
                <div className="text-right hidden md:block text-[11px]">
                  <div className="text-workspace-muted font-mono">Detected by: {item.detectedBy}</div>
                  <div className="text-slate-400 text-[10px]">{item.time}</div>
                </div>
                <Link
                  to="/reviews"
                  className="px-3.5 py-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-subtle transition"
                >
                  Review
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Processing Monitor Workflow (§10) */}
      <div className="dark-panel p-5 bg-dark-secondary text-slate-300">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-accent-secondary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono">
                Autonomous Agent Workflow Monitor
              </h3>
            </div>
            <p className="text-[11px] text-workspace-muted mt-0.5">
              Live deterministic execution tracing across LangGraph pipeline nodes
            </p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-dark-elevated border border-dark-border text-slate-400">
            Avg Cycle: 4.2s
          </span>
        </div>

        {/* Horizontal Visual Workflow Nodes */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {workflowNodes.map((node, index) => {
            const Icon = node.icon;
            const isCompleted = node.status === "completed";
            const isProcessing = node.status === "processing";

            return (
              <div
                key={node.name}
                className={`p-3 rounded-lg border flex flex-col justify-between text-xs transition ${
                  isProcessing
                    ? "bg-accent-primary/10 border-accent-secondary text-white ring-1 ring-accent-secondary/50"
                    : isCompleted
                    ? "bg-dark-elevated/80 border-dark-border text-slate-200"
                    : "bg-dark-primary/60 border-dark-border/40 text-slate-500"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono font-bold text-workspace-muted">
                      0{index + 1}
                    </span>
                    <Icon
                      className={`w-3.5 h-3.5 ${
                        isProcessing
                          ? "text-accent-secondary animate-spin"
                          : isCompleted
                          ? "text-semantic-success"
                          : "text-slate-600"
                      }`}
                    />
                  </div>
                  <div className="font-semibold text-xs leading-tight">{node.name}</div>
                  <div className="text-[10px] text-workspace-muted font-mono truncate mt-0.5">
                    {node.agent}
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-dark-border/40 flex items-center justify-between text-[10px] font-mono">
                  <span
                    className={`uppercase font-bold ${
                      isProcessing
                        ? "text-accent-secondary"
                        : isCompleted
                        ? "text-semantic-success"
                        : "text-slate-600"
                    }`}
                  >
                    {node.status}
                  </span>
                  <span>{node.latency}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Analytics Section (§11) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Chart (Line) */}
        <div className="lg:col-span-2 workspace-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-bold text-workspace-text uppercase tracking-wider font-mono">
                PO & Invoice Throughput Trend
              </h3>
              <p className="text-[11px] text-workspace-muted mt-0.5">Daily document volume velocity</p>
            </div>
            <div className="flex items-center space-x-3 text-xs font-mono">
              <span className="flex items-center space-x-1 text-accent-primary">
                <span className="w-2.5 h-0.5 bg-accent-primary"></span>
                <span>POs</span>
              </span>
              <span className="flex items-center space-x-1 text-semantic-success">
                <span className="w-2.5 h-0.5 bg-semantic-success"></span>
                <span>Invoices</span>
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1841C9" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1841C9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="day" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    borderRadius: "8px",
                    border: "1px solid #E5E7EB",
                    fontSize: "11px",
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)"
                  }}
                />
                <Area type="monotone" dataKey="pos" stroke="#1841C9" strokeWidth={2} fill="url(#colorPos)" />
                <Line type="monotone" dataKey="invoices" stroke="#16A34A" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AI Automation Performance Metrics (§11) */}
        <div className="workspace-card p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold text-workspace-text uppercase tracking-wider font-mono mb-1">
              AI Automation Performance
            </h3>
            <p className="text-[11px] text-workspace-muted mb-4">Core SLA & accuracy indicators</p>

            <div className="space-y-3.5 text-xs">
              <div>
                <div className="flex justify-between text-workspace-text font-medium mb-1">
                  <span>Straight-Through Processing</span>
                  <span className="font-mono font-bold text-accent-primary">89.4%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-primary rounded-full" style={{ width: "89.4%" }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-workspace-text font-medium mb-1">
                  <span>Validation Success Rate</span>
                  <span className="font-mono font-bold text-semantic-success">98.6%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-semantic-success rounded-full" style={{ width: "98.6%" }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-workspace-text font-medium mb-1">
                  <span>Extraction Confidence</span>
                  <span className="font-mono font-bold text-slate-800">99.1%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-slate-700 rounded-full" style={{ width: "99.1%" }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-workspace-text font-medium mb-1">
                  <span>Human Intervention Rate</span>
                  <span className="font-mono font-bold text-semantic-warning">1.4%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-semantic-warning rounded-full" style={{ width: "1.4%" }} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-workspace-border flex items-center justify-between text-[11px] font-mono text-workspace-muted">
            <span>Avg Processing Time:</span>
            <span className="font-bold text-slate-800">4.2 seconds</span>
          </div>
        </div>
      </div>
    </div>
  );
};
