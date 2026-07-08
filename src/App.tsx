import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import AppLayout from "./components/layout/AppLayout";
import Index from "./pages/Index";
import Companies from "./pages/Companies";
import People from "./pages/People";
import Forms from "./pages/Forms";
import Invoices from "./pages/Invoices";
import Email from "./pages/Email";
import WordDocs from "./pages/WordDocs";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import FieldMapping from "./pages/FieldMapping";
import Repair from "./pages/Repair";
import MissingOfficers from "./pages/MissingOfficers";
import Presenters from "./pages/Presenters";
import Reminders from "./pages/Reminders";
import Documents from "./pages/Documents";
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
          <ErrorBoundary>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/documents" element={<Documents />} />
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
                <Route path="presenters" element={<Presenters />} />
                <Route path="forms" element={<Forms />} />
                <Route path="word-docs" element={<WordDocs />} />
                <Route path="reminders" element={<Reminders />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="email" element={<Email />} />
                <Route path="logs" element={<Logs />} />
                <Route path="field-mapping" element={<FieldMapping />} />
                <Route path="repair" element={<Repair />} />
                <Route path="missing-officers" element={<MissingOfficers />} />
                <Route path="documents" element={<Documents />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
