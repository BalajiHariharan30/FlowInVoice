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
  ShieldCheck
} from "lucide-react";

interface PDFDocumentViewerProps {
  documentName?: string;
  documentUrl?: string;
  poNumber?: string;
  customerName?: string;
  totalPages?: number;
}

export const PDFDocumentViewer: React.FC<PDFDocumentViewerProps> = ({
  documentName = "Purchase_Order_Original.pdf",
  documentUrl,
  poNumber = "PO-2026-1042",
  customerName = "Acme Technologies",
  totalPages = 2
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showThumbnails, setShowThumbnails] = useState(false);

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
          <span className="font-semibold text-workspace-text truncate max-w-[140px] sm:max-w-[200px]" title={documentName}>
            {documentName}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-workspace-border text-workspace-muted hidden sm:inline">
            PDF • 248 KB
          </span>
        </div>

        {/* Page & Zoom Controls */}
        <div className="flex items-center space-x-1 sm:space-x-2">
          {/* Page Navigation */}
          <div className="flex items-center space-x-1 bg-white border border-workspace-border rounded-lg px-2 py-1 shadow-subtle">
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage <= 1}
              className="text-workspace-muted hover:text-workspace-text disabled:opacity-30 p-0.5"
              title="Previous Page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] text-workspace-text px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage >= totalPages}
              className="text-workspace-muted hover:text-workspace-text disabled:opacity-30 p-0.5"
              title="Next Page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

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
          <button
            onClick={() => {
              if (documentUrl) window.open(documentUrl, "_blank");
            }}
            className="p-1.5 bg-white border border-workspace-border hover:bg-workspace-hover text-workspace-muted hover:text-workspace-text rounded-lg shadow-subtle transition"
            title="Download PDF"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 bg-white border border-workspace-border hover:bg-workspace-hover text-workspace-muted hover:text-workspace-text rounded-lg shadow-subtle transition"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className="flex-1 bg-slate-100/80 p-4 sm:p-6 overflow-auto flex justify-center items-start">
        <div
          style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top center" }}
          className="transition-transform duration-150 ease-out shadow-lg bg-white border border-workspace-border rounded-lg max-w-full w-[540px] min-h-[720px] p-8 flex flex-col justify-between"
        >
          {/* Rendered Purchase Order Document Content */}
          <div className="space-y-6">
            {/* Document Header */}
            <div className="flex justify-between items-start border-b border-slate-200 pb-4">
              <div>
                <div className="font-bold text-base text-slate-900 tracking-tight">{customerName}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  128 Innovation Way, Bangalore, KA 560103
                </div>
                <div className="text-[10px] text-slate-500 font-mono">GSTIN: 29AABCS1429B1Z8</div>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-accent-primary uppercase tracking-wider font-mono">
                  PURCHASE ORDER
                </span>
                <div className="text-sm font-mono font-bold text-slate-900 mt-1">{poNumber}</div>
                <div className="text-[10px] text-slate-500 font-mono">Date: 2026-03-15</div>
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
                <div className="font-bold text-slate-700 uppercase">Ship To:</div>
                <div>Acme Logistics Hub #4</div>
                <div>Industrial Area, Peenya</div>
                <div>Bangalore, KA</div>
              </div>
            </div>

            {/* Document Line Items */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-800 uppercase tracking-wider font-mono">
                Order Items
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
                  <tr>
                    <td className="py-1.5 font-bold">SKU-892</td>
                    <td className="py-1.5">Enterprise Cloud Node Sub</td>
                    <td className="py-1.5 text-right">10</td>
                    <td className="py-1.5 text-right">₹2,000</td>
                    <td className="py-1.5 text-right font-bold">₹20,000</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-bold">SKU-441</td>
                    <td className="py-1.5">High-Throughput Vector Shard</td>
                    <td className="py-1.5 text-right">5</td>
                    <td className="py-1.5 text-right">₹15,000</td>
                    <td className="py-1.5 text-right font-bold">₹75,000</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-bold">SKU-108</td>
                    <td className="py-1.5">API Latency Guarantee SLA</td>
                    <td className="py-1.5 text-right">1</td>
                    <td className="py-1.5 text-right">₹25,000</td>
                    <td className="py-1.5 text-right font-bold">₹25,000</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-end pt-3 border-t border-slate-200">
              <div className="w-48 space-y-1 text-[10px] font-mono">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal:</span>
                  <span className="font-semibold text-slate-800">₹120,000</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>GST (18%):</span>
                  <span className="font-semibold text-slate-800">₹21,600</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200 text-xs">
                  <span>Grand Total:</span>
                  <span className="text-accent-primary">₹141,600</span>
                </div>
              </div>
            </div>
          </div>

          {/* Document Footer / Security Stamps */}
          <div className="pt-8 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400 font-mono">
            <div className="flex items-center space-x-1">
              <ShieldCheck className="w-3 h-3 text-semantic-success" />
              <span>Cryptographically Verified Ingestion</span>
            </div>
            <span>Page {currentPage} of {totalPages}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
