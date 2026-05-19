// Pages Functions API - D1 + R2 backend for secretary-system (no Supabase)

interface Env {
  DB: D1Database;
  PDF_TEMPLATES: R2Bucket;
  COMPANY_DOCUMENTS: R2Bucket;
  COMPANY_LOGS: R2Bucket;
  BACKUPS: R2Bucket;
  JWT_SECRET: string;
}

interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

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

// ─── JWT helpers (Web Crypto) ───

async function base64url(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = await base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = await base64url(enc.encode(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${headerB64}.${payloadB64}`));
  return `${headerB64}.${payloadB64}.${await base64url(sig)}`;
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  const saltB64 = await base64url(salt);
  const hashB64 = await base64url(hash);
  return `${saltB64}:${hashB64}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [saltB64, hashB64] = stored.split(":");
    const enc = new TextEncoder();
    const salt = Uint8Array.from(atob(saltB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
    return await base64url(hash) === hashB64;
  } catch { return false; }
}

// ─── Auth middleware ───

async function verifyAuth(req: Request, env: Env): Promise<User | null> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  const roleResult = await env.DB.prepare(
    "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'"
  ).bind(payload.sub as string).first();
  return {
    id: payload.sub as string,
    email: payload.email as string,
    display_name: (payload.display_name as string) || "",
    role: roleResult ? "admin" : "user",
  };
}

function requireAdmin(user: User | null) {
  if (!user || user.role !== "admin") throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
}

function generateUUID(): string {
  return crypto.randomUUID();
}

// ─── Router ───

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
    if (query.has(key)) { bindings.push(query.get(key)); sql += ` AND ${key} = ?`; }
  }
  if (query.has("search")) {
    const s = `%${query.get("search")}%`;
    bindings.push(s, s, s);
    sql += ` AND (name LIKE ? OR name_english LIKE ? OR name_chinese LIKE ?)`;
  }
  const limit = Math.min(parseInt(query.get("limit") || "100"), 1000);
  const offset = parseInt(query.get("offset") || "0");
  sql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  return { sql, bindings };
}

// ─── Auth routes (must be first to avoid /api/:table conflicts) ───

// POST /api/auth/login
addRoute("POST", "/api/auth/login", async (req, env, _user) => {
  const { email, password } = await req.json() as { email: string; password: string };
  if (!email || !password) return error("Email and password required");
  const user = await env.DB.prepare(
    "SELECT id, email, password_hash, display_name FROM auth_users WHERE email = ?"
  ).bind(email.toLowerCase().trim()).first() as any;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return error("Invalid email or password", 401);
  }
  const roleResult = await env.DB.prepare(
    "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'"
  ).bind(user.id).first();
  const token = await signJWT({
    sub: user.id,
    email: user.email,
    display_name: user.display_name,
    role: roleResult ? "admin" : "user",
  }, env.JWT_SECRET);
  return json({
    token,
    user: { id: user.id, email: user.email, display_name: user.display_name, role: roleResult ? "admin" : "user" },
  });
});

// POST /api/auth/register
addRoute("POST", "/api/auth/register", async (req, env, user) => {
  requireAdmin(user);
  const { email, password, display_name } = await req.json() as { email: string; password: string; display_name?: string };
  if (!email || !password) return error("Email and password required");
  const emailLower = email.toLowerCase().trim();
  const existing = await env.DB.prepare("SELECT id FROM auth_users WHERE email = ?").bind(emailLower).first();
  if (existing) return error("Email already exists", 409);
  const id = generateUUID();
  const password_hash = await hashPassword(password);
  await env.DB.prepare(
    "INSERT INTO auth_users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)"
  ).bind(id, emailLower, password_hash, display_name || emailLower).run();
  return json({ id, email: emailLower, display_name: display_name || emailLower }, 201);
});

// POST /api/auth/change-password
addRoute("POST", "/api/auth/change-password", async (req, env, user) => {
  if (!user) return error("Not authenticated", 401);
  const { current_password, new_password } = await req.json() as { current_password: string; new_password: string };
  if (!current_password || !new_password) return error("Current and new password required");
  const row = await env.DB.prepare("SELECT password_hash FROM auth_users WHERE id = ?").bind(user.id).first() as any;
  if (!row || !(await verifyPassword(current_password, row.password_hash))) {
    return error("Current password is incorrect", 401);
  }
  const password_hash = await hashPassword(new_password);
  await env.DB.prepare("UPDATE auth_users SET password_hash = ? WHERE id = ?").bind(password_hash, user.id).run();
  return json({ success: true });
});

// GET /api/auth/me
addRoute("GET", "/api/auth/me", async (_req, _env, user) => {
  if (!user) return error("Not authenticated", 401);
  return json(user);
});

