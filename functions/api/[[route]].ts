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

const JWT_TTL_SECONDS = 7 * 24 * 60 * 60; // token 有效期 7 天（配合 verifyJWT 的 exp 檢查，實現過期自動登出）

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = await base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = await base64url(enc.encode(JSON.stringify({ exp: now + JWT_TTL_SECONDS, ...payload, iat: now })));
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
  const roleRows = await env.DB.prepare(
    "SELECT role FROM user_roles WHERE user_id = ?"
  ).bind(payload.sub as string).all();
  const roleSet = new Set((roleRows.results || []).map((r: any) => r.role));
  const role = roleSet.has("admin") ? "admin" : roleSet.has("moderator") ? "moderator" : "user";
  return {
    id: payload.sub as string,
    email: payload.email as string,
    display_name: (payload.display_name as string) || "",
    role,
  };
}

function requireAdmin(user: User | null) {
  if (!user || (user.role !== "admin" && user.role !== "moderator"))
    throw new Response(JSON.stringify({ error: "Unauthorized — admin or moderator required" }), { status: 401, headers: corsHeaders });
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
    // :name -> 單段 [^/]+；:name* -> catch-all .+（可含 /，用於嵌套的 R2 key 如 <companyId>/ci_x.pdf）
    const regex = new RegExp("^" + pattern
      .replace(/:(\w+)\*/g, "(?<$1>.+)")
      .replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    const match = path.match(regex);
    if (match) return { handler, params: match.groups || {} };
  }
  return null;
}

// ─── CRUD helpers ───

