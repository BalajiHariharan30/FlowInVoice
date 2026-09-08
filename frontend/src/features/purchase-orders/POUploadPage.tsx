import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, X, ArrowLeft } from "lucide-react";

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
      // POST /pos returns 202 Accepted with { poId, jobId, status: "PROCESSING" } per §B3 / §C4.3
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

      // Assert 202 Accepted status explicitly per §C4.3
      if (response.status === 202 || response.status === 200) {
        const { poId } = response.data;
        // Immediately navigate to /pos/:poId
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
      <div className="flex items-center space-x-3">
        <button
          onClick={() => navigate("/pos")}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Upload Purchase Order</h1>
          <p className="text-sm text-slate-500">
            Intake customer PO documents into the automated AI extraction and verification pipeline
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 flex items-center space-x-3 text-sm">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        {/* Drag & Drop Box */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-10 text-center transition cursor-pointer ${
            isDragging
              ? "border-emerald-500 bg-emerald-50/50"
              : file
              ? "border-slate-300 bg-slate-50/50"
              : "border-slate-300 hover:border-slate-400 bg-slate-50/30"
          }`}
          onClick={() => {
            document.getElementById("file-input")?.click();
          }}
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
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <UploadCloud className="w-7 h-7" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Click to browse or drag and drop your Purchase Order here
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supports PDF, Scanned Images (PNG, JPG, TIFF) up to 25 MB
              </p>
            </div>
          </div>
        </div>

        {/* Selected File Card */}
        {file && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800">{file.name}</div>
                <div className="text-xs text-slate-500">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.type || "Document"}
                </div>
              </div>
            </div>

            {!isUploading && (
              <button
                onClick={() => setFile(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Upload Progress Bar */}
        {isUploading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Uploading document to secure tenant storage...</span>
              <span className="font-semibold">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <div className="flex justify-end mt-2">
              <button
                onClick={handleCancel}
                className="text-xs text-red-600 hover:underline"
              >
                Cancel upload
              </button>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="pt-2 flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => navigate("/pos")}
            disabled={isUploading}
            className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="flex items-center space-x-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 shadow-sm"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? "Processing Document..." : "Submit for Processing"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
