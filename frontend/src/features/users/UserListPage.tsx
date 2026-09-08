import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/axios";
import { UserItem, PaginatedResponse } from "../../types";
import { formatDate } from "../../lib/format";
import { LoadingSkeleton, EmptyState, ErrorBanner } from "../../components/feedback";
import { Users, Shield, CheckCircle, XCircle } from "lucide-react";

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
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
          <Users className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          <span>System Users & Roles</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Read-only directory of authenticated users and assigned RBAC privileges (v1)
        </p>
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
        <div className="glass-card rounded-2xl overflow-hidden shadow-glass">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/10 text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-6">Name</th>
                <th className="py-3.5 px-6">Email Address</th>
                <th className="py-3.5 px-6">Assigned Role</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6">Member Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {data.data.map((user) => (
                <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-6 font-bold text-white">{user.name}</td>
                  <td className="py-4 px-6 text-slate-400 font-mono text-xs">{user.email}</td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                      <Shield className="w-3 h-3 text-blue-400" />
                      <span>{user.role}</span>
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    {user.isActive ? (
                      <span className="inline-flex items-center space-x-1.5 text-xs text-emerald-400 font-medium">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                        <span>Active</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1.5 text-xs text-slate-500">
                        <XCircle className="w-3.5 h-3.5 text-slate-500" />
                        <span>Inactive</span>
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-xs text-slate-400 font-mono">{formatDate(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
