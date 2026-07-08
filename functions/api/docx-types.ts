// GET /api/docx-types
// 列出支援的 Word 文件類型（對應 generate-docx.ts 的 DOCX_TYPES）
// resp: [{ key, label }]

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
};

export async function onRequest(context: { request: Request }): Promise<Response> {
  const { request } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = Object.entries(DOCX_TYPES).map(([key, label]) => ({ key, label }));
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
