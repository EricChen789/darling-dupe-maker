// AI-assisted resolution generator using Lovable AI Gateway.
// Returns: { content: string }  (Chinese resolution body, plain text with paragraphs)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Req {
  resolutionType: string;     // e.g. "appointment_director", "address_change", "rename", "general"
  companyName: string;
  companyChineseName?: string;
  brNumber?: string;
  resolutionDate: string;     // YYYY-MM-DD
  context: string;            // free-form context the user wants to include
  language?: "zh" | "en" | "bilingual"; // default bilingual
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: Req = await req.json();
    if (!body.companyName || !body.resolutionType) {
      return new Response(JSON.stringify({ error: "companyName and resolutionType required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const lang = body.language || "bilingual";
    const langInstruction = lang === "zh"
      ? "Output in Traditional Chinese only."
      : lang === "en"
        ? "Output in English only."
        : "Output bilingually: each major paragraph in English, followed by Traditional Chinese on a new line.";

    const systemPrompt = `You are a Hong Kong corporate secretarial assistant. Generate a formal company resolution.
Follow Hong Kong Companies Ordinance conventions. Use the WRITTEN RESOLUTION format unless the user asks for a meeting minute.
Structure:
1. Header: company name + Chinese name + BR number + "Written Resolution of Directors / Members"
2. Resolution number (e.g. "RESOLVED THAT:")
3. Body — clear, formal, numbered if multiple items
4. Effective date
5. Signature block (Director(s) / Members)
${langInstruction}
Return ONLY the resolution body text, no markdown headers, no commentary, ready to paste into a PDF.`;

    const userPrompt = `Generate a ${body.resolutionType} resolution for:
Company: ${body.companyName}${body.companyChineseName ? ` (${body.companyChineseName})` : ""}
BR Number: ${body.brNumber || "—"}
Resolution Date: ${body.resolutionDate}

Context / Specific details from user:
${body.context || "(no extra context provided)"}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "請求過於頻繁，請稍後再試" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI 額度不足，請充值" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      throw new Error(`AI gateway error ${status}: ${t}`);
    }

    const result = await aiResp.json();
    const content = result.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-resolution error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
