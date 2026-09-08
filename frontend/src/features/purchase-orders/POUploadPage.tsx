import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowLeft,
  ShieldCheck,
  Lock,
  Sparkles,
  RefreshCw
} from "lucide-react";

export const POUploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "received" | "processing">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileSelect = (selectedFile: File) => {
    setErrorMessage(null);
    const validTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    const isPdf = selectedFile.name.toLowerCase().endsWith(".pdf");
    const isImage = /\.(png|jpe?g)$/i.test(selectedFile.name);

    if (!validTypes.includes(selectedFile.type) && !isPdf && !isImage) {
      setErrorMessage("Supported formats: PDF, PNG, JPG");
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
    setUploadStatus("uploading");
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
        setUploadStatus("received");
        setTimeout(() => {
          setUploadStatus("processing");
          setTimeout(() => {
            const { poId } = response.data;
            navigate(`/pos/${poId}`);
          }, 800);
        }, 600);
      }
    } catch (err: any) {
      if (err.name === "CanceledError" || err.code === "ERR_CANCELED") {
        setErrorMessage("Upload cancelled");
      } else {
        setErrorMessage(err.message || "Failed to upload purchase order");
      }
      setUploadStatus("idle");
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
    setUploadStatus("idle");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => navigate("/pos")}
          className="p-1.5 rounded-lg border border-workspace-border hover:bg-workspace-hover text-workspace-muted hover:text-workspace-text transition shadow-subtle"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-workspace-text tracking-tight">Upload Purchase Order</h1>
          <p className="text-xs text-workspace-muted mt-0.5">
            Ingest customer PO document for automated extraction, deterministic validation, and invoice generation
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-semantic-error-bg border border-semantic-error-border text-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-semantic-error flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => handleUpload()}
            className="flex items-center space-x-1 font-semibold text-semantic-error hover:underline ml-3"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Main Upload Card */}
      <div className="workspace-card p-6 space-y-5">
        {/* Interactive Dropzone (§13) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("file-input")?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer ${
            isDragging
              ? "border-accent-primary bg-accent-subtle/50"
              : file
              ? "border-accent-border bg-accent-subtle/30"
              : "border-workspace-border hover:border-accent-border bg-workspace-subtle hover:bg-white"
          }`}
        >
          <input
            id="file-input"
            type="file"
            accept=".pdf,image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
              }
            }}
          />

          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-white border border-workspace-border flex items-center justify-center text-accent-primary shadow-subtle">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-workspace-text">
                Drop your Purchase Order here
              </p>
              <p className="text-xs text-workspace-muted mt-1">
                or click to browse files from your computer
              </p>
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-workspace-muted font-mono pt-1">
              <span>Supported: PDF, PNG, JPG</span>
              <span>•</span>
              <span>Max file size: 25 MB</span>
            </div>
          </div>
        </div>

        {/* Selected File Card */}
        {file && (
          <div className="p-3.5 rounded-xl bg-workspace-subtle border border-workspace-border flex items-center justify-between">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-white border border-workspace-border flex items-center justify-center text-accent-primary shadow-subtle flex-shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-workspace-text truncate">{file.name}</div>
                <div className="text-[11px] text-workspace-muted font-mono">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.type || "PDF Document"}
                </div>
              </div>
            </div>

            {!isUploading && uploadStatus === "idle" && (
              <button
                onClick={() => setFile(null)}
                className="p-1.5 text-workspace-muted hover:text-workspace-text rounded-md hover:bg-white transition"
                title="Remove file"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Upload Status / Progress Indicator (§13) */}
        {(isUploading || uploadStatus !== "idle") && (
          <div className="space-y-2 p-3.5 bg-workspace-subtle rounded-xl border border-workspace-border">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center space-x-1.5 font-medium text-workspace-text">
                {uploadStatus === "uploading" && (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
                    <span>Uploading document...</span>
                  </>
                )}
                {uploadStatus === "received" && (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-semantic-success" />
                    <span className="text-semantic-success font-semibold">PO received</span>
                  </>
                )}
                {uploadStatus === "processing" && (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-accent-primary animate-spin" />
                    <span className="text-accent-primary font-semibold">AI processing started...</span>
                  </>
                )}
              </span>
              <span className="font-mono font-bold text-accent-primary">{uploadProgress}%</span>
            </div>

            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-accent-primary h-full transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>

            {uploadStatus === "uploading" && (
              <div className="flex justify-end pt-1">
                <button onClick={handleCancel} className="text-[11px] text-workspace-muted hover:text-semantic-error">
                  Cancel upload
                </button>
              </div>
            )}
          </div>
        )}

        {/* Security Trust Indicator (§42) */}
        <div className="p-3 rounded-lg bg-white border border-workspace-border flex items-center justify-between text-[11px] text-workspace-muted font-mono">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-3.5 h-3.5 text-semantic-success" />
            <span>256-bit TLS encryption</span>
          </div>
          <div className="flex items-center space-x-2">
            <Lock className="w-3 h-3 text-slate-400" />
            <span>Isolated tenant storage</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex justify-end space-x-2.5 border-t border-workspace-border">
          <button
            type="button"
            onClick={() => navigate("/pos")}
            disabled={isUploading}
            className="px-4 py-2 border border-workspace-border rounded-lg text-xs font-semibold text-workspace-muted hover:bg-workspace-hover hover:text-workspace-text transition disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="flex items-center space-x-1.5 px-5 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-subtle transition disabled:opacity-40"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? "Uploading..." : "Start Processing"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
