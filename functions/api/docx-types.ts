// GET /api/docx-types
// 列出支援的 Word 文件類型（對應 generate-docx.ts 的 DOCX_TYPES）
// resp: [{ key, label }] 或含 form_code 時返回 cr_form 子類型列表

import { verifyAuthRequest, type Env as AuthEnv } from './_auth';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOCX_TYPES: Record<string, string> = {
  company_profile: "公司資料摘要",
  directors_register: "董事名冊",
  members_register: "成員（股東）名冊",
  board_resolution: "董事會書面決議",
  meeting_minutes: "董事會會議記錄",
  scr_register: "重要控制人登記冊",
  cr_form: "政府表格 (Word)",
};

const CR_FORM_META: Record<string, { code: string; title: string; title_en: string }> = {
  nar1:  { code: "NAR1",  title: "周年申報表",           title_en: "Annual Return" },
  nd2a:  { code: "ND2A",  title: "更改公司秘書及董事通知書（委任／停任）", title_en: "Notice of Change of Company Secretary and Director (Appointment/Cessation)" },
  nd2b:  { code: "ND2B",  title: "更改公司秘書及董事詳情通知書",       title_en: "Notice of Change in Particulars of Company Secretary and Director" },
  nd4:   { code: "ND4",   title: "公司秘書及董事辭任通知書",           title_en: "Notice of Resignation of Company Secretary and Director" },
  ndr1:  { code: "NDR1",  title: "撤銷註冊申請書",                    title_en: "Application for Deregistration" },
  nr1:   { code: "NR1",   title: "註冊辦事處地址變更通知書",           title_en: "Notice of Change of Registered Office Address" },
  nsc1:  { code: "NSC1",  title: "股份配發申報書",                    title_en: "Return of Allotment" },
  nnc1:  { code: "NNC1",  title: "法團成立表格（股份有限公司）",        title_en: "Incorporation Form (Company Limited by Shares)" },
  nnc2:  { code: "NNC2",  title: "更改公司名稱通知書",                 title_en: "Notice of Change of Company Name" },
  nn1:   { code: "NN1",   title: "註冊非香港公司註冊申請書",            title_en: "Application for Registration as Registered Non-Hong Kong Company" },
  nn3:   { code: "NN3",   title: "註冊非香港公司周年申報表",            title_en: "Annual Return of Registered Non-Hong Kong Company" },
  nn6:   { code: "NN6",   title: "非香港公司更改秘書及董事（委任／停任）", title_en: "Change of Company Secretary and Director of Non-Hong Kong Company" },
  nn7:   { code: "NN7",   title: "非香港公司更改秘書及董事詳情",         title_en: "Change in Particulars of Company Secretary and Director of Non-Hong Kong Company" },
  nn9:   { code: "NN9",   title: "非香港公司更改地址申報表",            title_en: "Notice of Change of Address of Non-Hong Kong Company" },
};

export async function onRequest(context: { request: Request; env: AuthEnv }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const formCode = url.searchParams.get("form_code");
  if (formCode) {
    // Return CR form subtypes
    const crForms = Object.entries(CR_FORM_META).map(([key, meta]) => ({
      key: `cr_form:${key}`,
      label: `${meta.code} — ${meta.title}`,
      doc_type: "cr_form",
      form_code: key,
      code: meta.code,
      title: meta.title,
      title_en: meta.title_en,
    }));
    return new Response(JSON.stringify(crForms), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = Object.entries(DOCX_TYPES).map(([key, label]) => ({ key, label }));
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
