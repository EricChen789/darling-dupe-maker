import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { RefreshCw, Plus, FileText, HelpCircle } from 'lucide-react';
import { mockForms } from '@/data/mockData';
import FormWizard from '@/components/forms/FormWizard';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mockCompanies } from '@/data/mockData';

interface Submission {
  id: string;
  formName: string;
  companyName: string;
  status: 'draft' | 'submitted';
  createdAt: string;
}

const Forms = () => {
  const [selectedForm, setSelectedForm] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [showSubmissions, setShowSubmissions] = useState(false);
  const [newSubmissionDialogOpen, setNewSubmissionDialogOpen] = useState(false);
  const [selectedFormForNew, setSelectedFormForNew] = useState('');
  const [selectedCompanyForNew, setSelectedCompanyForNew] = useState('');

  const handleRefresh = () => {
    toast({
      title: '已重新整理',
      description: '表格列表已更新',
    });
  };

  const handleStartForm = (formId: string) => {
    setSelectedForm(formId);
  };

  const handleManageSubmissions = () => {
    setShowSubmissions(!showSubmissions);
  };

  const handleNewSubmission = () => {
    setNewSubmissionDialogOpen(true);
  };

  const handleCreateSubmission = () => {
    if (!selectedFormForNew || !selectedCompanyForNew) {
      toast({
        title: '錯誤',
        description: '請選擇表格和公司',
        variant: 'destructive',
      });
      return;
    }

    const form = mockForms.find(f => f.id === selectedFormForNew);
    const company = mockCompanies.find(c => c.id === selectedCompanyForNew);

    const newSubmission: Submission = {
      id: `sub${Date.now()}`,
      formName: form?.name || '',
      companyName: company?.name || '',
      status: 'draft',
      createdAt: new Date().toLocaleDateString('zh-TW'),
    };

    setSubmissions([...submissions, newSubmission]);
    setNewSubmissionDialogOpen(false);
    setSelectedFormForNew('');
    setSelectedCompanyForNew('');

    toast({
      title: '提交已建立',
      description: `${form?.name} - ${company?.name}`,
    });

    // Start the form wizard
    setSelectedForm(selectedFormForNew);
  };

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
            <Button variant="outline" size="sm" onClick={handleRefresh}>
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
                onClick={() => handleStartForm(form.id)}
              >
                開始填寫
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Submissions Section */}
      {showSubmissions && submissions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">我的提交</h2>
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {submissions.map((submission) => (
              <div key={submission.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{submission.formName}</div>
                  <div className="text-sm text-muted-foreground">{submission.companyName}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    submission.status === 'draft' 
                      ? 'bg-warning/10 text-warning' 
                      : 'bg-primary/10 text-primary'
                  }`}>
                    {submission.status === 'draft' ? '草稿' : '已提交'}
                  </span>
                  <span className="text-sm text-muted-foreground">{submission.createdAt}</span>
                  <Button variant="outline" size="sm">
                    繼續填寫
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submission Management */}
      <div className="mt-8 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          選擇操作以繼續
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleManageSubmissions}>
            {showSubmissions ? '隱藏提交' : '管理提交'} ({submissions.length})
          </Button>
          <Button 
            size="sm" 
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleNewSubmission}
          >
            <Plus className="h-4 w-4 mr-2" />
            新增提交
          </Button>
        </div>
      </div>

      {/* New Submission Dialog */}
      <Dialog open={newSubmissionDialogOpen} onOpenChange={setNewSubmissionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增提交</DialogTitle>
            <DialogDescription>選擇表格類型和公司以建立新的提交</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>表格類型</Label>
              <Select value={selectedFormForNew} onValueChange={setSelectedFormForNew}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇表格" />
                </SelectTrigger>
                <SelectContent>
                  {mockForms.map((form) => (
                    <SelectItem key={form.id} value={form.id}>
                      {form.name} - {form.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>公司</Label>
              <Select value={selectedCompanyForNew} onValueChange={setSelectedCompanyForNew}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇公司" />
                </SelectTrigger>
                <SelectContent>
                  {mockCompanies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSubmissionDialogOpen(false)}>
              取消
            </Button>
            <Button 
              className="bg-primary text-primary-foreground"
              onClick={handleCreateSubmission}
            >
              建立並開始填寫
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Forms;
