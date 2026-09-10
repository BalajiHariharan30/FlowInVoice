import React, { useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Download,
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
  RotateCw,
  ShieldCheck,
  Eye
} from "lucide-react";
import { PurchaseOrder } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";

interface PDFDocumentViewerProps {
  documentName?: string;
  documentUrl?: string;
  poNumber?: string;
  customerName?: string;
  totalPages?: number;
  po?: PurchaseOrder;
  poId?: string;
}

export const PDFDocumentViewer: React.FC<PDFDocumentViewerProps> = ({
  documentName = "Purchase_Order_Original.pdf",
  documentUrl,
  poNumber = "PO-2026-1042",
  customerName = "Acme Technologies",
  totalPages = 1,
  po,
  poId
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"extracted" | "raw">(documentUrl ? "raw" : "extracted");

  // Reset page, zoom, and auto-switch to raw when a real document file is loaded
  React.useEffect(() => {
    setCurrentPage(1);
    setZoomLevel(100);
    if (documentUrl) {
      setViewMode("raw");
    }
  }, [documentUrl, poId, poNumber]);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 15, 180));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 15, 60));
  const handleFitWidth = () => setZoomLevel(100);

  return (
    <div
      className={`workspace-card flex flex-col overflow-hidden bg-white ${
        isFullscreen ? "fixed inset-4 z-50 shadow-2xl" : "h-full min-h-[640px]"
      }`}
    >
      {/* Top Toolbar */}
      <div className="bg-workspace-subtle border-b border-workspace-border px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
        {/* Document Info */}
        <div className="flex items-center space-x-2 min-w-0">
          <FileText className="w-4 h-4 text-accent-primary flex-shrink-0" />
          <span className="font-semibold text-workspace-text truncate max-w-[130px] sm:max-w-[180px]" title={documentName}>
            {documentName}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-workspace-border text-workspace-muted hidden sm:inline">
            {documentName.split(".").pop()?.toUpperCase()} • Verified
          </span>
        </div>

        {/* View Mode Switcher: Extracted vs Raw */}
        <div className="flex items-center bg-white border border-workspace-border rounded-lg p-0.5 shadow-subtle">
          <button
            onClick={() => setViewMode("extracted")}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold transition ${
              viewMode === "extracted"
                ? "bg-accent-primary text-white shadow-xs"
                : "text-workspace-muted hover:text-workspace-text"
            }`}
            title="View Extracted Ingestion Layout"
          >
            <FileText className="w-3 h-3" />
            <span>Extracted</span>
          </button>
          {documentUrl && (
            <button
              onClick={() => setViewMode("raw")}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                viewMode === "raw"
                  ? "bg-accent-primary text-white shadow-xs"
                  : "text-workspace-muted hover:text-workspace-text"
              }`}
              title="View Raw Uploaded Document File"
            >
              <Eye className="w-3 h-3" />
              <span>Original File</span>
            </button>
          )}
        </div>

        {/* Page & Zoom Controls */}
        <div className="flex items-center space-x-1 sm:space-x-2">
          {/* Zoom Buttons */}
          <div className="hidden sm:flex items-center space-x-1 bg-white border border-workspace-border rounded-lg px-1.5 py-1 shadow-subtle">
            <button
              onClick={handleZoomOut}
              className="p-0.5 text-workspace-muted hover:text-workspace-text rounded"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleFitWidth}
              className="font-mono text-[10px] text-workspace-muted hover:text-workspace-text px-1"
              title="Fit to Width"
            >
              {zoomLevel}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-0.5 text-workspace-muted hover:text-workspace-text rounded"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Download & Fullscreen */}
          {documentUrl && (
            <button
              onClick={() => window.open(documentUrl, "_blank")}
              className="p-1.5 bg-white border border-workspace-border hover:bg-workspace-hover text-workspace-muted hover:text-workspace-text rounded-lg shadow-subtle transition"
              title="Download Document"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 bg-white border border-workspace-border hover:bg-workspace-hover text-workspace-muted hover:text-workspace-text rounded-lg shadow-subtle transition"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      {viewMode === "raw" && documentUrl ? (
        <div className="flex-1 bg-slate-100 p-2 overflow-auto flex justify-center items-center h-full">
          {documentName?.toLowerCase().endsWith(".pdf") ? (
            <iframe
              key={documentUrl || po?.id || poId || poNumber}
              src={documentUrl}
              title={documentName}
              className="w-full h-full min-h-[680px] rounded-lg border border-workspace-border bg-white shadow"
            />
          ) : (
            <img
              key={documentUrl || po?.id || poId || poNumber}
              src={documentUrl}
              alt={documentName}
              width={800}
              height={1000}
              className="max-w-full max-h-full object-contain rounded-lg shadow border border-workspace-border"
            />
          )}

        </div>
      ) : (
        <div className="flex-1 bg-slate-100/80 p-4 sm:p-6 overflow-auto flex justify-center items-start">
          <div
            style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top center" }}
            className="transition-transform duration-150 ease-out shadow-lg bg-white border border-workspace-border rounded-lg max-w-full w-[540px] min-h-[720px] p-8 flex flex-col justify-between"
          >
            {/* Rendered Purchase Order Document Content from Ingested PO */}
            <div className="space-y-6">
              {/* Document Header */}
              <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                <div>
                  <div className="font-bold text-base text-slate-900 tracking-tight">
                    {po?.customerName || customerName}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {po?.customerId ? `Customer Account: ${po.customerId}` : "Customer Ingestion Verified"}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    GSTIN: {po?.gstNumber || "29AABCS1429B1Z8"}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-accent-primary uppercase tracking-wider font-mono">
                    PURCHASE ORDER
                  </span>
                  <div className="text-sm font-mono font-bold text-slate-900 mt-1">
                    {po?.poNumber || poNumber}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Date: {po?.issueDate ? formatDate(po.issueDate) : (po?.createdAt ? formatDate(po.createdAt) : "2026-03-15")}
                  </div>
                </div>
              </div>

              {/* Vendor & Shipping */}
              <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono">
                <div>
                  <div className="font-bold text-slate-700 uppercase">Vendor:</div>
                  <div>FlowInvoice AI Enterprise Services</div>
                  <div>Tech Park, Whitefield</div>
                  <div>Karnataka, India</div>
                </div>
                <div>
                  <div className="font-bold text-slate-700 uppercase">Ship / Bill To:</div>
                  <div className="font-semibold text-slate-800">{po?.customerName || customerName}</div>
                  <div>Terms: {po?.paymentTerms || "NET_30"}</div>
                  <div>Currency: {po?.currency || "INR"}</div>
                </div>
              </div>

              {/* Document Line Items */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-800 uppercase tracking-wider font-mono flex justify-between">
                  <span>Order Items ({po?.lineItems?.length || 0})</span>
                  <span className="text-slate-500 text-[10px] font-normal">
                    Currency: {po?.currency || "INR"}
                  </span>
                </div>
                <table className="w-full text-left text-[10px] border-collapse font-mono">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-slate-500 uppercase">
                      <th className="py-1">Item</th>
                      <th className="py-1">Description</th>
                      <th className="py-1 text-right">Qty</th>
                      <th className="py-1 text-right">Unit Price</th>
                      <th className="py-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {po?.lineItems && po.lineItems.length > 0 ? (
                      po.lineItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 font-bold text-slate-900">{item.productCode || `SKU-${idx + 1}`}</td>
                          <td className="py-1.5 max-w-[150px] truncate" title={item.description}>
                            {item.description}
                          </td>
                          <td className="py-1.5 text-right font-semibold">{item.quantity}</td>
                          <td className="py-1.5 text-right">{formatCurrency(item.unitPrice, po?.currency)}</td>
                          <td className="py-1.5 text-right font-bold text-slate-900">
                            {formatCurrency(item.lineTotal, po?.currency)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 font-sans text-xs">
                          Line items pending extraction for {documentName}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              <div className="flex justify-end pt-3 border-t border-slate-200">
                <div className="w-56 space-y-1 text-[10px] font-mono">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal:</span>
                    <span className="font-semibold text-slate-800">
                      {formatCurrency(
                        po?.subtotal || (po?.totalAmount ? Math.round(po.totalAmount / 1.18) : 0),
                        po?.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>GST (18%):</span>
                    <span className="font-semibold text-slate-800">
                      {formatCurrency(
                        po?.tax || (po?.totalAmount ? Math.round(po.totalAmount - po.totalAmount / 1.18) : 0),
                        po?.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200 text-xs">
                    <span>Grand Total:</span>
                    <span className="text-accent-primary">
                      {formatCurrency(po?.totalAmount || 0, po?.currency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Document Footer / Security Stamps */}
            <div className="pt-8 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400 font-mono">
              <div className="flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3 text-semantic-success" />
                <span>Ingestion Source: {documentName}</span>
              </div>
              <span>Page {currentPage} of {totalPages}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
