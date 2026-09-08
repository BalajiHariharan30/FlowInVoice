import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/axios";
import { UserItem, PaginatedResponse } from "../../types";
import { formatDate } from "../../lib/format";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import { Users, Shield, CheckCircle2, XCircle, ArrowRight } from "lucide-react";

export const UserListPage: React.FC = () => {
  const { data, isLoading, error, refetch } = useQuery<PaginatedResponse<UserItem>>({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedResponse<UserItem>>("/users");
      return res.data;
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-workspace-text tracking-tight">
            System Users & RBAC Directory
          </h1>
          <p className="text-xs text-workspace-muted mt-1">
            Directory of active users, assigned roles, and security access levels across your enterprise tenant.
          </p>
        </div>

        <Link
          to="/settings"
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold transition shadow-sm"
        >
          <span>Manage in Settings</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorBanner
          message={(error as any)?.message || "Failed to load users"}
          code={(error as any)?.code}
          requestId={(error as any)?.requestId}
          onRetry={() => refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="No users registered in tenant" />
      ) : (
        <div className="workspace-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Work Email Address</th>
                  <th>Assigned Role</th>
                  <th>Status</th>
                  <th>Member Since</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => (
                  <tr key={user.id}>
                    <td className="font-bold text-workspace-text">{user.name}</td>
                    <td className="font-mono text-xs text-workspace-muted">{user.email}</td>
                    <td>
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-slate-100 text-slate-700 border border-slate-200">
                        <Shield className="w-3 h-3 text-accent-primary" />
                        <span>{user.role}</span>
                      </span>
                    </td>
                    <td>
                      {user.isActive ? (
                        <span className="inline-flex items-center space-x-1 text-xs text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-xs text-slate-400">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Suspended</span>
                        </span>
                      )}
                    </td>
                    <td className="text-workspace-muted text-xs font-mono">{formatDate(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
