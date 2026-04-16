import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

interface ImportOfficer {
  role: "director" | "secretary";
  identity?: "natural" | "corporate";
  name_english: string;
  name_chinese?: string;
  id_number?: string;
  address?: string;
  date_appointed?: string;
  date_ceased?: string;
  place_incorporated?: string;
  company_number_ref?: string;
}

interface ImportShareholder {
  name: string;
  name_english?: string;
  name_chinese?: string;
  shares?: number;
  identity?: "natural" | "corporate";
  id_number?: string;
  address?: string;
  email?: string;
  share_type?: string;
}

interface ImportCompany {
  name: string;
  company_number: string; // BR number — used for duplicate detection
  chinese_name?: string;
  trading_name?: string;
  business_nature?: string;
  company_type?: string;
  business_code?: string;
  company_group?: string;
  register_date?: string;
  quorum?: string;
  reg_flat?: string;
  reg_building?: string;
  reg_street?: string;
  reg_district?: string;
  reg_region?: string;
  officers?: ImportOfficer[];
  shareholders?: ImportShareholder[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();

    // Accept single object or array
    const companies: ImportCompany[] = Array.isArray(body) ? body : body.companies ? body.companies : [body];

    if (!companies.length) {
      return new Response(JSON.stringify({ error: "No data provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate required fields
    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      if (!c.name || typeof c.name !== "string" || c.name.trim().length === 0) {
        return new Response(JSON.stringify({ error: `Company at index ${i} missing 'name'` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!c.company_number || typeof c.company_number !== "string" || c.company_number.trim().length === 0) {
        return new Response(JSON.stringify({ error: `Company at index ${i} missing 'company_number' (BR number)` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch existing BR numbers for duplicate detection
    const brNumbers = companies.map((c) => c.company_number.trim());
    const { data: existingCompanies, error: fetchErr } = await supabase
      .from("companies")
      .select("id, company_number")
      .in("company_number", brNumbers);

    if (fetchErr) throw fetchErr;

    const existingBrSet = new Set((existingCompanies || []).map((c: any) => c.company_number));

    const results = {
      imported: 0,
      skipped: 0,
      skipped_br_numbers: [] as string[],
      errors: [] as string[],
    };

    for (const company of companies) {
      const br = company.company_number.trim();

      // Skip duplicates
      if (existingBrSet.has(br)) {
        results.skipped++;
        results.skipped_br_numbers.push(br);
        continue;
      }

      // Insert company
      const { data: inserted, error: insertErr } = await supabase
        .from("companies")
        .insert({
          name: company.name.trim(),
          company_number: br,
          chinese_name: company.chinese_name || "",
          trading_name: company.trading_name || "",
          business_nature: company.business_nature || "",
          company_type: company.company_type || "私人公司 Private company",
          business_code: company.business_code || "",
          company_group: company.company_group || "",
          register_date: company.register_date || "",
          quorum: company.quorum || "",
          reg_flat: company.reg_flat || "",
          reg_building: company.reg_building || "",
          reg_street: company.reg_street || "",
          reg_district: company.reg_district || "",
          reg_region: company.reg_region || "香港 Hong Kong",
        })
        .select("id")
        .single();

      if (insertErr) {
        results.errors.push(`Company ${br}: ${insertErr.message}`);
        continue;
      }

      const companyId = inserted.id;
      existingBrSet.add(br); // Prevent duplicates within same batch

      // Insert officers
      if (company.officers && company.officers.length > 0) {
        const officerRows = company.officers.map((o) => ({
          company_id: companyId,
          role: o.role || "director",
          identity: o.identity || "natural",
          name_english: o.name_english || "",
          name_chinese: o.name_chinese || "",
          id_number: o.id_number || "",
          address: o.address || "",
          date_appointed: o.date_appointed || null,
          date_ceased: o.date_ceased || null,
          place_incorporated: o.place_incorporated || "",
          company_number_ref: o.company_number_ref || "",
        }));

        const { error: offErr } = await supabase.from("officers").insert(officerRows);
        if (offErr) {
          results.errors.push(`Officers for ${br}: ${offErr.message}`);
        }
      }

      // Insert shareholders
      if (company.shareholders && company.shareholders.length > 0) {
        const shRows = company.shareholders.map((s) => ({
          company_id: companyId,
          name: s.name || s.name_english || s.name_chinese || "",
          name_english: s.name_english || "",
          name_chinese: s.name_chinese || "",
          shares: s.shares || 0,
          identity: s.identity || "natural",
          id_number: s.id_number || "",
          address: s.address || "",
          email: s.email || "",
          share_type: s.share_type || "",
        }));

        const { error: shErr } = await supabase.from("shareholders").insert(shRows);
        if (shErr) {
          results.errors.push(`Shareholders for ${br}: ${shErr.message}`);
        }
      }

      results.imported++;
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Import error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
