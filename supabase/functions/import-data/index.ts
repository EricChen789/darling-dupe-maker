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

      // Helper: find or create person in central master
      const findOrCreatePerson = async (input: {
        identity?: string;
        name_english: string;
        name_chinese?: string;
        id_number?: string;
        address?: string;
        email?: string;
        place_incorporated?: string;
        company_number_ref?: string;
      }): Promise<string | null> => {
        const identity = input.identity || "natural";
        const nameEng = (input.name_english || "").trim();
        const nameZh = (input.name_chinese || "").trim();
        const idNum = (input.id_number || "").trim();
        if (!nameEng && !nameZh) return null;

        // Try by id_number
        if (idNum) {
          const { data } = await supabase.from("persons").select("id").eq("id_number", idNum).limit(1);
          if (data && data.length > 0) return data[0].id;
        }
        // Try by normalized english name
        if (nameEng) {
          const normKey = nameEng.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (normKey) {
            const { data } = await supabase.from("persons").select("id, name_chinese, identity").eq("normalized_key", normKey);
            if (data && data.length > 0) {
              if (identity === "corporate") {
                const corp = data.find((d: any) => d.identity === "corporate");
                if (corp) return corp.id;
              } else {
                const exact = data.find((d: any) => d.identity === "natural" && d.name_chinese === nameZh);
                if (exact) return exact.id;
                if (!nameZh) {
                  const anyNat = data.find((d: any) => d.identity === "natural");
                  if (anyNat) return anyNat.id;
                }
              }
            }
          }
        }
        // Create new
        const { data: created, error } = await supabase
          .from("persons")
          .insert({
            identity, name_english: nameEng, name_chinese: nameZh, id_number: idNum,
            address: input.address || "", email: input.email || "",
            place_incorporated: input.place_incorporated || "",
            company_number_ref: input.company_number_ref || "",
          })
          .select("id").single();
        if (error) {
          results.errors.push(`Create person ${nameEng}: ${error.message}`);
          return null;
        }
        return created.id;
      };

      // Insert officers as person_company_roles
      if (company.officers && company.officers.length > 0) {
        const roleRows: any[] = [];
        for (const o of company.officers) {
          const personId = await findOrCreatePerson({
            identity: o.identity, name_english: o.name_english, name_chinese: o.name_chinese,
            id_number: o.id_number, address: o.address,
            place_incorporated: o.place_incorporated, company_number_ref: o.company_number_ref,
          });
          if (!personId) continue;
          roleRows.push({
            person_id: personId,
            company_id: companyId,
            role: o.role || "director",
            date_appointed: o.date_appointed || "",
            date_ceased: o.date_ceased || "",
          });
        }
        if (roleRows.length > 0) {
          const { error: offErr } = await supabase.from("person_company_roles").insert(roleRows);
          if (offErr) results.errors.push(`Officer roles for ${br}: ${offErr.message}`);
        }
      }

      // Insert shareholders as person_company_roles
      if (company.shareholders && company.shareholders.length > 0) {
        const roleRows: any[] = [];
        for (const s of company.shareholders) {
          const personId = await findOrCreatePerson({
            identity: s.identity,
            name_english: s.name_english || s.name,
            name_chinese: s.name_chinese,
            id_number: s.id_number, address: s.address, email: s.email,
          });
          if (!personId) continue;
          roleRows.push({
            person_id: personId,
            company_id: companyId,
            role: "shareholder",
            shares: s.shares || 0,
            share_type: s.share_type || "",
          });
        }
        if (roleRows.length > 0) {
          const { error: shErr } = await supabase.from("person_company_roles").insert(roleRows);
          if (shErr) results.errors.push(`Shareholder roles for ${br}: ${shErr.message}`);
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
