import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface Env {
  DB: D1Database;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHINESE_FONT_URL = 'https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf';

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { companyId } = await request.json();
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'companyId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [company, scrResult, fontResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at").bind(companyId).all(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: '*/*' } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!fontResp.ok) throw new Error('Failed to load Chinese font');
    const scrs = (scrResult.results || []) as any[];

    const fontBytes = await fontResp.arrayBuffer();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes);

    let page = pdf.addPage([595, 842]);
    let y = 800;
    const left = 50;

    const draw = (text: string, x: number, opts: { size?: number; color?: any } = {}) => {
      page.drawText(text || '', { x, y, size: opts.size ?? 10, font, color: opts.color ?? rgb(0, 0, 0) });
    };
    const newLine = (delta = 14) => {
      y -= delta;
      if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
    };

    draw('重要控制人登記冊 / Significant Controllers Register', left, { size: 16 });
    newLine(22);
    draw(`公司名稱: ${(company as any).name || ''}`, left, { size: 11 });
    newLine();
    if ((company as any).chinese_name) { draw(`中文名稱: ${(company as any).chinese_name}`, left); newLine(); }
    draw(`商業登記號碼 BR: ${(company as any).company_number || '-'}`, left);
    newLine();
    draw(`生成日期: ${new Date().toISOString().slice(0, 10)}`, left);
    newLine(22);

    if (scrs.length === 0) {
      draw('(無記錄 / None)', left, { color: rgb(0.5, 0.5, 0.5) });
    }

    scrs.forEach((s: any, idx: number) => {
      draw(`${idx + 1}. ${s.name_english || s.name_chinese || '(unnamed)'}`, left, { size: 12 });
      newLine(16);
      const natures: string[] = [];
      if (s.nature_shares) natures.push('持股 >25%');
      if (s.nature_voting) natures.push('表決權 >25%');
      if (s.nature_appoint) natures.push('任命董事權');
      if (s.nature_influence) natures.push('重大影響');
      if (s.nature_trust) natures.push('信託控制');
      if (s.nature_other) natures.push(s.nature_other);
      const rows: [string, string][] = [
        ['身份 Identity', s.identity === 'corporate' ? '法人 Corporate' : '自然人 Natural'],
        ['身份證/編號', s.id_number || '-'],
        ['中文名稱', s.name_chinese || '-'],
        ['居住/註冊地址', s.address || '-'],
        ['服務地址 Service Address', s.service_address || '-'],
        ['成為控制人日期', s.date_became || '-'],
        ['停止日期 Date Ceased', s.date_ceased || '-'],
        ['控制性質 Nature of Control', natures.join('、') || '-'],
      ];
      if (s.is_designated_rep) {
        rows.push(['指定代表 Designated Rep', `${s.designated_rep_name || '-'} (${s.designated_rep_contact || '-'})`]);
      }
      rows.forEach(([k, v]) => {
        draw(`  ${k}:`, left, { size: 9, color: rgb(0.4, 0.4, 0.4) });
        draw(v, left + 160, { size: 9 });
        newLine(12);
      });
      newLine(8);
    });

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="SCR_${(company as any).company_number || 'company'}.pdf"`,
      },
    });
  } catch (e: any) {
    console.error('SCR PDF error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
