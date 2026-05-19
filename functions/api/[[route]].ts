// Pages Functions API - D1 + R2 backend for secretary-system
// Route: /api/*

interface Env {
  DB: D1Database;
  PDF_TEMPLATES: R2Bucket;
  COMPANY_DOCUMENTS: R2Bucket;
  COMPANY_LOGS: R2Bucket;
  BACKUPS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

interface User {
  id: string;
  email: string;
  role: string;
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

// Verify Supabase JWT token
async function verifyAuth(req: Request, env: Env): Promise<User | null> {
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth) return null;
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${auth}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!resp.ok) return null;
    const user = await resp.json() as any;
    // Check admin role from D1
    const roleResult = await env.DB.prepare(
      "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'"
    ).bind(user.id).first();
    return { id: user.id, email: user.email, role: roleResult ? "admin" : "user" };
  } catch {
    return null;
  }
}

function requireAdmin(user: User | null) {
  if (!user || user.role !== "admin") throw new Response("Unauthorized", { status: 401 });
}

// Simple router
type Handler = (req: Request, env: Env, user: User | null, params: Record<string, string>) => Promise<Response>;

const routes: Record<string, Record<string, Handler>> = {};

function addRoute(method: string, path: string, handler: Handler) {
  if (!routes[method]) routes[method] = {};
  routes[method][path] = handler;
}

function matchRoute(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  const methodRoutes = routes[method] || {};
  for (const [pattern, handler] of Object.entries(methodRoutes)) {
    const regex = new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    const match = path.match(regex);
    if (match) return { handler, params: match.groups || {} };
  }
  return null;
}

// ─── CRUD helpers ───
function buildSelect(table: string, query: URLSearchParams): { sql: string; bindings: any[] } {
  let sql = `SELECT * FROM ${table} WHERE 1=1`;
  const bindings: any[] = [];
  const allowedFilters = ["company_id", "person_id", "role", "status", "company_group", "company_number", "identity"];
  for (const key of allowedFilters) {
    if (query.has(key)) {
      bindings.push(query.get(key));
      sql += ` AND ${key} = ?`;
    }
  }
  if (query.has("search")) {
    bindings.push(`%${query.get("search")}%`);
    sql += ` AND (name LIKE ? OR name_english LIKE ? OR name_chinese LIKE ?)`;
    bindings.push(`%${query.get("search")}%`);
    bindings.push(`%${query.get("search")}%`);
  }
  const limit = Math.min(parseInt(query.get("limit") || "100"), 1000);
  const offset = parseInt(query.get("offset") || "0");
  sql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  return { sql, bindings };
}

function buildInsert(table: string, data: Record<string, unknown>): { sql: string; bindings: any[] } {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
    bindings: values,
  };
}

