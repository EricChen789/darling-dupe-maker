// Generic form/document PDF generator.
// Generates NNC1 (HK), NNC1-BVI, NNC2 (rename), and resolution PDFs from scratch.
// Uses Noto Sans TC via R2-first font loading + Helvetica for ASCII.
// Draws bilingual text with drawMixed() for professional mixed CJK/English typography.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont, drawMixed, widthOfText,
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

    // Embed fonts: ASCII (built-in Helvetica) + CJK (Noto Sans TC from R2/CDN)
    const helv = pdf.embedStandardFont(StandardFonts.Helvetica);
    const helvBold = pdf.embedStandardFont(StandardFonts.HelveticaBold);
    const { cjk } = await fetchAndEmbedFont(pdf, env as any);

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

    // Simple draw with specific font
    const drawF = (text: string, font: any, x: number, size: number, color?: any) => {
      try {
        page.drawText(text || "", { x, y, size, font, color: color ?? rgb(0, 0, 0) });
      } catch (_e) {
        // Fallback to Helvetica
        try { page.drawText(text || "", { x, y, size, font: helv, color: color ?? rgb(0, 0, 0) }); } catch (_e2) { }
      }
    };

    // Mixed draw shortcut — always passes cjk + helv fonts
    const dm = (text: string, x: number, size: number, color?: any) => {
      drawMixed(page, text, { x, y, size, cjk, ascii: helv, color });
    };

    // Draw mixed text centered
    const dmCenter = (text: string, size: number, color?: any) => {
      const w = widthOfText(text || "", cjk, helv, size);
      const x = Math.max(0, (595 - w) / 2);
      dm(text, x, size, color);
    };

    // Word-wrap mixed text paragraph
    const drawPara = (text: string, x: number, width: number, size: number, lh: number, color?: any) => {
      const paragraphs = (text || "").split("\n");
      for (const para of paragraphs) {
        if (!para) { newLine(lh); continue; }
        const lines = wrapPara(para, size, width);
        for (const line of lines) {
          dm(line, x, size, color);
          newLine(lh);
        }
      }
    };

    const wrapPara = (text: string, size: number, width: number): string[] => {
      const lines: string[] = [];
      const words = text.split(/(\s+)/);
      let cur = "";
      for (const w of words) {
        const trial = cur + w;
        if (widthOfText(trial, cjk, helv, size) <= width) {
          cur = trial;
        } else if (widthOfText(w, cjk, helv, size) > width) {
          if (cur) { lines.push(cur); cur = ""; }
          let chunk = "";
          for (const ch of w) {
            if (widthOfText(chunk + ch, cjk, helv, size) > width) {
              if (chunk) lines.push(chunk);
              chunk = ch;
            } else { chunk += ch; }
          }
          if (chunk) cur = chunk;
        } else {
          if (cur) lines.push(cur);
          cur = w.replace(/^\s+/, "");
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    // ── Header — Title ──
    const titleText = data.title || "";
    const titleW = widthOfText(titleText, cjk, helv, 18);
    if (titleW <= maxWidth) {
      dmCenter(titleText, 18);
    } else {
      drawF(titleText, cjk, (595 - cjk.widthOfTextAtSize(titleText, 18)) / 2, 18);
    }
    newLine(26);

    if (data.subtitle) {
      const sw = widthOfText(data.subtitle, cjk, helv, 11);
      if (sw <= maxWidth) {
        dmCenter(data.subtitle, 11, rgb(0.4, 0.4, 0.4));
      } else {
        drawF(data.subtitle, cjk, (595 - cjk.widthOfTextAtSize(data.subtitle, 11)) / 2, 11, rgb(0.4, 0.4, 0.4));
      }
      newLine(22);
    }

    // ── Company info ──
    if (data.companyName || data.brNumber) {
      newLine(4);
      const ix = left + 8;
      if (data.companyName) {
        drawF("Company / 公司名稱：", helv, ix, 9, rgb(0.4, 0.4, 0.4));
        dm(data.companyName, ix + 130, 10);
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
        const hw = widthOfText(sec.heading, cjk, helvBold, 12);
        if (hw <= maxWidth) {
          dm(sec.heading, left + 6, 12);
        } else {
          drawF(sec.heading, helvBold, left + 6, 12);
        }
        newLine(18);
      }

      if (sec.rows && sec.rows.length) {
        for (const [k, v] of sec.rows) {
          drawF(k + "：", helv, left + 10, 10, rgb(0.4, 0.4, 0.4));
          dm(v || "—", left + 180, 10);
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
      dm("Signatures / 簽署", left + 6, 12);
      newLine(26);
      for (const line of data.signatureLines) {
        const lw = widthOfText(line, cjk, helv, 10);
        if (lw <= maxWidth) {
          dm(line, left + 10, 10);
        } else {
          drawF(line, cjk, left + 10, 10);
        }
        newLine(30);
      }
    }

    // ── Footer ──
    newLine(24);
    drawSep();
    const footer = "本文件由公司秘書管理系統自動生成 · Generated by Secretary Management System";
    dmCenter(footer, 7, rgb(0.6, 0.6, 0.6));

    const bytes = await pdf.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(bytes)) });
  } catch (e: any) {
    console.error("generate-generic-form-pdf error:", e);
    return jsonResp({ error: e.message || String(e) }, 500);
  }
}
