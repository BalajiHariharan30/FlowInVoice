import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { env } from "./env";
import { ApiErrorPayload } from "../types";

export class ApiError extends Error {
  code: string;
  details: Record<string, any>;
  requestId: string;
  status?: number;

  constructor(payload: ApiErrorPayload, status?: number) {
    super(payload.message || "An unexpected error occurred");
    this.name = "ApiError";
    this.code = payload.code || "UNKNOWN_ERROR";
    this.details = payload.details || {};
    this.requestId = payload.requestId || "";
    this.status = status;
  }
}

export const apiClient = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  headers: {
    "Content-Type": "application/json"
  }
});

// Request interceptor: inject Bearer token and tenant header
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem("accessToken");
  const tenantId = localStorage.getItem("tenantId") || "tenant_default";

  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (tenantId && config.headers) {
    config.headers["x-tenant-id"] = tenantId;
  }

  return config;
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor: handle token refresh and normalize errors
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // 401 handling: attempt refresh ONCE
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (originalRequest.url?.includes("/auth/refresh") || originalRequest.url?.includes("/auth/login")) {
        return Promise.reject(normalizeError(error));
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        isRefreshing = false;
        clearAuthAndRedirect();
        return Promise.reject(normalizeError(error));
      }

      try {
        const { data } = await axios.post(`${env.VITE_API_BASE_URL}/auth/refresh`, {
          refreshToken
        });

        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        }

        processQueue(null, data.accessToken);
        return apiClient(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        clearAuthAndRedirect();
        return Promise.reject(normalizeError(refreshErr as AxiosError));
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(normalizeError(error));
  }
);

function normalizeError(error: AxiosError<any>): ApiError {
  if (error.response?.data && error.response.data.code) {
    return new ApiError(error.response.data, error.response.status);
  }

  return new ApiError(
    {
      code: error.code || "NETWORK_ERROR",
      message: error.message || "Failed to communicate with the server",
      details: {},
      requestId: (error.response?.headers?.["x-request-id"] as string) || ""
    },
    error.response?.status
  );
}

function clearAuthAndRedirect() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  if (window.location.pathname !== "/login") {
    window.location.href = "/login?expired=true";
  }
}
