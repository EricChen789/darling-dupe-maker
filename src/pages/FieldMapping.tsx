import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { RefreshCw, FileText, CheckSquare, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface FieldInfo {
  name: string;
  type: string;
}

// Static mapping data based on NAR1 form structure
const page1Fields = [
  { field: 'fill_1_P.1', description: '頁頭商業登記號碼 (前8位)', dataSource: 'brNumber.slice(0,8)' },
  { field: 'fill_2_P.1', description: '1. 公司名稱', dataSource: 'name' },
  { field: 'fill_3_P.1', description: '2. 商業名稱 (如有的話)', dataSource: 'tradingName' },
  { field: 'cb_1_P.1', description: '3. 公司類別 - 私人公司', dataSource: 'companyType 包含「私人」' },
  { field: 'cb_2_P.1', description: '3. 公司類別 - 公眾公司', dataSource: 'companyType 包含「公眾」' },
  { field: 'cb_3_P.1', description: '3. 公司類別 - 擔保有限公司', dataSource: 'companyType 包含「擔保」' },
  { field: 'fill_4_P.1', description: '9. 經營業務性質 - 編碼', dataSource: 'businessCode' },
  { field: 'fill_5_P.1', description: '9. 經營業務性質 - 描述', dataSource: 'businessNature' },
  { field: 'fill_6_P.1', description: '4. 結算日期 - 日 (DD)', dataSource: 'returnDate 中的日' },
  { field: 'fill_7_P.1', description: '4. 結算日期 - 月 (MM)', dataSource: 'returnDate 中的月' },
  { field: 'fill_8_P.1', description: '4. 結算日期 - 年 (YYYY)', dataSource: 'returnDate 中的年' },
  { field: 'fill_15_P.1', description: '6. 註冊地址 - 室／樓／座等', dataSource: 'registeredOffice.flat' },
  { field: 'fill_16_P.1', description: '6. 註冊地址 - 大廈', dataSource: 'registeredOffice.building' },
  { field: 'fill_17_P.1', description: '6. 註冊地址 - 街道', dataSource: 'registeredOffice.street' },
  { field: 'fill_18_P.1', description: '6. 註冊地址 - 區', dataSource: 'registeredOffice.district' },
];

const page3Fields = [
  { field: 'fill_1_P.3', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.3', description: '15. 秘書中文姓名', dataSource: 'secretaries[0].nameChinese' },
  { field: 'fill_3_P.3', description: '15. 秘書英文姓氏 (Surname)', dataSource: 'secretaries[0].nameEnglish 最後一詞' },
  { field: 'fill_4_P.3', description: '15. 秘書其他英文名字', dataSource: 'secretaries[0].nameEnglish 除姓氏外' },
  { field: 'fill_13_P.3', description: '17. 秘書電郵地址', dataSource: 'secretaries[0].email' },
];

const page5Fields = [
  { field: 'fill_1_P.5', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'cb_1_P.5', description: '23. 身分 - 董事', dataSource: '自動勾選' },
  { field: 'cb_2_P.5', description: '23. 身分 - 候補董事', dataSource: '如適用' },
  { field: 'fill_2_P.5', description: '24. 董事中文姓名', dataSource: 'directors[0].nameChinese' },
  { field: 'fill_3_P.5', description: '24. 董事英文姓氏 (Surname)', dataSource: 'directors[0].nameEnglish 最後一詞' },
  { field: 'fill_4_P.5', description: '24. 董事其他英文名字', dataSource: 'directors[0].nameEnglish 除姓氏外' },
  { field: 'fill_14_P.5', description: '26. 董事電郵地址', dataSource: 'directors[0].email' },
];

const FieldMapping = () => {
  const [allFields, setAllFields] = useState<FieldInfo[]>([]);
  const [loading, setLoading] = useState(false);

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
        description="顯示 NAR1 周年申報表 PDF 模板的欄位編號與資料映射關係"
      />

      <Tabs defaultValue="mapping" className="space-y-4">
        <TabsList>
          <TabsTrigger value="mapping">欄位映射</TabsTrigger>
          <TabsTrigger value="all-fields">所有欄位</TabsTrigger>
        </TabsList>

        <TabsContent value="mapping" className="space-y-4">
          {/* Page 1 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                第 1 頁 - 公司基本資料 / 業務性質 / 結算日期 / 註冊地址
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">欄位編號</TableHead>
                    <TableHead>表格項目</TableHead>
                    <TableHead>資料來源</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page1Fields.map((field) => (
                    <TableRow key={field.field}>
                      <TableCell>
                        <Badge variant={field.field.startsWith('cb_') ? 'secondary' : 'outline'}>
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

          {/* Page 3 - Secretary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                第 3 頁 - 公司秘書 (自然人) 12A
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">欄位編號</TableHead>
                    <TableHead>表格項目</TableHead>
                    <TableHead>資料來源</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page3Fields.map((field) => (
                    <TableRow key={field.field}>
                      <TableCell>
                        <Badge variant={field.field.startsWith('cb_') ? 'secondary' : 'outline'}>
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

          {/* Page 5 - Director */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                第 5 頁 - 董事 (自然人) 13A
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">欄位編號</TableHead>
                    <TableHead>表格項目</TableHead>
                    <TableHead>資料來源</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page5Fields.map((field) => (
                    <TableRow key={field.field}>
                      <TableCell>
                        <Badge variant={field.field.startsWith('cb_') ? 'secondary' : 'outline'}>
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

export default FieldMapping;
