import { useMutation } from '@tanstack/react-query';
import { downloadBase64File, DOCX_MIME } from '@/lib/downloadPdf';

// 支援的 Word 文件類型（對應後端 DOCX_TYPES）
export const DOCX_DOC_TYPES: { key: string; label: string; description: string; needsContent?: boolean }[] = [
  { key: 'company_profile', label: '公司資料摘要', description: '公司基本資料 + 董事 / 秘書 / 股東 / 股本結構總覽' },
  { key: 'directors_register', label: '董事名冊', description: '依《公司條例》第641條 — 董事姓名、證件、委任日期、住址' },
  { key: 'members_register', label: '成員（股東）名冊', description: '依《公司條例》第627條 — 股東持股、類別、佔比' },
  { key: 'board_resolution', label: '董事會書面決議', description: '書面決議範本，自動帶入公司抬頭與董事簽署欄', needsContent: true },
  { key: 'meeting_minutes', label: '董事會會議記錄', description: '會議記錄範本，自動帶入出席董事、主席與議決事項', needsContent: true },
];

export interface GenerateDocxInput {
  company_id: string;
  doc_type: string;
  content?: string;       // 決議 / 會議記錄的議決事項內文
  meeting_date?: string;  // 會議 / 決議日期
  location?: string;      // 會議地點
}

interface GenerateDocxResult {
  success: boolean;
  docx: string;     // base64
  filename: string;
  doc_type: string;
}

export function useGenerateDocx() {
  return useMutation({
    mutationFn: async (input: GenerateDocxInput): Promise<GenerateDocxResult> => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch('/api/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || result.success === false) {
        throw new Error(result.error || `HTTP ${resp.status}`);
      }
      return result as GenerateDocxResult;
    },
    onSuccess: (result) => {
      downloadBase64File(result.docx, result.filename, DOCX_MIME);
    },
  });
}
