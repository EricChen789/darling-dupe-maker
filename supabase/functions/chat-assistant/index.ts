import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `你是一個公司秘書管理系統的 AI 助手。你可以幫助用戶管理公司資料、人員、股東，以及生成 PDF 文件。

你有以下能力：
1. 查詢資料庫中的公司、董事、秘書、股東資料
2. 新增公司、董事、秘書、股東
3. 更新公司、董事、秘書、股東資料
4. 軟刪除（標記為已刪除而非真正刪除）
5. 回答關於資料庫內容的問題
6. 協助生成 NAR1 PDF 表格

當用戶要求查詢或操作資料時，使用提供的工具函數。
回覆時使用繁體中文。
如果用戶要求生成 PDF，告訴他們可以在公司管理頁面的公司卡片上點擊「生成 NAR1」按鈕。
對於軟刪除，你會在 name 欄位前加上 [DELETED] 標記，而不是真正刪除記錄。`;

const tools = [
  {
    type: "function",
    function: {
      name: "query_companies",
      description: "查詢公司列表，可選擇按名稱或公司編號搜索",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "搜索關鍵字（公司名稱或編號）" },
          limit: { type: "number", description: "返回數量限制，預設10" },
          include_deleted: { type: "boolean", description: "是否包含已刪除的記錄" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_officers",
      description: "查詢公司的董事或秘書",
      parameters: {
        type: "object",
        properties: {
          company_id: { type: "string", description: "公司 UUID" },
          company_name: { type: "string", description: "公司名稱（模糊搜索）" },
          role: { type: "string", enum: ["director", "secretary"], description: "角色篩選" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_shareholders",
      description: "查詢公司的股東",
      parameters: {
        type: "object",
        properties: {
          company_id: { type: "string", description: "公司 UUID" },
          company_name: { type: "string", description: "公司名稱（模糊搜索）" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_company",
      description: "新增公司",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "公司英文名稱" },
          chinese_name: { type: "string", description: "公司中文名稱" },
          company_number: { type: "string", description: "商業登記號碼" },
          trading_name: { type: "string", description: "商號名稱" },
          business_nature: { type: "string", description: "業務性質" },
          company_type: { type: "string", description: "公司類型" },
          business_code: { type: "string", description: "業務代碼" },
          company_group: { type: "string", description: "公司群組" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_company",
      description: "更新公司資料",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "公司 UUID" },
          name: { type: "string" },
          chinese_name: { type: "string" },
          company_number: { type: "string" },
          trading_name: { type: "string" },
          business_nature: { type: "string" },
          company_type: { type: "string" },
          business_code: { type: "string" },
          company_group: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "soft_delete_company",
      description: "軟刪除公司（在名稱前加上 [DELETED] 標記）",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "公司 UUID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_officer",
      description: "新增董事或秘書",
      parameters: {
        type: "object",
        properties: {
          company_id: { type: "string", description: "公司 UUID" },
          name_english: { type: "string", description: "英文名稱" },
          name_chinese: { type: "string", description: "中文名稱" },
          role: { type: "string", enum: ["director", "secretary"], description: "角色" },
          identity: { type: "string", enum: ["natural", "corporate"], description: "身份類型" },
          id_number: { type: "string", description: "身份證/護照號碼" },
        },
        required: ["company_id", "name_english", "role"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_officer",
      description: "更新董事或秘書資料",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "人員 UUID" },
          name_english: { type: "string" },
          name_chinese: { type: "string" },
          role: { type: "string", enum: ["director", "secretary"] },
          identity: { type: "string", enum: ["natural", "corporate"] },
          id_number: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "soft_delete_officer",
      description: "軟刪除董事或秘書",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "人員 UUID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_shareholder",
      description: "新增股東",
      parameters: {
        type: "object",
        properties: {
          company_id: { type: "string", description: "公司 UUID" },
          name: { type: "string", description: "股東名稱" },
          shares: { type: "number", description: "持股數量" },
        },
        required: ["company_id", "name", "shares"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_shareholder",
      description: "更新股東資料",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "股東 UUID" },
          name: { type: "string" },
          shares: { type: "number" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "soft_delete_shareholder",
      description: "軟刪除股東",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "股東 UUID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stats",
      description: "獲取資料庫統計資訊",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

async function executeTool(supabase: any, name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case "query_companies": {
        let query = supabase.from("companies").select("*").order("name").limit(args.limit || 10);
        if (args.search) {
          query = query.or(`name.ilike.%${args.search}%,company_number.ilike.%${args.search}%,chinese_name.ilike.%${args.search}%`);
        }
        if (!args.include_deleted) {
          query = query.not("name", "like", "[DELETED]%");
        }
        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ companies: data, count: data.length });
      }

      case "query_officers": {
        let companyIds: string[] = [];
        if (args.company_id) {
          companyIds = [args.company_id];
        } else if (args.company_name) {
          const { data: companies } = await supabase
            .from("companies")
            .select("id")
            .ilike("name", `%${args.company_name}%`)
            .limit(5);
          companyIds = (companies || []).map((c: any) => c.id);
        }

        let query = supabase.from("officers").select("*, companies(name)").not("name_english", "like", "[DELETED]%");
        if (companyIds.length > 0) query = query.in("company_id", companyIds);
        if (args.role) query = query.eq("role", args.role);
        query = query.limit(50);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ officers: data, count: data.length });
      }

      case "query_shareholders": {
        let companyIds: string[] = [];
        if (args.company_id) {
          companyIds = [args.company_id];
        } else if (args.company_name) {
          const { data: companies } = await supabase
            .from("companies")
            .select("id")
            .ilike("name", `%${args.company_name}%`)
            .limit(5);
          companyIds = (companies || []).map((c: any) => c.id);
        }

        let query = supabase.from("shareholders").select("*, companies(name)").not("name", "like", "[DELETED]%");
        if (companyIds.length > 0) query = query.in("company_id", companyIds);
        query = query.limit(50);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ shareholders: data, count: data.length });
      }

      case "add_company": {
        const { data, error } = await supabase.from("companies").insert({
          name: args.name,
          chinese_name: args.chinese_name || "",
          company_number: args.company_number || "",
          trading_name: args.trading_name || "",
          business_nature: args.business_nature || "",
          company_type: args.company_type || "私人公司 Private company",
          business_code: args.business_code || "",
          company_group: args.company_group || "",
        }).select().single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, company: data });
      }

      case "update_company": {
        const { id, ...updates } = args;
        updates.updated_at = new Date().toISOString();
        const { data, error } = await supabase.from("companies").update(updates).eq("id", id).select().single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, company: data });
      }

      case "soft_delete_company": {
        const { data: company } = await supabase.from("companies").select("name").eq("id", args.id).single();
        if (!company) return JSON.stringify({ error: "公司不存在" });
        const newName = company.name.startsWith("[DELETED]") ? company.name : `[DELETED] ${company.name}`;
        const { error } = await supabase.from("companies").update({ name: newName, updated_at: new Date().toISOString() }).eq("id", args.id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, message: `公司「${company.name}」已標記為刪除` });
      }

      case "add_officer": {
        const { data, error } = await supabase.from("officers").insert({
          company_id: args.company_id,
          name_english: args.name_english,
          name_chinese: args.name_chinese || "",
          role: args.role,
          identity: args.identity || "natural",
          id_number: args.id_number || "",
        }).select().single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, officer: data });
      }

      case "update_officer": {
        const { id, ...updates } = args;
        const { data, error } = await supabase.from("officers").update(updates).eq("id", id).select().single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, officer: data });
      }

      case "soft_delete_officer": {
        const { data: officer } = await supabase.from("officers").select("name_english").eq("id", args.id).single();
        if (!officer) return JSON.stringify({ error: "人員不存在" });
        const newName = officer.name_english.startsWith("[DELETED]") ? officer.name_english : `[DELETED] ${officer.name_english}`;
        const { error } = await supabase.from("officers").update({ name_english: newName }).eq("id", args.id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, message: `人員「${officer.name_english}」已標記為刪除` });
      }

      case "add_shareholder": {
        const { data, error } = await supabase.from("shareholders").insert({
          company_id: args.company_id,
          name: args.name,
          shares: args.shares,
        }).select().single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, shareholder: data });
      }

      case "update_shareholder": {
        const { id, ...updates } = args;
        const { data, error } = await supabase.from("shareholders").update(updates).eq("id", id).select().single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, shareholder: data });
      }

      case "soft_delete_shareholder": {
        const { data: sh } = await supabase.from("shareholders").select("name").eq("id", args.id).single();
        if (!sh) return JSON.stringify({ error: "股東不存在" });
        const newName = sh.name.startsWith("[DELETED]") ? sh.name : `[DELETED] ${sh.name}`;
        const { error } = await supabase.from("shareholders").update({ name: newName }).eq("id", args.id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, message: `股東「${sh.name}」已標記為刪除` });
      }

      case "get_stats": {
        const [companies, officers, shareholders] = await Promise.all([
          supabase.from("companies").select("id", { count: "exact", head: true }).not("name", "like", "[DELETED]%"),
          supabase.from("officers").select("id", { count: "exact", head: true }).not("name_english", "like", "[DELETED]%"),
          supabase.from("shareholders").select("id", { count: "exact", head: true }).not("name", "like", "[DELETED]%"),
        ]);
        return JSON.stringify({
          companies: companies.count || 0,
          officers: officers.count || 0,
          shareholders: shareholders.count || 0,
        });
      }

      default:
        return JSON.stringify({ error: `未知工具: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "執行錯誤" });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const allMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    // First call - may return tool calls
    let response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: allMessages,
        tools,
      }),
    });

    if (!response.ok) {
      const status = response.status;
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
      const t = await response.text();
      throw new Error(`AI gateway error ${status}: ${t}`);
    }

    let result = await response.json();
    let assistantMessage = result.choices?.[0]?.message;

    // Handle tool calls iteratively (max 5 rounds)
    let rounds = 0;
    while (assistantMessage?.tool_calls && rounds < 5) {
      rounds++;
      const toolResults = [];

      for (const tc of assistantMessage.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        const toolResult = await executeTool(supabase, tc.function.name, args);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      }

      allMessages.push(assistantMessage);
      allMessages.push(...toolResults);

      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: allMessages,
          tools,
        }),
      });

      if (!response.ok) throw new Error(`AI gateway error: ${response.status}`);
      result = await response.json();
      assistantMessage = result.choices?.[0]?.message;
    }

    const content = assistantMessage?.content || "抱歉，無法生成回覆。";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
