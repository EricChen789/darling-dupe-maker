import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
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
      const token = localStorage.getItem("secretary_jwt") || "";
      if (!token) throw new Error('請先登入');
      const url = `/api/export-all`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err || `HTTP ${resp.status}`);
      }
      const json = await resp.json();
      // Build a UTF-8 JSON blob directly — btoa() cannot encode Chinese characters.
      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          if (a.parentNode) a.parentNode.removeChild(a);
        } catch (_) { /* already removed */ }
        URL.revokeObjectURL(objUrl);
      }, 100);
      toast({ title: '匯出完成', description: 'JSON 備份已下載' });
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

      <div className="bg-card border border-border rounded-lg p-6 max-w-2xl">
        <h2 className="text-lg font-semibold mb-2">完整資料備份</h2>
        <p className="text-sm text-muted-foreground mb-4">
          匯出所有資料表為單一 JSON 檔。僅限管理員。
        </p>
        <Button onClick={handleFullExport} disabled={exporting}>
          {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          {exporting ? '匯出中…' : '匯出完整備份 (JSON)'}
        </Button>
      </div>

      <UserManagement />
    </div>
  );
};

export default Settings;
