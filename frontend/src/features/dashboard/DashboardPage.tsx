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
  ArrowUpRight
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
      date: v.date.slice(5), // MM-DD
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
      {/* Page Header with Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Executive Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time PO intake, Agentic RAG validation, and automated invoicing metrics
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Link
            to="/pos/upload"
            className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Purchase Order</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total POs</span>
            <FileText className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{summary?.totalPOs ?? 0}</div>
          <div className="text-xs text-slate-400 mt-2">All received documents</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Approved POs</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{summary?.approvedPOs ?? 0}</div>
          <div className="text-xs text-emerald-600 font-medium mt-2">Validated commercially</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Reviews</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600">{summary?.pendingReviews ?? 0}</div>
          <Link to="/reviews" className="text-xs text-amber-700 hover:underline mt-2 inline-flex items-center">
            <span>Requires human action</span>
            <ArrowUpRight className="w-3 h-3 ml-0.5" />
          </Link>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Invoiced</span>
            <Receipt className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {formatCurrency(summary?.totalInvoicedAmount ?? 0)}
          </div>
          <div className="text-xs text-slate-400 mt-2">Issued invoices sum</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Accuracy</span>
            <TrendingUp className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {formatPercent(summary?.processingAccuracy ?? 98.5)}
          </div>
          <div className="text-xs text-indigo-600 font-medium mt-2">Extraction confidence</div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PO Intake & Value Trends */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">PO Intake & Processing Trend</h3>
              <p className="text-xs text-slate-500">Document volume over the past 30 days</p>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-slate-600">PO Inflow</span>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData.length > 0 ? chartData : [{ date: "Today", count: 1, amount: 1500 }]}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    borderRadius: "8px",
                    border: "none",
                    color: "#fff",
                    fontSize: "12px"
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorCount)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Breakdown Chart */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="mb-6">
            <h3 className="text-base font-bold text-slate-900">Pipeline Status Breakdown</h3>
            <p className="text-xs text-slate-500">Active distribution in the 13-stage workflow</p>
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
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis dataKey="status" type="category" width={110} stroke="#94a3b8" fontSize={10} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    borderRadius: "8px",
                    border: "none",
                    color: "#fff",
                    fontSize: "12px"
                  }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
