import { useMutation } from '@tanstack/react-query';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

export interface AutoCRFormPdfInput {
  company_id: string;
  form_code: string;   // nar1 | nd2a | nd2b | ... | nn9
}

interface AutoCRFormPdfResult {
  success: boolean;
  pdf: string;     // base64
  filename: string;
}

export function useAutoCRFormPdf() {
  return useMutation({
    mutationFn: async (input: AutoCRFormPdfInput): Promise<AutoCRFormPdfResult> => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch('/api/generate-cr-form-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || result.success === false) {
        throw new Error(result.error || `HTTP ${resp.status}`);
      }
      return result as AutoCRFormPdfResult;
    },
    onSuccess: (result) => {
      downloadBase64Pdf(result.pdf, result.filename);
    },
  });
}