// Simple identifier safety check (matches Flask _safe_ident)
function _safeIdent(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function buildSelect(table: string, query: URLSearchParams): { sql: string; bindings: any[] } {
  let sql = `SELECT * FROM ${table} WHERE 1=1`;
  const bindings: any[] = [];
  const reserved = new Set(["search", "limit", "offset", "_order", "_order_dir"]);

  for (const key of query.keys()) {
    if (reserved.has(key)) continue;
    const val = query.get(key);
    if (val === null || val === "") continue;

    if (key.includes("__")) {
      const lastIdx = key.lastIndexOf("__");
      const col = key.slice(0, lastIdx);
      const op = key.slice(lastIdx + 2);
      if (!_safeIdent(col)) continue;

      switch (op) {
        case "neq":
          bindings.push(val); sql += ` AND "${col}" != ?`; break;
        case "gt":
          bindings.push(val); sql += ` AND "${col}" > ?`; break;
        case "lt":
          bindings.push(val); sql += ` AND "${col}" < ?`; break;
        case "gte":
          bindings.push(val); sql += ` AND "${col}" >= ?`; break;
        case "lte":
          bindings.push(val); sql += ` AND "${col}" <= ?`; break;
        case "like":
        case "ilike":
          bindings.push(val); sql += ` AND "${col}" LIKE ?`; break;
        case "in": {
          const vals = val.split(",").map(v => v.trim()).filter(Boolean);
          if (vals.length > 0) {
            const ph = vals.map(() => "?").join(",");
            bindings.push(...vals); sql += ` AND "${col}" IN (${ph})`;
          }
          break;
        }
        case "is":
          sql += ` AND "${col}" IS ${val}`; break;
        default:
          // fallback: treat as plain eq
          bindings.push(val); sql += ` AND "${key}" = ?`;
      }
    } else {
      if (!_safeIdent(key)) continue;
      bindings.push(val); sql += ` AND "${key}" = ?`;
    }
  }

  if (query.has("search")) {
    const s = `%${query.get("search")}%`;
    bindings.push(s, s, s);
    sql += ` AND (name LIKE ? OR name_english LIKE ? OR name_chinese LIKE ?)`;
  }

  // Order support
  const orderCol = query.get("_order");
  const orderDir = query.get("_order_dir") === "asc" ? "ASC" : "DESC";
  if (orderCol && _safeIdent(orderCol)) {
    sql += ` ORDER BY "${orderCol}" ${orderDir}`;
  } else {
    sql += ` ORDER BY created_at DESC`;
  }

  const limit = Math.min(parseInt(query.get("limit") || "100"), 1000);
  const offset = parseInt(query.get("offset") || "0");
  sql += ` LIMIT ${limit} OFFSET ${offset}`;
  return { sql, bindings };
}

// ─── Auth routes (must be first to avoid /api/:table conflicts) ───

// POST /api/auth/login
addRoute("POST", "/api/auth/login", async (req, env, _user) => {
  const { email, password } = await req.json() as { email: string; password: string };
  if (!email || !password) return error("Email and password required");
  const user = await env.DB.prepare(
    "SELECT id, email, password_hash, display_name, is_active FROM auth_users WHERE email = ?"
  ).bind(email.toLowerCase().trim()).first() as any;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return error("Invalid email or password", 401);
  }
  if (user.is_active === 0) return error("Account is deactivated", 403);
  const roleRows = await env.DB.prepare(
    "SELECT role FROM user_roles WHERE user_id = ?"
  ).bind(user.id).all();
  const roleSet = new Set((roleRows.results || []).map((r: any) => r.role));
  const role = roleSet.has("admin") ? "admin" : roleSet.has("moderator") ? "moderator" : "user";
  const token = await signJWT({
    sub: user.id,
    email: user.email,
    display_name: user.display_name,
    role,
  }, env.JWT_SECRET);
  return json({
    token,
    user: { id: user.id, email: user.email, display_name: user.display_name, role },
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

// ─── 用户管理（admin，10.1–10.3）───
const VALID_ROLES = ["admin", "moderator", "user"];

// GET /api/admin/users — 列出所有用户 + 角色 + 啟用狀態
addRoute("GET", "/api/admin/users", async (_req, env, user) => {
  requireAdmin(user);
  const users = await env.DB.prepare(
    "SELECT id, email, display_name, is_active, created_at FROM auth_users ORDER BY created_at"
  ).all();
  const roleRows = await env.DB.prepare("SELECT user_id, role FROM user_roles").all();
  const roleMap: Record<string, string[]> = {};
  for (const r of (roleRows.results || []) as any[]) {
    (roleMap[r.user_id] ||= []).push(r.role);
  }
  const out = ((users.results || []) as any[]).map((u) => ({ ...u, roles: roleMap[u.id] || [] }));
  return json(out);
});

// POST /api/admin/users — 建立用户
addRoute("POST", "/api/admin/users", async (req, env, user) => {
  requireAdmin(user);
  const { email, password, display_name, role } = await req.json() as
    { email: string; password: string; display_name?: string; role?: string };
  if (!email || !password) return error("Email and password required");
  const emailLower = email.toLowerCase().trim();
  const existing = await env.DB.prepare("SELECT id FROM auth_users WHERE email = ?").bind(emailLower).first();
  if (existing) return error("Email already exists", 409);
  const id = generateUUID();
  const password_hash = await hashPassword(password);
  await env.DB.prepare(
    "INSERT INTO auth_users (id, email, password_hash, display_name, is_active) VALUES (?, ?, ?, ?, 1)"
  ).bind(id, emailLower, password_hash, display_name || emailLower).run();
  const r = role && VALID_ROLES.includes(role) ? role : "user";
  await env.DB.prepare("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)")
    .bind(generateUUID(), id, r).run();
  return json({ id, email: emailLower, display_name: display_name || emailLower, roles: [r], is_active: 1 }, 201);
});

// PUT /api/admin/users/:id — 更新角色 / 啟用狀態 / 顯示名 / 密碼
addRoute("PUT", "/api/admin/users/:id", async (req, env, user, params) => {
  requireAdmin(user);
  const id = params.id;
  const body = await req.json() as
    { role?: string; is_active?: boolean | number; display_name?: string; password?: string };
  const target = await env.DB.prepare("SELECT id FROM auth_users WHERE id = ?").bind(id).first();
  if (!target) return error("User not found", 404);
  if (body.is_active !== undefined) {
    await env.DB.prepare("UPDATE auth_users SET is_active = ? WHERE id = ?")
      .bind(body.is_active ? 1 : 0, id).run();
  }
  if (body.display_name !== undefined) {
    await env.DB.prepare("UPDATE auth_users SET display_name = ? WHERE id = ?").bind(body.display_name, id).run();
  }
  if (body.password) {
    await env.DB.prepare("UPDATE auth_users SET password_hash = ? WHERE id = ?")
      .bind(await hashPassword(body.password), id).run();
  }
  if (body.role !== undefined) {
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id).run();
    if (VALID_ROLES.includes(body.role)) {
      await env.DB.prepare("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)")
        .bind(generateUUID(), id, body.role).run();
    }
  }
  return json({ success: true });
});

// DELETE /api/admin/users/:id — 刪除用户
addRoute("DELETE", "/api/admin/users/:id", async (_req, env, user, params) => {
  requireAdmin(user);
  await env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(params.id).run();
  await env.DB.prepare("DELETE FROM auth_users WHERE id = ?").bind(params.id).run();
  return json({ success: true });
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

addRoute("GET", "/api/storage/:bucket/:file*", async (_req, env, _user, params) => {
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  const object = await bucket.get(params.file || "");
  if (!object) return error("File not found", 404);
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(object.body, { headers });
});

addRoute("POST", "/api/storage/:bucket/:file*", async (req, env, user, params) => {
  requireAdmin(user);
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  const contentType = req.headers.get("Content-Type") || "application/octet-stream";
  await bucket.put(params.file || "", req.body, { httpMetadata: { contentType } });
  return json({ success: true, path: params.file }, 201);
});

addRoute("DELETE", "/api/storage/:bucket/:file*", async (_req, env, user, params) => {
  requireAdmin(user);
  const bucket = getBucket(params.bucket, env);
  if (!bucket) return error("Bucket not found", 404);
  await bucket.delete(params.file || "");
  return json({ success: true });
});

// ─── Table CRUD routes ───

const TABLES = ["companies", "officers", "shareholders", "persons", "person_company_roles", "presenters", "significant_controllers", "company_logs", "reminders", "resolutions", "secretary_templates", "share_transactions", "user_roles", "email_templates", "email_logs", "invoices", "whatsapp_logs", "company_versions"];

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
    const body = await req.json() as any;
    // Support both single object and array (batch) inserts — matches Flask behavior
    const rows: Record<string, unknown>[] = Array.isArray(body) ? body : [body];
    if (rows.length === 0) return error("Empty data", 400);

    // D1 batch: execute all inserts in one call
    const statements: D1PreparedStatement[] = rows.map(row => {
      // Auto-generate UUID when id is missing (matches Flask behavior)
      if (row.id === undefined || row.id === null || row.id === '') {
        row.id = generateUUID();
      }
      const keys = Object.keys(row);
      const values = Object.values(row);
      const placeholders = keys.map(() => "?").join(", ");
      return env.DB.prepare(
        `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`
      ).bind(...values);
    });

    const results = await env.DB.batch(statements);
    const ids: string[] = [];
    for (const r of results) {
      if (r.meta?.last_row_id) ids.push(String(r.meta.last_row_id));
    }

    if (Array.isArray(body)) {
      return json({ success: true, ids, count: ids.length }, 201);
    }
    return json({ success: true, id: ids[0] }, 201);
  });

  addRoute("PUT", `/api/${table}/:id`, async (req, env, user, params) => {
    requireAdmin(user);
    const data = await req.json() as Record<string, unknown>;
    const keys = Object.keys(data);
    const setClauses = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map(k => data[k]);
    values.push(params.id);
    await env.DB.prepare(`UPDATE ${table} SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();
    // ─── Company version snapshot: auto-record on every company update (mirrors Flask) ───
    if (table === "companies") {
      try {
        await recordCompanyVersion(env.DB, params.id);
      } catch (e: any) {
        console.error(`[VERSION] snapshot failed: ${e.message}`);
      }
    }
    return json({ success: true });
  });

  addRoute("DELETE", `/api/${table}/:id`, async (_req, env, user, params) => {
    requireAdmin(user);

    if (table === "companies") {
      // ─── Cascade delete: clean up all related records (mirrors Flask server.py) ───
      const companyId = params.id;

      // 1. Find persons that will become orphaned (only in this company)
      const rolesResult = await env.DB.prepare(
        "SELECT person_id FROM person_company_roles WHERE company_id = ?"
      ).bind(companyId).all();
      const orphanPersonIds = (rolesResult.results || []).map((r: any) => r.person_id);

      // 2. Delete all related records across child tables (some don't have ON DELETE CASCADE)
      const childTables = [
        "person_company_roles", "reminders", "company_logs",
        "resolutions", "significant_controllers", "share_transactions",
        "invoices", "email_logs",
      ];
      for (const tbl of childTables) {
        try {
          await env.DB.prepare(`DELETE FROM ${tbl} WHERE company_id = ?`).bind(companyId).run();
        } catch (e: any) {
          console.error(`[DELETE cascade] ${tbl}:`, e.message);
        }
      }

      // 3. Delete orphaned persons (no remaining roles in any company)
      for (const pid of orphanPersonIds) {
        try {
          const remaining = await env.DB.prepare(
            "SELECT COUNT(*) as cnt FROM person_company_roles WHERE person_id = ?"
          ).bind(pid).first() as any;
          if (remaining && remaining.cnt === 0) {
            await env.DB.prepare("DELETE FROM persons WHERE id = ?").bind(pid).run();
          }
        } catch (e: any) {
          console.error(`[DELETE cascade] orphan person ${pid}:`, e.message);
        }
      }

      // 4. officers & shareholders have ON DELETE CASCADE, auto-cleaned by D1
      try {
        await env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(companyId).run();
      } catch (e: any) {
        console.error(`[DELETE cascade] companies:`, e.message);
        return error(`刪除失敗：${e.message}`, 500);
      }
    } else {
      await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(params.id).run();
    }

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
  // Read shareholders from person_company_roles (same source as frontend hooks & Flask server.py)
  const shareholders = await env.DB.prepare(
    "SELECT pcr.*, p.name_english AS person_name_english, p.name_chinese AS person_name_chinese, " +
    "p.identity AS person_identity, p.id_number AS person_id_number, p.address AS person_address, " +
    "p.email AS person_email, p.service_address AS person_service_address " +
    "FROM person_company_roles pcr " +
    "LEFT JOIN persons p ON p.id = pcr.person_id " +
    "WHERE pcr.company_id = ? AND pcr.role = 'shareholder'"
  ).bind(params.id).all();
  const scrs = await env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ?").bind(params.id).all();
  const logs = await env.DB.prepare("SELECT * FROM company_logs WHERE company_id = ?").bind(params.id).all();
  return json({ ...company, officers: officers.results, shareholders: shareholders.results, significant_controllers: scrs.results, logs: logs.results });
});

addRoute("GET", "/api/search", async (req, env, _user) => {
  const raw = new URL(req.url).searchParams.get("q") || "";
  if (!raw) return json([]);
  const q = `%${raw}%`;
  const companies = await env.DB.prepare(
    "SELECT id, name, chinese_name, company_number, ci_number, company_type, status, 'company' as type " +
    "FROM companies WHERE name LIKE ? OR chinese_name LIKE ? OR company_number LIKE ? OR ci_number LIKE ? " +
    "ORDER BY name LIMIT 30"
  ).bind(q, q, q, q).all();
  const persons = await env.DB.prepare(
    "SELECT id, name_english, name_chinese, identity, id_number, passport_number, 'person' as type " +
    "FROM persons WHERE name_english LIKE ? OR name_chinese LIKE ? OR id_number LIKE ? OR passport_number LIKE ? " +
    "ORDER BY name_english LIMIT 30"
  ).bind(q, q, q, q).all();
  const out: any[] = [...companies.results];
  // 每位自然人附上關聯公司+角色，讓前端點擊可定位公司登記冊
  for (const p of persons.results as any[]) {
    const roles = await env.DB.prepare(
      "SELECT pcr.role, pcr.date_ceased, c.id AS company_id, c.name AS company_name " +
      "FROM person_company_roles pcr JOIN companies c ON c.id = pcr.company_id " +
      "WHERE pcr.person_id = ?"
    ).bind(p.id).all();
    out.push({ ...p, roles: roles.results });
  }
  return json(out);
});

// ─── Cleanup orphan persons ───

addRoute("POST", "/api/persons/cleanup-orphans", async (_req, env, user) => {
  requireAdmin(user);
  const result = await env.DB.prepare(
    "DELETE FROM persons WHERE id IN (SELECT p.id FROM persons p LEFT JOIN person_company_roles r ON p.id = r.person_id WHERE r.person_id IS NULL)"
  ).run();
  return json({ success: true, deleted: result.meta?.changes || 0 });
});

addRoute("POST", "/api/backup", async (_req, env, user) => {
  requireAdmin(user);
  for (const table of TABLES) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    await env.BACKUPS.put(`backup_${new Date().toISOString().slice(0, 10)}/${table}.json`, JSON.stringify(results));
  }
  return json({ success: true, message: "Backup saved to R2" });
});

// ─── Company Versions ───

// Shared version-snapshot fields & labels (mirrors Flask VERSION_FIELDS)
const VERSION_FIELDS = [
  "name", "chinese_name", "company_number", "ci_number", "trading_name",
  "business_nature", "company_type", "business_code", "status",
  "incorporation_date", "jurisdiction", "reg_flat", "reg_building",
  "reg_street", "reg_district", "reg_region", "email", "phone", "signer_role_id",
];
const VERSION_FIELD_LABELS: Record<string, string> = {
  name: "英文名稱", chinese_name: "中文名稱", company_number: "商業登記號碼",
  ci_number: "公司註冊編號", trading_name: "商業名稱", business_nature: "業務性質",
  company_type: "公司類型", business_code: "業務代碼", status: "狀態",
  incorporation_date: "成立日期", jurisdiction: "司法管轄區",
  reg_flat: "註冊地址-室/樓/座", reg_building: "註冊地址-大廈", reg_street: "註冊地址-街道",
  reg_district: "註冊地址-區", reg_region: "註冊地址-地區", email: "電郵地址",
  phone: "電話", signer_role_id: "簽署人",
};

async function recordCompanyVersion(db: D1Database, companyId: string, changedBy = ""): Promise<number | null> {
  const company = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first() as any;
  if (!company) return null;

  // Build current snapshot
  const snap: Record<string, string> = {};
  for (const k of VERSION_FIELDS) {
    snap[k] = company[k] !== null && company[k] !== undefined ? String(company[k]) : "";
  }

  // Compare with latest version
  const latest = await db.prepare(
    "SELECT * FROM company_versions WHERE company_id = ? ORDER BY version_no DESC LIMIT 1"
  ).bind(companyId).first() as any;

  let changed: string[] = [];
  let versionNo = 1;
  if (latest) {
    let prevSnap: Record<string, string> = {};
    try { prevSnap = JSON.parse(latest.snapshot || "{}"); } catch { /* keep default */ }
    for (const k of VERSION_FIELDS) {
      if ((prevSnap[k] || "") !== (snap[k] || "")) changed.push(k);
    }
    if (changed.length === 0) return null; // No real change, skip duplicate version
    versionNo = (latest.version_no || 0) + 1;
  }

  const labels = changed.map(k => VERSION_FIELD_LABELS[k] || k);
  const summary = versionNo === 1 ? "建立初始版本" : `更新：${labels.join("、")}`;

  await db.prepare(
    "INSERT INTO company_versions (id, company_id, version_no, snapshot, changed_fields, change_summary, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    generateUUID(), companyId, versionNo,
    JSON.stringify(snap), JSON.stringify(changed), summary, changedBy
  ).run();

  return versionNo;
}

addRoute("GET", "/api/companies/:id/versions", async (_req, env, _user, params) => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM company_versions WHERE company_id = ? ORDER BY version_no DESC"
  ).bind(params.id).all();
  const out = (results || []).map((r: any) => {
    let snapshot: any = {};
    let changed_fields: any = [];
    try { snapshot = JSON.parse(r.snapshot || "{}"); } catch { /* keep default */ }
    try { changed_fields = JSON.parse(r.changed_fields || "[]"); } catch { /* keep default */ }
    return { ...r, snapshot, changed_fields };
  });
  return json(out);
});

addRoute("POST", "/api/companies/:id/versions/snapshot", async (req, env, user, params) => {
  requireAdmin(user);
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  const changedBy = body.changed_by || "";
  const v = await recordCompanyVersion(env.DB, params.id, changedBy);
  return json({ success: true, version_no: v, created: v !== null });
});

// ─── Form History ───

addRoute("GET", "/api/form-history/list", async (req, env, user) => {
  if (!user) return error("Not authenticated", 401);
  const url = new URL(req.url);
  const formType = url.searchParams.get("formType") || "";
  if (!formType) return error("formType required", 400);
  const { results } = await env.DB.prepare(
    "SELECT id, label, form_type, submission_index, created_at FROM form_history WHERE user_id = ? AND form_type = ? ORDER BY submission_index DESC"
  ).bind(user.id, formType).all();
  return json({ entries: results || [] });
});

addRoute("GET", "/api/form-history/load", async (req, env, user) => {
  if (!user) return error("Not authenticated", 401);
  const url = new URL(req.url);
  const entryId = url.searchParams.get("id") || "";
  if (!entryId) return error("id required", 400);
  const row = await env.DB.prepare(
    "SELECT id, form_data FROM form_history WHERE id = ? AND user_id = ?"
  ).bind(entryId, user.id).first() as any;
  if (!row) return error("Not found", 404);
  let formData: any = {};
  try { formData = JSON.parse(row.form_data || "{}"); } catch { /* keep default */ }
  return json({ entry: { id: row.id, form_data: formData } });
});

addRoute("POST", "/api/form-history/save", async (req, env, user) => {
  if (!user) return error("Not authenticated", 401);
  const data = await req.json() as { formType?: string; formData?: any };
  if (!data.formType || data.formData === undefined) return error("formType and formData required", 400);

  // Get next submission index
  const maxRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(submission_index), 0) as max_idx FROM form_history WHERE user_id = ? AND form_type = ?"
  ).bind(user.id, data.formType).first() as any;
  const nextIdx = (maxRow?.max_idx || 0) + 1;

  // Generate label: YYYY-MM-DD_FORM_N
  const today = new Date().toISOString().slice(0, 10);
  const label = `${today}_${data.formType}_${nextIdx}`;

  const result = await env.DB.prepare(
    "INSERT INTO form_history (user_id, user_email, form_type, submission_index, label, form_data) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(user.id, user.email, data.formType, nextIdx, label, JSON.stringify(data.formData)).run();

  return json({ id: result.meta?.last_row_id, label, submission_index: nextIdx }, 201);
});

addRoute("DELETE", "/api/form-history/:id", async (_req, env, user, params) => {
  if (!user) return error("Not authenticated", 401);
  const entryId = params.id;

  // Get the record being deleted
  const row = await env.DB.prepare(
    "SELECT form_type, submission_index FROM form_history WHERE id = ? AND user_id = ?"
  ).bind(entryId, user.id).first() as any;
  if (!row) return error("Not found", 404);

  const formType = row.form_type;
  const deletedIdx = row.submission_index;

  // Delete
  await env.DB.prepare("DELETE FROM form_history WHERE id = ? AND user_id = ?").bind(entryId, user.id).run();

  // Renumber later submissions
  await env.DB.prepare(
    "UPDATE form_history SET submission_index = submission_index - 1 WHERE user_id = ? AND form_type = ? AND submission_index > ?"
  ).bind(user.id, formType, deletedIdx).run();

  // Update labels
  const rows = await env.DB.prepare(
    "SELECT id, created_at, submission_index FROM form_history WHERE user_id = ? AND form_type = ? AND submission_index >= ? ORDER BY submission_index"
  ).bind(user.id, formType, deletedIdx).all();
  for (const r of (rows.results || []) as any[]) {
    const datePart = (r.created_at || "").slice(0, 10);
    const newLabel = `${datePart}_${formType}_${r.submission_index}`;
    await env.DB.prepare("UPDATE form_history SET label = ? WHERE id = ?").bind(newLabel, r.id).run();
  }

  return json({ success: true });
});

// ─── Export All ───

addRoute("POST", "/api/export-all", async (_req, env, user) => {
  requireAdmin(user);
  const exportData: Record<string, any[]> = {};
  for (const table of TABLES) {
    try {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      exportData[table] = results || [];
    } catch { exportData[table] = []; }
  }
  return json({ success: true, data: exportData, exported_at: new Date().toISOString() });
});

// ─── Send WhatsApp ───

addRoute("POST", "/api/send-whatsapp", async (req, env, user) => {
  requireAdmin(user);
  const data = await req.json() as { phone?: string; message?: string; task_title?: string; company_id?: string };
  if (!data.phone || !data.message) return error("phone and message required", 400);

  // In Cloudflare, we can't call Wuzapi directly (it's local).
  // Log the message and return simulated success.
  const id = generateUUID();
  await env.DB.prepare(
    "INSERT INTO whatsapp_logs (id, company_id, phone, message, task_title, status) VALUES (?, ?, ?, ?, ?, 'sent')"
  ).bind(id, data.company_id || null, data.phone, data.message, data.task_title || "").run();

  console.log(`[WHATSAPP:SIMULATED] to=${data.phone} msg=${data.message.slice(0, 80)}`);

  return json({ success: true, id, simulated: true, message: "WhatsApp message logged (Wuzapi not available in Cloud)" });
});

// ─── Main handler ───

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const path = new URL(request.url).pathname;
  const user = await verifyAuth(request, env);
  console.log(`[API] ${request.method} ${path} user=${user?.email || 'none'} role=${user?.role || 'none'}`);
  const match = matchRoute(request.method, path);
  if (!match) {
    console.log(`[API] ${request.method} ${path} → 404 (no route)`);
    return error("Not found", 404);
  }
  try {
    const res = await match.handler(request, env, user, match.params);
    console.log(`[API] ${request.method} ${path} → ${res.status}`);
    return res;
  } catch (e: any) {
    if (e instanceof Response) {
      console.log(`[API] ${request.method} ${path} → ${e.status} (thrown Response)`);
      return e;
    }
    console.error(`[API] ${request.method} ${path} → 500:`, e.message);
    return error(e.message || "Internal server error", 500);
  }
}
