import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { companyId } = await req.json();
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [companyRes, rolesRes, txRes, fontResp] = await Promise.all([
      supabase.from("companies").select("*").eq("id", companyId).single(),
      supabase.from("person_company_roles").select("*").eq("company_id", companyId).eq("role", "shareholder"),
      supabase.from("share_transactions").select("*").eq("company_id", companyId).order("transaction_date"),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (companyRes.error) throw companyRes.error;
    if (rolesRes.error) throw rolesRes.error;
    if (!fontResp.ok) throw new Error("Failed to load Chinese font");

    const company = companyRes.data;
    const roles = (rolesRes.data || []) as any[];
    const transactions = (txRes.data || []) as any[];
    const personIds = roles.map((r) => r.person_id);
    const personsRes = personIds.length
      ? await supabase.from("persons").select("*").in("id", personIds)
      : { data: [], error: null };
    if (personsRes.error) throw personsRes.error;
    const personMap = new Map<string, any>();
    (personsRes.data || []).forEach((p: any) => personMap.set(p.id, p));

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

    draw("股東登記冊 / Register of Members", left, { size: 16 });
    newLine(22);
    draw(`公司名稱: ${company.name || ""}`, left, { size: 11 });
    newLine();
    if (company.chinese_name) { draw(`中文名稱: ${company.chinese_name}`, left); newLine(); }
    draw(`商業登記號碼 BR: ${company.company_number || "-"}`, left);
    newLine();
    draw(`生成日期: ${new Date().toISOString().slice(0, 10)}`, left);
    newLine(22);

    draw("現有股東 Current Shareholders", left, { size: 13 });
    newLine(18);

    if (roles.length === 0) {
      draw("(無記錄 / None)", left, { color: rgb(0.5, 0.5, 0.5) });
      newLine(20);
    } else {
      roles.forEach((r, idx) => {
        const p = personMap.get(r.person_id) || {};
        draw(`${idx + 1}. ${p.name_english || p.name_chinese || "(unnamed)"}`, left, { size: 11 });
        newLine(15);
        const rows: [string, string][] = [
          ["身份 Identity", p.identity === "corporate" ? "Corporate / 法人" : "Natural / 自然人"],
          ["中文姓名", p.name_chinese || "-"],
          ["身份證/護照/編號", p.id_number || "-"],
          ["出生日期 DOB", p.date_of_birth || "-"],
          ["地址 Address", p.address || "-"],
          ["持股數 Shares", String(r.shares ?? 0)],
          ["股份類別 Class", r.share_type || "-"],
          ["每股價 Issue Price", `${r.currency || "HKD"} ${r.issue_price || "-"}`],
          ["實繳 Paid Up", r.paid_up || "-"],
          ["未繳 Unpaid", r.unpaid || "-"],
        ];
        rows.forEach(([k, v]) => {
          draw(`  ${k}:`, left, { size: 9, color: rgb(0.4, 0.4, 0.4) });
          draw(v, left + 160, { size: 9 });
          newLine(12);
        });
        newLine(6);
      });
    }

    newLine(10);
    draw("股份轉讓記錄 Share Transfer History", left, { size: 13 });
    newLine(18);

    if (transactions.length === 0) {
      draw("(無轉讓記錄 / No transfers recorded)", left, { color: rgb(0.5, 0.5, 0.5) });
      newLine(20);
    } else {
      transactions.forEach((t, idx) => {
        draw(`${idx + 1}. ${t.transaction_date || "-"}  (${t.transaction_type || "transfer"})`, left, { size: 11 });
        newLine(14);
        const rows: [string, string][] = [
          ["轉讓人 From", t.from_name || "-"],
          ["受讓人 To", t.to_name || "-"],
          ["股數 Shares", String(t.shares ?? 0)],
          ["股份類別 Class", t.share_type || "-"],
          ["每股價格", `${t.currency || "HKD"} ${t.price_per_share || "-"}`],
          ["總代價 Consideration", t.total_consideration || "-"],
          ["文件編號 Instrument", t.instrument_number || "-"],
          ["備註 Notes", t.notes || "-"],
        ];
        rows.forEach(([k, v]) => {
          draw(`  ${k}:`, left, { size: 9, color: rgb(0.4, 0.4, 0.4) });
          draw(v, left + 160, { size: 9 });
          newLine(12);
        });
        newLine(6);
      });
    }

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: { ...corsHeaders, "Content-Type": "application/pdf" },
    });
  } catch (e: any) {
    console.error("generate-shareholders-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
