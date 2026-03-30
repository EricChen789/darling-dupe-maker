import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

const Header = () => {
  const now = new Date();
  const { user, signOut } = useAuth();
  
  return (
    <header className="h-12 border-b border-border flex items-center justify-between px-6 bg-card">
      <div className="text-sm text-muted-foreground">
        {user?.email}
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right text-sm text-muted-foreground">
          <div>{format(now, 'HH:mm:ss')}</div>
          <div>{format(now, 'yyyy/M/dd')}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} title="登出">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
};

export default Header;
