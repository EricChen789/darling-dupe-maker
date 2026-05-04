import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { RefreshCw, FileText, CheckSquare, Loader2, Download } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { allPageFields, FieldMapping as FieldMappingType } from '@/data/nar1FieldData';

interface FieldInfo {
  name: string;
  type: string;
}

const FieldMapping = () => {
  const [allFields, setAllFields] = useState<FieldInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingDebug, setGeneratingDebug] = useState(false);

  const fetchAllFields = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-nar1-pdf', {
        body: { listFields: true },
      });

      if (error) throw error;

      setAllFields(data.fields || []);
      toast({
        title: '欄位列表已更新',
        description: `共找到 ${data.fields?.length || 0} 個欄位`,
      });
    } catch (error) {
      console.error('Error fetching fields:', error);
      toast({
        title: '載入失敗',
        description: '無法從 PDF 模板讀取欄位列表',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const generateDebugPdf = async () => {
    setGeneratingDebug(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-nar1-pdf', {
        body: { debugMode: true },
      });

      if (error) throw error;

      if (data?.pdf) {
        // Convert base64 to blob and download
        const byteCharacters = atob(data.pdf);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'NAR1-Schedule1-debug.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({
          title: '診斷 PDF 已生成',
          description: '所有頁面欄位已填入欄位編號 (含頁碼)，勾選框全部勾上',
        });
      }
    } catch (error) {
      console.error('Error generating debug PDF:', error);
      toast({
        title: '生成失敗',
        description: '無法生成測試 PDF',
        variant: 'destructive',
      });
    } finally {
      setGeneratingDebug(false);
    }
  };

  const groupFieldsByPage = (fields: FieldInfo[]) => {
    const grouped: Record<string, FieldInfo[]> = {};
    fields.forEach((field) => {
      const match = field.name.match(/P\.(\d+)/);
      const page = match ? `第 ${match[1]} 頁` : '其他';
      if (!grouped[page]) grouped[page] = [];
      grouped[page].push(field);
    });
    return grouped;
  };

  const groupedFields = groupFieldsByPage(allFields);

  return (
    <div className="space-y-6">
      <PageHeader
        title="NAR1 欄位對照表"
        description="顯示 NAR1 周年申報表 PDF 模板的欄位編號與資料映射關係 (共 15 頁)"
        actions={
          <Button onClick={generateDebugPdf} disabled={generatingDebug}>
            {generatingDebug ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {generatingDebug ? '生成中...' : '生成診斷 PDF'}
          </Button>
        }
      />

      <Tabs defaultValue="mapping" className="space-y-4">
        <TabsList>
          <TabsTrigger value="mapping">欄位映射</TabsTrigger>
          <TabsTrigger value="all-fields">所有欄位</TabsTrigger>
        </TabsList>

        <TabsContent value="mapping" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={generateDebugPdf} disabled={generatingDebug}>
              {generatingDebug ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {generatingDebug ? '生成中...' : '生成測試 PDF'}
            </Button>
          </div>
          
          {allPageFields.map((pageData) => (
            <FieldMappingCard
              key={pageData.page}
              title={pageData.title}
              fields={pageData.fields}
            />
          ))}
        </TabsContent>

        <TabsContent value="all-fields" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              從 PDF 模板動態讀取所有表單欄位（共 {allFields.length} 個）
            </p>
            <Button onClick={fetchAllFields} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {loading ? '載入中...' : '從模板載入欄位'}
            </Button>
          </div>

          {Object.entries(groupedFields)
            .sort(([a], [b]) => {
              const numA = parseInt(a.match(/\d+/)?.[0] || '0');
              const numB = parseInt(b.match(/\d+/)?.[0] || '0');
              return numA - numB;
            })
            .map(([page, fields]) => (
              <Card key={page}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {page}
                    <Badge variant="secondary" className="ml-2">
                      {fields.length} 個欄位
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {fields.map((field) => (
                      <Badge
                        key={field.name}
                        variant={field.name.startsWith('cb_') ? 'secondary' : 'outline'}
                        className="font-mono text-xs"
                      >
                        {field.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
        </TabsContent>
      </Tabs>
    </div>
  );
};

// Reusable component for field mapping cards
interface FieldMappingCardProps {
  title: string;
  fields: FieldMappingType[];
}

const FieldMappingCard = ({ title, fields }: FieldMappingCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <FileText className="h-5 w-5" />
        {title}
        <Badge variant="outline" className="ml-2">
          {fields.length} 個欄位
        </Badge>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">欄位編號</TableHead>
            <TableHead>表格項目</TableHead>
            <TableHead>資料來源</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field) => (
            <TableRow key={field.field}>
              <TableCell>
                <Badge variant={field.field.startsWith('cb_') ? 'secondary' : field.field.startsWith('Dropdown') ? 'default' : 'outline'}>
                  {field.field.startsWith('cb_') && <CheckSquare className="h-3 w-3 mr-1" />}
                  {field.field}
                </Badge>
              </TableCell>
              <TableCell>{field.description}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {field.dataSource}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

export default FieldMapping;
