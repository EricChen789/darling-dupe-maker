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
  { field: 'fill_9_P.1', description: '5. 財務報表期間開始 - 日', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_10_P.1', description: '5. 財務報表期間開始 - 月', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_11_P.1', description: '5. 財務報表期間開始 - 年', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_12_P.1', description: '5. 財務報表期間結束 - 日', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_13_P.1', description: '5. 財務報表期間結束 - 月', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_14_P.1', description: '5. 財務報表期間結束 - 年', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_15_P.1', description: '6. 註冊地址 - 室／樓／座等', dataSource: 'registeredOffice.flat' },
  { field: 'fill_16_P.1', description: '6. 註冊地址 - 大廈', dataSource: 'registeredOffice.building' },
  { field: 'fill_17_P.1', description: '6. 註冊地址 - 街道', dataSource: 'registeredOffice.street' },
  { field: 'fill_18_P.1', description: '6. 註冊地址 - 區', dataSource: 'registeredOffice.district' },
];

const page2Fields = [
  { field: 'fill_1_P.2', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.2', description: '9. 按揭及押記負債總額', dataSource: 'mortgageAmount' },
  { field: 'fill_3_P.2', description: '10. 無股本公司成員人數', dataSource: '(適用於無股本公司)' },
  { field: 'fill_4_P.2', description: '11. 股本資料 - 股份類別 1', dataSource: 'shareCapital[0].class' },
  { field: 'fill_5_P.2', description: '11. 股本資料 - 貨幣 1', dataSource: 'shareCapital[0].currency' },
  { field: 'fill_6_P.2', description: '11. 股本資料 - 股份數目 1', dataSource: 'shareCapital[0].shares' },
  { field: 'fill_7_P.2', description: '11. 股本資料 - 繳足款額 1', dataSource: 'shareCapital[0].paidUp' },
  { field: 'fill_8_P.2', description: '11. 股本資料 - 股份類別 2', dataSource: 'shareCapital[1].class' },
  { field: 'fill_9_P.2', description: '11. 股本資料 - 貨幣 2', dataSource: 'shareCapital[1].currency' },
  { field: 'fill_10_P.2', description: '11. 股本資料 - 股份數目 2', dataSource: 'shareCapital[1].shares' },
  { field: 'fill_11_P.2', description: '11. 股本資料 - 繳足款額 2', dataSource: 'shareCapital[1].paidUp' },
  { field: 'fill_12_P.2', description: '11. 股本資料 - 股份類別 3', dataSource: 'shareCapital[2].class' },
  { field: 'fill_13_P.2', description: '11. 股本資料 - 貨幣 3', dataSource: 'shareCapital[2].currency' },
  { field: 'fill_14_P.2', description: '11. 股本資料 - 股份數目 3', dataSource: 'shareCapital[2].shares' },
  { field: 'fill_15_P.2', description: '11. 股本資料 - 繳足款額 3', dataSource: 'shareCapital[2].paidUp' },
];

const page3Fields = [
  { field: 'fill_1_P.3', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.3', description: '15. 秘書中文姓名', dataSource: 'secretaries[0].nameChinese' },
  { field: 'fill_3_P.3', description: '15. 秘書英文姓氏 (Surname)', dataSource: 'secretaries[0].nameEnglish 最後一詞' },
  { field: 'fill_4_P.3', description: '15. 秘書其他英文名字', dataSource: 'secretaries[0].nameEnglish 除姓氏外' },
  { field: 'fill_5_P.3', description: '前用姓名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_6_P.3', description: '前用姓名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_7_P.3', description: '別名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_8_P.3', description: '別名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_9_P.3', description: '16. 香港通訊地址 - 室／樓／座等', dataSource: 'secretaries[0].address.flat' },
  { field: 'fill_10_P.3', description: '16. 香港通訊地址 - 大廈', dataSource: 'secretaries[0].address.building' },
  { field: 'fill_11_P.3', description: '16. 香港通訊地址 - 街道', dataSource: 'secretaries[0].address.street' },
  { field: 'fill_12_P.3', description: '16. 香港通訊地址 - 區', dataSource: 'secretaries[0].address.district' },
  { field: 'fill_13_P.3', description: '17. 秘書電郵地址', dataSource: 'secretaries[0].email' },
  { field: 'fill_14_P.3', description: '18a. 香港身分證部分號碼', dataSource: 'secretaries[0].hkidPartial' },
  { field: 'fill_15_P.3', description: '18b. 護照簽發國家/地區', dataSource: 'secretaries[0].passportCountry' },
  { field: 'cb_1_P.3', description: '20. 無須領有牌照', dataSource: '(如適用)' },
];

const page4Fields = [
  { field: 'fill_1_P.4', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.4', description: '21. 法人秘書中文名稱', dataSource: '法人秘書 nameChinese' },
  { field: 'fill_3_P.4', description: '21. 法人秘書英文名稱', dataSource: '法人秘書 nameEnglish' },
  { field: 'fill_4_P.4', description: '22. 香港地址 - 室／樓／座等', dataSource: '法人秘書地址 flat' },
  { field: 'fill_5_P.4', description: '22. 香港地址 - 大廈', dataSource: '法人秘書地址 building' },
  { field: 'fill_6_P.4', description: '22. 香港地址 - 街道', dataSource: '法人秘書地址 street' },
  { field: 'fill_7_P.4', description: '22. 香港地址 - 區', dataSource: '法人秘書地址 district' },
  { field: 'fill_8_P.4', description: '17. 法人秘書電郵地址', dataSource: '法人秘書 email' },
  { field: 'fill_9_P.4', description: '19. 法人秘書商業登記號碼', dataSource: '法人秘書 brNumber' },
  { field: 'cb_1_P.4', description: '20. 無須領有牌照', dataSource: '(如適用)' },
];

const page5Fields = [
  { field: 'fill_1_P.5', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'cb_1_P.5', description: '23. 身分 - 董事', dataSource: '自動勾選' },
  { field: 'cb_2_P.5', description: '23. 身分 - 候補董事', dataSource: '(如適用)' },
  { field: 'fill_2_P.5', description: '24. 董事中文姓名', dataSource: 'directors[0].nameChinese' },
  { field: 'fill_3_P.5', description: '24. 董事英文姓氏 (Surname)', dataSource: 'directors[0].nameEnglish 最後一詞' },
  { field: 'fill_4_P.5', description: '24. 董事其他英文名字', dataSource: 'directors[0].nameEnglish 除姓氏外' },
  { field: 'fill_5_P.5', description: '前用姓名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_6_P.5', description: '前用姓名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_7_P.5', description: '別名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_8_P.5', description: '別名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_9_P.5', description: '25. 通訊地址 - 室／樓／座等', dataSource: 'directors[0].address.flat' },
  { field: 'fill_10_P.5', description: '25. 通訊地址 - 大廈', dataSource: 'directors[0].address.building' },
  { field: 'fill_11_P.5', description: '25. 通訊地址 - 街道', dataSource: 'directors[0].address.street' },
  { field: 'fill_12_P.5', description: '25. 通訊地址 - 區/市/省/郵遞區號', dataSource: 'directors[0].address.district' },
  { field: 'fill_13_P.5', description: '25. 通訊地址 - 國家/地區', dataSource: 'directors[0].address.country' },
  { field: 'fill_14_P.5', description: '26. 董事電郵地址', dataSource: 'directors[0].email' },
  { field: 'fill_15_P.5', description: '27a. 香港身分證部分號碼', dataSource: 'directors[0].hkidPartial' },
];

const page6Fields = [
  { field: 'fill_1_P.6', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'cb_1_P.6', description: '23. 身分 - 董事', dataSource: '自動勾選' },
  { field: 'cb_2_P.6', description: '23. 身分 - 候補董事', dataSource: '(如適用)' },
  { field: 'cb_3_P.6', description: '在香港成立', dataSource: '(如適用)' },
  { field: 'cb_4_P.6', description: '在香港以外地方成立', dataSource: '(如適用)' },
  { field: 'fill_2_P.6', description: '法人董事中文名稱', dataSource: '法人董事 nameChinese' },
  { field: 'fill_3_P.6', description: '法人董事英文名稱', dataSource: '法人董事 nameEnglish' },
  { field: 'fill_4_P.6', description: '地址 - 室／樓／座等', dataSource: '法人董事地址 flat' },
  { field: 'fill_5_P.6', description: '地址 - 大廈', dataSource: '法人董事地址 building' },
  { field: 'fill_6_P.6', description: '地址 - 街道', dataSource: '法人董事地址 street' },
  { field: 'fill_7_P.6', description: '地址 - 區', dataSource: '法人董事地址 district' },
  { field: 'fill_8_P.6', description: '法人董事電郵地址', dataSource: '法人董事 email' },
  { field: 'fill_9_P.6', description: '法人董事商業登記號碼', dataSource: '法人董事 brNumber' },
];

const page7Fields = [
  { field: 'fill_1_P.7', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.7', description: '備任董事中文姓名', dataSource: 'reserveDirector.nameChinese' },
  { field: 'fill_3_P.7', description: '備任董事英文姓氏', dataSource: 'reserveDirector.nameEnglish 姓氏' },
  { field: 'fill_4_P.7', description: '備任董事其他英文名字', dataSource: 'reserveDirector.nameEnglish 其他' },
  { field: 'cb_1_P.7', description: '備任董事相關勾選項', dataSource: '(如適用)' },
];

const page8Fields = [
  { field: 'fill_1_P.8', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.8', description: '送達代理人中文姓名', dataSource: 'serviceAgent.nameChinese' },
  { field: 'fill_3_P.8', description: '送達代理人英文姓名', dataSource: 'serviceAgent.nameEnglish' },
  { field: 'Dropdown_1_P.8', description: '送達代理人類別下拉選單', dataSource: 'serviceAgent.type' },
];

const page9Fields = [
  { field: 'fill_1_P.9', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.9', description: '成員詳情 - 姓名/名稱', dataSource: 'members[0].name' },
  { field: 'fill_3_P.9', description: '成員詳情 - 股份數目', dataSource: 'members[0].shares' },
  { field: 'cb_1_P.9', description: '成員詳情相關勾選項', dataSource: '(如適用)' },
];

const page10to13Fields = [
  { field: 'fill_X_P.10~13', description: '附表一 - 非上市公司成員', dataSource: 'members[] (詳細列表)' },
];

const page14to15Fields = [
  { field: 'fill_1_P.14', description: '聲明人姓名', dataSource: 'declarant.name' },
  { field: 'fill_2_P.14', description: '聲明人身分', dataSource: 'declarant.capacity' },
  { field: 'fill_3_P.14', description: '簽署日期 - 日', dataSource: 'signatureDate 日' },
  { field: 'fill_4_P.14', description: '簽署日期 - 月', dataSource: 'signatureDate 月' },
  { field: 'fill_5_P.14', description: '簽署日期 - 年', dataSource: 'signatureDate 年' },
  { field: 'cb_1_P.14', description: '聲明確認勾選', dataSource: '(必須勾選)' },
  { field: 'fill_1_P.15', description: '聯絡人姓名', dataSource: 'contact.name' },
  { field: 'fill_2_P.15', description: '聯絡電話', dataSource: 'contact.phone' },
  { field: 'fill_3_P.15', description: '聯絡電郵', dataSource: 'contact.email' },
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
          <FieldMappingCard title="第 1 頁 - 公司基本資料 / 業務性質 / 結算日期 / 註冊地址" fields={page1Fields} />
          <FieldMappingCard title="第 2 頁 - 按揭及押記 / 成員人數 / 股本" fields={page2Fields} />
          <FieldMappingCard title="第 3 頁 - 公司秘書 (自然人) 12A" fields={page3Fields} />
          <FieldMappingCard title="第 4 頁 - 公司秘書 (法人團體) 12B" fields={page4Fields} />
          <FieldMappingCard title="第 5 頁 - 董事 (自然人) 13A" fields={page5Fields} />
          <FieldMappingCard title="第 6 頁 - 董事 (法人團體) 13B" fields={page6Fields} />
          <FieldMappingCard title="第 7 頁 - 備任董事" fields={page7Fields} />
          <FieldMappingCard title="第 8 頁 - 法律程序文件送達代理人" fields={page8Fields} />
          <FieldMappingCard title="第 9 頁 - 成員詳情" fields={page9Fields} />
          <FieldMappingCard title="第 10-13 頁 - 附表一：非上市公司成員" fields={page10to13Fields} />
          <FieldMappingCard title="第 14-15 頁 - 聲明及簽署" fields={page14to15Fields} />
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
  fields: Array<{ field: string; description: string; dataSource: string }>;
}

const FieldMappingCard = ({ title, fields }: FieldMappingCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <FileText className="h-5 w-5" />
        {title}
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
          {fields.map((field) => (
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
);

export default FieldMapping;
