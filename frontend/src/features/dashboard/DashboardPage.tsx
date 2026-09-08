import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { DashboardSummary, DashboardAnalytics } from "../../types";
import { formatCurrency, formatPercent } from "../../lib/format";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  TrendingUp,
  UploadCloud,
  ArrowUpRight,
  Sparkles,
  Zap
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar
} from "recharts";

export const DashboardPage: React.FC = () => {
  const {
    data: summary,
    isLoading: isSummaryLoading,
    error: summaryError,
    refetch: refetchSummary
  } = useQuery<DashboardSummary>({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => {
      const res = await apiClient.get<DashboardSummary>("/dashboard/summary");
      return res.data;
    }
  });

  const {
    data: analytics,
    isLoading: isAnalyticsLoading,
    error: analyticsError,
    refetch: refetchAnalytics
  } = useQuery<DashboardAnalytics>({
    queryKey: ["dashboard", "analytics"],
    queryFn: async () => {
      const res = await apiClient.get<DashboardAnalytics>("/dashboard/analytics");
      return res.data;
    }
  });

  const chartData = useMemo(() => {
    if (!analytics?.volumeTrends) return [];
    return analytics.volumeTrends.map((v) => ({
      date: v.date.slice(5),
      count: v.count,
      amount: v.amount
    }));
  }, [analytics?.volumeTrends]);

  const statusBreakdownData = useMemo(() => {
    if (!analytics?.statusBreakdown) return [];
    return analytics.statusBreakdown.map((s) => ({
      status: s.status.replace(/_/g, " "),
      count: s.count
    }));
  }, [analytics?.statusBreakdown]);

  if (isSummaryLoading || isAnalyticsLoading) {
    return <LoadingSkeleton rows={6} />;
  }

  if (summaryError || analyticsError) {
    return (
      <div className="space-y-4">
        <ErrorBanner
          message={(summaryError as any)?.message || (analyticsError as any)?.message || "Failed to load dashboard"}
          code={(summaryError as any)?.code || (analyticsError as any)?.code}
          requestId={(summaryError as any)?.requestId || (analyticsError as any)?.requestId}
          onRetry={() => {
            refetchSummary();
            refetchAnalytics();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top Banner & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Mission Control</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              Live Pipeline
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time autonomous PO intake, Agentic RAG contract compliance, and invoice verification
          </p>
        </div>

        <Link
          to="/pos/upload"
          className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 hover:from-emerald-500 hover:to-teal-300 text-obsidian-950 text-xs font-bold rounded-xl shadow-neon-emerald transition-all duration-200 transform hover:-translate-y-0.5"
        >
          <UploadCloud className="w-4 h-4" />
          <span>Upload Purchase Order</span>
        </Link>
      </div>

      {/* Glammorphic KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total POs Card */}
        <div className="glass-card-hover p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-slate-500 to-transparent opacity-60"></div>
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Received</span>
            <div className="p-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-slate-300">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-white tracking-tight">
            {summary?.totalPOs ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-2 flex items-center space-x-1">
            <Zap className="w-3 h-3 text-slate-400" />
            <span>Autonomous Ingestion</span>
          </div>
        </div>

        {/* Approved POs Card */}
        <div className="glass-card-hover p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent"></div>
          <div className="flex items-center justify-between text-emerald-400/80 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Validated Commercially</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-emerald-400 tracking-tight">
            {summary?.approvedPOs ?? 0}
          </div>
          <div className="text-[11px] text-emerald-400/80 mt-2 font-medium">
            RAG & pricing compliant
          </div>
        </div>

        {/* Pending Reviews Card */}
        <div className="glass-card-hover p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent"></div>
          <div className="flex items-center justify-between text-amber-400/80 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Human Reviews</span>
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-amber-400 tracking-tight">
            {summary?.pendingReviews ?? 0}
          </div>
          <Link
            to="/reviews"
            className="text-[11px] text-amber-400 hover:text-amber-300 font-medium mt-2 inline-flex items-center space-x-1"
          >
            <span>Inspect exceptions</span>
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Total Invoiced Card */}
        <div className="glass-card-hover p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
          <div className="flex items-center justify-between text-blue-400/80 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Invoiced</span>
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-400">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-blue-300 font-mono tracking-tight">
            {formatCurrency(summary?.totalInvoicedAmount ?? 0)}
          </div>
          <div className="text-[11px] text-slate-400 mt-2 font-medium">
            Issued PDF invoices
          </div>
        </div>

        {/* Processing Accuracy Card */}
        <div className="glass-card-hover p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-purple-500 to-transparent"></div>
          <div className="flex items-center justify-between text-purple-400/80 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">OCR Precision</span>
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/25 text-purple-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-purple-300 tracking-tight">
            {formatPercent(summary?.processingAccuracy ?? 98.5)}
          </div>
          <div className="text-[11px] text-purple-400/80 mt-2 font-medium">
            Deterministic verification
          </div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PO Flow Trend Chart */}
        <div className="lg:col-span-2 glass-card p-6 relative overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">Autonomous Intake & Volume Velocity</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">PO activity and financial volume over the past 30 days</p>
            </div>
            <div className="flex items-center space-x-2 text-[11px]">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
              <span className="text-slate-300 font-medium">Daily Documents</span>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData.length > 0 ? chartData : [{ date: "Today", count: 1, amount: 1500 }]}>
                <defs>
                  <linearGradient id="glamEmerald" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(10, 15, 29, 0.9)",
                    backdropFilter: "blur(12px)",
                    borderRadius: "12px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#f8fafc",
                    fontSize: "11px",
                    boxShadow: "0 8px 32px 0 rgba(0,0,0,0.4)"
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#34d399"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#glamEmerald)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pipeline Distribution Chart */}
        <div className="glass-card p-6 relative overflow-hidden">
          <div className="mb-6">
            <h3 className="text-sm font-bold text-white tracking-wide">13-Stage Pipeline State Breakdown</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Active load across autonomous agent nodes</p>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={
                  statusBreakdownData.length > 0
                    ? statusBreakdownData
                    : [{ status: "COMPLETED", count: 1 }, { status: "PROCESSING", count: 1 }]
                }
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis dataKey="status" type="category" width={110} stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(10, 15, 29, 0.9)",
                    backdropFilter: "blur(12px)",
                    borderRadius: "12px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#f8fafc",
                    fontSize: "11px"
                  }}
                />
                <Bar dataKey="count" fill="#38bdf8" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
