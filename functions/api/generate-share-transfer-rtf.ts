import { verifyAuthRequest, type Env as AuthEnv } from './_auth';

type Env = AuthEnv & {
  DB: D1Database;
  PDF_TEMPLATES?: R2Bucket;
  R2?: R2Bucket;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── Base64-encode a UTF-8 string (chunked to avoid stack overflow) ──
function stringToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const CHUNK = 4096;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(binary);
}

// ── Split address string into N lines by comma ──
function splitAddressLines(addr: string, numLines: number): string[] {
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < numLines; i++) {
    lines.push(parts[i] || "");
  }
  return lines;
}

// ── 平衡分配：按逗号部件贪心装 N 行（预算内换行），多余部件并进最后一行，绝不丢尾 ──
function splitAddressBalanced(addr: string, numLines: number, maxCharsPerLine: number): string[] {
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const p of parts) {
    const candidate = cur ? `${cur}, ${p}` : p;
    if (cur && lines.length < numLines - 1 && candidate.length > maxCharsPerLine) {
      lines.push(cur);
      cur = p;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  while (lines.length < numLines) lines.push("");
  // 安全网：部件多到超过行数时，超出的并进最后一行（完整地址不丢失）
  while (lines.length > numLines) {
    const extra = lines.pop() || "";
    lines[lines.length - 1] = `${lines[lines.length - 1]}, ${extra}`;
  }
  return lines;
}

// ── Build person address from structured fields ──
// 回退链：结构化住宅地址 → address → 结构化服务地址 → service_address
// （生产数据有 address 空但 service_address 有值的记录，如 PAUL TANG 买方 Timothy Tang）
function buildPersonAddress(person: any): string {
  if (!person) return "";
  const parts = [
    person.addr_flat,
    person.addr_building,
    person.addr_street,
    person.addr_district,
    person.addr_region,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(", ");
  if (person.address) return person.address;
  const svcParts = [
    person.svc_addr_flat,
    person.svc_addr_building,
    person.svc_addr_street,
    person.svc_addr_district,
    person.svc_addr_region,
  ].filter(Boolean);
  if (svcParts.length > 0) return svcParts.join(", ");
  return person.service_address || "";
}

// ── Build company registered office address ──
function buildCompanyAddress(company: any): string {
  if (!company) return "";
  const parts = [
    company.reg_flat,
    company.reg_building,
    company.reg_street,
    company.reg_district,
    company.reg_region,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(", ");
  return company.address || company.registered_office || "";
}

// ── Format date as DD/MM/YYYY ──
function fmtDateSlash(s: string | null | undefined): string {
  if (!s) return "";
  const t = String(s).trim();
  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  // YYYY-MM-DD → DD/MM/YYYY
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return t;
}

// ── Format shares number with commas ──
function fmtShares(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return String(n);
  return num.toLocaleString("en-US");
}

// ── RTF-escape inserted values ──
// 模板自身中文全用 \uN RTF unicode 转义（模板文件零非 ASCII 字节），
// 与段落字体 charset 无关。若把 raw UTF-8 中文直接塞进模板，
// Word 会按段落字体声明的 charset（如 \f41 fcharset136=Big5/CP950）
// 解码字节 → 乱码（香港 → 擐+U+EA54+葛，生产已证实）。
// 因此插入值统一转 \uN 转义：\uc1 前缀把 fallback 计数锁定为 1，
// 每转义后跟 1 个 fallback 字符 '?'；N 为 signed 16-bit（BMP >32767 用负值）。
// 同时转义 RTF 控制字符 \ { }，删除换行（RTF 里 raw 换行会破坏控制流）。
function rtfEscape(s: string): string {
  if (!s) return "";
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x5c) out += "\\\\"; // backslash
    else if (cp === 0x7b) out += "\\{"; // {
    else if (cp === 0x7d) out += "\\}"; // }
    else if (cp === 0x0d || cp === 0x0a) {
      /* drop newlines */
    } else if (cp > 0x7f) {
      if (cp <= 0xffff) {
        const n = cp > 32767 ? cp - 65536 : cp;
        out += `\\uc1\\u${n}?`;
      } else {
        // astral 字符：代理对（两个 \uN 组合）
        const sp = cp - 0x10000;
        const hi = 0xd800 + (sp >> 10);
        const lo = 0xdc00 + (sp & 0x3ff);
        const s16 = (u: number) => (u > 32767 ? u - 65536 : u);
        out += `\\uc1\\u${s16(hi)}?\\u${s16(lo)}?`;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

// ── Format currency amount ──
function fmtMoney(val: number | string | null | undefined, currency?: string | null): string {
  if (val === null || val === undefined) return "";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return String(val);
  const curr = (currency || "HKD").toUpperCase();
  const compact: Record<string, string> = {
    HKD: "HK$", USD: "US$", CNY: "CN¥", GBP: "£", EUR: "€", JPY: "¥",
  };
  const symbol = compact[curr] || curr + " ";
  return `${symbol}${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const body = await request.json() as any;
    const { companyId, transactionId, documentType, transaction: txData } = body;

    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const docType = documentType || "instrument_of_transfer";

    // ── Fetch company ──
    const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
    if (!company) throw new Error("Company not found");

    // ── Fetch transaction ──
    // Priority: 1) txData from frontend (Supabase)  2) transactionId from D1  3) D1 query / auto-build
    let transaction: any = null;
    let allTransactions: any[] = [];

    if (txData && typeof txData === "object" && Object.keys(txData).length > 0) {
      // Use transaction data passed directly from frontend (Supabase-sourced)
      transaction = txData;
    } else if (transactionId) {
      transaction = await env.DB.prepare(
        "SELECT * FROM share_transactions WHERE id = ? AND company_id = ?"
      ).bind(transactionId, companyId).first();
      if (!transaction) throw new Error("Transaction not found");
    } else {
      const txResult = await env.DB.prepare(
        "SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date DESC"
      ).bind(companyId).all();
      allTransactions = (txResult.results || []) as any[];
    }

    // ── Auto-build transaction from shareholders when none exists ──
    if (!transaction && allTransactions.length === 0) {
      const shResult = await env.DB.prepare(
        `SELECT p.id as person_id, p.name_english, p.address,
                p.addr_flat, p.addr_building, p.addr_street, p.addr_district, p.addr_region,
                p.id_number, p.passport_number,
                pcr.shares, pcr.share_type, pcr.issue_price
         FROM person_company_roles pcr
         JOIN persons p ON p.id = pcr.person_id
         WHERE pcr.company_id = ? AND pcr.role = 'shareholder'
         ORDER BY p.identity = 'natural' DESC, p.name_english`
      ).bind(companyId).all();
      const shs = (shResult.results || []) as any[];
      if (shs.length >= 2) {
        const s1 = shs[0], s2 = shs[1];
        const shShares = s1.shares || 0;
        const shPrice = parseFloat(s1.issue_price) || 1.00;
        transaction = {
          from_person_id: s1.person_id,
          from_name: s1.name_english,
          to_person_id: s2.person_id,
          to_name: s2.name_english,
          shares: shShares,
          share_type: s1.share_type || "Ordinary",
          price_per_share: s1.issue_price || "1.00",
          total_consideration: shShares * shPrice,
          transaction_date: "",  // 日期留空：文件日期稍後再填（不自動填今天）
        };
      }
    }

    // ── 編號：按發生時間順序 1、2、3…（日期升序、同日按建立時間；無日期排最後）──
    const seqResult = await env.DB.prepare(
      "SELECT id FROM share_transactions WHERE company_id = ? ORDER BY CASE WHEN transaction_date = '' OR transaction_date IS NULL THEN 1 ELSE 0 END, transaction_date ASC, created_at ASC"
    ).bind(companyId).all();
    const seqIds = ((seqResult.results || []) as any[]).map((r) => r.id);
    let seqNo = transaction?.id ? seqIds.indexOf(transaction.id) + 1 : 0;
    if (seqNo <= 0) seqNo = seqIds.length + 1;

    // ── Auto-generate certificate number if missing (for share_certificate docType) ──
    if (docType === "share_certificate" && transaction && !transaction.instrument_number) {
      transaction.instrument_number = String(seqNo);
      if (transaction.id) {
        try {
          await env.DB.prepare(
            "UPDATE share_transactions SET instrument_number = ? WHERE id = ?"
          ).bind(String(seqNo), transaction.id).run();
        } catch { /* non-critical */ }
      }
    }

    // ── Resolve the effective transaction (used for names + dates below) ──
    const tx = transaction || (allTransactions.length > 0 ? allTransactions[0] : {});

    // ── Fallback: find person by name (case-insensitive), company-scoped first ──
    const findPersonByName = async (name: string, companyId: string): Promise<any | null> => {
      const clean = String(name || "").trim().toLowerCase();
      if (!clean) return null;
      const scoped = await env.DB.prepare(
        `SELECT p.* FROM persons p
         JOIN person_company_roles pcr ON pcr.person_id = p.id
         WHERE pcr.company_id = ? AND LOWER(TRIM(p.name_english)) = ?
         LIMIT 1`
      ).bind(companyId, clean).first();
      if (scoped) return scoped;
      return await env.DB.prepare(
        "SELECT * FROM persons WHERE LOWER(TRIM(name_english)) = ? LIMIT 1"
      ).bind(clean).first();
    };

    // ── Fetch persons for address + HKID data ──
    // Support both: top-level from_person_id/to_person_id (QuickFormDialog) AND transaction object.
    // When no person id is available (legacy records), fall back to a name lookup.
    let sellerPerson: any = null;
    let buyerPerson: any = null;
    const sellerId = body.from_person_id || transaction?.from_person_id;
    const buyerId = body.to_person_id || transaction?.to_person_id;
    if (sellerId) {
      sellerPerson = await env.DB.prepare("SELECT * FROM persons WHERE id = ?")
        .bind(sellerId).first();
    } else if (tx.from_name) {
      sellerPerson = await findPersonByName(tx.from_name, companyId);
    }
    if (buyerId) {
      buyerPerson = await env.DB.prepare("SELECT * FROM persons WHERE id = ?")
        .bind(buyerId).first();
    } else if (tx.to_name) {
      buyerPerson = await findPersonByName(tx.to_name, companyId);
    }

    // ── Read RTF template from R2 ──
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) throw new Error("R2 bucket not available");

    const templateKey: Record<string, string> = {
      bought_sold_note: "bought-sold-note-template.rtf",
      instrument_of_transfer: "instrument-of-transfer-template.rtf",
      share_certificate: "share-certificate-template.rtf",
    };
    const key = templateKey[docType];
    if (!key) throw new Error(`Unknown document type: ${docType}`);

    const templateObj = await r2Bucket.get(key);
    if (!templateObj) throw new Error(`Template not found: ${key}`);
    const rtfTemplate = await templateObj.text();

    // ── Build replacement variables ──
    const vars: Record<string, string> = {};

    // Common
    vars["{{COMPANY_NAME}}"] = (company as any).name || "";

    // Transaction amounts
    const shares = tx.shares || 0;
    vars["{{SHARES}}"] = fmtShares(shares);
    vars["{{PRICE_PER_SHARE}}"] = fmtMoney(tx.price_per_share, tx.currency);
    // Consideration = 股數 × 每股股價（自動計算；股價未填才回退存庫總代價）
    const priceNum = parseFloat(String(tx.price_per_share ?? "").replace(/,/g, ""));
    const consideration = !isNaN(priceNum) && priceNum > 0
      ? (Number(shares) || 0) * priceNum
      : (parseFloat(String(tx.total_consideration ?? "").replace(/,/g, "")) || 0);
    vars["{{TOTAL_CONSIDERATION}}"] = consideration > 0 ? fmtMoney(consideration, tx.currency) : "";
    vars["{{CONSIDERATION}}"] = consideration > 0 ? fmtMoney(consideration, tx.currency) : "";

    // Dates (transaction date → signature/dating lines)
    vars["{{TX_DATE}}"] = fmtDateSlash(tx.transaction_date);
    vars["{{SIGN_DATE}}"] = fmtDateSlash(tx.transaction_date);

    // Names
    vars["{{SELLER_NAME}}"] = tx.from_name || "";
    vars["{{BUYER_NAME}}"] = tx.to_name || "";

    // Seller address — 完整地址平衡装两行（超长的单行会超出页宽被截断，千问已证实）
    const sellerAddr = sellerPerson ? buildPersonAddress(sellerPerson) : "";
    const sellerLines = splitAddressBalanced(sellerAddr, 2, 58);
    vars["{{SELLER_ADDR_L1}}"] = sellerLines[0] || "";
    vars["{{SELLER_ADDR_L2}}"] = sellerLines[1] || "";
    vars["{{SELLER_HKID}}"] = sellerPerson?.id_number || sellerPerson?.passport_number || "";

    // Buyer address — 同上，平衡两行
    const buyerAddr = buyerPerson ? buildPersonAddress(buyerPerson) : "";
    const buyerLines = splitAddressBalanced(buyerAddr, 2, 58);
    vars["{{BUYER_ADDR_L1}}"] = buyerLines[0] || "";
    vars["{{BUYER_ADDR_L2}}"] = buyerLines[1] || "";
    vars["{{BUYER_HKID}}"] = buyerPerson?.id_number || buyerPerson?.passport_number || "";

    // Share Certificate specific
    vars["{{COMPANY_NUMBER}}"] = (company as any).company_number || "";
    vars["{{INCORP_DATE}}"] = fmtDateSlash((company as any).incorporation_date);

    // Certificate number（無手填編號時用發生順序編號 1、2、3…）
    vars["{{CERT_NO}}"] = tx.instrument_number || String(seqNo);

    // Registered office address (4 lines)
    const regAddr = buildCompanyAddress(company);
    const regLines = splitAddressLines(regAddr, 4);
    vars["{{REG_OFFICE_L1}}"] = regLines[0] || "";
    vars["{{REG_OFFICE_L2}}"] = regLines[1] || "";
    vars["{{REG_OFFICE_L3}}"] = regLines[2] || "";
    vars["{{REG_OFFICE_L4}}"] = regLines[3] || "";

    // Holder (buyer) details for share certificate — 地址两行平衡分配（11pt 加粗，格子 492pt 约容 60 字/行）
    vars["{{HOLDER_NAME}}"] = tx.to_name || "";
    vars["{{HOLDER_HKID}}"] = buyerPerson?.id_number || buyerPerson?.passport_number || "";
    const holderAddr = buyerPerson ? buildPersonAddress(buyerPerson) : "";
    const holderLines = splitAddressBalanced(holderAddr, 2, 60);
    vars["{{HOLDER_ADDR_L1}}"] = holderLines[0] || "";
    vars["{{HOLDER_ADDR_L2}}"] = holderLines[1] || "";
    vars["{{HOLDER_ADDR_L3}}"] = "";
    vars["{{HOLDER_ADDR_L4}}"] = "";

    // ── Fill template via string replacement ──
    // 所有插入值经 rtfEscape：中文转 \uN 转义（防 Word 按段落字体 charset 误解码 UTF-8），
    // \ { } 转义、换行删除 — 模板自身中文就是 \uN 形式，插入值与其一致
    let rtfContent = rtfTemplate;
    for (const [placeholder, value] of Object.entries(vars)) {
      rtfContent = rtfContent.replaceAll(placeholder, rtfEscape(value));
    }

    // ── Build filename ──
    const coNum = (company as any).company_number || "CO";
    const docLabel: Record<string, string> = {
      bought_sold_note: "BoughtSoldNote",
      instrument_of_transfer: "InstrumentOfTransfer",
      share_certificate: "ShareCertificate",
    };
    const label = docLabel[docType] || "Document";
    const refNo = tx.instrument_number || String(seqNo);
    const filename = `${label}_${coNum}_${refNo}.rtf`;

    // ── Return base64-encoded RTF ──
    const rtfBase64 = stringToBase64(rtfContent);

    return new Response(JSON.stringify({ rtf: rtfBase64, filename }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-share-transfer-rtf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
