import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Building2, Users, FileText, Receipt, ClipboardList, Settings, LogOut, LayoutGrid } from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { path: '/companies', label: '公司管理', icon: Building2 },
  { path: '/people', label: '人員管理', icon: Users },
  { path: '/forms', label: '表單管理', icon: FileText },
  { path: '/invoices', label: '發票管理', icon: Receipt },
  { path: '/logs', label: '公司日誌', icon: ClipboardList },
];

const bottomNavItems = [
  { path: '/settings', label: '設定', icon: Settings },
  { path: '/logout', label: '登出', icon: LogOut },
];

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const location = useLocation();

  return (
    <aside className={cn(
      "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
      collapsed ? "w-16" : "w-56"
    )}>
      {/* Logo */}
      <div className="flex items-center gap-2 p-4 border-b border-sidebar-border">
        <button onClick={onToggle} className="p-1 hover:bg-muted rounded">
          <LayoutGrid className="h-5 w-5 text-muted-foreground" />
        </button>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="font-semibold text-sm">Muselabs</span>
            <span className="text-xs text-muted-foreground">秘書公司管理系統</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom Navigation */}
      <div className="border-t border-sidebar-border py-4">
        <ul className="space-y-1 px-2">
          {bottomNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
};

export default Sidebar;
