import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { RefreshCw, Plus, FileText, HelpCircle } from 'lucide-react';
import { mockForms } from '@/data/mockData';
import FormWizard from '@/components/forms/FormWizard';

const Forms = () => {
  const [selectedForm, setSelectedForm] = useState<string | null>(null);

  if (selectedForm) {
    return <FormWizard formId={selectedForm} onBack={() => setSelectedForm(null)} />;
  }

  return (
    <div>
      <PageHeader
        title="可用表格"
        description="選擇要填寫的政府表格"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              重新整理
            </Button>
          </div>
        }
      />

      {/* Form Cards */}
      <div className="space-y-4">
        {mockForms.map((form) => (
          <div
            key={form.id}
            className="bg-card border border-border rounded-lg p-4 flex items-center justify-between hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <div className="font-medium text-lg">{form.name}</div>
                <div className="text-sm text-muted-foreground">{form.description}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                年度 {form.year}
              </span>
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                版本 {form.version}
              </span>
              {form.isHelper && (
                <span className="inline-flex items-center rounded-full bg-warning/10 text-warning px-2.5 py-0.5 text-xs font-medium">
                  <HelpCircle className="h-3 w-3 mr-1" />
                  輔助填表
                </span>
              )}
              <Button 
                size="sm" 
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setSelectedForm(form.id)}
              >
                開始填寫
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Submission Management */}
      <div className="mt-8 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          選擇操作以繼續
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            管理提交
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />
            新增提交
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Forms;
