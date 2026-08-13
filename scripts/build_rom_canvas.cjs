/**
 * ROM 画布生成器（离线运行，产物上传 R2）— 2026-08-13 CPU 优化方案核心
 *
 * 生成「预烘焙画布」：ROM 模板页 + 全部白块覆盖（页眉+2股东区块+交易带）+ 预子集字体（全量注册编码）
 * 运行时端点不再跑 pdf-lib save()，只做增量追加文本流（CPU ~3ms/请求，冷启动安全）。
 *
 * 输入: _verify_output/rom-template-bg-r2.pdf (R2 真实模板)
 *       _verify_output/rom_subset_gb.ttf   (fontTools 子集字体: Big5L1∪GB2312∪生产∪HK)
 *       _verify_output/rom_charset_gb.txt  (字符集: Big5L1∪GB2312∩字体 ∪ 生产 ∪ HK 常用)
 * 输出: _verify_output/rom-canvas.pdf      (上传 R2: rom-canvas.pdf)
 *       _verify_output/rom-canvas.json     (上传 R2: rom-canvas.json — 结构+字符码表)
 *
 * 用法: node scripts/build_rom_canvas.cjs
 */
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("fs");

const PW = 842, PH = 595;
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

// ═══ 覆盖几何 — 与 generate-shareholders-register-pdf.ts 完全一致 ═══
// 2026-08-13 像素仲裁修复：原覆盖底边高于文字基线 → 样本文字下伸笔画(g/y/p/,)从底边下
// 露出 1-2pt。模板边框线精扫后，覆盖下延至边框线上方 0.2pt（顶边不变）。
const HEADER = {
  covers: {
    en: { x: 133.7, y: 508.0, w: 177, h: 16.6 },
    zh: { x: 133.7, y: 496.7, w: 91,  h: 14.0 },
    br: { x: 132.9, y: 476.7, w: 55,  h: 15.6 },
  },
  brUnderline: { x0: 134.7, x1: 340, y: 478.9 },
};
const BLOCKS = [
  {
    covers: {
      name:    { x: 135.3, y: 458.8, w: 98,   h: 12.2 },
      occ:     { x: 419,   y: 458.8, w: 42,   h: 11.7 },
      entered: { x: 737.5, y: 458.8, w: 49.5, h: 11.7 },
      addr:    { x: 115.8, y: 446.9, w: 402,  h: 11.0 },
    },
    rowsTop:    [399.3, 375.0, 350.8, 326.7, 302.4],
    rowsBottom: [375.0, 350.8, 326.7, 302.4, 278.2],
  },
  {
    covers: {
      name:    { x: 135.3, y: 258.2, w: 98,   h: 12.2 },
      occ:     { x: 419,   y: 258.2, w: 42,   h: 11.7 },
      entered: { x: 737.5, y: 258.2, w: 49.5, h: 11.7 },
      addr:    { x: 115.8, y: 244.3, w: 402,  h: 11.6 },
    },
    rowsTop:    [195.5, 171.2, 147.0, 122.9, 98.6],
    rowsBottom: [171.2, 147.0, 122.9, 98.6, 74.4],
  },
];

const cover = (page, c) => page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: WHITE });

function bakeCovers(page) {
  for (const k of ["en", "zh", "br"]) cover(page, HEADER.covers[k]);
  page.drawLine({
    start: { x: HEADER.brUnderline.x0, y: HEADER.brUnderline.y },
    end: { x: HEADER.brUnderline.x1, y: HEADER.brUnderline.y },
    thickness: 0.5, color: BLACK,
  });
  for (const b of BLOCKS) {
    for (const k of ["name", "occ", "entered", "addr"]) cover(page, b.covers[k]);
    for (let i = 0; i < 5; i++) {
      const top = b.rowsTop[i], bottom = b.rowsBottom[i];
      page.drawRectangle({ x: 29, y: bottom + 1.2, width: 816 - 29, height: (top - bottom) - 2.4, color: WHITE });
    }
  }
}

