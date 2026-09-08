import { useAuth } from "../contexts/AuthContext";
import { Role } from "../types";

export function usePermissions() {
  const { user } = useAuth();
  const role: Role = user?.role || "VIEWER";

  const canApproveReviews = role === "ADMIN" || role === "FINANCE" || role === "REVIEWER";
  const canUploadPOs = role === "ADMIN" || role === "OPERATIONS" || role === "FINANCE";
  const canGenerateInvoices = role === "ADMIN" || role === "FINANCE";
  const canManageContracts = role === "ADMIN" || role === "FINANCE";

  return {
    role,
    canApproveReviews,
    canUploadPOs,
    canGenerateInvoices,
    canManageContracts,
    isAdmin: role === "ADMIN"
  };
}
