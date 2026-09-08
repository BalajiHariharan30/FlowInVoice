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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate("/invoices")}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-slate-900 font-mono tracking-tight">
                {invoice.invoiceNumber}
              </h1>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Generated from Purchase Order:{" "}
              <Link to={`/pos/${invoice.poId}`} className="text-emerald-700 font-semibold hover:underline">
                {invoice.poNumber}
              </Link>
            </p>
          </div>
        </div>

        <button
          onClick={handleDownloadPdf}
          disabled={isDownloading}
          className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          <span>{isDownloading ? "Generating Link..." : "Download Official PDF"}</span>
        </button>
      </div>

      {downloadError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm">
          {downloadError}
        </div>
      )}

      {/* Overview Metadata Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <Building className="w-3.5 h-3.5" />
            <span>Customer</span>
          </div>
          <div className="text-sm font-bold text-slate-900">{invoice.customerName}</div>
          <div className="text-xs text-slate-400">ID: {invoice.customerId}</div>
        </div>

        {/* Labeled GST Number field (§Part C §11.1) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-semibold text-emerald-800">GST Number / Tax ID</span>
          </div>
          <div className="text-sm font-mono font-bold text-slate-900">{invoice.gstNumber}</div>
          <div className="text-xs text-slate-400">Verified against PO record</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <Calendar className="w-3.5 h-3.5" />
            <span>Dates & Payment Terms</span>
          </div>
          <div className="text-sm font-semibold text-slate-900">
            Due: {formatDate(invoice.dueDate)}
          </div>
          <div className="text-xs text-slate-500">Terms: {invoice.paymentTerms}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs text-slate-500 uppercase font-semibold">Total Amount</div>
          <div className="text-xl font-bold text-slate-900">
            {formatCurrency(invoice.totalAmount, invoice.currency)}
          </div>
          <div className="text-xs text-slate-500">
            Subtotal: {formatCurrency(invoice.subtotal, invoice.currency)} • Tax: {formatCurrency(invoice.tax, invoice.currency)}
          </div>
        </div>
      </div>

      {/* Invoice Line Items Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Verified Line Items ({invoice.lineItems?.length || 0})
          </h2>
          <span className="text-xs text-slate-400 font-mono">
            Verified via Decimal.js Deterministic Arithmetic
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                <th className="py-3 px-6">#</th>
                <th className="py-3 px-6">Item Code</th>
                <th className="py-3 px-6">Description</th>
                <th className="py-3 px-6">GST Number</th>
                <th className="py-3 px-6 text-right">Quantity</th>
                <th className="py-3 px-6 text-right">Unit Price</th>
                <th className="py-3 px-6 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.lineItems?.map((item) => (
                <tr key={item.lineNumber} className="hover:bg-slate-50">
                  <td className="py-3.5 px-6 font-mono text-slate-400">{item.lineNumber}</td>
                  <td className="py-3.5 px-6 font-mono font-semibold text-slate-800">
                    {item.productCode}
                  </td>
                  <td className="py-3.5 px-6 text-slate-700">{item.description}</td>
                  <td className="py-3.5 px-6 font-mono text-xs text-slate-600">
                    {item.gstNumber || invoice.gstNumber}
                  </td>
                  <td className="py-3.5 px-6 text-right font-medium">{item.quantity}</td>
                  <td className="py-3.5 px-6 text-right text-slate-700">
                    {formatCurrency(item.unitPrice, invoice.currency)}
                  </td>
                  <td className="py-3.5 px-6 text-right font-semibold text-slate-900">
                    {formatCurrency(item.lineTotal, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="p-6 bg-slate-50/50 border-t border-slate-200 flex justify-end">
          <div className="w-72 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span className="font-semibold text-slate-900 font-mono">
                {formatCurrency(invoice.subtotal, invoice.currency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax (GST):</span>
              <span className="font-semibold text-slate-900 font-mono">
                {formatCurrency(invoice.tax, invoice.currency)}
              </span>
            </div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Discount:</span>
                <span className="font-semibold font-mono">
                  -{formatCurrency(invoice.discount, invoice.currency)}
                </span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-200 flex justify-between text-base font-bold text-slate-900">
              <span>Grand Total:</span>
              <span className="font-mono text-emerald-600">
                {formatCurrency(invoice.totalAmount, invoice.currency)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
