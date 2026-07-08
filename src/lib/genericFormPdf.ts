// Shared helper: call generate-generic-form-pdf and trigger download + open in new tab.
import { toast } from '@/hooks/use-toast';
import { downloadAndOpenBase64Pdf } from '@/lib/downloadPdf';

export interface GenericFormSection {
  heading?: string;
  rows?: [string, string][];
  paragraph?: string;
  bullets?: string[];
}

export interface GenericFormPayload {
  formCode: string;
  title: string;
  subtitle?: string;
  companyName?: string;
  brNumber?: string;
  sections: GenericFormSection[];
  signatureLines?: string[];
}

export async function downloadGenericFormPdf(payload: GenericFormPayload, fileLabel?: string) {
  try {
    const token = localStorage.getItem("secretary_jwt") || "";
    const url = `/api/generate-generic-form-pdf`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Unknown error');

    const filename = `${fileLabel || payload.formCode}_${payload.brNumber || ''}_${payload.companyName || ''}.pdf`.replace(/__+/g, '_');
    downloadAndOpenBase64Pdf(result.pdf, filename);
    return true;
  } catch (e: any) {
    toast({ title: 'PDF 生成失敗', description: e.message, variant: 'destructive' });
    return false;
  }
}
