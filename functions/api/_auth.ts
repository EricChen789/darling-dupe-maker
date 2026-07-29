// _auth.ts — Shared authentication middleware for standalone Cloudflare Function endpoints
// Usage: import { verifyAuthRequest, requireAdmin, type User, type Env } from "./_auth";

import { corsHeaders, jsonResp } from "./_pdf-utils";

// ═══ Types ═══
export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export interface Env {
  DB?: D1Database;
  JWT_SECRET?: string;
}

// ═══ JWT Verification (matches [[route]].ts exactly) ═══
async function base64url(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyJWT(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sig = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      enc.encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ═══ Auth Middleware ═══
// Returns { user, errorResponse } — caller checks errorResponse first
export async function verifyAuthRequest(
  request: Request,
  env: Env
): Promise<{ user: User | null; errorResponse?: Response }> {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return {
      user: null,
      errorResponse: jsonResp({ error: "Not authenticated" }, 401),
    };
  }

  const jwtSecret = env.JWT_SECRET || "";
  if (!jwtSecret) {
    return {
      user: null,
      errorResponse: jsonResp({ error: "Server misconfigured: JWT_SECRET not set" }, 500),
    };
  }

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload) {
    return {
      user: null,
      errorResponse: jsonResp({ error: "Invalid or expired token" }, 401),
    };
  }

  // Resolve role from user_roles table
  let role = "user";
  if (env.DB) {
    try {
      const roleRows = await env.DB.prepare(
        "SELECT role FROM user_roles WHERE user_id = ?"
      )
        .bind(payload.sub as string)
        .all();
      const roleSet = new Set(
        (roleRows.results || []).map((r: any) => r.role)
      );
      if (roleSet.has("admin")) role = "admin";
      else if (roleSet.has("moderator")) role = "moderator";
    } catch {
      // DB unavailable — default to "user" role
    }
  }

  const user: User = {
    id: (payload.sub as string) || "",
    email: (payload.email as string) || "",
    display_name: (payload.display_name as string) || "",
    role,
  };

  return { user };
}

// ═══ Role Guards ═══
export function requireAdmin(user: User | null): Response | null {
  if (!user || (user.role !== "admin" && user.role !== "moderator")) {
    return jsonResp({ error: "Unauthorized — admin or moderator required" }, 401);
  }
  return null; // OK
}

export function requireUser(user: User | null): Response | null {
  if (!user) {
    return jsonResp({ error: "Not authenticated" }, 401);
  }
  return null; // OK
}
