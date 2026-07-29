// POST /api/generate-cr-form-pdf
// Auto-fill CR form PDF from company data (production — Cloudflare Functions)
// body: { company_id, form_code }
// resp: { success: true, pdf: '<base64>', filename }

import { PDFDocument, rgb } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget, fmtDate,
  drawMixed, segmentText, widthOfText, personLabel,
  fetchAndEmbedFont, buildAddress
} from './_pdf-utils';
import { verifyAuthRequest, type User, type Env } from './_auth';

const CR_FORM_META: Record<string, { code: string; title: string; title_en: string }> = {
  nar1:  { code: 'NAR1',  title: '周年申報表',           title_en: 'Annual Return' },
  nd2a:  { code: 'ND2A',  title: '更改公司秘書及董事通知書（委任／停任）', title_en: 'Notice of Change of Company Secretary and Director (Appointment/Cessation)' },
  nd2b:  { code: 'ND2B',  title: '更改公司秘書及董事詳情通知書',       title_en: 'Notice of Change in Particulars of Company Secretary and Director' },
  nd4:   { code: 'ND4',   title: '公司秘書及董事辭任通知書',           title_en: 'Notice of Resignation of Company Secretary and Director' },
  ndr1:  { code: 'NDR1',  title: '撤銷註冊申請書',                    title_en: 'Application for Deregistration' },
  nr1:   { code: 'NR1',   title: '註冊辦事處地址變更通知書',           title_en: 'Notice of Change of Registered Office Address' },
  nsc1:  { code: 'NSC1',  title: '股份配發申報書',                    title_en: 'Return of Allotment' },
  nnc1:  { code: 'NNC1',  title: '法團成立表格（股份有限公司）',        title_en: 'Incorporation Form (Company Limited by Shares)' },
  nnc2:  { code: 'NNC2',  title: '更改公司名稱通知書',                 title_en: 'Notice of Change of Company Name' },
  nn1:   { code: 'NN1',   title: '註冊非香港公司註冊申請書',            title_en: 'Application for Registration as Registered Non-Hong Kong Company' },
  nn3:   { code: 'NN3',   title: '註冊非香港公司周年申報表',            title_en: 'Annual Return of Registered Non-Hong Kong Company' },
  nn6:   { code: 'NN6',   title: '非香港公司更改秘書及董事（委任／停任）', title_en: 'Change of Company Secretary and Director of Non-Hong Kong Company' },
  nn7:   { code: 'NN7',   title: '非香港公司更改秘書及董事詳情',         title_en: 'Change in Particulars of Company Secretary and Director of Non-Hong Kong Company' },
  nn9:   { code: 'NN9',   title: '非香港公司更改地址申報表',            title_en: 'Notice of Change of Address of Non-Hong Kong Company' },
};

async function fetchCompanyBundle(db: D1Database, companyId: string) {
  const row = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
  if (!row) return null;

  const { results: members } = await db.prepare(
    `SELECT pcr.role, pcr.shares, pcr.share_type, pcr.currency, pcr.paid_up,
            pcr.date_appointed, pcr.date_ceased, pcr.is_reserve,
            p.name_english, p.name_chinese, p.id_number, p.passport_number,
            p.address, p.service_address, p.email, p.phone, p.identity, p.tcsp_number
     FROM person_company_roles pcr JOIN persons p ON p.id = pcr.person_id
     WHERE pcr.company_id = ? AND (pcr.date_ceased IS NULL OR pcr.date_ceased = '')
     ORDER BY pcr.role, p.name_english`
  ).bind(companyId).all();

  const directors = members.filter((m: any) => m.role === 'director');
  const secretaries = members.filter((m: any) => m.role === 'secretary');
  const shareholders = members.filter((m: any) => m.role === 'shareholder');
  const totalShares = shareholders.reduce((sum: number, m: any) => sum + (Number(m.shares) || 0), 0);

  const c = row as any;
  const address = buildAddress(c);

  return { c, address, directors, secretaries, shareholders, totalShares };
}

