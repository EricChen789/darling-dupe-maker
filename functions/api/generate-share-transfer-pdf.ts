import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  corsHeaders, uint8ToBase64,
  drawMixed, widthOfText, fetchAndEmbedFont,
} from './_pdf-utils';

type Env = AuthEnv & {
  DB: D1Database;
  PDF_TEMPLATES?: R2Bucket;
  R2?: R2Bucket;
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 45;

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

    // Fetch company
    const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
    if (!company) throw new Error("Company not found");

    // Fetch specific transaction or all transactions
    let transaction: any = null;
    let allTransactions: any[] = [];

    if (txData && typeof txData === "object" && Object.keys(txData).length > 0) {
      // Use transaction data passed directly from frontend (Supabase-sourced)
      transaction = txData;
    } else if (transactionId) {
      transaction = await env.DB.prepare("SELECT * FROM share_transactions WHERE id = ? AND company_id = ?")
        .bind(transactionId, companyId).first();
      if (!transaction) throw new Error("Transaction not found");
    } else if (body.from_name || body.to_name || body.shares) {
      // 交易数据平铺在顶层（与 RTF 端点一致）— 以传入数据为准，
      // 否则会错用 D1 最近一笔旧交易（日期/买卖方/代价全错）
      transaction = {
        from_person_id: body.from_person_id || "",
        from_name: body.from_name || "",
        to_person_id: body.to_person_id || "",
        to_name: body.to_name || "",
        shares: body.shares || 0,
        share_type: body.share_type || "Ordinary",
        price_per_share: body.price_per_share ?? "",
        total_consideration: body.total_consideration ?? "",
        transaction_date: body.transaction_date ?? "",
        instrument_number: body.instrument_number ?? "",
        currency: body.currency || "HKD",
      };
    } else {
      const txResult = await env.DB.prepare(
        "SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date DESC"
      ).bind(companyId).all();
      allTransactions = (txResult.results || []) as any[];
    }

    // Fetch shareholders to calculate current holdings
    const rolesResult = await env.DB.prepare(
      "SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder'"
    ).bind(companyId).all();
    const shareholders = (rolesResult.results || []) as any[];

    // ── Auto-build transaction from shareholders when no transaction exists ──
    // Mirrors local Flask server.py: if no share_transactions record,
    // auto-build from first 2 shareholders (natural persons preferred).
    if (!transaction && allTransactions.length === 0) {
      const shResult = await env.DB.prepare(
        `SELECT p.id as person_id, p.name_english, p.address,
                p.addr_flat, p.addr_building, p.addr_street, p.addr_district, p.addr_region,
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
          share_type: s1.share_type || 'Ordinary',
          price_per_share: s1.issue_price || '1.00',
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
      // Persist the certificate number back to the transaction
      if (transaction.id) {
        try {
          await env.DB.prepare(
            "UPDATE share_transactions SET instrument_number = ? WHERE id = ?"
          ).bind(String(seqNo), transaction.id).run();
        } catch { /* non-critical */ }
      }
    }

    // Load CJK font via R2-first shared helper (avoids CDN fetch CPU timeout)
    const pdf = await PDFDocument.create();
    const { cjk: cjkFont, ascii: asciiFont } = await fetchAndEmbedFont(pdf, env as any);
    const fonts = { cjk: cjkFont, ascii: asciiFont, asciiBold: asciiFont };

    if (docType === "share_certificate") {
      await buildShareCertificate(pdf, fonts, company as any, transaction, shareholders, seqNo);
    } else if (docType === "bought_sold_note") {
      await buildBoughtSoldNote(pdf, fonts, company as any, transaction, allTransactions, seqNo);
    } else {
      await buildInstrumentOfTransfer(pdf, fonts, company as any, transaction, allTransactions, seqNo);
    }

    const bytes = await pdf.save();
    const pdfBase64 = uint8ToBase64(bytes);

    return new Response(JSON.stringify({ pdf: pdfBase64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-share-transfer-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// ── Instrument of Transfer ──
// 日期統一 DD/MM/YYYY（與 RTF 模板一致）；空值回空（日期留空待填）
function fmtDateSlash(s: string | null | undefined): string {
  if (!s) return "";
  const t = String(s).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return t;
}

async function buildInstrumentOfTransfer(
  pdf: PDFDocument, fonts: { cjk: any; ascii: any; asciiBold: any },
  company: any, transaction: any, allTransactions: any[], seqNo: number,
) {
  const { cjk, ascii } = fonts;
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  drawMixed(page, "股份轉讓文書 / Instrument of Transfer", {
    x: MARGIN, y: PAGE_H - 50, size: 15, cjk, ascii,
  });
  page.drawLine({ start: { x: MARGIN, y: PAGE_H - 58 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 58 }, color: rgb(0.3, 0.3, 0.3), thickness: 1 });

  let y = PAGE_H - 80;

  const drawLine = (label: string, value: string) => {
    drawMixed(page, label, { x: MARGIN, y, size: 10, cjk, ascii, color: rgb(0.3, 0.3, 0.3) });
    drawMixed(page, value || "__________________________", { x: MARGIN + 140, y, size: 10, cjk, ascii });
    y -= 22;
  };

  // Company info
  drawLine("公司名稱 Company:", company.name || "");
  drawLine("BR 號碼:", company.company_number || "");
  if (company.chinese_name) drawLine("中文名稱:", company.chinese_name);

  y -= 12;
  drawMixed(page, "轉讓詳情 / Transfer Details", {
    x: MARGIN, y, size: 12, cjk, ascii,
  });
  page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: PAGE_W - MARGIN, y: y - 4 }, color: rgb(0.5, 0.5, 0.5), thickness: 0.5 });
  y -= 20;

  const tx = transaction || (allTransactions.length > 0 ? allTransactions[0] : {});
  const itxShares = Number(tx.shares) || 0;
  const itxParVal = parseFloat(String(tx.price_per_share ?? "").replace(/,/g, "")) || 0;
  // Consideration = 股數 × 每股股價（自動計算；股價未填才回退存庫總代價）
  const itxCons = itxParVal > 0 ? itxShares * itxParVal
    : (parseFloat(String(tx.total_consideration ?? "").replace(/,/g, "")) || 0);
  const sharesFmt = typeof itxShares === 'number' ? itxShares.toLocaleString('en-US') : String(itxShares);
  const consFmt = itxCons.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  drawLine("轉讓人 Transferor:", tx.from_name || "________________");
  drawLine("受讓人 Transferee:", tx.to_name || "________________");
  drawLine("股份數目 No. of Shares:", tx.shares ? `${sharesFmt}  of  HK$${(itxParVal || 1).toFixed(2)}  each` : "________________");
  drawLine("股份類別 Share Class:", tx.share_type || "Ordinary");
  drawLine("每股代價 Price per Share:", tx.currency ? `${tx.currency} ${tx.price_per_share || ""}` : "________________");
  drawLine("總代價 Total Consideration:", itxCons ? `HK$${consFmt}` : "________________");
  drawLine("轉讓日期 Transfer Date:", fmtDateSlash(tx.transaction_date) || "________________");
  drawLine("文書編號 Instrument No:", tx.instrument_number || String(seqNo));

  y -= 20;
  drawMixed(page, "轉讓人簽署 / Signed by Transferor:", {
    x: MARGIN, y, size: 10, cjk, ascii,
  });
  drawMixed(page, "____________________________", {
    x: MARGIN + 200, y, size: 10, cjk, ascii,
  });
  y -= 25;
  drawMixed(page, "受讓人簽署 / Signed by Transferee:", {
    x: MARGIN, y, size: 10, cjk, ascii,
  });
  drawMixed(page, "____________________________", {
    x: MARGIN + 200, y, size: 10, cjk, ascii,
  });
  y -= 25;
  drawMixed(page, "日期 Date: ____/____/________", {
    x: MARGIN, y, size: 10, cjk, ascii,
  });

  // Footer
  drawMixed(page, `由 Muse Labs Engineering Limited 秘書系統生成 | ${new Date().toISOString().slice(0, 10)}`, {
    x: MARGIN, y: 30, size: 7, cjk, ascii, color: rgb(0.6, 0.6, 0.6),
  });
}

// ── Bought / Sold Note (Paul Tang reference format) ──
// Free-form layout, tab-stop alignment, 16pt bold title, 1.5pt thick line, TNR 12pt
async function buildBoughtSoldNote(
  pdf: PDFDocument, fonts: { cjk: any; ascii: any; asciiBold: any },
  company: any, transaction: any, allTransactions: any[], seqNo: number,
) {
  const { cjk, ascii, asciiBold } = fonts;
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const halfH = PAGE_H / 2;
  const labelX = MARGIN + 5;
  const valueX = PAGE_W / 3 + 10;  // ~30% label, ~70% value

  const tx = transaction || (allTransactions.length > 0 ? allTransactions[0] : {});
  const fromName = tx.from_name || "";
  const toName = tx.to_name || "";
  const shares = Number(tx.shares) || 0;
  const parVal = tx.price_per_share || "1.00";
  // Consideration = 股數 × 每股股價（自動計算；股價未填才回退存庫總代價）
  const parValNum = parseFloat(String(tx.price_per_share ?? "").replace(/,/g, ""));
  const consideration = !isNaN(parValNum) && parValNum > 0 ? shares * parValNum
    : (parseFloat(String(tx.total_consideration ?? "").replace(/,/g, "")) || 0);
  const txDate = fmtDateSlash(tx.transaction_date);
  const coName = company.name || "";

  const sharesFmt = typeof shares === 'number' ? shares.toLocaleString('en-US') : String(shares);
  const consFmt = typeof consideration === 'number' ? consideration.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(consideration);

  // Thick title line: ~70% page width
  const lineW = (PAGE_W - 2 * MARGIN) * 0.7;
  const lineStart = (PAGE_W - lineW) / 2;

  const drawRow = (label: string, value: string, yPos: number, size = 12) => {
    drawMixed(page, label, { x: labelX, y: yPos, size, cjk, ascii, color: rgb(0, 0, 0) });
    drawMixed(page, value || "", { x: valueX, y: yPos, size, cjk, ascii, color: rgb(0, 0, 0) });
  };

  // ═══ SOLD NOTE — TOP half ═══
  let y = PAGE_H - 50;

  // Title: 16pt bold, centered
  const soldNoteW = widthOfText("Sold Note", cjk, ascii, 16);
  drawMixed(page, "Sold Note", {
    x: PAGE_W / 2 - soldNoteW / 2, y, size: 16, cjk, ascii,
  });
  y -= 4;
  drawMixed(page, "賣出票據", {
    x: PAGE_W / 2 - widthOfText("賣出票據", cjk, ascii, 11) / 2, y, size: 11, cjk, ascii,
  });
  y -= 22;

  // Thick black line (1.5pt)
  page.drawLine({ start: { x: lineStart, y }, end: { x: lineStart + lineW, y }, color: rgb(0, 0, 0), thickness: 1.5 });
  y -= 18;

  drawRow("Name of Purchaser (Transferee):", toName, y); y -= 18;
  drawRow("Address:", "", y); y -= 18;
  drawRow("Occupation:", "", y); y -= 18;
  drawRow("Name of Company:", coName, y); y -= 18;
  drawRow("Number of Shares:", `${sharesFmt}  of  HK$${parVal}  each`, y); y -= 18;
  if (consideration) {
    drawRow("Consideration Received:", `HK$${consFmt}`, y); y -= 18;
  } else {
    drawRow("Consideration Received:", "", y); y -= 18;
  }

  y -= 10;
  // Transferor signature: text + underline to right margin
  const tfText = `(Transferor)  ${fromName}`;
  drawMixed(page, tfText, { x: labelX, y, size: 12, cjk, ascii });
  const tfW = widthOfText(tfText, cjk, ascii, 12);
  const sigEnd = labelX + tfW + 10;
  page.drawLine({ start: { x: sigEnd, y: y + 3 }, end: { x: PAGE_W - MARGIN, y: y + 3 }, color: rgb(0, 0, 0), thickness: 0.6 });
  y -= 16;
  drawMixed(page, coName, { x: sigEnd, y, size: 8, cjk, ascii });
  y -= 14;

  drawMixed(page, `Hong Kong, Dated  ${txDate}`, {
    x: labelX, y, size: 12, cjk, ascii,
  });
  y -= 24;

  // ═══ DIVIDER ═══
  page.drawLine({ start: { x: MARGIN, y: halfH }, end: { x: PAGE_W - MARGIN, y: halfH }, color: rgb(0.39, 0.39, 0.39), thickness: 0.5 });

  y = halfH - 18;

  // ═══ BOUGHT NOTE — BOTTOM half ═══
  // Title: 16pt bold, centered
  drawMixed(page, "Bought Note", {
    x: PAGE_W / 2 - widthOfText("Bought Note", cjk, ascii, 16) / 2, y, size: 16, cjk, ascii,
  });
  y -= 4;
  drawMixed(page, "買入票據", {
    x: PAGE_W / 2 - widthOfText("買入票據", cjk, ascii, 11) / 2, y, size: 11, cjk, ascii,
  });
  y -= 22;

  // Thick black line
  page.drawLine({ start: { x: lineStart, y }, end: { x: lineStart + lineW, y }, color: rgb(0, 0, 0), thickness: 1.5 });
  y -= 18;

  drawRow("Name of Seller (Transferor):", fromName, y); y -= 18;
  drawRow("Address:", "", y); y -= 18;
  drawRow("Occupation:", "", y); y -= 18;
  drawRow("Name of Company:", coName, y); y -= 18;
  drawRow("Number of Shares:", `${sharesFmt}  of  HK$${parVal}  each`, y); y -= 18;
  if (consideration) {
    drawRow("Consideration Received:", `HK$${consFmt}`, y); y -= 18;
  } else {
    drawRow("Consideration Received:", "", y); y -= 18;
  }

  y -= 10;
  // Transferee signature: text + underline to right margin
  const teeText = `(Transferee)  ${toName}`;
  drawMixed(page, teeText, { x: labelX, y, size: 12, cjk, ascii });
  const teeW = widthOfText(teeText, cjk, ascii, 12);
  const teeEnd = labelX + teeW + 10;
  page.drawLine({ start: { x: teeEnd, y: y + 3 }, end: { x: PAGE_W - MARGIN, y: y + 3 }, color: rgb(0, 0, 0), thickness: 0.6 });
  y -= 18;
  drawMixed(page, `Hong Kong, Dated  ${txDate}`, {
    x: labelX, y, size: 12, cjk, ascii,
  });

  // Footer
  drawMixed(page, `Generated by Muse Labs | ${new Date().toISOString().slice(0, 10)}`, {
    x: MARGIN, y: 20, size: 7, cjk, ascii, color: rgb(0.6, 0.6, 0.6),
  });
}

// ── Share Certificate ──
async function buildShareCertificate(
  pdf: PDFDocument, fonts: { cjk: any; ascii: any; asciiBold: any },
  company: any, transaction: any, shareholders: any[], seqNo: number,
) {
  const { cjk, ascii, asciiBold } = fonts;
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // Ornate border
  page.drawRectangle({
    x: 15, y: 15, width: PAGE_W - 30, height: PAGE_H - 30,
    borderColor: rgb(0.1, 0.3, 0.1), borderWidth: 3,
  });
  page.drawRectangle({
    x: 22, y: 22, width: PAGE_W - 44, height: PAGE_H - 44,
    borderColor: rgb(0.2, 0.5, 0.2), borderWidth: 0.5,
  });

  let y = PAGE_H - 70;

  // Header — mixed CJK + ASCII, use CJK font (has both)
  drawMixed(page, "股票證書 / SHARE CERTIFICATE", {
    x: PAGE_W / 2 - 150, y, size: 16, cjk, ascii,
  });
  y -= 28;
  page.drawLine({ start: { x: 80, y }, end: { x: PAGE_W - 80, y }, color: rgb(0.1, 0.3, 0.1), thickness: 1 });
  y -= 24;

  drawMixed(page, `公司名稱: ${company.name || "________________________________"}`, {
    x: 50, y, size: 10, cjk, ascii,
  });
  y -= 18;
  if (company.chinese_name) {
    drawMixed(page, `中文名稱: ${company.chinese_name}`, {
      x: 50, y, size: 10, cjk, ascii,
    });
    y -= 18;
  }
  drawMixed(page, `商業登記號碼: ${company.company_number || "________________"}`, {
    x: 50, y, size: 10, cjk, ascii,
  });
  y -= 18;
  drawMixed(page, `註冊辦事處地址: ${company.address || company.registered_office || "________________________________"}`, {
    x: 50, y, size: 10, cjk, ascii,
  });

  y -= 30;
  drawMixed(page, "茲證明 / THIS IS TO CERTIFY that", {
    x: 50, y, size: 10, cjk, ascii, color: rgb(0.3, 0.3, 0.3),
  });
  y -= 24;

  const tx = transaction || {};
  const shareClass = tx.share_type || "Ordinary";
  const shares = tx.shares || "________";
  const holderName = tx.to_name || "________________________________";

  // Holder name — could be Chinese or English, drawMixed auto-detects
  drawMixed(page, holderName, {
    x: PAGE_W / 2 - 80, y, size: 13, cjk, ascii,
  });
  y -= 22;
  drawMixed(page, "is/are the registered holder(s) of", {
    x: 50, y, size: 10, cjk, ascii, color: rgb(0.3, 0.3, 0.3),
  });
  y -= 22;
  // Share count + class — drawMixed handles CJK/ASCII splitting
  const shareText = `${shares} ${shareClass} Share(s)`;
  drawMixed(page, shareText, {
    x: PAGE_W / 2 - 60, y, size: 13, cjk, ascii,
  });
  y -= 22;
  drawMixed(page, `of HK$ ${tx.price_per_share || "____"} each fully paid`, {
    x: 50, y, size: 10, cjk, ascii, color: rgb(0.3, 0.3, 0.3),
  });
  y -= 22;
  drawMixed(page, "in the above-named Company", {
    x: 50, y, size: 10, cjk, ascii, color: rgb(0.3, 0.3, 0.3),
  });

  y -= 30;
  drawMixed(page, `證書編號 Certificate No: ${tx.instrument_number || String(seqNo)}`, {
    x: 50, y, size: 9, cjk, ascii, color: rgb(0.4, 0.4, 0.4),
  });

  // Signature area
  y -= 50;
  page.drawLine({ start: { x: 50, y }, end: { x: 200, y }, color: rgb(0.1, 0.1, 0.1), thickness: 0.5 });
  page.drawLine({ start: { x: PAGE_W - 200, y }, end: { x: PAGE_W - 50, y }, color: rgb(0.1, 0.1, 0.1), thickness: 0.5 });
  y -= 14;
  drawMixed(page, "董事 Director", {
    x: 50, y, size: 8, cjk, ascii, color: rgb(0.4, 0.4, 0.4),
  });
  drawMixed(page, "公司秘書 Secretary", {
    x: PAGE_W - 200, y, size: 8, cjk, ascii, color: rgb(0.4, 0.4, 0.4),
  });

  y -= 24;
  drawMixed(page, `簽發日期 Issue Date: ${fmtDateSlash(tx.transaction_date) || "________________"}`, {
    x: 50, y, size: 9, cjk, ascii,
  });

  // Footer
  drawMixed(page, "由 Muse Labs Engineering Limited 秘書系統生成", {
    x: PAGE_W / 2 - 100, y: 30, size: 7, cjk, ascii, color: rgb(0.6, 0.6, 0.6),
  });
}
