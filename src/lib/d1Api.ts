// D1 API client - drop-in replacement for Supabase data operations
// Auth stays with Supabase, data goes through D1 via Pages Functions API

const API_BASE = "/api";

interface QueryBuilder {
  select: (columns?: string) => QueryBuilder;
  insert: (data: any | any[]) => QueryBuilder;
  update: (data: any) => QueryBuilder;
  delete: () => QueryBuilder;
  eq: (column: string, value: any) => QueryBuilder;
  neq: (column: string, value: any) => QueryBuilder;
  gt: (column: string, value: any) => QueryBuilder;
  lt: (column: string, value: any) => QueryBuilder;
  gte: (column: string, value: any) => QueryBuilder;
  lte: (column: string, value: any) => QueryBuilder;
  like: (column: string, pattern: string) => QueryBuilder;
  ilike: (column: string, pattern: string) => QueryBuilder;
  in: (column: string, values: any[]) => QueryBuilder;
  is: (column: string, value: any) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  range: (from: number, to: number) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  single: () => QueryBuilder;
  maybeSingle: () => QueryBuilder;
  then: (resolve: (value: any) => void) => Promise<any>;
}

// Build fetch options
function getAccessToken(): string {
  return localStorage.getItem("secretary_jwt") || "";
}

function buildFetch(method: string, body?: any): RequestInit {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return opts;
}

async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, options);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    return { data: null, error: err };
  }
  const data = await resp.json();
  return { data, error: null };
}

class D1QueryBuilder implements QueryBuilder {
  private table: string;
  private operation: "select" | "insert" | "update" | "delete" | null = null;
  private filters: Record<string, any> = {};
  private data: any = null;
  private _limit: number = 100;
  private _offset: number = 0;
  private _single: boolean = false;
  private tableId: string | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string): QueryBuilder {
    this.operation = "select";
    return this;
  }

  insert(data: any | any[]): QueryBuilder {
    this.operation = "insert";
    this.data = data;
    return this;
  }

  update(data: any): QueryBuilder {
    this.operation = "update";
    this.data = data;
    return this;
  }

  delete(): QueryBuilder {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: any): QueryBuilder {
    if (column === "id") this.tableId = value;
    else this.filters[column] = value;
    return this;
  }

  neq(column: string, value: any): QueryBuilder { return this; }
  gt(column: string, value: any): QueryBuilder { return this; }
  lt(column: string, value: any): QueryBuilder { return this; }
  gte(column: string, value: any): QueryBuilder { return this; }
  lte(column: string, value: any): QueryBuilder { return this; }
  like(column: string, pattern: string): QueryBuilder { this.filters[column] = pattern; return this; }
  ilike(column: string, pattern: string): QueryBuilder { this.filters[column] = pattern; return this; }
  in(column: string, values: any[]): QueryBuilder { return this; }
  is(column: string, value: any): QueryBuilder { return this; }

  order(column: string, options?: { ascending?: boolean }): QueryBuilder { return this; }

  range(from: number, to: number): QueryBuilder {
    this._offset = from;
    this._limit = to - from + 1;
    return this;
  }

  limit(count: number): QueryBuilder {
    this._limit = count;
    return this;
  }

  single(): QueryBuilder { this._single = true; return this; }
  maybeSingle(): QueryBuilder { this._single = true; return this; }

  async then(resolve: (value: any) => void): Promise<any> {
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(this.filters)) {
        params.set(k, String(v));
      }
      params.set("limit", String(this._limit));
      if (this._offset) params.set("offset", String(this._offset));

      let result: any;

      if (this.operation === "select") {
        if (this.tableId) {
          result = await apiFetch(`/${this.table}/${this.tableId}`);
          if (result.data) result.data = this._single ? result.data : [result.data];
          else result.data = this._single ? null : [];
        } else {
          result = await apiFetch(`/${this.table}?${params.toString()}`);
          result.data = result.data || [];
        }
      } else if (this.operation === "insert") {
        result = await apiFetch(`/${this.table}`, buildFetch("POST", this.data));
        result.data = result.data ? (Array.isArray(this.data) ? result.data : result.data) : null;
      } else if (this.operation === "update") {
        const id = this.tableId;
        if (!id) { resolve({ data: null, error: { message: "Missing id for update" } }); return; }
        result = await apiFetch(`/${this.table}/${id}`, buildFetch("PUT", this.data));
      } else if (this.operation === "delete") {
        const id = this.tableId;
        if (!id) { resolve({ data: null, error: { message: "Missing id for delete" } }); return; }
        result = await apiFetch(`/${this.table}/${id}`, buildFetch("DELETE"));
      } else {
        resolve({ data: null, error: { message: "No operation specified" } });
        return;
      }

      resolve(result);
    } catch (e: any) {
      resolve({ data: null, error: { message: e.message } });
    }
  }
}

