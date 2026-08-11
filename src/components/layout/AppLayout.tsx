import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import ChatPanel from '@/components/chat/ChatPanel';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const AppLayout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile: hidden aside that acts as spacer for the Sheet overlay */}
      {/* Desktop: fixed sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        isMobile={isMobile}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />

      {!chatOpen && (
        <Button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 h-12 w-12 rounded-full shadow-lg z-50"
          size="icon"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
};

export default AppLayout;
