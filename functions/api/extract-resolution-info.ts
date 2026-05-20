interface Env {
  LOVABLE_API_KEY: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const formData = await request.formData();
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
              content: `You are a Hong Kong company document extractor. The uploaded file may be a Board/Shareholders Resolution (會議紀錄/決議), an NNC1, an Annual Return (NAR1), an Articles of Association, or any company-related document.

Extract as many of the following fields as you can find. Return ONLY a JSON object (no markdown, no explanation):

{
  "companyName": "English company name",
  "chineseName": "中文公司名稱",
  "brNumber": "Business Registration number (商業登記號碼) — usually 8 digits sometimes with -000",
  "companyNumber": "Company Number / CR Number (公司編號) — 6-8 digits",
  "incorporationDate": "DD/MM/YYYY",
  "companyType": "私人公司 Private company | 公眾公司 Public company | 擔保有限公司 Company limited by guarantee",
  "jurisdiction": "Hong Kong (or other)",
  "businessNature": "Nature of business",
  "tradingName": "Trading / business name if different from company name",
  "regFlat": "Flat/Room/Floor portion of registered office address",
  "regBuilding": "Building name portion",
  "regStreet": "Street name and number",
  "regDistrict": "District (e.g. Central, Wan Chai, Kwun Tong)",
  "regRegion": "香港 Hong Kong | 九龍 Kowloon | 新界 New Territories",
  "contactPhone": "Phone number if present",
  "contactEmail": "Email if present",
  "directors": [
    { "nameEnglish": "...", "nameChinese": "...", "idNumber": "HKID or passport", "address": "residential address", "identity": "natural | corporate" }
  ],
  "secretaries": [
    { "nameEnglish": "...", "nameChinese": "...", "idNumber": "...", "address": "...", "identity": "natural | corporate" }
  ],
  "shareholders": [
    { "nameEnglish": "...", "nameChinese": "...", "idNumber": "...", "address": "...", "shares": 0, "shareType": "Ordinary", "identity": "natural | corporate" }
  ]
}

Rules:
- For any field not found, use "" (empty string) or [] for arrays.
- Normalize all dates to DD/MM/YYYY.
- Split addresses into flat/building/street/district/region carefully when possible. If you cannot split, put the whole address into regStreet and leave others "".
- Identify directors/secretaries/shareholders even if listed in tables or signature blocks.
- Return ONLY valid JSON.`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Please extract all company-related information from this document.",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64}` },
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

    let extracted: Record<string, any> = {};
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      throw new Error("無法解析 AI 回應，請確保上傳的是清晰的文件。");
    }

    return new Response(JSON.stringify({ data: extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-resolution-info error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
