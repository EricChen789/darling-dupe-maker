import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { toast } from '@/hooks/use-toast';
import { Shield, Trash2, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

interface UserWithRole {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  roles: AppRole[];
}

export const UserManagement = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('user');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (user) {
      checkAdmin();
    }
  }, [user]);

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const checkAdmin = async () => {
    const { data } = await supabase.rpc('has_role', { _user_id: user!.id, _role: 'admin' });
    setIsAdmin(!!data);
    if (!data) setLoading(false);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch profiles and roles
      const { data: profiles } = await supabase.from('profiles').select('*');
      const { data: roles } = await supabase.from('user_roles').select('*');

      if (profiles) {
        const userList: UserWithRole[] = profiles.map(p => ({
          id: p.id,
          email: '',
          display_name: p.display_name,
          created_at: p.created_at,
          roles: roles?.filter(r => r.user_id === p.id).map(r => r.role) || [],
        }));
        setUsers(userList);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
    setLoading(false);
  };

  const handleRoleChange = async (userId: string, newRole: AppRole, currentRoles: AppRole[]) => {
    try {
      // Remove existing roles
      for (const role of currentRoles) {
        await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role);
      }
      // Add new role
      if (newRole) {
        await supabase.from('user_roles').insert({ user_id: userId, role: newRole });
      }
      toast({ title: '角色已更新', description: `用戶角色已更新為 ${newRole}` });
      fetchUsers();
    } catch {
      toast({ title: '更新失敗', description: '無法更新用戶角色', variant: 'destructive' });
    }
  };

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) {
      toast({ title: '請填寫所有欄位', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: {
          action: 'create',
          email: newEmail,
          password: newPassword,
          display_name: newDisplayName || newEmail,
          role: newRole,
        },
      });
      if (error) throw error;
      toast({ title: '用戶已建立', description: `${newEmail} 已成功建立` });
      setAddDialogOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('user');
      fetchUsers();
    } catch (err: any) {
      toast({ title: '建立失敗', description: err.message, variant: 'destructive' });
    }
    setCreating(false);
  };

  const handleDeleteUser = async (userId: string) => {
    if (userId === user?.id) {
      toast({ title: '無法刪除自己', variant: 'destructive' });
      return;
    }
    if (!confirm('確定要刪除此用戶嗎？此操作無法復原。')) return;
    try {
      const { error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'delete', userId },
      });
      if (error) throw error;
      toast({ title: '用戶已刪除' });
      fetchUsers();
    } catch (err: any) {
      toast({ title: '刪除失敗', description: err.message, variant: 'destructive' });
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 max-w-4xl">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5" /> 用戶管理
        </h2>
        <p className="text-muted-foreground">您沒有管理用戶的權限。</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" /> 用戶管理
        </h2>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><UserPlus className="h-4 w-4 mr-1" /> 新增用戶</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新增用戶</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>電郵地址</Label>
                <Input value={newEmail} onChange={e => setNewEmail(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>密碼</Label>
                <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>顯示名稱</Label>
                <Input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>角色</Label>
                <Select value={newRole} onValueChange={(v: AppRole) => setNewRole(v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="moderator">Moderator</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreateUser} disabled={creating} className="w-full">
                {creating ? '建立中...' : '建立用戶'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground">載入中...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>建立日期</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.id}>
                <TableCell>
                  <div>
                    <div className="font-medium">{u.display_name || '未設定'}</div>
                    <div className="text-xs text-muted-foreground">{u.id.slice(0, 8)}...</div>
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={u.roles[0] || 'user'}
                    onValueChange={(v: AppRole) => handleRoleChange(u.id, v, u.roles)}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString('zh-HK')}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteUser(u.id)}
                    disabled={u.id === user?.id}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
