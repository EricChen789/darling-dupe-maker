import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new Error("No file uploaded");

    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ""
      )
    );

    const mimeType = file.type || "application/pdf";

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a Hong Kong Certificate of Incorporation (CI / 公司註冊證書) data extractor.
Extract the following fields from the uploaded CI certificate image/PDF. Return ONLY a JSON object with these fields:
- companyName: The company name in English (as printed on the certificate)
- chineseName: The company name in Chinese (中文名稱) if present, otherwise ""
- companyNumber: The Company Number (公司編號 / CR Number), usually 6-8 digits
- incorporationDate: Date of incorporation (公司成立日期) in DD/MM/YYYY format
- companyType: Type of company. Use one of:
  * "私人公司 Private company"
  * "公眾公司 Public company"
  * "擔保有限公司 Company limited by guarantee"
- jurisdiction: Place of incorporation, default "Hong Kong" if it's a HK CI

If a field is not found, use an empty string "".
For incorporationDate, normalize to DD/MM/YYYY (e.g. "01/01/2016"). If only English month is shown like "1 JANUARY 2016", convert to "01/01/2016".
Return ONLY valid JSON, no markdown, no explanation.`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Please extract the company information from this Certificate of Incorporation.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64}`,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI 服務請求過於頻繁，請稍後再試。" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI 服務額度不足，請充值後再試。" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    let extracted: Record<string, string> = {};
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      throw new Error("無法解析 AI 回應，請確保上傳的是清晰的公司註冊證書文件。");
    }

    return new Response(JSON.stringify({ data: extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-ci-info error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
