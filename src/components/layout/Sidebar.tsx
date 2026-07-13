import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Download, Wrench, UserCheck, AlertTriangle, FileDown, Bell, FolderOpen, Mail, FileType, Search } from 'lucide-react';
import { Building2, Users, FileText, Receipt, ClipboardList, Settings, LogOut, Table, PanelLeftClose, PanelLeft, LayoutDashboard, UserCog } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems: { path: string; label: string; icon: any; external?: boolean }[] = [
  { path: '/dashboard', label: '儀錶板', icon: LayoutDashboard },
  { path: '/companies', label: '公司管理', icon: Building2 },
  { path: '/people', label: '自然人管理', icon: Users },
  { path: '/presenters', label: '提交人資料', icon: UserCheck },
  { path: '/forms', label: '表單管理', icon: FileText },
  { path: '/word-docs', label: 'Word 文件', icon: FileType },
  { path: '/reminders', label: '任務管理', icon: Bell },
  { path: '/invoices', label: '發票管理', icon: Receipt },
  { path: '/email', label: '郵件模塊', icon: Mail },
  { path: '/logs', label: '公司日誌', icon: ClipboardList },
  { path: '/search', label: '歷史檢索', icon: Search },
  { path: '/field-mapping', label: '欄位對照表', icon: Table },
  { path: '/repair', label: '數據修復', icon: Wrench },
  { path: '/missing-officers', label: '仍缺董事/秘書', icon: AlertTriangle },
  { path: '/documents', label: '文件管理', icon: FolderOpen },
  { path: '/import-data-skill-guide.md', label: 'API 導入指南', icon: Download, external: true },
  { path: '/nar1_field_diagnostic.pdf', label: '診斷 PDF', icon: FileDown, external: true },
];

const bottomNavItems = [
  { path: '/users', label: '使用者管理', icon: UserCog },
  { path: '/settings', label: '設定', icon: Settings },
];

// Items only visible to admin (US-05/06)
const ADMIN_ONLY_PATHS = new Set([
  '/users', '/settings', '/repair', '/field-mapping',
  '/nar1_field_diagnostic.pdf', '/import-data-skill-guide.md',
]);

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const isAdmin = user?.role === 'admin';

  const visibleNavItems = navItems.filter(item => !ADMIN_ONLY_PATHS.has(item.path) || isAdmin);
  const visibleBottomItems = bottomNavItems.filter(item => !ADMIN_ONLY_PATHS.has(item.path) || isAdmin);

  return (
    <TooltipProvider delayDuration={0}>
      <aside className={cn(
        "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 relative",
        collapsed ? "w-16" : "w-56"
      )}>
        {/* Logo */}
        <div className={cn(
          "relative border-b border-sidebar-border p-3",
          collapsed ? "flex items-center justify-center" : "flex flex-col gap-1"
        )}>
          {!collapsed ? (
            <>
              <div className="flex justify-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onToggle}
                      className="p-1.5 hover:bg-muted rounded-md transition-colors"
                      aria-label="收起側邊欄"
                    >
                      <PanelLeftClose className="h-5 w-5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">收起側邊欄</TooltipContent>
                </Tooltip>
              </div>
              <img src="/logo.png" alt="Logo" className="w-full max-w-[96px] h-auto object-contain mx-auto" />
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggle}
                  className="p-1.5 hover:bg-muted rounded-md transition-colors shrink-0"
                  aria-label="展開側邊欄"
                >
                  <PanelLeft className="h-5 w-5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">展開側邊欄</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4">
          <ul className="space-y-1 px-2">
            {visibleNavItems.map((item) => {
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
                <span
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-muted",
                    collapsed && "justify-center"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </span>
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
            {visibleBottomItems.map((item) => {
              const isActive = location.pathname === item.path;
              const linkContent = (
                <span
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-muted",
                    collapsed && "justify-center"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </span>
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
