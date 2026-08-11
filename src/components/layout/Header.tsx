import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, FileDown, PanelLeft } from 'lucide-react';
import GlobalSearch from './GlobalSearch';

interface HeaderProps {
  onMenuClick?: () => void;
}

const Header = ({ onMenuClick }: HeaderProps) => {
  const now = new Date();
  const { user, signOut } = useAuth();

  return (
    <header className="h-12 border-b border-border flex items-center justify-between px-3 sm:px-6 bg-card">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden shrink-0"
          onClick={onMenuClick}
          aria-label="打開選單"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <GlobalSearch />
        <div className="text-sm text-muted-foreground truncate hidden md:block">
          {user?.email}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <Button variant="outline" size="sm" asChild title="下載 NAR1 欄位診斷 PDF" className="hidden sm:inline-flex">
          <a href="/nar1_field_diagnostic.pdf" download>
            <FileDown className="h-4 w-4 mr-2" />
            診斷 PDF
          </a>
        </Button>
        <div className="text-right text-xs sm:text-sm text-muted-foreground">
          <div>{format(now, 'HH:mm:ss')}</div>
          <div className="hidden sm:block">{format(now, 'yyyy/M/dd')}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} title="登出">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
};

export default Header;
