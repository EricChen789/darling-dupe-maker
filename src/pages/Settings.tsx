import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { UserManagement } from '@/components/settings/UserManagement';
import { PresenterManagement } from '@/components/settings/PresenterManagement';
import { SecretaryTemplateManagement } from '@/components/settings/SecretaryTemplateManagement';

const Settings = () => {
  const [companyName, setCompanyName] = useState('Muselabs');
  const [email, setEmail] = useState('admin@muselabs.com');

  const handleSave = () => {
    toast({
      title: '設定已儲存',
      description: '您的變更已成功儲存',
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="設定"
        description="管理系統設定"
      />

      <div className="bg-card border border-border rounded-lg p-6 max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">公司資料</h2>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="companyName">公司名稱</Label>
            <Input 
              id="companyName" 
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-2" 
            />
          </div>
          
          <div>
            <Label htmlFor="email">電郵地址</Label>
            <Input 
              id="email" 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2" 
            />
          </div>

          <Button onClick={handleSave}>
            儲存變更
          </Button>
        </div>
      </div>

      <PresenterManagement />

      <div className="bg-card border border-border rounded-lg p-6">
        <SecretaryTemplateManagement />
      </div>

      <UserManagement />
    </div>
  );
};

export default Settings;
