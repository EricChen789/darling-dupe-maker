import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Download } from 'lucide-react';
import { Building2, Users, FileText, Receipt, ClipboardList, Settings, LogOut, Table, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems: { path: string; label: string; icon: any; external?: boolean }[] = [
  { path: '/companies', label: '公司管理', icon: Building2 },
  { path: '/people', label: '人員管理', icon: Users },
  { path: '/forms', label: '表單管理', icon: FileText },
  { path: '/invoices', label: '發票管理', icon: Receipt },
  { path: '/logs', label: '公司日誌', icon: ClipboardList },
  { path: '/field-mapping', label: '欄位對照表', icon: Table },
  { path: '/import-data-skill-guide.md', label: 'API 導入指南', icon: Download, external: true },
];

const bottomNavItems = [
  { path: '/settings', label: '設定', icon: Settings },
];

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <TooltipProvider delayDuration={0}>
      <aside className={cn(
        "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 relative",
        collapsed ? "w-16" : "w-56"
      )}>
        {/* Logo */}
        <div className={cn(
          "flex items-center p-4 border-b border-sidebar-border",
          collapsed ? "justify-center" : "gap-3"
        )}>
          {!collapsed && (
            <div className="flex flex-col flex-1 min-w-0">
              <span className="font-semibold text-sm">Muselabs</span>
              <span className="text-xs text-muted-foreground truncate">秘書公司管理系統</span>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                onClick={onToggle} 
                className="p-1.5 hover:bg-muted rounded-md transition-colors shrink-0"
                aria-label={collapsed ? "展開側邊欄" : "收起側邊欄"}
              >
                {collapsed ? (
                  <PanelLeft className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <PanelLeftClose className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "展開側邊欄" : "收起側邊欄"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4">
          <ul className="space-y-1 px-2">
            {navItems.map((item) => {
              const isActive = !item.external && (location.pathname === item.path || location.pathname.startsWith(item.path + '/'));
              const linkContent = item.external ? (
                <a
                  href={item.path}
                  download
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-sidebar-foreground hover:bg-muted",
                    collapsed && "justify-center"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </a>
              ) : (
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-muted",
                    collapsed && "justify-center"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
              
              return (
                <li key={item.path}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : linkContent}
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
              const linkContent = (
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-muted",
                    collapsed && "justify-center"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
              
              return (
                <li key={item.path}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : linkContent}
                </li>
              );
            })}
            {/* Logout button */}
            <li>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={signOut}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-sidebar-foreground hover:bg-muted w-full justify-center"
                    >
                      <LogOut className="h-4 w-4 shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">登出</TooltipContent>
                </Tooltip>
              ) : (
                <button
                  onClick={signOut}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-sidebar-foreground hover:bg-muted w-full"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  <span>登出</span>
                </button>
              )}
            </li>
          </ul>
        </div>
      </aside>
    </TooltipProvider>
  );
};

export default Sidebar;