// ─── PDF builder ───
async function buildPdf(
  bundle: any,
  meta: { code: string; title: string; title_en: string },
  formCode: string,
  env: Env
) {
  const doc = await PDFDocument.create();
  const { cjk, ascii, cjkMissing } = await fetchAndEmbedFont(doc, env as any);

  const MARGIN = 50;
  const PAGE_W = 595, PAGE_H = 842; // A4
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = 800;
  const lineH = 14;

  // Helper: draw a line of text with mixed CJK/ASCII
  const drawLine = (text: string, size = 10, bold = false, color?: any) => {
    if (y < 60) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = 800;
    }
    drawMixed(page, text, {
      x: MARGIN, y, size,
      cjk: bold ? cjk : (cjkMissing ? ascii : cjk),
      ascii,
      color,
    });
    y -= lineH;
  };

  // Helper: centered title
  const drawTitle = (text: string, size = 14, color?: any) => {
    const w = widthOfText(text, cjk, ascii, size);
    const x = (PAGE_W - w) / 2;
    drawMixed(page, text, { x, y, size, cjk, ascii, color });
    y -= lineH + 4;
  };

  const c = bundle.c;
  const nameEn = rget(c, 'name');
  const nameCn = rget(c, 'chinese_name');
  const br = rget(c, 'company_number');
  const cr = rget(c, 'ci_number');

  const BLUE = rgb(0, 0.2, 0.6);

  drawTitle(`${meta.title}  ${meta.code}`, 16, BLUE);
  drawTitle(meta.title_en, 10, BLUE);
  y -= 4;
  drawLine(`公司註冊處表格 ${meta.code} · 由系統自動填入生成草稿`, 8);
  y -= 6;

  // Company info
  drawLine('公司基本資料', 11, true);
  const info: [string, string][] = [
    ['英文名稱', nameEn], ['中文名稱', nameCn],
    ['商業登記號碼 (BR)', br], ['公司註冊編號 (CR)', cr],
    ['公司類型', rget(c, 'company_type')], ['成立日期', fmtDate(rget(c, 'incorporation_date'))],
    ['狀態', rget(c, 'status')], ['註冊辦事處地址', bundle.address],
    ['電郵', rget(c, 'email')], ['電話', rget(c, 'phone')],
  ];
  for (const [label, val] of info) {
    if (val) drawLine(`${label}：${val}`, 9);
  }
  y -= 4;

  // Directors & Secretaries
  const hasOfficers = ['nar1','nd2a','nd2b','nd4','nnc1','nn1','nn3','nn6','nn7'].includes(formCode);
  if (hasOfficers) {
    drawLine(`董事（${bundle.directors.length} 人）`, 10, true);
    for (const d of bundle.directors) {
      const parts = [personLabel(d), rget(d, 'id_number') || rget(d, 'passport_number') || '', `委任: ${fmtDate(rget(d, 'date_appointed'))}`];
      drawLine(`  ${parts.filter(Boolean).join('  |  ')}`, 8);
    }
    if (!bundle.directors.length) drawLine('  （無董事記錄）', 8);
    y -= 2;

    drawLine(`公司秘書（${bundle.secretaries.length} 人）`, 10, true);
    for (const s of bundle.secretaries) {
      const parts = [personLabel(s), `TCSP: ${rget(s, 'tcsp_number')}`, `委任: ${fmtDate(rget(s, 'date_appointed'))}`];
      drawLine(`  ${parts.filter(Boolean).join('  |  ')}`, 8);
    }
    if (!bundle.secretaries.length) drawLine('  （無秘書記錄）', 8);
    y -= 4;
  }

  // Shareholders
  const hasShares = ['nar1','nsc1','nnc1','nn1','nn3'].includes(formCode);
  if (hasShares) {
    drawLine(`股東／股本結構（總發行股數：${bundle.totalShares}）`, 10, true);
    for (const sh of bundle.shareholders) {
      const pct = bundle.totalShares ? `${(Number(sh.shares || 0) * 100 / bundle.totalShares).toFixed(2)}%` : '—';
      drawLine(`  ${personLabel(sh)}  |  ${sh.shares || 0} 股  |  ${sh.share_type || '普通股'}  |  ${pct}`, 8);
    }
    if (!bundle.shareholders.length) drawLine('  （無股東記錄）', 8);
    y -= 4;
  }

  // Form-specific
  if (formCode === 'nar1') {
    drawLine('重要控制人登記冊 (SCR) 是否備存於公司註冊辦事處？  是 □  否 □', 9);
  }
  if (['nr1','ndr1','nn9'].includes(formCode)) {
    drawLine(`現有註冊地址：${bundle.address || '（未填）'}`, 9);
    drawLine('變更後註冊地址（請手動填寫）：＿＿＿＿＿＿＿＿＿＿＿＿', 9);
  }
  if (formCode === 'nsc1') {
    for (const line of ['配發日期：＿＿＿＿', '配發股份類別：＿＿＿＿', '每股發行價：＿＿＿＿', '配發總額：＿＿＿＿']) {
      drawLine(line, 9);
    }
  }

  // Signature block
  y -= 10;
  if (y < 120) { page = doc.addPage([PAGE_W, PAGE_H]); y = 800; }
  drawLine('簽署 / SIGNED:', 10, true);
  y -= 8;
  drawLine('_______________________________', 10);
  drawLine('董事 / Director       日期 Date：＿＿＿＿', 9);
  y -= 4;
  drawLine('_______________________________', 10);
  drawLine('公司秘書 / Company Secretary       日期 Date：＿＿＿＿', 9);

  // Footer
  y -= 10;
  if (y < 50) { page = doc.addPage([PAGE_W, PAGE_H]); y = 800; }
  const today = new Date().toISOString().slice(0, 10);
  drawLine(`本文件由公司秘書管理系統自動生成 · ${today}`, 7);

  const pdfBytes = await doc.save();
  return pdfBytes;
}

// ─── Route handler ───
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  // Auth
  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const body: any = await request.json().catch(() => ({}));
    const companyId = body.company_id || body.companyId;
    const formCode = (body.form_code || body.formType || '').toLowerCase();
    if (!companyId || !formCode) return jsonResp({ error: '缺少 company_id 或 form_code' }, 400);

    const meta = CR_FORM_META[formCode];
    if (!meta) return jsonResp({ error: `不支援的表格代碼：${formCode}` }, 400);

    const bundle = await fetchCompanyBundle(env.DB as unknown as D1Database, companyId);
    if (!bundle) return jsonResp({ error: '找不到該公司' }, 404);

    const pdfBytes = await buildPdf(bundle, meta, formCode, env);

    const bytes = new Uint8Array(pdfBytes);
    const base64 = uint8ToBase64(bytes);

    const safeName = (bundle.c.name || bundle.c.chinese_name || 'company')
      .replace(/[^\w一-鿿-]/g, '_').slice(0, 30);
    const filename = `${meta.code}_${meta.title}_${safeName}.pdf`;

    return jsonResp({ success: true, pdf: base64, filename });
  } catch (e: any) {
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
