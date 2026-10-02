import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/axios";

interface AppConfig {
  enforceMakerChecker: boolean;
}

/**
 * Fetches feature flags from GET /api/v1/config.
 * Cached indefinitely (staleTime: Infinity) — the value only changes on redeployment.
 * Falls back to true (safe default) while loading or on error.
 */
export function useAppConfig(): AppConfig {
  const { data } = useQuery<AppConfig>({
    queryKey: ["app-config"],
    queryFn: async () => {
      const res = await apiClient.get<AppConfig>("/config");
      return res.data;
    },
    staleTime: Infinity,
    retry: 1
  });
  // Default to true (enforce) while loading — prevents a split-second flash of enabled buttons
  return { enforceMakerChecker: data?.enforceMakerChecker ?? true };
}
