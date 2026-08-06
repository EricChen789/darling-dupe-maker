// Generic form/document PDF generator.
// Generates NNC1 (HK), NNC1-BVI, NNC2 (rename), and resolution PDFs from scratch.
// Uses Noto Sans TC via R2-first font loading for CJK text.
// Optimized: single-font rendering (CJK only) to avoid CPU timeout on Cloudflare Workers.
// No fontkit + drawMixed — uses cjk.widthOfTextAtSize directly.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

interface Section {
  heading?: string;
  rows?: [string, string][];
  paragraph?: string;
  bullets?: string[];
}

interface DocPayload {
  formCode: string;
  title: string;
  subtitle?: string;
  companyName?: string;
  brNumber?: string;
  sections: Section[];
  signatureLines?: string[];
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data: DocPayload = await request.json();
    if (!data || !data.formCode || !data.title) {
      return jsonResp({ error: "formCode and title required" }, 400);
    }

    const pdf = await PDFDocument.create();

    // Embed fonts: Helvetica (built-in) + CJK (Noto Sans TC from R2/CDN)
    const helv = pdf.embedStandardFont(StandardFonts.Helvetica);
    const helvBold = pdf.embedStandardFont(StandardFonts.HelveticaBold);
    const { cjk } = await fetchAndEmbedFont(pdf, env as any);

    // Use CJK font for all text — it renders both ASCII and CJK acceptably.
    // Single font avoids the per-segment drawMixed() CPU overhead.
    const mainFont = cjk;

    let page = pdf.addPage([595, 842]);
    let y = 800;
    const left = 50;
    const right = 545;
    const maxWidth = right - left;

    // ── Helpers ──
    const newLine = (delta = 14) => {
      y -= delta;
      if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
    };

    // Draw a horizontal separator line
    const drawSep = (color: any = rgb(0.7, 0.7, 0.7)) => {
      page.drawLine({
        start: { x: left, y },
        end: { x: right, y },
        thickness: 0.5,
        color,
      });
      newLine(10);
    };

    // Draw text with specific font
    const drawF = (text: string, font: any, x: number, size: number, color?: any) => {
      try {
        page.drawText(text || "", { x, y, size, font, color: color ?? rgb(0, 0, 0) });
      } catch (_e) {
        try { page.drawText(text || "", { x, y, size, font: helv, color: color ?? rgb(0, 0, 0) }); } catch (_e2) {}
      }
    };

    // Draw CJK text (single font — no per-segment switching)
    const drawCjk = (text: string, x: number, size: number, color?: any) => {
      drawF(text, mainFont, x, size, color);
    };

    // Centered CJK text
    const centerCjk = (text: string, size: number, color?: any) => {
      try {
        const w = mainFont.widthOfTextAtSize(text || "", size);
        const x = Math.max(0, (595 - w) / 2);
        drawCjk(text, x, size, color);
      } catch (_e) {
        drawF(text || "", helv, (595 - helv.widthOfTextAtSize(text || "", size)) / 2, size, color);
      }
    };

    // Word-wrap paragraph (CJK font)
    const drawPara = (text: string, x: number, width: number, size: number, lh: number, color?: any) => {
      const paragraphs = (text || "").split("\n");
      for (const para of paragraphs) {
        if (!para) { newLine(lh); continue; }
        const lines = wrapLine(para, size, width);
        for (const line of lines) {
          drawCjk(line, x, size, color);
          newLine(lh);
        }
      }
    };

    const wrapLine = (text: string, size: number, width: number): string[] => {
      const lines: string[] = [];
      let cur = "";
      for (const ch of text) {
        if (mainFont.widthOfTextAtSize(cur + ch, size) > width) {
          if (cur) lines.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : [text];
    };

    // ── Header — Title ──
    const titleText = data.title || "";
    centerCjk(titleText, 18);
    newLine(26);

    if (data.subtitle) {
      centerCjk(data.subtitle, 11, rgb(0.4, 0.4, 0.4));
      newLine(22);
    }

    // ── Company info ──
    if (data.companyName || data.brNumber) {
      newLine(4);
      const ix = left + 8;
      if (data.companyName) {
        drawF("Company / 公司名稱：", helv, ix, 9, rgb(0.4, 0.4, 0.4));
        drawCjk(data.companyName, ix + 130, 10);
        newLine(14);
      }
      if (data.brNumber) {
        drawF("BR No. / 商業登記號碼：", helv, ix, 9, rgb(0.4, 0.4, 0.4));
        drawF(data.brNumber, helv, ix + 130, 10);
        newLine(14);
      }
      drawF(`Date Generated / 生成日期：${new Date().toISOString().slice(0, 10)}`, helv, ix, 9, rgb(0.4, 0.4, 0.4));
      newLine(14);
    }

    drawSep();

    // ── Sections ──
    const lastIdx = (data.sections || []).length - 1;
    for (let si = 0; si < (data.sections || []).length; si++) {
      const sec = data.sections[si];

      if (sec.heading) {
        drawCjk(sec.heading, left + 6, 12);
        newLine(18);
      }

      if (sec.rows && sec.rows.length) {
        for (const [k, v] of sec.rows) {
          drawF(k + "：", helv, left + 10, 10, rgb(0.4, 0.4, 0.4));
          drawCjk(v || "—", left + 180, 10);
          newLine(14);
        }
        newLine(6);
      }

      if (sec.paragraph) {
        drawPara(sec.paragraph, left + 10, maxWidth - 10, 10, 15);
        newLine(8);
      }

      if (sec.bullets && sec.bullets.length) {
        for (const b of sec.bullets) {
          drawF("•", helv, left + 10, 10);
          drawPara(b, left + 24, maxWidth - 24, 10, 14);
        }
        newLine(4);
      }

      // Separator between sections
      if (si < lastIdx) {
        newLine(4);
        drawSep();
      }
    }

    // ── Signature block ──
    if (data.signatureLines && data.signatureLines.length) {
      newLine(16);
      drawSep();
      newLine(6);
      drawCjk("Signatures / 簽署", left + 6, 12);
      newLine(26);
      for (const line of data.signatureLines) {
        drawCjk(line, left + 10, 10);
        newLine(30);
      }
    }

    // ── Footer ──
    newLine(24);
    drawSep();
    centerCjk("本文件由公司秘書管理系統自動生成 · Generated by Secretary Management System", 7, rgb(0.6, 0.6, 0.6));

    const bytes = await pdf.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(bytes)) });
  } catch (e: any) {
    console.error("generate-generic-form-pdf error:", e);
    return jsonResp({ error: e.message || String(e) }, 500);
  }
}
