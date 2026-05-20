import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface Env {
  DB: D1Database;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { companyId } = await request.json();
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [company, rolesResult, fontResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role IN ('director', 'secretary')").bind(companyId).all(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!fontResp.ok) throw new Error("Failed to load Chinese font");

    const roles = (rolesResult.results || []) as any[];
    const personIds = roles.map((r: any) => r.person_id);
    let personsResult: any[] = [];
    if (personIds.length > 0) {
      const placeholders = personIds.map(() => '?').join(',');
      let stmt = env.DB.prepare(`SELECT * FROM persons WHERE id IN (${placeholders})`);
      for (const id of personIds) {
        stmt = stmt.bind(id);
      }
      const result = await stmt.all();
      personsResult = result.results || [];
    }
    const personMap = new Map<string, any>();
    personsResult.forEach((p: any) => personMap.set(p.id, p));

    const fontBytes = await fontResp.arrayBuffer();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes);

    let page = pdf.addPage([595, 842]);
    let y = 800;
    const left = 50;

    const draw = (text: string, x: number, opts: { size?: number; color?: any } = {}) => {
      page.drawText(text || "", { x, y, size: opts.size ?? 10, font, color: opts.color ?? rgb(0, 0, 0) });
    };
    const newLine = (delta = 14) => {
      y -= delta;
      if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
    };

    draw("董事登記冊 / Register of Directors", left, { size: 16 });
    newLine(22);
    draw(`公司名稱: ${(company as any).name || ""}`, left, { size: 11 });
    newLine();
    if ((company as any).chinese_name) { draw(`中文名稱: ${(company as any).chinese_name}`, left); newLine(); }
    draw(`商業登記號碼 BR: ${(company as any).company_number || "-"}`, left);
    newLine();
    draw(`生成日期: ${new Date().toISOString().slice(0, 10)}`, left);
    newLine(22);

    const directors = roles.filter((r: any) => r.role === "director");
    const secretaries = roles.filter((r: any) => r.role === "secretary");

    const drawSection = (title: string, items: any[]) => {
      draw(title, left, { size: 13 });
      newLine(18);
      if (items.length === 0) {
        draw("(無記錄 / None)", left, { color: rgb(0.5, 0.5, 0.5) });
        newLine(20);
        return;
      }
      items.forEach((r: any, idx: number) => {
        const p = personMap.get(r.person_id) || {};
        draw(`${idx + 1}. ${p.name_english || p.name_chinese || "(unnamed)"}${r.is_reserve ? "  [預備董事 Reserve]" : ""}`, left, { size: 11 });
        newLine(15);
        const rows: [string, string][] = [
          ["身份 Identity", p.identity === "corporate" ? "Corporate / 法人" : "Natural / 自然人"],
          ["中文姓名", p.name_chinese || "-"],
          ["身份證/護照/編號", p.id_number || "-"],
          ["出生日期 DOB", p.date_of_birth || "-"],
          ["地址 Address", p.address || "-"],
          ["服務地址 Service Address", r.service_address_override || p.service_address || "-"],
          ["委任日期 Date Appointed", r.date_appointed || "-"],
          ["停止日期 Date Ceased", r.date_ceased || "-"],
        ];
        if (p.identity === "corporate") {
          rows.push(["註冊地 Place Incorporated", p.place_incorporated || "-"]);
          rows.push(["公司編號 Company No.", p.company_number_ref || "-"]);
        }
        rows.forEach(([k, v]) => {
          draw(`  ${k}:`, left, { size: 9, color: rgb(0.4, 0.4, 0.4) });
          draw(v, left + 160, { size: 9 });
          newLine(12);
        });
        newLine(6);
      });
    };

    drawSection("董事 Directors", directors);
    newLine(8);
    drawSection("公司秘書 Company Secretaries", secretaries);

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: { ...corsHeaders, "Content-Type": "application/pdf" },
    });
  } catch (e: any) {
    console.error("generate-directors-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
