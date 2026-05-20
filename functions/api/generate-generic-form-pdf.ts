// Generic form/document PDF generator.
// Generates NNC1 (HK), NNC1-BVI, NNC2 (rename), and resolution PDFs from scratch.
// Uses Noto Sans TC for full Chinese support.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

interface Section {
  heading?: string;
  rows?: [string, string][];
  paragraph?: string;
  bullets?: string[];
}

interface DocPayload {
  formCode: string;          // "NNC1", "NNC1-BVI", "NNC2", "RESOLUTION"
  title: string;             // Big title at top, e.g. "Incorporation Form (NNC1)"
  subtitle?: string;
  companyName?: string;
  brNumber?: string;
  sections: Section[];
  signatureLines?: string[]; // e.g. ["Director: ____________", "Date: ____________"]
}

export async function onRequest(context: { request: Request; env: any }) {
  const { request } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const data: DocPayload = await request.json();
    if (!data || !data.formCode || !data.title) {
      return new Response(JSON.stringify({ error: "formCode and title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fontResp = await fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } });
    if (!fontResp.ok) throw new Error("Failed to load Chinese font");
    const fontBytes = await fontResp.arrayBuffer();

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes);

    let page = pdf.addPage([595, 842]);
    let y = 800;
    const left = 50;
    const right = 545;
    const maxWidth = right - left;

    const draw = (text: string, x: number, opts: { size?: number; color?: any } = {}) => {
      page.drawText(text || "", { x, y, size: opts.size ?? 10, font, color: opts.color ?? rgb(0, 0, 0) });
    };
    const newLine = (delta = 14) => {
      y -= delta;
      if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
    };

    // Word-wrap that respects font metrics (handles CJK by splitting on chars when needed).
    const wrapText = (text: string, size: number, width: number): string[] => {
      if (!text) return [""];
      const words = text.split(/(\s+)/);
      const lines: string[] = [];
      let cur = "";
      const measure = (s: string) => font.widthOfTextAtSize(s, size);
      for (const w of words) {
        const trial = cur + w;
        if (measure(trial) <= width) {
          cur = trial;
        } else if (measure(w) > width) {
          if (cur) { lines.push(cur); cur = ""; }
          let chunk = "";
          for (const ch of w) {
            if (measure(chunk + ch) > width) {
              if (chunk) lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
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

    const drawWrapped = (text: string, x: number, width: number, opts: { size?: number; color?: any; lineHeight?: number } = {}) => {
      const size = opts.size ?? 10;
      const lh = opts.lineHeight ?? size + 4;
      const lines = wrapText(text, size, width);
      lines.forEach((ln) => {
        draw(ln, x, { size, color: opts.color });
        newLine(lh);
      });
    };

    // Header
    draw(data.title, left, { size: 18 });
    newLine(24);
    if (data.subtitle) {
      draw(data.subtitle, left, { size: 11, color: rgb(0.4, 0.4, 0.4) });
      newLine(18);
    }
    if (data.companyName || data.brNumber) {
      draw(`公司名稱 / Company: ${data.companyName || "-"}`, left, { size: 10 });
      newLine();
      draw(`商業登記號碼 / BR No.: ${data.brNumber || "-"}`, left, { size: 10 });
      newLine();
      draw(`生成日期 / Date Generated: ${new Date().toISOString().slice(0, 10)}`, left, { size: 10 });
      newLine(18);
    }

    page.drawLine({ start: { x: left, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    newLine(10);

    // Sections
    for (const sec of data.sections || []) {
      if (sec.heading) {
        draw(sec.heading, left, { size: 13 });
        newLine(18);
      }
      if (sec.paragraph) {
        drawWrapped(sec.paragraph, left, maxWidth, { size: 10, lineHeight: 14 });
        newLine(6);
      }
      if (sec.bullets && sec.bullets.length) {
        for (const b of sec.bullets) {
          draw("•", left, { size: 10 });
          drawWrapped(b, left + 14, maxWidth - 14, { size: 10, lineHeight: 14 });
        }
        newLine(4);
      }
      if (sec.rows && sec.rows.length) {
        for (const [k, v] of sec.rows) {
          draw(`${k}:`, left, { size: 9, color: rgb(0.4, 0.4, 0.4) });
          drawWrapped(v || "-", left + 180, maxWidth - 180, { size: 9, lineHeight: 12 });
        }
        newLine(6);
      }
      newLine(8);
    }

    // Signature lines
    if (data.signatureLines && data.signatureLines.length) {
      newLine(20);
      page.drawLine({ start: { x: left, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      newLine(16);
      draw("簽署 / Signatures", left, { size: 11 });
      newLine(20);
      for (const line of data.signatureLines) {
        draw(line, left, { size: 10 });
        newLine(28);
      }
    }

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${data.formCode}_${data.brNumber || "doc"}.pdf"`,
      },
    });
  } catch (e: any) {
    console.error("generate-generic-form-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
