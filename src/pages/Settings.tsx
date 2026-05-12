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
  const [exporting, setExporting] = useState(false);

  const handleSave = () => {
    toast({
      title: '設定已儲存',
      description: '您的變更已成功儲存',
    });
  };

  const handleFullExport = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('請先登入');
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-all`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      const dlUrl = URL.createObjectURL(blob);
      a.href = dlUrl;
      a.download = `backup_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
      toast({ title: '匯出完成', description: 'ZIP 已下載' });
    } catch (e: any) {
      toast({ title: '匯出失敗', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
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
