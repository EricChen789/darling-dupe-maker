// GET /api/company-registers?company_id=xxx
// 公司登記冊明細（6.2–6.6）：當前/歷史董事、股東、秘書、股份轉讓、SCR
// 移植自 local-server/server.py:company_registers

interface Env {
  DB: D1Database;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const companyId = new URL(request.url).searchParams.get("company_id");
  if (!companyId) return json({ error: "缺少 company_id" }, 400);

  try {
    const company = await env.DB.prepare(
      "SELECT id, name, chinese_name, company_number FROM companies WHERE id = ?"
    ).bind(companyId).first();
    if (!company) return json({ error: "找不到該公司" }, 404);

    // 當前 = date_ceased 為空；歷史 = date_ceased 非空
    async function roles(role: string, historical: boolean) {
      const cond = historical
        ? "(pcr.date_ceased IS NOT NULL AND pcr.date_ceased != '')"
        : "(pcr.date_ceased IS NULL OR pcr.date_ceased = '')";
      const { results } = await env.DB.prepare(
        `SELECT pcr.role, pcr.shares, pcr.share_type, pcr.currency, pcr.paid_up, pcr.unpaid,
                pcr.date_appointed, pcr.date_ceased, pcr.is_reserve,
                p.id AS person_id, p.identity, p.name_english, p.name_chinese,
                p.id_number, p.passport_number, p.address, p.email, p.phone
         FROM person_company_roles pcr JOIN persons p ON p.id = pcr.person_id
         WHERE pcr.company_id = ? AND pcr.role = ? AND ${cond}
         ORDER BY p.name_english`
      ).bind(companyId, role).all();
      return results;
    }

    const [currentDirectors, historicalDirectors, currentShareholders, historicalShareholders, secretaries] =
      await Promise.all([
        roles("director", false),
        roles("director", true),
        roles("shareholder", false),
        roles("shareholder", true),
        roles("secretary", false),
      ]);

    const shareTx = await env.DB.prepare(
      `SELECT * FROM share_transactions WHERE company_id = ?
       ORDER BY transaction_date DESC, created_at DESC`
    ).bind(companyId).all();

    const scr = await env.DB.prepare(
      "SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY name_english"
    ).bind(companyId).all();

    return json({
      company,
      current_directors: currentDirectors,
      historical_directors: historicalDirectors,
      current_shareholders: currentShareholders,
      historical_shareholders: historicalShareholders,
      secretaries,
      share_transactions: shareTx.results,
      scr: scr.results,
    });
  } catch (e: any) {
    return json({ error: e.message || "Internal server error" }, 500);
  }
}