// ─── R2 Storage routes ───

function getBucket(name: string, env: Env): R2Bucket | null {
  switch (name) {
    case "pdf-templates": return env.PDF_TEMPLATES;
    case "company-documents": return env.COMPANY_DOCUMENTS;
    case "company-logs": return env.COMPANY_LOGS;
    case "backups": return env.BACKUPS;
    default: return null;
  }
}

addRoute("GET", "/api/storage/:bucket/:file", async (_req, env, _user, params) => {
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  const object = await bucket.get(params.file || "");
  if (!object) return error("File not found", 404);
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(object.body, { headers });
});

addRoute("POST", "/api/storage/:bucket/:file", async (req, env, user, params) => {
  requireAdmin(user);
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  const contentType = req.headers.get("Content-Type") || "application/octet-stream";
  await bucket.put(params.file || "", req.body, { httpMetadata: { contentType } });
  return json({ success: true, path: params.file }, 201);
});

addRoute("DELETE", "/api/storage/:bucket/:file", async (_req, env, user, params) => {
  requireAdmin(user);
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  await bucket.delete(params.file || "");
  return json({ success: true });
});

// ─── Table CRUD routes ───

const TABLES = ["companies", "officers", "shareholders", "persons", "person_company_roles", "presenters", "significant_controllers", "company_logs", "reminders", "resolutions", "secretary_templates", "share_transactions", "user_roles"];

for (const table of TABLES) {
  addRoute("GET", `/api/${table}`, async (req, env, _user) => {
    const { sql, bindings } = buildSelect(table, new URL(req.url).searchParams);
    const { results } = await env.DB.prepare(sql).bind(...bindings).all();
    return json(results);
  });

  addRoute("GET", `/api/${table}/:id`, async (_req, env, _user, params) => {
    const result = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(params.id).first();
    return result ? json(result) : error("Not found", 404);
  });

  addRoute("POST", `/api/${table}`, async (req, env, user) => {
    requireAdmin(user);
    const data = await req.json() as Record<string, unknown>;
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => "?").join(", ");
    await env.DB.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`).bind(...values).run();
    return json({ success: true }, 201);
  });

  addRoute("PUT", `/api/${table}/:id`, async (req, env, user, params) => {
    requireAdmin(user);
    const data = await req.json() as Record<string, unknown>;
    const keys = Object.keys(data);
    const setClauses = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map(k => data[k]);
    values.push(params.id);
    await env.DB.prepare(`UPDATE ${table} SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();
    return json({ success: true });
  });

  addRoute("DELETE", `/api/${table}/:id`, async (_req, env, user, params) => {
    requireAdmin(user);
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(params.id).run();
    return json({ success: true });
  });
}

// ─── Special routes ───

addRoute("GET", "/api/me", async (_req, _env, user) => {
  if (!user) return error("Not authenticated", 401);
  return json(user);
});

addRoute("GET", "/api/companies/:id/full", async (_req, env, _user, params) => {
  const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(params.id).first();
  if (!company) return error("Company not found", 404);
  const officers = await env.DB.prepare("SELECT * FROM officers WHERE company_id = ?").bind(params.id).all();
  const shareholders = await env.DB.prepare("SELECT * FROM shareholders WHERE company_id = ?").bind(params.id).all();
  const scrs = await env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ?").bind(params.id).all();
  const logs = await env.DB.prepare("SELECT * FROM company_logs WHERE company_id = ?").bind(params.id).all();
  return json({ ...company, officers: officers.results, shareholders: shareholders.results, significant_controllers: scrs.results, logs: logs.results });
});

addRoute("GET", "/api/search", async (req, env, _user) => {
  const q = `%${new URL(req.url).searchParams.get("q") || ""}%`;
  if (!q || q === "%%") return json([]);
  const companies = await env.DB.prepare("SELECT id, name, chinese_name, company_number, 'company' as type FROM companies WHERE name LIKE ? OR chinese_name LIKE ? OR company_number LIKE ? LIMIT 20").bind(q, q, q).all();
  const persons = await env.DB.prepare("SELECT id, name_english, name_chinese, 'person' as type FROM persons WHERE name_english LIKE ? OR name_chinese LIKE ? LIMIT 20").bind(q, q).all();
  return json([...companies.results, ...persons.results]);
});

addRoute("POST", "/api/backup", async (_req, env, user) => {
  requireAdmin(user);
  for (const table of TABLES) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    await env.BACKUPS.put(`backup_${new Date().toISOString().slice(0, 10)}/${table}.json`, JSON.stringify(results));
  }
  return json({ success: true, message: "Backup saved to R2" });
});

// ─── Main handler ───

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const path = new URL(request.url).pathname;
  const user = await verifyAuth(request, env);
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