(async () => {
  const tplBytes = fs.readFileSync("_verify_output/rom-template-bg-r2.pdf");
  const fontBytes = fs.readFileSync("_verify_output/rom_subset_gb.ttf");
  const charset = [...new Set(fs.readFileSync("_verify_output/rom_charset_gb.txt", "utf8"))];

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  // 模板页 0 → 新页 + 白块覆盖
  const tplDoc = await PDFDocument.load(tplBytes, { ignoreEncryption: true });
  const [tplPage] = await pdf.embedPages([tplDoc.getPage(0)]);
  const page = pdf.addPage([PW, PH]);
  page.drawPage(tplPage);
  bakeCovers(page);

  // 预子集字体 + Helvetica（ASCII 标准字体，运行时直接用资源名）
  const cjkFont = await pdf.embedFont(fontBytes, { subset: true });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);

  // 全字符注册编码：先 drawText 一条包含全部字符的字符串（白色微字号，不可见）
  // → pdf-lib 给每个字形分配 2 字节码 → 再 encodeText 逐字取码
  const fkFont = fontkit.create(Buffer.from(fontBytes));
  const cmapChars = charset.filter((ch) => {
    const g = fkFont.glyphForCodePoint(ch.codePointAt(0));
    return g && g.id > 0;
  });
  const dropped = charset.filter((ch) => !cmapChars.includes(ch));
  console.log(`charset ${charset.length} → 字体覆盖 ${cmapChars.length}，丢弃 ${dropped.length}: ${JSON.stringify(dropped)}`);
  // 画在页外 (0, -100)：仍需存在于内容流以注册字形码，但不出现在可见区/文本提取层
  page.drawText(cmapChars.join(""), { x: 0, y: -100, size: 0.1, font: cjkFont, color: WHITE });

  const chars = {};
  for (const ch of cmapChars) {
    const code = cjkFont.encodeText(ch).value;           // 2字节 hex 码
    const w = cjkFont.widthOfTextAtSize(ch, 1000);       // em(1000) 单位宽度
    chars[ch] = { c: code, w: Math.round(w * 100) / 100 };
  }
  // Helvetica 也注册（画一个空白字符，确保字体资源存在于页 Resources）
  page.drawText(" ", { x: 0, y: -100, size: 0.1, font: helv, color: WHITE });

  const canvasBytes = Buffer.from(await pdf.save());

  // ── 解析画布结构（用 pdf-lib 重新加载枚举对象）──
  const { PDFName, PDFRef } = require("pdf-lib");
  const loaded = await PDFDocument.load(canvasBytes, { ignoreEncryption: true });
  const objs = new Map();
  for (const [ref, obj] of loaded.context.enumerateIndirectObjects()) {
    objs.set(ref.toString(), { ref, num: Number(ref.toString().split(" ")[0]), obj });
  }
  const lp = loaded.getPage(0);
  const pageRef = lp.ref.toString();
  const pageNode = lp.node;
  const contents = pageNode.Contents();
  // Contents = PDFArray [25 0 R]（pdf-lib 数组写入）
  const contentsArr = contents.asArray ? contents.asArray() : [contents];
  const contentsRefs = contentsArr.map((c) => c.toString()).map((s) => ({ s, num: Number(s.split(" ")[0]) }));
  const coverStreamRef = contentsRefs[0] ? contentsRefs[0].s : null;

  // 找 Pages 树根 + Catalog
  let pagesRef = null, rootRef = null;
  for (const { ref, obj } of objs.values()) {
    if (!obj || !obj.get) continue;
    const t = obj.get(PDFName.of("Type"));
    if (t && t.toString() === "/Pages") pagesRef = ref.toString();
    if (t && t.toString() === "/Catalog") rootRef = ref.toString();
  }

  // 资源 dict（直接或间接）
  const resDict = pageNode.Resources();
  const resourcesRef = resDict && resDict.ref ? resDict.ref.toString() : null;

  // 字体资源名：/Font dict → 名字（/F1 等）+ 对应字体（BaseFont 判断）
  let cjkName = null, helvName = null;
  const fontDict = resDict ? resDict.lookup(PDFName.of("Font")) : null;
  if (fontDict) {
    for (const key of fontDict.keys ? fontDict.keys() : []) {
      const v = fontDict.get(key);
      if (v instanceof PDFRef) {
        const fobj = loaded.context.lookup(v);
        const bf = fobj && fobj.lookup ? fobj.lookup(PDFName.of("BaseFont")) : null;
        if (bf) {
          const bfn = bf.toString();
          if (bfn.includes("NotoSansTC")) cjkName = key.toString().slice(1);
          else if (bfn.includes("Helvetica")) helvName = key.toString().slice(1);
        }
      } else if (v && v.toString && v.toString().includes("Helvetica")) {
        helvName = key.toString().slice(1);
      }
    }
  }

  // 关键对象序列化字节（运行时字节级替换用）
  const pageDictBytes = pageNode.toString();
  const pagesDictBytes = objs.get(pagesRef) ? objs.get(pagesRef).obj.toString() : null;
  const resDictBytes = resourcesRef === null && resDict ? resDict.toString() : null;

  // startxref 偏移 = 文件尾部
  const tail = canvasBytes.subarray(canvasBytes.length - 40).toString("latin1");
  const m = tail.match(/startxref\s+(\d+)/);
  const startxref = m ? Number(m[1]) : null;
  // 真实 maxObj：字节扫描全部 "N 0 obj" 标记（对象流内的对象会被枚举漏掉，必须扫描）
  let maxObj = 0;
  const markerRe = /(\d+) 0 obj/g;
  let mm;
  while ((mm = markerRe.exec(canvasBytes.toString("latin1"))) !== null) {
    maxObj = Math.max(maxObj, Number(mm[1]));
  }

  const struct = {
    _comment: "ROM canvas structure — generated by build_rom_canvas.cjs. Do not edit by hand.",
    startxref, maxObj, pageRef: pageRef, pagesRef, rootRef, resourcesRef,
    coverStreamRef,
    pageDict: pageDictBytes, pagesDict: pagesDictBytes, resDict: resDictBytes,
    cjkName, helvName,
    charsetCount: cmapChars.length,
    chars,
  };
  fs.writeFileSync("_verify_output/rom-canvas.pdf", canvasBytes);
  fs.writeFileSync("_verify_output/rom-canvas.json", JSON.stringify(struct));
  console.log(`canvas: ${canvasBytes.length} bytes → _verify_output/rom-canvas.pdf`);
  console.log(`struct: startxref=${startxref} maxObj=${maxObj} page=${pageRef} pages=${pagesRef} root=${rootRef} res=${resourcesRef}`);
  console.log(`coverStream=${coverStreamRef} cjkFont=/${cjkName} helv=/${helvName} chars=${cmapChars.length}`);
  console.log(`pageDict(${pageDictBytes.length}B) pagesDict(${pagesDictBytes ? pagesDictBytes.length : 0}B) resDict=${resDictBytes ? resDictBytes.length : "indirect"}B`);
  console.log("✓ 生成完成");
})();