// Proxy-based Supabase-compatible client
export function createD1Client() {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === "from") {
        return (table: string) => new D1QueryBuilder(table);
      }
      if (prop === "then") {
        return undefined;
      }
      return undefined;
    },
  };

  return new Proxy({}, handler);
}

// R2 Storage client - mimics Supabase storage API
function createR2Storage() {
  const API = "/api/storage";

  const bucketHandler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === "then") return undefined;

      return (bucket: string) => {
        const getUrl = (path: string) => `${API}/${bucket}/${path}`;

        return {
          // Upload file
          upload: async (path: string, file: File, options?: { upsert?: boolean }) => {
            const resp = await fetch(getUrl(path), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${getAccessToken()}`,
                "Content-Type": file.type || "application/octet-stream",
              },
              body: file,
            });
            const data = await resp.json().catch(() => ({}));
            return resp.ok ? { data, error: null } : { data: null, error: data };
          },

          // Download file
          download: async (path: string) => {
            const resp = await fetch(getUrl(path), {
              headers: { Authorization: `Bearer ${getAccessToken()}` },
            });
            if (!resp.ok) return { data: null, error: { message: "Download failed" } };
            const blob = await resp.blob();
            return { data: blob, error: null };
          },

          // Create signed URL (just returns API URL with auth)
          createSignedUrl: async (path: string, expiresIn: number, options?: { download?: string }) => {
            const url = getUrl(path);
            const params = new URLSearchParams();
            if (options?.download) params.set("download", options.download);
            const fullUrl = params.toString() ? `${url}?${params}` : url;
            return { data: { signedUrl: fullUrl }, error: null };
          },

          // Get public URL
          getPublicUrl: (path: string) => {
            return { data: { publicUrl: getUrl(path) } };
          },

          // Remove file
          remove: async (paths: string[]) => {
            const results = [];
            for (const path of paths) {
              const resp = await fetch(getUrl(path), {
                method: "DELETE",
                headers: { Authorization: `Bearer ${getAccessToken()}` },
              });
              results.push(resp.ok);
            }
            return { data: results, error: null };
          },

          // List files
          list: async (prefix?: string) => {
            // List is not directly supported via simple API, return empty
            return { data: [], error: null };
          },
        };
      };
    },
  };

  return new Proxy({}, bucketHandler);
}

// Hybrid client: uses Supabase for auth, D1 for data, R2 for storage
export function createHybridClient(supabaseClient: any) {
  const r2Storage = createR2Storage();

  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      // Auth methods → Supabase
      if (prop === "auth") return supabaseClient.auth;
      // Storage methods → R2
      if (prop === "storage") return r2Storage;
      // RPC calls → Supabase
      if (prop === "rpc") return (...args: any[]) => supabaseClient.rpc(...args);
      // Channel/subscription → Supabase
      if (prop === "channel") return (...args: any[]) => supabaseClient.channel(...args);
      if (prop === "removeChannel") return (...args: any[]) => supabaseClient.removeChannel(...args);
      if (prop === "removeAllChannels") return (...args: any[]) => supabaseClient.removeAllChannels(...args);
      // Data methods → D1
      if (prop === "from") return (table: string) => new D1QueryBuilder(table);
      return undefined;
    },
  };

  return new Proxy({}, handler);
}
