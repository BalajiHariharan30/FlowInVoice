import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "warning" | "error" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, "id">) => void;
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type, title, message, duration = 4000 }: Omit<Toast, "id">) => {
      const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, title, message, duration }]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, addToast: showToast, removeToast }}>
      {children}
      {/* Toast Notification Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-3.5 rounded-xl border shadow-elevated flex items-start space-x-3 transition-all transform translate-y-0 text-xs ${
              toast.type === "success"
                ? "bg-white border-semantic-success-border text-workspace-text"
                : toast.type === "warning"
                ? "bg-white border-semantic-warning-border text-workspace-text"
                : toast.type === "error"
                ? "bg-white border-semantic-error-border text-workspace-text"
                : "bg-white border-semantic-info-border text-workspace-text"
            }`}
          >
            <div className="mt-0.5 flex-shrink-0">
              {toast.type === "success" && <CheckCircle2 className="w-4 h-4 text-semantic-success" />}
              {toast.type === "warning" && <AlertTriangle className="w-4 h-4 text-semantic-warning" />}
              {toast.type === "error" && <XCircle className="w-4 h-4 text-semantic-error" />}
              {toast.type === "info" && <Info className="w-4 h-4 text-semantic-info" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-workspace-text">{toast.title}</div>
              {toast.message && <p className="text-workspace-muted mt-0.5 leading-relaxed">{toast.message}</p>}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-workspace-muted hover:text-workspace-text p-0.5 rounded transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
