import { useEffect, useRef } from "react";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
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

const TERMINAL_STATES: POStatus[] = ["COMPLETED", "FAILED", "REJECTED", "HUMAN_REVIEW"];

export function usePOStatus(poId: string | undefined, initialStatus?: POStatus) {
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<POStatus | undefined>(initialStatus);

  const query = useQuery({
    queryKey: ["po-status", poId],
    queryFn: async () => {
      const res = await apiClient.get<POStatusResponse>(`/pos/${poId}/status`);
      return res.data;
    },
    enabled: !!poId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status && TERMINAL_STATES.includes(status)) {
        return false;
      }
      return 3000;
    },
    placeholderData: keepPreviousData
  });

  // When status changes, invalidate full PO queries so detail views update
  useEffect(() => {
    const currentStatus = query.data?.status;
    if (currentStatus && prevStatusRef.current !== currentStatus) {
      prevStatusRef.current = currentStatus;
      queryClient.invalidateQueries({ queryKey: ["po", poId] });
      queryClient.invalidateQueries({ queryKey: ["pos"] });
    }
  }, [query.data?.status, poId, queryClient]);

  return {
    status: query.data?.status || initialStatus,
    data: query.data || null,
    // isPending is true ONLY on initial load without cache; never true during polling!
    isLoading: query.isPending,
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? (query.error as any).message || "Failed to poll status" : null,
    refetch: query.refetch
  };
}

