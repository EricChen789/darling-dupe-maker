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

// ── Build person address from structured fields ──
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
  return person.address || "";
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
        const today = new Date().toISOString().slice(0, 10);
        transaction = {
          from_person_id: s1.person_id,
          from_name: s1.name_english,
          to_person_id: s2.person_id,
          to_name: s2.name_english,
          shares: shShares,
          share_type: s1.share_type || "Ordinary",
          price_per_share: s1.issue_price || "1.00",
          total_consideration: shShares * shPrice,
          transaction_date: today,
        };
      }
    }

    // ── Auto-generate certificate number if missing (for share_certificate docType) ──
    if (docType === "share_certificate" && transaction && !transaction.instrument_number) {
      const br = (company as any).company_number || "00000000";
      const brSuffix = br.replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
      const certCount = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM share_transactions WHERE company_id = ? AND instrument_number != ''"
      ).bind(companyId).first();
      const seq = String(((certCount as any)?.cnt || 0) + 1).padStart(4, "0");
      const certNo = `SC-${brSuffix}-${seq}`;
      transaction.instrument_number = certNo;
      try {
        await env.DB.prepare(
          "UPDATE share_transactions SET instrument_number = ? WHERE id = ?"
        ).bind(certNo, transaction.id).run();
      } catch { /* non-critical */ }
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
    vars["{{TOTAL_CONSIDERATION}}"] = fmtMoney(tx.total_consideration, tx.currency);
    vars["{{CONSIDERATION}}"] = fmtMoney(tx.total_consideration, tx.currency);

    // Dates (transaction date → signature/dating lines)
    vars["{{TX_DATE}}"] = fmtDateSlash(tx.transaction_date);
    vars["{{SIGN_DATE}}"] = fmtDateSlash(tx.transaction_date);

    // Names
    vars["{{SELLER_NAME}}"] = tx.from_name || "";
    vars["{{BUYER_NAME}}"] = tx.to_name || "";

    // Seller address (from person record or transaction)
    const sellerAddr = sellerPerson ? buildPersonAddress(sellerPerson) : "";
    const sellerLines = splitAddressLines(sellerAddr, 2);
    vars["{{SELLER_ADDR_L1}}"] = sellerLines[0] || "";
    vars["{{SELLER_ADDR_L2}}"] = sellerLines[1] || "";
    vars["{{SELLER_HKID}}"] = sellerPerson?.id_number || sellerPerson?.passport_number || "";

    // Buyer address
    const buyerAddr = buyerPerson ? buildPersonAddress(buyerPerson) : "";
    const buyerLines = splitAddressLines(buyerAddr, 2);
    vars["{{BUYER_ADDR_L1}}"] = buyerLines[0] || "";
    vars["{{BUYER_ADDR_L2}}"] = buyerLines[1] || "";
    vars["{{BUYER_HKID}}"] = buyerPerson?.id_number || buyerPerson?.passport_number || "";

    // Share Certificate specific
    vars["{{COMPANY_NUMBER}}"] = (company as any).company_number || "";
    vars["{{INCORP_DATE}}"] = fmtDateSlash((company as any).incorporation_date);

    // Certificate number
    vars["{{CERT_NO}}"] = tx.instrument_number || "";

    // Registered office address (4 lines)
    const regAddr = buildCompanyAddress(company);
    const regLines = splitAddressLines(regAddr, 4);
    vars["{{REG_OFFICE_L1}}"] = regLines[0] || "";
    vars["{{REG_OFFICE_L2}}"] = regLines[1] || "";
    vars["{{REG_OFFICE_L3}}"] = regLines[2] || "";
    vars["{{REG_OFFICE_L4}}"] = regLines[3] || "";

    // Holder (buyer) details for share certificate
    vars["{{HOLDER_NAME}}"] = tx.to_name || "";
    vars["{{HOLDER_HKID}}"] = buyerPerson?.id_number || buyerPerson?.passport_number || "";
    const holderAddr = buyerPerson ? buildPersonAddress(buyerPerson) : "";
    const holderLines = splitAddressLines(holderAddr, 4);
    vars["{{HOLDER_ADDR_L1}}"] = holderLines[0] || "";
    vars["{{HOLDER_ADDR_L2}}"] = holderLines[1] || "";
    vars["{{HOLDER_ADDR_L3}}"] = holderLines[2] || "";
    vars["{{HOLDER_ADDR_L4}}"] = holderLines[3] || "";

    // ── Fill template via string replacement ──
    let rtfContent = rtfTemplate;
    for (const [placeholder, value] of Object.entries(vars)) {
      rtfContent = rtfContent.replaceAll(placeholder, value);
    }

    // ── Build filename ──
    const coNum = (company as any).company_number || "CO";
    const docLabel: Record<string, string> = {
      bought_sold_note: "BoughtSoldNote",
      instrument_of_transfer: "InstrumentOfTransfer",
      share_certificate: "ShareCertificate",
    };
    const label = docLabel[docType] || "Document";
    const refNo = tx.instrument_number || tx.id || "auto";
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
