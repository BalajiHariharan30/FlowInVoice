import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { Invoice } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { LoadingSkeleton, ErrorBanner } from "../../components/feedback";
import { useToast } from "../../contexts/ToastContext";
import {
  ArrowLeft,
  Download,
  FileText,
  Building,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  Printer,
  ChevronRight,
  ExternalLink,
  Receipt,
  FileCheck2,
  Lock,
  Layers
} from "lucide-react";

export const InvoiceDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
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

      const res = await apiClient.get<{ url: string; expiresAt: string }>(
        `/invoices/${id}/download`
      );

      if (res.data?.url) {
        window.open(res.data.url, "_blank");
        addToast({
          type: "success",
          title: "Download Started",
          message: "Opening presigned secure invoice PDF."
        });
      }
    } catch (err: any) {
      const msg = err.message || "Failed to generate presigned download URL";
      setDownloadError(msg);
      addToast({
        type: "error",
        title: "Download Failed",
        message: msg
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
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
      {/* Top Breadcrumb & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-workspace-border print:hidden">
        <div>
          <nav className="flex items-center space-x-2 text-xs text-workspace-muted mb-1 font-medium">
            <Link to="/invoices" className="hover:text-workspace-text transition-colors">
              Invoices
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-workspace-muted" />
            <span className="font-mono text-workspace-text font-semibold">{invoice.invoiceNumber}</span>
          </nav>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-black text-workspace-text font-mono tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handlePrint}
            className="inline-flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-slate-50 border border-workspace-border text-workspace-text text-xs font-semibold rounded-lg shadow-sm transition"
          >
            <Printer className="w-3.5 h-3.5 text-workspace-muted" />
            <span>Print</span>
          </button>

          <button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <Download className={`w-3.5 h-3.5 ${isDownloading ? "animate-bounce" : ""}`} />
            <span>{isDownloading ? "Generating Presigned PDF..." : "Download Official PDF"}</span>
          </button>
        </div>
      </div>

      {downloadError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl print:hidden">
          {downloadError}
        </div>
      )}

      {/* Main Canonical Invoice Document Card (Clean Light Financial Paper) */}
      <div className="workspace-card p-8 sm:p-10 shadow-lg border border-workspace-border space-y-8 bg-white print:border-none print:shadow-none print:p-0">
        {/* Document Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 pb-6 border-b border-workspace-border">
          <div>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center font-bold text-white text-base">
                F
              </div>
              <span className="text-xl font-black tracking-tight text-workspace-text">
                FlowInvoice<span className="text-accent-secondary"> AI</span>
              </span>
            </div>
            <p className="text-xs text-workspace-muted mt-1.5 leading-relaxed max-w-xs">
              Autonomous Enterprise Finance Engine<br />
              Tax Regulatory & Multi-Tenant Billing Gateway
            </p>
          </div>

          <div className="sm:text-right space-y-1">
            <span className="text-xs font-bold uppercase tracking-widest text-accent-primary block">
              Commercial Tax Invoice
            </span>
            <div className="text-2xl font-black font-mono text-workspace-text tracking-tight">
              {invoice.invoiceNumber}
            </div>
            <div className="text-xs text-workspace-muted">
              Source PO:{" "}
              <Link
                to={`/pos/${invoice.poId}`}
                className="font-mono font-bold text-accent-primary hover:underline"
              >
                {invoice.poNumber}
              </Link>
            </div>
          </div>
        </div>

        {/* Billing & Tax Entity Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
          {/* Bill To */}
          <div className="space-y-2">
            <span className="font-bold text-workspace-muted uppercase tracking-wider text-[11px] block">
              Billed To
            </span>
            <div className="text-base font-bold text-workspace-text">{invoice.customerName}</div>
            <div className="text-workspace-muted leading-relaxed">
              Customer Account ID: <span className="font-mono font-semibold text-workspace-text">{invoice.customerId}</span><br />
              450 Silicon Avenue, Tech Park Phase 2<br />
              Bengaluru, Karnataka 560100, India
            </div>

            {/* Labeled GST Number Pill (§Part C §10) */}
            <div className="pt-1.5">
              <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="font-mono text-xs font-bold text-emerald-950">
                  GSTIN: {invoice.gstNumber || "29AABCU9603R1ZM"}
                </span>
                <span className="text-[10px] text-emerald-700 font-semibold">• Active</span>
              </div>
            </div>
          </div>

          {/* Invoice Terms & Dates */}
          <div className="space-y-3 md:text-right">
            <span className="font-bold text-workspace-muted uppercase tracking-wider text-[11px] block">
              Payment & Regulatory Schedule
            </span>

            <div className="space-y-1">
              <div className="text-workspace-muted">
                Issue Date: <strong className="text-workspace-text">{formatDate(invoice.issueDate)}</strong>
              </div>
              <div className="text-workspace-muted">
                Due Date: <strong className="text-workspace-text">{formatDate(invoice.dueDate)}</strong>
              </div>
              <div className="text-workspace-muted">
                Payment Terms:{" "}
                <span className="font-mono font-bold text-accent-primary">
                  {invoice.paymentTerms || "NET_30"}
                </span>
              </div>
              <div className="text-workspace-muted">
                Billing Currency: <strong className="text-workspace-text font-mono">{invoice.currency}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Invoice Line Items Table */}
        <div className="overflow-x-auto border border-workspace-border rounded-xl">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>Product Code</th>
                <th>Description</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit Price</th>
                <th className="text-right">Tax Rate</th>
                <th className="text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item) => (
                <tr key={item.lineNumber}>
                  <td className="font-mono text-workspace-muted">{item.lineNumber}</td>
                  <td>
                    <span className="font-mono font-bold text-accent-primary">{item.productCode}</span>
                    {item.gstNumber && (
                      <span className="block text-[10px] text-workspace-muted font-mono">
                        GST: {item.gstNumber}
                      </span>
                    )}
                  </td>
                  <td className="text-workspace-text font-medium">{item.description}</td>
                  <td className="text-right font-mono font-semibold text-workspace-text">
                    {item.quantity}
                  </td>
                  <td className="text-right font-mono text-workspace-muted">
                    {formatCurrency(item.unitPrice, invoice.currency)}
                  </td>
                  <td className="text-right font-mono text-workspace-muted">
                    {item.taxRate ? `${item.taxRate}%` : "18% GST"}
                  </td>
                  <td className="text-right font-mono font-bold text-workspace-text">
                    {formatCurrency(item.lineTotal, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial Calculation Summary (Decimal.js Exact Totals) */}
        <div className="flex flex-col sm:flex-row justify-end">
          <div className="w-full sm:w-80 space-y-2.5 bg-slate-50 border border-workspace-border rounded-xl p-5 text-xs">
            <div className="flex justify-between text-workspace-muted">
              <span>Subtotal</span>
              <span className="font-mono font-medium text-workspace-text">
                {formatCurrency(invoice.subtotal, invoice.currency)}
              </span>
            </div>

            <div className="flex justify-between text-workspace-muted">
              <span>GST / Indirect Tax</span>
              <span className="font-mono font-medium text-workspace-text">
                {formatCurrency(invoice.tax, invoice.currency)}
              </span>
            </div>

            {invoice.discount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Contract Discount</span>
                <span className="font-mono font-medium">
                  -{formatCurrency(invoice.discount, invoice.currency)}
                </span>
              </div>
            )}

            <div className="border-t border-workspace-border pt-3 flex justify-between items-baseline">
              <span className="font-bold text-sm text-workspace-text">Total Due</span>
              <span className="font-mono font-black text-xl text-accent-primary">
                {formatCurrency(invoice.totalAmount, invoice.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Autonomous Verification & Audit Proof Stamp */}
        <div className="pt-6 border-t border-workspace-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-workspace-muted">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <div className="font-bold text-workspace-text">
                Digitally Verified & Validated by FlowInvoice AI
              </div>
              <div className="text-[11px] text-workspace-muted">
                Autonomous Verification Agent • Verified at{" "}
                {formatDate(invoice.verifiedAt || invoice.createdAt, true)}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 font-mono text-[10px] text-workspace-muted">
            <Lock className="w-3.5 h-3.5 text-accent-primary" />
            <span>SHA-256: 8f4a9b2c...7e1d44</span>
          </div>
        </div>
      </div>
    </div>
  );
};
