import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Sparkles, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FormWizardProps {
  formId: string;
  onBack: () => void;
}

const standardPages = [
  { id: 1, label: '1' },
  { id: 2, label: '2' },
  { id: 3, label: '3' },
  { id: 4, label: '4' },
  { id: 5, label: '5' },
  { id: 6, label: '6' },
  { id: 7, label: '7' },
  { id: 8, label: '8' },
];

const extraPages = [
  { id: 's1', label: '附表一', icon: '📋', shortLabel: 'S1' },
  { id: 's2', label: '附表二', icon: '📋', shortLabel: 'S2' },
  { id: 'a', label: '續頁 A', icon: '📄', shortLabel: 'A' },
  { id: 'b', label: '續頁 B', icon: '📄', shortLabel: 'B' },
  { id: 'c', label: '續頁 C', icon: '📄', shortLabel: 'C' },
  { id: 'd', label: '續頁 D', icon: '📄', shortLabel: 'D' },
  { id: 'e', label: '續頁 E', icon: '📄', shortLabel: 'E' },
];

const FormWizard = ({ formId, onBack }: FormWizardProps) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedExtraPages, setSelectedExtraPages] = useState<string[]>([]);
  const [autoFill, setAutoFill] = useState(false);

  const totalSteps = 9 + selectedExtraPages.length;
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <h1 className="text-xl font-semibold">建立 NAR1 周年申報表</h1>
        <p className="text-sm text-muted-foreground">建立和提交政府表格</p>
        <div className="flex gap-2 mt-3">
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
            年度 2025
          </span>
          <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
            版本 2
          </span>
          <span className="inline-flex items-center rounded-full bg-warning/10 text-warning px-2.5 py-0.5 text-xs font-medium">
            <HelpCircle className="h-3 w-3 mr-1" />
            輔助填表
          </span>
        </div>
      </div>

      {/* Navigation Card */}
      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <div className="text-sm font-medium mb-4">快速導航到頁面：</div>
        
        <div className="mb-4">
          <Button 
            variant={currentStep === 1 ? "default" : "outline"} 
            size="sm"
            onClick={() => setCurrentStep(1)}
            className={currentStep === 1 ? "bg-primary text-primary-foreground" : ""}
          >
            基本資訊
          </Button>
        </div>

        <div className="mb-4">
          <div className="text-sm text-muted-foreground mb-2">標準頁面</div>
          <div className="flex flex-wrap gap-2">
            {standardPages.map((page) => (
              <Button
                key={page.id}
                variant={currentStep === page.id + 1 ? "default" : "outline"}
                size="sm"
                onClick={() => setCurrentStep(page.id + 1)}
                className={cn(
                  "w-8 h-8 p-0",
                  currentStep === page.id + 1 && "bg-primary text-primary-foreground"
                )}
              >
                {page.label}
              </Button>
            ))}
          </div>
        </div>

        {selectedExtraPages.length > 0 && (
          <div className="mb-4">
            <div className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
              額外頁面 
              <span className="text-xs text-warning">⚠ 部分頁面仍在填寫中</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {extraPages.filter(p => selectedExtraPages.includes(p.id)).map((page) => (
                <Button
                  key={page.id}
                  variant="outline"
                  size="sm"
                  className="h-8"
                >
                  {page.icon} {page.shortLabel}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span>進度</span>
            <span>{currentStep} / {totalSteps}</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="text-right text-sm text-muted-foreground mt-1">
            {Math.round(progress)}% 完成
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="bg-card border border-border rounded-lg p-6">
        {currentStep === 1 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">基本資訊</h2>
            
            <div className="mb-6">
              <Label htmlFor="company" className="text-sm font-medium">
                公司 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="company"
                placeholder="搜尋公司名稱或商業登記號碼..."
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="mt-2"
              />
            </div>

            <div className="mb-6">
              <div className="text-sm font-medium mb-2">選擇額外頁面</div>
              <p className="text-sm text-muted-foreground mb-4">
                選擇您需要填寫的額外頁面，這些頁面包含額外的成員詳情和補充資料。
              </p>
              
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm">
                  額外頁面 <span className="text-warning">⚠ 部分頁面仍在填寫中</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="link" size="sm" className="text-primary" onClick={() => setSelectedExtraPages(extraPages.map(p => p.id))}>
                    全選
                  </Button>
                  <Button variant="link" size="sm" onClick={() => setSelectedExtraPages([])}>
                    取消全選
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {extraPages.map((page) => (
                  <div
                    key={page.id}
                    className={cn(
                      "border rounded-lg p-3 cursor-pointer transition-colors",
                      selectedExtraPages.includes(page.id)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground"
                    )}
                    onClick={() => {
                      setSelectedExtraPages(prev =>
                        prev.includes(page.id)
                          ? prev.filter(id => id !== page.id)
                          : [...prev, page.id]
                      );
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox checked={selectedExtraPages.includes(page.id)} />
                      <span>{page.icon}</span>
                      <div>
                        <div className="text-sm font-medium">{page.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {page.id.startsWith('s') ? '上市公司成員詳情' : '補充資料（續頁）'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {currentStep > 1 && (
          <div className="text-center py-12 text-muted-foreground">
            <div className="text-lg mb-2">頁面 {currentStep - 1} 內容</div>
            <p>此處將顯示 NAR1 表格的第 {currentStep - 1} 頁內容</p>
          </div>
        )}
      </div>

      {/* Auto-fill Toggle */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          若無資料，將不會自動填寫 / If no data exists, nothing will be auto-filled
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm">自動輔助/填寫</span>
            <Button
              variant="outline"
              size="sm"
              className={cn(autoFill && "bg-primary text-primary-foreground")}
              onClick={() => setAutoFill(!autoFill)}
            >
              {autoFill ? 'ON' : 'OFF'}
            </Button>
          </div>
          <Button variant="outline" size="sm">
            <Sparkles className="h-4 w-4 mr-2" />
            立即填寫 Fill Now
          </Button>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>取消</Button>
          <Button variant="destructive">重設</Button>
          <Button variant="outline">清除此頁</Button>
        </div>
        <Button 
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => setCurrentStep(prev => Math.min(prev + 1, totalSteps))}
        >
          下一步
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
};

export default FormWizard;
