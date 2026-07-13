// POST /api/generate-cr-form-pdf
// Auto-fill CR form PDF from company data (production — Cloudflare Functions)
// body: { company_id, form_code }
// resp: { success: true, pdf: '<base64>', filename }

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

// ─── JWT verify ───
async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const encoder = new TextEncoder();

    // Verify signature
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${headerB64}.${payloadB64}`));
    if (!valid) return null;

    // Parse payload
    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);

    // Check expiry
    if (payload.exp && Date.now() / 1000 > (payload.exp as number)) return null;

    return payload;
  } catch { return null; }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const t = String(s).trim();
  if (t.length === 8 && /^\d{8}$/.test(t)) return `${t.slice(0,2)}/${t.slice(2,4)}/${t.slice(4,8)}`;
  return t;
}

function personLabel(m: any): string {
  const en = (m.name_english || '').trim();
  const cn = (m.name_chinese || '').trim();
  if (en && cn) return `${en}（${cn}）`;
  return en || cn || '—';
}

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
  const addr = [c.reg_flat, c.reg_building, c.reg_street, c.reg_district, c.reg_region]
    .filter(Boolean).join(', ');

  return { c, address: addr, directors, secretaries, shareholders, totalShares };
}

// ─── PDF builder ───
async function buildPdf(bundle: any, meta: { code: string; title: string; title_en: string }, formCode: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]); // A4
  let y = 800;
  const margin = 50;
  const lineH = 14;

  const addLine = (text: string, size = 10, isBold = false) => {
    if (y < 60) { page = doc.addPage([595, 842]); y = 800; }
    const f = isBold ? bold : font;
    page.drawText(text, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
    y -= lineH;
  };

  const addTitle = (text: string, size = 14) => {
    const f = bold;
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (595 - w) / 2, y, size, font: f, color: rgb(0, 0, 0) });
    y -= lineH + 4;
  };

  const c = bundle.c;
  const nameEn = c.name || '';
  const nameCn = c.chinese_name || '';
  const br = c.company_number || '';
  const cr = c.ci_number || '';

  addTitle(`${meta.title}  ${meta.code}`, 16);
  addTitle(meta.title_en, 10);
  y -= 4;
  addLine(`公司註冊處表格 ${meta.code} · 由系統自動填入生成草稿`, 8);
  y -= 6;

  // Company info
  addLine('公司基本資料', 11, true);
  const info = [
    ['英文名稱', nameEn], ['中文名稱', nameCn],
    ['商業登記號碼 (BR)', br], ['公司註冊編號 (CR)', cr],
    ['公司類型', c.company_type || ''], ['成立日期', fmtDate(c.incorporation_date)],
    ['狀態', c.status || ''], ['註冊辦事處地址', bundle.address],
    ['電郵', c.email || ''], ['電話', c.phone || ''],
  ];
  for (const [label, val] of info) {
    if (val) addLine(`${label}：${val}`, 9);
  }
  y -= 4;

  // Directors & Secretaries
  const hasOfficers = ['nar1','nd2a','nd2b','nd4','nnc1','nn1','nn3','nn6','nn7'].includes(formCode);
  if (hasOfficers) {
    addLine(`董事（${bundle.directors.length} 人）`, 10, true);
    for (const d of bundle.directors) {
      const parts = [personLabel(d), d.id_number || d.passport_number || '', `委任: ${fmtDate(d.date_appointed)}`];
      addLine(`  ${parts.filter(Boolean).join('  |  ')}`, 8);
    }
    if (!bundle.directors.length) addLine('  （無董事記錄）', 8);
    y -= 2;

    addLine(`公司秘書（${bundle.secretaries.length} 人）`, 10, true);
    for (const s of bundle.secretaries) {
      const parts = [personLabel(s), `TCSP: ${s.tcsp_number || ''}`, `委任: ${fmtDate(s.date_appointed)}`];
      addLine(`  ${parts.filter(Boolean).join('  |  ')}`, 8);
    }
    if (!bundle.secretaries.length) addLine('  （無秘書記錄）', 8);
    y -= 4;
  }

  // Shareholders
  const hasShares = ['nar1','nsc1','nnc1','nn1','nn3'].includes(formCode);
  if (hasShares) {
    addLine(`股東／股本結構（總發行股數：${bundle.totalShares}）`, 10, true);
    for (const sh of bundle.shareholders) {
      const pct = bundle.totalShares ? `${(Number(sh.shares || 0) * 100 / bundle.totalShares).toFixed(2)}%` : '—';
      addLine(`  ${personLabel(sh)}  |  ${sh.shares || 0} 股  |  ${sh.share_type || '普通股'}  |  ${pct}`, 8);
    }
    if (!bundle.shareholders.length) addLine('  （無股東記錄）', 8);
    y -= 4;
  }

  // Form-specific
  if (formCode === 'nar1') {
    addLine('重要控制人登記冊 (SCR) 是否備存於公司註冊辦事處？  是 □  否 □', 9);
  }
  if (['nr1','ndr1','nn9'].includes(formCode)) {
    addLine(`現有註冊地址：${bundle.address || '（未填）'}`, 9);
    addLine('變更後註冊地址（請手動填寫）：＿＿＿＿＿＿＿＿＿＿＿＿', 9);
  }
  if (formCode === 'nsc1') {
    for (const line of ['配發日期：＿＿＿＿', '配發股份類別：＿＿＿＿', '每股發行價：＿＿＿＿', '配發總額：＿＿＿＿']) {
      addLine(line, 9);
    }
  }

  // Signature block
  y -= 10;
  if (y < 120) { page = doc.addPage([595, 842]); y = 800; }
  addLine('簽署 / SIGNED:', 10, true);
  y -= 8;
  addLine('_______________________________', 10);
  addLine('董事 / Director       日期 Date：＿＿＿＿', 9);
  y -= 4;
  addLine('_______________________________', 10);
  addLine('公司秘書 / Company Secretary       日期 Date：＿＿＿＿', 9);

  // Footer
  y -= 10;
  if (y < 50) { page = doc.addPage([595, 842]); y = 800; }
  const today = new Date().toISOString().slice(0, 10);
  addLine(`本文件由公司秘書管理系統自動生成 · ${today}`, 7);

  const pdfBytes = await doc.save();
  return pdfBytes;
}

// ─── Route handler ───
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  // Auth
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return json({ error: 'Not authenticated' }, 401);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Invalid or expired token' }, 401);

  try {
    const body: any = await request.json().catch(() => ({}));
    const companyId = body.company_id;
    const formCode = (body.form_code || '').toLowerCase();
    if (!companyId || !formCode) return json({ error: '缺少 company_id 或 form_code' }, 400);

    const meta = CR_FORM_META[formCode];
    if (!meta) return json({ error: `不支援的表格代碼：${formCode}` }, 400);

    const bundle = await fetchCompanyBundle(env.DB, companyId);
    if (!bundle) return json({ error: '找不到該公司' }, 404);

    const pdfBytes = await buildPdf(bundle, meta, formCode);

    // Base64 encode (avoid spread operator for compatibility)
    const bytes = new Uint8Array(pdfBytes);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    const safeName = (bundle.c.name || bundle.c.chinese_name || 'company')
      .replace(/[^\w一-鿿-]/g, '_').slice(0, 30);
    const filename = `${meta.code}_${meta.title}_${safeName}.pdf`;

    return json({ success: true, pdf: base64, filename });
  } catch (e: any) {
    return json({ error: e.message || 'Internal error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
