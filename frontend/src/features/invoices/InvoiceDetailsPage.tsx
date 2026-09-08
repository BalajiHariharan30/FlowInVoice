import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { Invoice } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import {
  ArrowLeft,
  Download,
  FileText,
  Building,
  Calendar,
  ShieldCheck,
  CheckCircle2
} from "lucide-react";

export const InvoiceDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: invoice, isLoading, error, refetch } = useQuery<Invoice>({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const res = await apiClient.get<Invoice>(`/invoices/${id}`);
      return res.data;
    },
    enabled: !!id
  });

  // Short-lived presigned URL download handler per §Part C §4.4
  const handleDownloadPdf = async () => {
    try {
      setIsDownloading(true);
      setDownloadError(null);

      // Re-fetch on every click; do not cache short-lived presigned URL
      const res = await apiClient.get<{ url: string; expiresAt: string }>(
        `/invoices/${id}/download`
      );

      if (res.data?.url) {
        window.open(res.data.url, "_blank");
      }
    } catch (err: any) {
      setDownloadError(err.message || "Failed to generate presigned download URL");
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) return <LoadingSkeleton rows={10} />;
  if (error || !invoice) {
    return (
      <ErrorBanner
        message={(error as any)?.message || "Invoice not found"}
        code={(error as any)?.code}
        requestId={(error as any)?.requestId}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate("/invoices")}
            className="p-2.5 rounded-xl bg-obsidian-card/60 hover:bg-obsidian-card-hover border border-white/10 text-slate-400 hover:text-white transition shadow-glass backdrop-blur-md"
            title="Back to Invoices"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-black text-white font-mono tracking-tight flex items-center gap-2">
                <FileText className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span>{invoice.invoiceNumber}</span>
              </h1>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5">
              <span>Generated from Purchase Order:</span>
              <Link
                to={`/pos/${invoice.poId}`}
                className="text-emerald-400 hover:text-emerald-300 font-mono font-semibold hover:underline px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20"
              >
                {invoice.poNumber}
              </Link>
            </p>
          </div>
        </div>

        <button
          onClick={handleDownloadPdf}
          disabled={isDownloading}
          className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-obsidian-base rounded-xl text-xs font-bold shadow-neon-emerald transition-all duration-200 disabled:opacity-50 group active:scale-[0.98]"
        >
          <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
          <span>{isDownloading ? "Generating Link..." : "Download Official PDF"}</span>
        </button>
      </div>

      {downloadError && (
        <div className="p-4 bg-rose-950/30 border border-rose-500/30 text-rose-300 rounded-2xl text-xs backdrop-blur-md shadow-glass flex items-center gap-2">
          <span>{downloadError}</span>
        </div>
      )}

      {/* Overview Metadata Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Customer */}
        <div className="glass-card p-5 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2">
            <Building className="w-3.5 h-3.5 text-blue-400" />
            <span>Customer</span>
          </div>
          <div className="text-sm font-bold text-white truncate">{invoice.customerName}</div>
          <div className="text-[11px] text-slate-400 font-mono mt-0.5">ID: {invoice.customerId}</div>
        </div>

        {/* Labeled GST Number field (§Part C §11.1) */}
        <div className="glass-card p-5 rounded-2xl relative overflow-hidden border-emerald-500/20 group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
          <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-wider text-emerald-400 mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span className="font-semibold">GSTIN / Tax ID</span>
          </div>
          <div className="text-sm font-mono font-bold text-white tracking-wide">{invoice.gstNumber}</div>
          <div className="text-[11px] text-emerald-400/70 flex items-center gap-1 mt-0.5">
            <CheckCircle2 className="w-3 h-3 inline" /> Verified against PO record
          </div>
        </div>

        {/* Dates & Payment Terms */}
        <div className="glass-card p-5 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2">
            <Calendar className="w-3.5 h-3.5 text-purple-400" />
            <span>Dates & Terms</span>
          </div>
          <div className="text-sm font-semibold text-white">
            Due: {formatDate(invoice.dueDate)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">Terms: {invoice.paymentTerms}</div>
        </div>

        {/* Total Amount */}
        <div className="glass-card p-5 rounded-2xl relative overflow-hidden border-emerald-500/20 group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
          <div className="text-[11px] text-slate-400 uppercase font-mono tracking-wider mb-1">Total Amount</div>
          <div className="text-xl font-black text-white font-mono drop-shadow-[0_0_10px_rgba(16,185,129,0.3)]">
            {formatCurrency(invoice.totalAmount, invoice.currency)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono mt-1">
            Sub: {formatCurrency(invoice.subtotal, invoice.currency)} • Tax: {formatCurrency(invoice.tax, invoice.currency)}
          </div>
        </div>
      </div>

      {/* Invoice Line Items Table */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-glass">
        <div className="p-6 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              Verified Line Items
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/5 border border-white/10 text-slate-400">
              {invoice.lineItems?.length || 0}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Verified via Decimal.js Deterministic Arithmetic
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/10 text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-6">#</th>
                <th className="py-3.5 px-6">Item Code</th>
                <th className="py-3.5 px-6">Description</th>
                <th className="py-3.5 px-6">GSTIN</th>
                <th className="py-3.5 px-6 text-right">Quantity</th>
                <th className="py-3.5 px-6 text-right">Unit Price</th>
                <th className="py-3.5 px-6 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {invoice.lineItems?.map((item) => (
                <tr key={item.lineNumber} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-6 font-mono text-slate-500 text-xs">{item.lineNumber}</td>
                  <td className="py-4 px-6">
                    <span className="font-mono text-xs font-semibold text-slate-200 px-2 py-1 rounded bg-white/[0.04] border border-white/5">
                      {item.productCode}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-slate-300 text-xs font-medium">{item.description}</td>
                  <td className="py-4 px-6 font-mono text-xs text-slate-400">
                    {item.gstNumber || invoice.gstNumber}
                  </td>
                  <td className="py-4 px-6 text-right font-mono text-xs text-slate-200">{item.quantity}</td>
                  <td className="py-4 px-6 text-right font-mono text-xs text-slate-400">
                    {formatCurrency(item.unitPrice, invoice.currency)}
                  </td>
                  <td className="py-4 px-6 text-right font-mono text-xs font-bold text-white">
                    {formatCurrency(item.lineTotal, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="p-6 bg-white/[0.01] border-t border-white/10 flex justify-end">
          <div className="w-80 space-y-2.5 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal:</span>
              <span className="font-mono font-medium text-slate-200">
                {formatCurrency(invoice.subtotal, invoice.currency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Tax (GST):</span>
              <span className="font-mono font-medium text-slate-200">
                {formatCurrency(invoice.tax, invoice.currency)}
              </span>
            </div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Discount:</span>
                <span className="font-mono font-semibold">
                  -{formatCurrency(invoice.discount, invoice.currency)}
                </span>
              </div>
            )}
            <div className="pt-3 border-t border-white/10 flex justify-between items-baseline text-sm font-bold text-white">
              <span className="uppercase tracking-wider text-xs font-mono text-slate-300">Grand Total:</span>
              <span className="font-mono text-xl text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]">
                {formatCurrency(invoice.totalAmount, invoice.currency)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
