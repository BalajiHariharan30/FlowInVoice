import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";

// Feature Pages
import { LoginPage } from "./features/auth/LoginPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { POListPage } from "./features/purchase-orders/POListPage";
import { POUploadPage } from "./features/purchase-orders/POUploadPage";
import { PODetailsPage } from "./features/purchase-orders/PODetailsPage";
import { InvoiceListPage } from "./features/invoices/InvoiceListPage";
import { InvoiceDetailsPage } from "./features/invoices/InvoiceDetailsPage";
import { ReviewListPage } from "./features/reviews/ReviewListPage";
import { ReviewDetailsPage } from "./features/reviews/ReviewDetailsPage";
import { CustomerListPage } from "./features/customers/CustomerListPage";
import { CustomerDetailsPage } from "./features/customers/CustomerDetailsPage";
import { UserListPage } from "./features/users/UserListPage";
import { AuditHistoryPage } from "./features/audit/AuditHistoryPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 1000 * 30 // 30 seconds
    }
  }
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Auth Route */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected Enterprise Routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/pos" element={<POListPage />} />
                <Route path="/pos/upload" element={<POUploadPage />} />
                <Route path="/pos/:id" element={<PODetailsPage />} />
                <Route path="/invoices" element={<InvoiceListPage />} />
                <Route path="/invoices/:id" element={<InvoiceDetailsPage />} />
                <Route path="/reviews" element={<ReviewListPage />} />
                <Route path="/reviews/:id" element={<ReviewDetailsPage />} />
                <Route path="/customers" element={<CustomerListPage />} />
                <Route path="/customers/:id" element={<CustomerDetailsPage />} />
                <Route path="/users" element={<UserListPage />} />
                <Route path="/audit/:entityId" element={<AuditHistoryPage />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
