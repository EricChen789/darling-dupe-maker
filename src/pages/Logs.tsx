import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { RefreshCw, Filter } from 'lucide-react';

const mockLogs = [
  { id: '1', action: '新增公司', entity: 'TEST COMPANY', user: '管理員', timestamp: '2025/11/18 14:30:00' },
  { id: '2', action: '更新人員', entity: '測試董事', user: '管理員', timestamp: '2025/11/18 14:25:00' },
  { id: '3', action: '建立發票', entity: 'INV-710585', user: '管理員', timestamp: '2025/11/18 14:20:00' },
  { id: '4', action: '提交表格', entity: 'NAR1 - TEST COMPANY', user: '管理員', timestamp: '2025/11/18 14:15:00' },
];

const Logs = () => {
  return (
    <div>
      <PageHeader
        title="公司日誌"
        description="查看系統操作記錄"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              篩選
            </Button>
            <Button variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              重新整理
            </Button>
          </div>
        }
      />

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="divide-y divide-border">
          {mockLogs.map((log) => (
            <div key={log.id} className="p-4 hover:bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{log.action}</span>
                  <span className="text-muted-foreground"> - </span>
                  <span>{log.entity}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {log.user} · {log.timestamp}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Logs;
