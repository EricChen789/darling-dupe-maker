// Shared helper: call generate-generic-form-pdf and trigger download + open in new tab.
import { toast } from '@/hooks/use-toast';

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
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-generic-form-pdf`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${fileLabel || payload.formCode}_${payload.brNumber || ''}_${payload.companyName || ''}.pdf`.replace(/__+/g, '_');
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.open(blobUrl, '_blank');
    return true;
  } catch (e: any) {
    toast({ title: 'PDF 生成失敗', description: e.message, variant: 'destructive' });
    return false;
  }
}
