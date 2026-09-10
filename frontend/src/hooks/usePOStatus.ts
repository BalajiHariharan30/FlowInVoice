import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/axios";
import { POStatus } from "../types";

export interface POStatusResponse {
  id: string;
  poNumber: string;
  status: POStatus;
  retryCount: number;
  failureReason?: string;
  updatedAt: string;
}

// How often to poll while the pipeline is actively running (ms)
const ACTIVE_POLL_INTERVAL = 3000;
// Backoff schedule for non-terminal waiting states after activity slows
const BACKOFF_SCHEDULE = [3000, 5000, 10000, 20000, 30000];

const TERMINAL_STATES: POStatus[] = ["COMPLETED", "FAILED", "REJECTED", "HUMAN_REVIEW"];

export function usePOStatus(poId: string | undefined, initialStatus?: POStatus) {
  const queryClient = useQueryClient();
  const [statusData, setStatusData] = useState<POStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const prevStatusRef = useRef<POStatus | undefined>(initialStatus);

  const backoffIndexRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const fetchStatus = useCallback(async () => {
    if (!poId) return;

    try {
      setIsLoading(true);
      const res = await apiClient.get<POStatusResponse>(`/pos/${poId}/status`);
      if (!isMountedRef.current) return;

      const data = res.data;
      setStatusData(data);
      setError(null);

      // If status changed, invalidate the full PO query so UI shows fresh extracted data
      if (prevStatusRef.current !== data.status) {
        prevStatusRef.current = data.status;
        queryClient.invalidateQueries({ queryKey: ["po", poId] });
        queryClient.invalidateQueries({ queryKey: ["pos"] });
      }

      // Terminal states: stop polling
      if (TERMINAL_STATES.includes(data.status)) {
        return;
      }

      // While actively processing, poll aggressively; otherwise back off
      const isActivelyProcessing =
        data.status === "PROCESSING" ||
        data.status === "EXTRACTED" ||
        data.status === "VALIDATING" ||
        data.status === "RAG_CHECKING" ||
        data.status === "COMPLIANCE_CHECKING" ||
        data.status === "INVOICE_GENERATING" ||
        data.status === "INVOICE_VALIDATING";

      const delay = isActivelyProcessing
        ? ACTIVE_POLL_INTERVAL
        : BACKOFF_SCHEDULE[backoffIndexRef.current] || 30000;

      if (!isActivelyProcessing) {
        backoffIndexRef.current = Math.min(
          backoffIndexRef.current + 1,
          BACKOFF_SCHEDULE.length - 1
        );
      }

      timerRef.current = setTimeout(() => {
        if (isMountedRef.current) fetchStatus();
      }, delay);
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || "Failed to poll status");
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [poId, queryClient]);

  useEffect(() => {
    isMountedRef.current = true;
    backoffIndexRef.current = 0;
    prevStatusRef.current = initialStatus;

    if (poId) {
      fetchStatus();
    }

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [poId, fetchStatus]);

  const refetch = useCallback(() => {
    backoffIndexRef.current = 0;
    fetchStatus();
  }, [fetchStatus]);

  return {
    status: statusData?.status || initialStatus,
    data: statusData,
    isLoading,
    error,
    refetch
  };
}
