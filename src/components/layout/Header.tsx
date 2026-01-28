import { format } from 'date-fns';

const Header = () => {
  const now = new Date();
  
  return (
    <header className="h-12 border-b border-border flex items-center justify-end px-6 bg-card">
      <div className="text-right text-sm text-muted-foreground">
        <div>{format(now, 'HH:mm:ss')}</div>
        <div>{format(now, 'yyyy/M/dd')}</div>
      </div>
    </header>
  );
};

export default Header;