function buildUpdate(table: string, id: string, data: Record<string, unknown>): { sql: string; bindings: any[] } {
  const keys = Object.keys(data);
  const setClauses = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => data[k]);
  values.push(id);
  return {
    sql: `UPDATE ${table} SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
    bindings: values,
  };
}

// ─── R2 Storage routes (must be before table routes to avoid /api/:table/:id conflict) ───

function getBucket(name: string, env: Env): R2Bucket | null {
  switch (name) {
    case "pdf-templates": return env.PDF_TEMPLATES;
    case "company-documents": return env.COMPANY_DOCUMENTS;
    case "company-logs": return env.COMPANY_LOGS;
    case "backups": return env.BACKUPS;
    default: return null;
  }
}

// GET /api/storage/:bucket/:file - download file
addRoute("GET", "/api/storage/:bucket/:file", async (_req, env, _user, params) => {
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  const filePath = params.file || "";
  const object = await bucket.get(filePath);
  if (!object) return error("File not found", 404);
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  if (object.httpMetadata?.contentDisposition) headers.set("Content-Disposition", object.httpMetadata.contentDisposition);
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(object.body, { headers });
});

// POST /api/storage/:bucket/:file - upload file
addRoute("POST", "/api/storage/:bucket/:file", async (req, env, user, params) => {
  requireAdmin(user);
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  const filePath = params.file || "";
  const contentType = req.headers.get("Content-Type") || "application/octet-stream";
  await bucket.put(filePath, req.body, { httpMetadata: { contentType } });
  return json({ success: true, path: filePath }, 201);
});

// DELETE /api/storage/:bucket/:file - delete file
addRoute("DELETE", "/api/storage/:bucket/:file", async (_req, env, user, params) => {
  requireAdmin(user);
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  const filePath = params.file || "";
  await bucket.delete(filePath);
  return json({ success: true });
});

// ─── Table CRUD routes ───
const TABLES = ["companies", "officers", "shareholders", "persons", "person_company_roles", "presenters", "significant_controllers", "company_logs", "reminders", "resolutions", "secretary_templates", "share_transactions", "user_roles"];

for (const table of TABLES) {
  // GET /api/:table
  addRoute("GET", `/api/${table}`, async (req, env, _user) => {
    const { sql, bindings } = buildSelect(table, new URL(req.url).searchParams);
    const { results } = await env.DB.prepare(sql).bind(...bindings).all();
    return json(results);
  });

  // GET /api/:table/:id
  addRoute("GET", `/api/${table}/:id`, async (_req, env, _user, params) => {
    const result = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(params.id).first();
    return result ? json(result) : error("Not found", 404);
  });

  // POST /api/:table
  addRoute("POST", `/api/${table}`, async (req, env, user) => {
    requireAdmin(user);
    const data = await req.json() as Record<string, unknown>;
    const { sql, bindings } = buildInsert(table, data);
    await env.DB.prepare(sql).bind(...bindings).run();
    return json({ success: true }, 201);
  });

  // PUT /api/:table/:id
  addRoute("PUT", `/api/${table}/:id`, async (req, env, user, params) => {
    requireAdmin(user);
    const data = await req.json() as Record<string, unknown>;
    const { sql, bindings } = buildUpdate(table, params.id, data);
    await env.DB.prepare(sql).bind(...bindings).run();
    return json({ success: true });
  });

  // DELETE /api/:table/:id
  addRoute("DELETE", `/api/${table}/:id`, async (_req, env, user, params) => {
    requireAdmin(user);
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(params.id).run();
    return json({ success: true });
  });
}

// ─── Special routes ───

// GET /api/me - current user info
addRoute("GET", "/api/me", async (_req, _env, user) => {
  if (!user) return error("Not authenticated", 401);
  return json(user);
});

// GET /api/companies/:id/full - company with all related data
addRoute("GET", "/api/companies/:id/full", async (_req, env, _user, params) => {
  const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(params.id).first();
  if (!company) return error("Company not found", 404);
  const officers = await env.DB.prepare("SELECT * FROM officers WHERE company_id = ?").bind(params.id).all();
  const shareholders = await env.DB.prepare("SELECT * FROM shareholders WHERE company_id = ?").bind(params.id).all();
  const scrs = await env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ?").bind(params.id).all();
  const logs = await env.DB.prepare("SELECT * FROM company_logs WHERE company_id = ?").bind(params.id).all();
  return json({ ...company, officers: officers.results, shareholders: shareholders.results, significant_controllers: scrs.results, logs: logs.results });
});

// GET /api/search - full-text search across companies, persons, officers
addRoute("GET", "/api/search", async (req, env, _user) => {
  const q = `%${new URL(req.url).searchParams.get("q") || ""}%`;
  if (!q || q === "%%") return json([]);
  const companies = await env.DB.prepare("SELECT id, name, chinese_name, company_number, 'company' as type FROM companies WHERE name LIKE ? OR chinese_name LIKE ? OR company_number LIKE ? LIMIT 20").bind(q, q, q).all();
  const persons = await env.DB.prepare("SELECT id, name_english, name_chinese, 'person' as type FROM persons WHERE name_english LIKE ? OR name_chinese LIKE ? LIMIT 20").bind(q, q).all();
  return json([...companies.results, ...persons.results]);
});

// POST /api/backup - trigger database backup
addRoute("POST", "/api/backup", async (_req, env, user) => {
  requireAdmin(user);
  const tables = TABLES.filter(t => t !== "company_logs");
  const files: Record<string, string> = {};
  for (const table of tables) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    files[`${table}.json`] = JSON.stringify(results, null, 2);
  }
  files["MANIFEST.json"] = JSON.stringify({ exported_at: new Date().toISOString(), tables: Object.fromEntries(tables.map(t => [t, { rows: 0 }])) });
  for (const [name, content] of Object.entries(files)) {
    await env.BACKUPS.put(`backup_${new Date().toISOString().slice(0,10)}/${name}`, content);
  }
  return json({ success: true, message: "Backup saved to R2" });
});

// ─── Main handler ───
export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // Authenticate
  const user = await verifyAuth(request, env);

  // Match route
  const match = matchRoute(request.method, path);
  if (!match) return error("Not found", 404);

  try {
    return await match.handler(request, env, user, match.params);
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("API Error:", e);
    return error(e.message || "Internal server error", 500);
  }
}
