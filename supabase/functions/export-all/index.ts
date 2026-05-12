// Edge function: full backup of all tables + storage files into a single ZIP.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore - fflate provides zip without native deps
import { zipSync, strToU8 } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES = [
  "companies",
  "company_logs",
  "officers",
  "person_company_roles",
  "persons",
  "presenters",
  "profiles",
  "reminders",
  "resolutions",
  "secretary_templates",
  "share_transactions",
  "shareholders",
  "significant_controllers",
  "user_roles",
];

const BUCKETS = ["pdf-templates", "company-documents", "company-logs"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, serviceKey);

    // Require admin caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin role required");

    const files: Record<string, Uint8Array> = {};
    const manifest: any = {
      exported_at: new Date().toISOString(),
      tables: {},
      buckets: {},
    };

    // --- Dump tables (paginate 1000 at a time) ---
    for (const table of TABLES) {
      const all: any[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await admin
          .from(table)
          .select("*")
          .range(from, from + PAGE - 1);
        if (error) {
          console.error(`Table ${table} error:`, error.message);
          manifest.tables[table] = { error: error.message };
          break;
        }
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      files[`tables/${table}.json`] = strToU8(JSON.stringify(all, null, 2));
      // CSV
      if (all.length > 0) {
        const cols = Object.keys(all[0]);
        const esc = (v: any) => {
          if (v === null || v === undefined) return "";
          const s = typeof v === "object" ? JSON.stringify(v) : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [cols.join(","), ...all.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
        files[`tables/${table}.csv`] = strToU8(csv);
      }
      manifest.tables[table] = { rows: all.length };
    }

    // --- Dump storage buckets recursively ---
    async function listAll(bucket: string, prefix = ""): Promise<string[]> {
      const out: string[] = [];
      const { data, error } = await admin.storage.from(bucket).list(prefix, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        console.error(`List ${bucket}/${prefix} error:`, error.message);
        return out;
      }
      for (const item of data || []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null || item.metadata === null) {
          // folder
          const sub = await listAll(bucket, path);
          out.push(...sub);
        } else {
          out.push(path);
        }
      }
      return out;
    }

    for (const bucket of BUCKETS) {
      const paths = await listAll(bucket);
      manifest.buckets[bucket] = { files: paths.length };
      for (const p of paths) {
        const { data, error } = await admin.storage.from(bucket).download(p);
        if (error || !data) {
          console.error(`Download ${bucket}/${p} error:`, error?.message);
          continue;
        }
        const buf = new Uint8Array(await data.arrayBuffer());
        files[`storage/${bucket}/${p}`] = buf;
      }
    }

    files["MANIFEST.json"] = strToU8(JSON.stringify(manifest, null, 2));

    const zipped = zipSync(files, { level: 6 });

    const filename = `backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`;

    return new Response(zipped, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error("export-all error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
