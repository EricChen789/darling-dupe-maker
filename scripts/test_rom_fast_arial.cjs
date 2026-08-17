/**
 * ROM 快速路径本地冒烟测试（Arial 字体切换后）
 * 加载 rom-canvas.pdf/json → 用与 generate-shareholders-register-pdf.ts 相同的拼接逻辑
 * 生成一页测试 PDF（页眉 + 交易行 HKD）→ PyMuPDF 验证字体/文字
 */
const fs = require("fs");

const canvas = {
  bytes: fs.readFileSync("_verify_output/rom-canvas.pdf"),
  struct: JSON.parse(fs.readFileSync("_verify_output/rom-canvas.json", "utf8")),
};

const S = canvas.struct;
console.log("canvas:", canvas.bytes.length, "bytes; arial=/"+S.arialName, "cjk=/"+S.cjkName);

// ═══ 与端点一致的逻辑 ═══
const HELV_W = { 32:278,33:278,34:355,35:556,36:556,37:889,38:667,39:191,40:333,41:333,42:389,43:584,44:278,45:333,46:278,47:278,48:556,49:556,50:556,51:556,52:556,53:556,54:556,55:556,56:556,57:556,58:278,59:278,60:584,61:584,62:584,63:556,64:1015,65:667,66:667,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:500,75:667,76:556,77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,89:667,90:611,91:278,92:278,93:278,94:469,95:556,96:333,97:556,98:556,99:500,100:556,101:556,102:278,103:556,104:556,105:222,106:222,107:500,108:222,109:833,110:556,111:556,112:556,113:556,114:333,115:500,116:278,117:556,118:500,119:722,120:500,121:500,122:500,123:334,124:260,125:334,126:584 };

function fastFontOf(ch) {
  const c = ch.charCodeAt(0);
  if (c <= 0x7f) return "a";
  if (S.asciiChars && S.asciiChars[ch]) return "a";
  return "c";
}
function fastTextWidth(text, size) {
  let w = 0;
  for (const ch of text) {
    if (fastFontOf(ch) === "a") {
      const aw = S.asciiChars && S.asciiChars[ch] ? S.asciiChars[ch].w : HELV_W[ch.charCodeAt(0)] || 500;
      w += (aw / 1000) * size;
    } else w += ((S.chars[ch] ? S.chars[ch].w : 1000) / 1000) * size;
  }
  return w;
}
const escHex = (s) => s.split("").map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
function fastTextOps(x, y, size, text, bold) {
  const clean = (text || "").replace(/[\n\r\t]/g, " ");
  let ops = "", seg = "", segKind = null;
  const flush = () => {
    if (!seg) return;
    const fontName = segKind === "a" ? (S.arialName || S.helvName || S.cjkName) : S.cjkName;
    let hex = "";
    for (const ch of seg) {
      if (segKind === "a") hex += S.asciiChars && S.asciiChars[ch] ? S.asciiChars[ch].c : escHex(ch);
      else hex += S.chars[ch].c;
    }
    ops += `BT /${fontName} ${size} Tf 1 0 0 1 ${x} ${y} Tm <${hex}> Tj ET\n`;
    if (bold) ops += `BT /${fontName} ${size} Tf 1 0 0 1 ${x + 0.5} ${y} Tm <${hex}> Tj ET\n`;
    x += fastTextWidth(seg, size);
    seg = ""; segKind = null;
  };
  for (const ch of clean) {
    const kind = fastFontOf(ch);
    if (segKind === null) segKind = kind;
    else if (segKind !== kind) { flush(); segKind = kind; }
    seg += ch;
  }
  flush();
  return ops;
}
function fastCenterOps(cx, y, size, text, bold) {
  if (!text) return "";
  const t = String(text);
  return fastTextOps(cx - fastTextWidth(t, size) / 2, y, size, t, bold);
}

// ═══ 组装一页（页眉 + SH1 名称行 + 交易行 HKD + 混合中英名）═══
let ops = "";
ops += fastTextOps(134.7, 511.1, 11, "PAUL TANG AND COMPANY LIMITED", false);
ops += fastTextOps(134.7, 498.5, 11, "", false);
ops += fastTextOps(133.9, 478.9, 11, "07281051", true);
ops += fastTextOps(136.3, 460.3, 9, "Lam Wai Keung 林偉強", false);
ops += fastTextOps(420, 459.8, 9, "Merchant", false);
ops += fastTextOps(738.5, 459.8, 9, "22/04/2026", false);
ops += fastTextOps(116.8, 447.3, 9, "Room 5, 8/F, Kwong Fat Mansion, 22 Nathan Road, Kowloon, Hong Kong", false);
// 交易行 0：date 左对齐 + HKD 居中 + total + remarks
const y = 399.3 - 18;
ops += fastTextOps(38.6, y, 9, "22/04/2026", false);
ops += fastCenterOps(118.1, y, 9, "-", false);
ops += fastCenterOps(251.95, y, 9, "3,000", false);
ops += fastCenterOps(309.3, y, 9, "HKD 1,000.00", false);
ops += fastCenterOps(679.1, y, 9, "3,000", false);
ops += fastCenterOps(740.2, y, 9, "Subscription", false);

// 增量更新组装（与 buildFastPdf 一致）
const numPages = 1;
const pageRefNum = Number(S.pageRef.split(" ")[0]);
const pagesRefNum = Number(S.pagesRef.split(" ")[0]);
const rootRefNum = Number(S.rootRef.split(" ")[0]);
const objMap = new Map();
let nextObj = S.maxObj + 1;
const addObj = (num, bytes) => objMap.set(num, bytes);
const textRefs = [];
const body = pagesText0 = ops;
const num = nextObj++;
addObj(num, `${num} 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`);
textRefs.push(num);
const contents = `[ ${S.coverStreamRef} ${textRefs[0]} 0 R ]`;
const pageDict = S.pageDict.replace(/\/Contents\s*\[[^\]]*\]/, "/Contents " + contents);
addObj(pageRefNum, `${pageRefNum} 0 obj\n${pageDict}\nendobj\n`);
const listed = [...objMap.keys()].sort((a, b) => a - b);
let objsBytes = "";
let cursor = canvas.bytes.length + 1;
const byteOffsets = {};
for (const n of listed) { byteOffsets[n] = cursor; const b = objMap.get(n); objsBytes += b; cursor += b.length; }
const xrefOffset = canvas.bytes.length + 1 + objsBytes.length;
let xrefStr = "xref\n";
const subsections = [];
for (const n of listed) {
  const last = subsections[subsections.length - 1];
  if (last && last.start + last.count === n) last.count++;
  else subsections.push({ start: n, count: 1 });
}
for (const s of subsections) xrefStr += `${s.start} ${s.count}\n`;
for (const n of listed) xrefStr += `${String(byteOffsets[n]).padStart(10, "0")} 00000 n \n`;
const trailer = `trailer\n<< /Size ${nextObj} /Root ${rootRefNum} 0 R /Prev ${S.startxref} >>\nstartxref\n${xrefOffset}\n%%EOF`;
const head = new Uint8Array(canvas.bytes.length + 1 + objsBytes.length + xrefStr.length + trailer.length);
head.set(canvas.bytes, 0);
let pos = canvas.bytes.length;
const appendStr = (s) => { for (let i = 0; i < s.length; i++) head[pos++] = s.charCodeAt(i) & 0xff; };
appendStr("\n" + objsBytes);
appendStr(xrefStr + trailer);
fs.writeFileSync("_verify_output/rom_fast_test.pdf", head);
console.log("✅ 已写入 _verify_output/rom_fast_test.pdf", head.length, "bytes");
