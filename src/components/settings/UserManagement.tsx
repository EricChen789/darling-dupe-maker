import { useEffect, useState, useCallback } from 'react';
import { useAuth, getToken } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { Shield, Trash2, UserPlus, Ban, CheckCircle2, Edit, Save, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type AppRole = 'admin' | 'moderator' | 'user';

interface UserWithRole {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  is_active: number;
  roles: AppRole[];
}

const ROLE_LABEL: Record<AppRole, string> = { admin: '管理員', moderator: '主管', user: '員工' };

// 統一的 admin API 呼叫（帶 JWT）
async function adminFetch(path: string, init?: RequestInit) {
  const resp = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(init?.headers || {}),
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

export const UserManagement = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('user');
  const [creating, setCreating] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<AppRole>('user');
  const [editIsActive, setEditIsActive] = useState(1);
  const [saving, setSaving] = useState(false);

  const openEditDialog = (u: UserWithRole) => {
    setEditingUser(u);
    setEditDisplayName(u.display_name || '');
    setEditRole((u.roles[0] as AppRole) || 'user');
    setEditIsActive(u.is_active);
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      await adminFetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          display_name: editDisplayName,
          role: editRole,
          is_active: editIsActive,
        }),
      });
      toast({ title: '使用者已更新' });
      setEditDialogOpen(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      toast({ title: '更新失敗', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminFetch('/api/admin/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching users:', err);
      toast({ title: '載入失敗', description: '無法取得用戶清單', variant: 'destructive' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) fetchUsers();
    else setLoading(false);
  }, [isAdmin, fetchUsers]);

  const handleRoleChange = async (userId: string, role: AppRole) => {
    try {
      await adminFetch(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) });
      toast({ title: '角色已更新', description: `已更新為 ${ROLE_LABEL[role]}` });
      fetchUsers();
    } catch (err: any) {
      toast({ title: '更新失敗', description: err.message, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (u: UserWithRole) => {
    if (u.id === user?.id) {
      toast({ title: '無法停用自己', variant: 'destructive' });
      return;
    }
    const next = u.is_active ? 0 : 1;
    try {
      await adminFetch(`/api/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ is_active: next }) });
      toast({ title: next ? '用戶已啟用' : '用戶已停用' });
      fetchUsers();
    } catch (err: any) {
      toast({ title: '操作失敗', description: err.message, variant: 'destructive' });
    }
  };

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) {
      toast({ title: '請填寫電郵與密碼', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      await adminFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          display_name: newDisplayName || newEmail,
          role: newRole,
        }),
      });
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
      await adminFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
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
            <Button size="sm"><UserPlus className="h-4 w-4 mr-1" /> 新增使用者</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新增使用者</DialogTitle>
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
                    <SelectItem value="admin">管理員 Admin</SelectItem>
                    <SelectItem value="moderator">主管 Moderator</SelectItem>
                    <SelectItem value="user">員工 User</SelectItem>
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
              <TableHead>電郵</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.display_name || '未設定'}</div>
                  <div className="text-xs text-muted-foreground">{u.id.slice(0, 8)}...</div>
                </TableCell>
                <TableCell className="text-sm">{u.email}</TableCell>
                <TableCell>
                  <Select
                    value={(u.roles[0] as AppRole) || 'user'}
                    onValueChange={(v: AppRole) => handleRoleChange(u.id, v)}
                    disabled={u.id === user?.id}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">管理員</SelectItem>
                      <SelectItem value="moderator">主管</SelectItem>
                      <SelectItem value="user">員工</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    u.is_active
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {u.is_active ? '啟用中' : '已停用'}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="編輯"
                    onClick={() => openEditDialog(u)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={u.is_active ? '停用' : '啟用'}
                    onClick={() => handleToggleActive(u)}
                    disabled={u.id === user?.id}
                  >
                    {u.is_active
                      ? <Ban className="h-4 w-4 text-amber-600" />
                      : <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="刪除"
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

      {/* ── 編輯使用者 dialog (US-03) ── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Edit className="h-5 w-5" />編輯使用者</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4">
              <div>
                <Label>電郵地址</Label>
                <Input value={editingUser.email} disabled className="mt-1 bg-muted/50" />
                <p className="text-[11px] text-muted-foreground mt-0.5">電郵地址不可更改</p>
              </div>
              <div>
                <Label>顯示名稱</Label>
                <Input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>角色權限</Label>
                <Select value={editRole} onValueChange={(v: AppRole) => setEditRole(v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">管理員 Admin — 完整系統權限</SelectItem>
                    <SelectItem value="moderator">主管 Moderator — 可編輯與刪除</SelectItem>
                    <SelectItem value="user">員工 User — 基本操作權限</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>帳號狀態</Label>
                  <p className="text-xs text-muted-foreground">
                    {editIsActive ? '啟用中 — 用戶可正常登入' : '已停用 — 用戶無法登入'}
                  </p>
                </div>
                <Button
                  variant={editIsActive ? 'destructive' : 'default'}
                  size="sm"
                  onClick={() => setEditIsActive(editIsActive ? 0 : 1)}
                  disabled={editingUser.id === user?.id}
                >
                  {editIsActive ? <><Ban className="h-3.5 w-3.5 mr-1" />停用</> : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />啟用</>}
                </Button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(false)}>
                  <X className="h-4 w-4 mr-1" />取消
                </Button>
                <Button size="sm" onClick={handleEditSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}儲存
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
