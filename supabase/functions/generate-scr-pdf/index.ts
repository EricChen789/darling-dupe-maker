import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { companyId } = await req.json();
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'companyId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [companyRes, scrRes] = await Promise.all([
      supabase.from('companies').select('*').eq('id', companyId).single(),
      supabase.from('significant_controllers').select('*').eq('company_id', companyId).order('created_at'),
    ]);

    if (companyRes.error) throw companyRes.error;
    const company = companyRes.data;
    const scrs = (scrRes.data || []) as any[];

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // ASCII-only sanitize (Helvetica doesn't support CJK glyphs)
    const ascii = (s: string) => (s || '').replace(/[^\x00-\x7F]/g, '?');

    let page = pdf.addPage([595, 842]); // A4
    let y = 800;

    const drawText = (text: string, x: number, opts: { size?: number; bold?: boolean; color?: any } = {}) => {
      page.drawText(ascii(text), {
        x, y,
        size: opts.size ?? 10,
        font: opts.bold ? fontBold : font,
        color: opts.color ?? rgb(0, 0, 0),
      });
    };

    const newLine = (delta = 14) => { y -= delta; if (y < 60) { page = pdf.addPage([595, 842]); y = 800; } };

    drawText('Significant Controllers Register', 50, { size: 16, bold: true });
    newLine(20);
    drawText(`Company: ${company.name}`, 50, { size: 11, bold: true });
    newLine();
    if (company.chinese_name) { drawText(`Chinese Name: ${company.chinese_name}`, 50); newLine(); }
    drawText(`Company Number / BR: ${company.company_number || '-'}`, 50);
    newLine();
    drawText(`Date Generated: ${new Date().toISOString().slice(0, 10)}`, 50);
    newLine(24);

    if (scrs.length === 0) {
      drawText('No significant controllers recorded.', 50, { color: rgb(0.5, 0.5, 0.5) });
    }

    scrs.forEach((s, idx) => {
      drawText(`${idx + 1}. ${s.name_english || s.name_chinese || '(unnamed)'}`, 50, { size: 12, bold: true });
      newLine(16);
      const rows: [string, string][] = [
        ['Identity', s.identity === 'corporate' ? 'Corporate' : 'Natural Person'],
        ['ID / Passport / Reg No.', s.id_number || '-'],
        ['Chinese Name', s.name_chinese || '-'],
        ['Residential / Reg Address', s.address || '-'],
        ['Service Address', s.service_address || '-'],
        ['Date Became Controller', s.date_became || '-'],
        ['Date Ceased', s.date_ceased || '-'],
        ['Nature of Control', [
          s.nature_shares && '>25% shares',
          s.nature_voting && '>25% voting rights',
          s.nature_appoint && 'Right to appoint/remove majority of directors',
          s.nature_influence && 'Significant influence/control',
          s.nature_trust && 'Trust/firm control',
          s.nature_other,
        ].filter(Boolean).join('; ') || '-'],
      ];
      if (s.is_designated_rep) {
        rows.push(['Designated Representative', `${s.designated_rep_name || s.name_english || '-'} (${s.designated_rep_contact || '-'})`]);
      }
      rows.forEach(([k, v]) => {
        drawText(k + ':', 60, { size: 9, bold: true });
        const wrapped = wrap(v, 80);
        wrapped.forEach((line, i) => {
          page.drawText(ascii(line), { x: 200, y: y - i * 12, size: 9, font });
        });
        newLine(Math.max(14, wrapped.length * 12 + 2));
      });
      newLine(8);
      page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 545, y: y + 4 }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
      newLine(6);
    });

    const bytes = await pdf.save();
    return new Response(bytes as BodyInit, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="SCR_${company.company_number || 'company'}.pdf"`,
      },
    });
  } catch (e: any) {
    console.error('SCR PDF error:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

function wrap(text: string, max: number): string[] {
  if (!text) return ['-'];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + w).length > max) { if (cur) lines.push(cur); cur = w.trimStart(); }
    else cur += w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ['-'];
}
