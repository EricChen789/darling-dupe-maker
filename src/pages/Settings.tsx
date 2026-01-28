import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Settings = () => {
  return (
    <div>
      <PageHeader
        title="設定"
        description="管理系統設定"
      />

      <div className="bg-card border border-border rounded-lg p-6 max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">公司資料</h2>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="companyName">公司名稱</Label>
            <Input id="companyName" defaultValue="Muselabs" className="mt-2" />
          </div>
          
          <div>
            <Label htmlFor="email">電郵地址</Label>
            <Input id="email" type="email" defaultValue="admin@muselabs.com" className="mt-2" />
          </div>

          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            儲存變更
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
