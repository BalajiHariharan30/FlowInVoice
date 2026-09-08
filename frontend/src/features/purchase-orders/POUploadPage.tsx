import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, X, ArrowLeft, Sparkles } from "lucide-react";

export const POUploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileSelect = (selectedFile: File) => {
    setErrorMessage(null);
    const validTypes = ["application/pdf", "image/png", "image/jpeg", "image/tiff"];
    if (!validTypes.includes(selectedFile.type) && !selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setErrorMessage("Please upload a PDF document or standard image (PNG, JPEG, TIFF)");
      return;
    }

    if (selectedFile.size > 25 * 1024 * 1024) {
      setErrorMessage("File size exceeds 25 MB maximum limit");
      return;
    }

    setFile(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);

    abortControllerRef.current = new AbortController();

    try {
      const response = await apiClient.post("/pos", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        signal: abortControllerRef.current.signal,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percent);
          }
        }
      });

      if (response.status === 202 || response.status === 200) {
        const { poId } = response.data;
        navigate(`/pos/${poId}`);
      }
    } catch (err: any) {
      if (err.name === "CanceledError" || err.code === "ERR_CANCELED") {
        setErrorMessage("Upload cancelled");
      } else {
        setErrorMessage(err.message || "Failed to upload purchase order");
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsUploading(false);
    setUploadProgress(0);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => navigate("/pos")}
          className="p-2 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.05] transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Intake Purchase Order</h1>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Submit customer PO for automatic OCR extraction, math verification, and contract RAG validation
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 flex items-center space-x-3 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Glammorphic Card */}
      <div className="glass-card p-8 space-y-6">
        {/* Interactive Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("file-input")?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer overflow-hidden ${
            isDragging
              ? "border-emerald-400 bg-emerald-500/10 shadow-neon-emerald"
              : file
              ? "border-emerald-500/40 bg-emerald-950/20"
              : "border-white/10 hover:border-emerald-500/30 bg-slate-950/40 hover:bg-slate-900/40"
          }`}
        >
          <input
            id="file-input"
            type="file"
            accept=".pdf,image/png,image/jpeg,image/tiff"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
              }
            }}
          />

          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-neon-emerald">
              <UploadCloud className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">
                Click to browse or drop your purchase order here
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Accepts PDF, Scanned TIFF, PNG, JPEG up to 25 MB
              </p>
            </div>
          </div>
        </div>

        {/* Selected File Pill */}
        {file && (
          <div className="p-4 rounded-xl bg-slate-950/50 border border-white/10 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-100">{file.name}</div>
                <div className="text-[11px] text-slate-400">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.type || "PDF Document"}
                </div>
              </div>
            </div>

            {!isUploading && (
              <button
                onClick={() => setFile(null)}
                className="p-1.5 text-slate-400 hover:text-rose-300 rounded-lg hover:bg-rose-500/10 transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Shimmer Progress Meter */}
        {isUploading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Uploading to isolated tenant S3 vault...</span>
              </span>
              <span className="font-mono font-bold text-emerald-400">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-950/60 h-2.5 rounded-full overflow-hidden border border-white/10">
              <div
                className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-full transition-all duration-200 shadow-neon-emerald"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={handleCancel}
                className="text-[11px] text-rose-400 hover:underline"
              >
                Cancel ingestion
              </button>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="pt-2 flex justify-end space-x-3 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => navigate("/pos")}
            disabled={isUploading}
            className="px-4 py-2.5 border border-white/10 rounded-xl text-xs font-semibold text-slate-300 hover:bg-white/[0.04] transition disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="flex items-center space-x-2 px-6 py-2.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 hover:from-emerald-500 hover:to-teal-300 text-obsidian-950 rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-40 shadow-neon-emerald"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? "Ingesting Document..." : "Launch Autonomous Pipeline"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
