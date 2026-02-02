import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import Index from "./pages/Index";
import Companies from "./pages/Companies";
import People from "./pages/People";
import Forms from "./pages/Forms";
import Invoices from "./pages/Invoices";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import FieldMapping from "./pages/FieldMapping";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Index />} />
            <Route path="companies" element={<Companies />} />
            <Route path="people" element={<People />} />
            <Route path="forms" element={<Forms />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="logs" element={<Logs />} />
            <Route path="field-mapping" element={<FieldMapping />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
