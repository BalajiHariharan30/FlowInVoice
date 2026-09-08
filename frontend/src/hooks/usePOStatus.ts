import { useState, useEffect, useRef, useCallback } from "react";
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

const BACKOFF_SCHEDULE = [2000, 4000, 8000, 15000, 30000];

export function usePOStatus(poId: string | undefined, initialStatus?: POStatus) {
  const [statusData, setStatusData] = useState<POStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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

      // Terminal states where polling halts entirely
      if (
        data.status === "COMPLETED" ||
        data.status === "FAILED" ||
        data.status === "REJECTED"
      ) {
        return;
      }

      // On HUMAN_REVIEW, stop aggressive polling
      if (data.status === "HUMAN_REVIEW") {
        return;
      }

      // Schedule next polling attempt with progressive backoff capped at 30s
      const delay = BACKOFF_SCHEDULE[backoffIndexRef.current] || 30000;
      backoffIndexRef.current = Math.min(
        backoffIndexRef.current + 1,
        BACKOFF_SCHEDULE.length - 1
      );

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
  }, [poId]);

  useEffect(() => {
    isMountedRef.current = true;
    backoffIndexRef.current = 0;

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
