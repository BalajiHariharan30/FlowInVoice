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
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Users & Roles</h1>
        <p className="text-sm text-slate-500 mt-1">
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                <th className="py-3.5 px-6">Name</th>
                <th className="py-3.5 px-6">Email Address</th>
                <th className="py-3.5 px-6">Assigned Role</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6">Member Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.data.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50 transition">
                  <td className="py-4 px-6 font-bold text-slate-900">{user.name}</td>
                  <td className="py-4 px-6 text-slate-600 font-mono text-xs">{user.email}</td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200 font-mono">
                      <Shield className="w-3 h-3 text-slate-500" />
                      <span>{user.role}</span>
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    {user.isActive ? (
                      <span className="inline-flex items-center space-x-1 text-xs text-emerald-700 font-medium">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Active</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-xs text-slate-400">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Inactive</span>
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
