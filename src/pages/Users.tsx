import { PageHeader } from '@/components/ui/page-header';
import { UserManagement } from '@/components/settings/UserManagement';

const Users = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="使用者管理"
        description="管理系統帳號、角色與權限（RBAC：管理員 Admin／主管 Moderator／員工 User）"
      />
      <UserManagement />
    </div>
  );
};

export default Users;
