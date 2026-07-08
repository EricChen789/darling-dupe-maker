import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { RefreshCw, FileText, HelpCircle, AlertCircle } from 'lucide-react';
import { mockForms } from '@/data/mockData';
import FormWizard from '@/components/forms/FormWizard';
import NR1GeneratorForm from '@/components/forms/NR1GeneratorForm';
import ND2AGeneratorForm from '@/components/forms/ND2AGeneratorForm';
import ND2BGeneratorForm from '@/components/forms/ND2BGeneratorForm';
import ND4GeneratorForm from '@/components/forms/ND4GeneratorForm';
import NDR1GeneratorForm from '@/components/forms/NDR1GeneratorForm';
import NSC1GeneratorForm from '@/components/forms/NSC1GeneratorForm';
import NN1GeneratorForm from '@/components/forms/NN1GeneratorForm';
import NN3GeneratorForm from '@/components/forms/NN3GeneratorForm';
import NN6GeneratorForm from '@/components/forms/NN6GeneratorForm';
import NN7GeneratorForm from '@/components/forms/NN7GeneratorForm';
import NN9GeneratorForm from '@/components/forms/NN9GeneratorForm';
import NewCompanyGeneratorForm from '@/components/forms/NewCompanyGeneratorForm';
import ResolutionGeneratorForm from '@/components/forms/ResolutionGeneratorForm';
import RenameCompanyForm from '@/components/forms/RenameCompanyForm';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import ErrorBoundary from '@/components/ErrorBoundary';

const Forms = () => {
  const [selectedForm, setSelectedForm] = useState<string | null>(null);

  const handleRefresh = () => {
    toast({ title: '已重新整理', description: '表格列表已更新' });
  };

  // CR form routing (nar1 is handled via Dialog at the bottom)
  if (selectedForm === 'nd2a') {
    return <ND2AGeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nd2b') {
    return <ND2BGeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nd4') {
    return <ND4GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'ndr1') {
    return <NDR1GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nr1') {
    return <NR1GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nsc1') {
    return <NSC1GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nn1') {
    return <NN1GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nn3') {
    return <NN3GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nn6') {
    return <NN6GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nn7') {
    return <NN7GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nn9') {
    return <NN9GeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nnc1') {
    return <NewCompanyGeneratorForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'nnc2') {
    return <RenameCompanyForm onBack={() => setSelectedForm(null)} />;
  }
  if (selectedForm === 'resolution') {
    return <ResolutionGeneratorForm onBack={() => setSelectedForm(null)} />;
  }

  // Group forms by category
  const crFormIds = ['nar1', 'nd2a', 'nd2b', 'nd4', 'ndr1', 'nr1', 'nsc1', 'nn1', 'nn3', 'nn6', 'nn7', 'nn9', 'nnc1', 'nnc2'];
  const otherFormIds = ['resolution'];
  const irdFormIds = ['irc3111a'];

  const crForms = mockForms.filter(f => crFormIds.includes(f.id));
  const otherForms = mockForms.filter(f => otherFormIds.includes(f.id));
  const irdForms = mockForms.filter(f => irdFormIds.includes(f.id));

  const isReady = (id: string) => [...crFormIds, ...otherFormIds].includes(id);

  return (
    <div>
      <PageHeader
        title="可用表格"
        description="選擇要填寫的政府表格，系統支持自動填入公司資料並生成 PDF"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />重新整理
          </Button>
        }
      />

      {/* CR Forms */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5" />
          公司註冊處表格
        </h2>
        <div className="space-y-3">
          {crForms.map((form) => (
            <div key={form.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between hover:border-primary/50 transition-colors">
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
                {form.isHelper && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                    <HelpCircle className="h-3 w-3 mr-1" />自動填表
                  </span>
                )}
                {isReady(form.id) ? (
                  <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setSelectedForm(form.id)}>
                    開始填寫
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    <AlertCircle className="h-4 w-4 mr-1" />即將推出
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Other Documents */}
      {otherForms.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            其他常用文件
          </h2>
          <div className="space-y-3">
            {otherForms.map((form) => (
              <div key={form.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between hover:border-primary/50 transition-colors">
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
                  {form.isHelper && (
                    <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                      <HelpCircle className="h-3 w-3 mr-1" />自動填表
                    </span>
                  )}
                  {isReady(form.id) ? (
                    <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setSelectedForm(form.id)}>
                      開始填寫
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled>
                      <AlertCircle className="h-4 w-4 mr-1" />即將推出
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* IRD Forms */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5" />
          稅務局表格
        </h2>
        <div className="space-y-3">
          {irdForms.map((form) => (
            <div key={form.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between hover:border-primary/50 transition-colors">
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
                <Button size="sm" variant="outline" disabled>
                  <AlertCircle className="h-4 w-4 mr-1" />即將推出
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Reference */}
      <div className="mt-8 bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">📋 快速對照表</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-medium">變更項目</th>
                <th className="text-left py-2 pr-4 font-medium">表格</th>
                <th className="text-left py-2 pr-4 font-medium">提交機構</th>
                <th className="text-left py-2 font-medium">時限</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-b border-border/50"><td className="py-2 pr-4">周年申報</td><td className="py-2 pr-4 font-medium text-foreground">NAR1</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">周年日後 42 日</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">董事/秘書委任/停任</td><td className="py-2 pr-4 font-medium text-foreground">ND2A</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">15 日</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">董事/秘書詳情更改</td><td className="py-2 pr-4 font-medium text-foreground">ND2B</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">15 日</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">董事/秘書辭任</td><td className="py-2 pr-4 font-medium text-foreground">ND4</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">15 日</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">撤銷註冊</td><td className="py-2 pr-4 font-medium text-foreground">NDR1</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">—</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">註冊辦事處地址</td><td className="py-2 pr-4 font-medium text-foreground">NR1</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">15 日</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">股份配發</td><td className="py-2 pr-4 font-medium text-foreground">NSC1</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">1 個月</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">公司成立(非股份有限公司)</td><td className="py-2 pr-4 font-medium text-foreground">NNC1</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">—</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">公司更名</td><td className="py-2 pr-4 font-medium text-foreground">NNC2</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">15 日</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">註冊非香港公司</td><td className="py-2 pr-4 font-medium text-foreground">NN1 / NN3 / NN6 / NN7 / NN9</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">—</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">業務/營業地址</td><td className="py-2 pr-4 font-medium text-foreground">IRC 3111A</td><td className="py-2 pr-4">稅務局</td><td className="py-2">1 個月</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">股份轉讓</td><td className="py-2 pr-4 font-medium text-foreground">下次 NAR1</td><td className="py-2 pr-4">公司註冊處</td><td className="py-2">年報時</td></tr>
              <tr><td className="py-2 pr-4">個人通訊地址</td><td className="py-2 pr-4 font-medium text-foreground">I.R. 1249</td><td className="py-2 pr-4">稅務局</td><td className="py-2">1 個月</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* NAR1 Modal */}
      <Dialog open={selectedForm === 'nar1'} onOpenChange={(open) => { if (!open) setSelectedForm(null); }}>
        <DialogContent className="max-w-none w-[95vw] h-[95vh] p-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            <ErrorBoundary>
              <FormWizard formId="nar1" onBack={() => setSelectedForm(null)} />
            </ErrorBoundary>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Forms;
