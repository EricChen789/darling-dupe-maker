import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "./components/layout/AppLayout";
import Index from "./pages/Index";
import Companies from "./pages/Companies";
import People from "./pages/People";
import Forms from "./pages/Forms";
import Invoices from "./pages/Invoices";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import FieldMapping from "./pages/FieldMapping";
import Repair from "./pages/Repair";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Index />} />
              <Route path="companies" element={<Companies />} />
              <Route path="people" element={<People />} />
              <Route path="forms" element={<Forms />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="logs" element={<Logs />} />
              <Route path="field-mapping" element={<FieldMapping />} />
              <Route path="repair" element={<Repair />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
