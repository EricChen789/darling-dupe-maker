# PDF 渲染一致性规范

> **目标**：消除本地 fpdf2 (Python) 与生产 pdf-lib (TypeScript/Cloudflare Workers) 之间的隐性差异，确保同一份 JSON 数据在两端的 PDF 输出视觉一致。

**版本**: 1.0  
**日期**: 2026-07-30  
**适用范围**: darling-dupe-maker 全部 PDF 生成端点

---

## 1. 坐标系

这是两端最根本的差异，所有坐标计算必须考虑。

| 引擎 | 原点 | Y 轴方向 | 单位 |
|------|------|---------|------|
| **fpdf2** (本地 Python) | **左上角** (0, 0) | 向下为正 ↑→↓ | pt (1/72 inch) |
| **pdf-lib** (生产 TypeScript) | **左下角** (0, 0) | 向上为正 ↑→↑ | pt (1/72 inch) |

### 转换公式

```python
# fpdf2 → pdf-lib
pdf_lib_y = page_height - fpdf2_y

# pdf-lib → fpdf2
fpdf2_y = page_height - pdf_lib_y
```

### 注意事项

- **文本基线**: fpdf2 的 y 坐标指向文本**顶部**（cell top），pdf-lib 的 y 坐标指向文本**基线**（baseline）。切换引擎时需补偿字体 ascent 高度（通常 +12pt for 10pt font）。
- **矩形**: fpdf2 `rect(x, y, w, h)` 的 y 是左上角；pdf-lib `drawRectangle({x, y, width, height})` 的 y 是左下角。
- **图片**: fpdf2 `image(x, y, w, h)` 的 y 是左上角；pdf-lib `drawImage()` + `embedPage()` 遵循 pdf-lib 坐标系（左下角）。

### 统一建议

在新代码中使用**抽象坐标函数**，而非硬编码数值：

```python
# 本地 fpdf2
def pt(x, y):
    return x, y  # fpdf2 原生坐标

# 生产 pdf-lib
def pt(x, y, page_h):
    return x, page_h - y  # 转换为 pdf-lib 坐标
```

---

## 2. 字体度量

两端使用不同的 CJK 字体，度量差异是中文偏移/溢出的主要根因。

| 属性 | fpdf2 (SimHei) | pdf-lib (Noto Sans TC) |
|------|---------------|----------------------|
| **字体名称** | SimHei (黑体) | Noto Sans TC |
| **文件路径** | `C:/Windows/Fonts/simhei.ttf` | R2: `fonts/NotoSansTC-Regular.woff2` |
| **粗体** | 独立 `simhei.ttf`（无原生 Bold） | `NotoSansTC-Bold.woff2` (weight 700) |
| **Ascent** | ~880 (1000 units) | ~880 (1000 units) |
| **Descent** | ~-120 (1000 units) | ~-120 (1000 units) |
| **平均字符宽度** (10pt) | ~8.5pt | ~8.3pt |
| **全角字符宽度** (10pt) | ~10pt | ~9.8pt |
| **半角字符宽度** (10pt) | ~5pt | ~5pt |
| **编码** | Identity-H (CID) | Identity-H (CID) |

### 字体宽度估算

```python
# 中文字符(CJK): 全角宽度 ≈ font_size * 0.98
# ASCII 字符: 半角宽度 ≈ font_size * 0.5

def estimate_text_width(text, font_size):
    width = 0
    for ch in text:
        if '\u4e00' <= ch <= '\u9fff' or '\u3000' <= ch <= '\u303f' or '\uff00' <= ch <= '\uffef':
            width += font_size * 0.98  # CJK full-width
        else:
            width += font_size * 0.5   # ASCII half-width
    return width
```

### 注意事项

- **pdf-lib 中文字形静默丢失**: `page.drawText("中文", {font: cjkFont})` 可能静默丢失字形，**必须**使用 `drawMixed()` → `segmentText()` 将每行按 ASCII/CJK 边界逐字符分段，分别用 Helvetica / Noto Sans TC 渲染。
- **fpdf2 系统字体**: 使用 `add_font('TC', style='B', fname=bold_font_path)` 单独注册粗体变体，否则 `FPDFException: Undefined font: tcB`。
- **fpdf2 overlay 方案**: `_set_widget_cjk_ap()` 用 `F=4` (visible) 创建 widget 蓝框 + `insert_textbox` overlay 文字；纯 ASCII 走 `w.update()` 自动生成 AP。

---

## 3. 行高算法

**统一公式**:
```
line_height = font_size * 1.3
```

| 属性 | fpdf2 | pdf-lib |
|------|-------|---------|
| **默认行高** | `font_size * 1.3` (multi_cell) | 手动计算 |
| **多行文本间距** | 自动换行 | 需手动 wrap + 逐行 drawText |
| **段落间距** | `h` 参数 | 手动 offset |

### 文本换行

两端统一使用**二分搜索**算法（非逐字符 O(n²) 遍历）：

```python
# fpdf2: 内置 multi_cell(w, h, text) — O(n log n)
# pdf-lib: wrapText(text, maxWidth, font, fontSize) — 手动实现二分搜索
```

### 页面间距参考值（Landscape A4, 842×595pt）

| 元素 | 值 |
|------|---|
| 页边距 | 28pt (~1cm) |
| 表头行高 | 10pt × 1.3 = 13pt |
| 数据行高 | 9pt × 1.3 = 11.7pt |
| 续页间距 | 22-16-14-8pt (header-gap-body-bottom) |
| 页面底部边距 | 70pt |

---

## 4. 颜色规范

### 统一 RGB 值

| 颜色 | RGB | 用途 |
|------|-----|------|
| **黑色** | `(0, 0, 0)` | 正文、表体文字 |
| **蓝色** | `(0, 51, 153)` / `#003399` | 公司抬头（Paul Tang 风格） |
| **灰色表头** | `(227, 227, 227)` | 登记册表头背景 |
| **白色** | `(255, 255, 255)` | 页面背景、交替行 |
| **红色** | `(255, 0, 0)` | 仅在明确需要时使用 |

### 两端设置方式

```python
# fpdf2
pdf.set_text_color(0, 0, 0)        # RGB tuple
pdf.set_fill_color(227, 227, 227)   # fill
pdf.set_draw_color(0, 0, 0)         # border/stroke

# pdf-lib
rgb(0, 0, 0)    # → {r: 0, g: 0, b: 0}
page.drawText(text, {color: rgb(0, 0, 0)})
page.drawRectangle({color: rgb(227, 227, 227)})
```

---

## 5. 页面尺寸

### 标准尺寸 (pt, 1/72 inch)

| 名称 | 尺寸 | 方向 | 用途 |
|------|------|------|------|
| **Portrait A4** | `595 × 842` | 纵向 | 大部分政府表格 |
| **Landscape A4** | `842 × 595` | 横向 | ROM/ROD/SCR 登记册 |

### 设置方式

```python
# fpdf2
pdf = FPDF(orientation='L', unit='pt', format='A4')  # Landscape
pdf = FPDF(orientation='P', unit='pt', format='A4')  # Portrait

# pdf-lib (A4: [595, 842])
const page = doc.addPage([595, 842])   # Portrait
const page = doc.addPage([842, 595])   # Landscape
```

### 自定义尺寸

```python
# fpdf2
pdf = FPDF(unit='pt', format=(width, height))

# pdf-lib
const page = doc.addPage([width, height])
```

---

## 6. PDF 表单（AcroForm）差异

| 操作 | PyMuPDF (本地) | pdf-lib (生产) |
|------|---------------|---------------|
| **字段写入** | `w.field_value = "text"` | `form.getTextField("name").setText("text")` |
| **CJK widget AP** | `_set_widget_cjk_ap()` 手动构建 | `tf.updateAppearances(cjkFont)` + `enableNeedAppearances()` |
| **Checkbox** | `w.field_value = True` (PyMuPDF 1.28+) | `form.getCheckBox("name").check()` |
| **Dropdown 划线** | `draw_line()` 画黑线保底 | `drawLine()` 画黑线保底 |
| **字段扁平化** | `doc.save()` 前 `form.flatten()` | `form.flatten()` (大模板 CPU 超时→跳过) |
| **Widget rect 提取** | `w.rect` → `(x0, y0, x1, y1)` | `field.acroField.getWidgets()[i].getRectangle()` |

### CB 模式

- **fpdf2**: 本地 PyMuPDF 不需要 WOFF2 字体嵌入 → checkbox CJK 可用 `_set_widget_cjk_ap()` + `F=4`
- **pdf-lib**: 云端大模板（如 NNC1 24页/2.4MB）嵌入 WOFF2 → CPU 超时 → **去 CJK 字体** → Helvetica-only + `enableNeedAppearances()` → 让 PDF 阅读器重建外观

---

## 7. 一致性检查清单

新增 PDF 端点时，必须验证以下项目：

### 两端对比检查

- [ ] 坐标系转换正确（fpdf2 y → pdf-lib `page_h - y`）
- [ ] 文本基线偏移补偿（pdf-lib `y + 12pt`）
- [ ] CJK 字体可用（本地 SimHei，生产 Noto Sans TC 预加载）
- [ ] pdf-lib 中文走 `drawMixed()` 而非 `drawText()`
- [ ] 页边距、列宽、行高、padding 两端数值一致
- [ ] 颜色 RGB 两端一致
- [ ] 页面尺寸 (Portrait/Landscape) 两端一致
- [ ] 表头/数据行字号一致

### 自动化验证

```bash
# 运行跨平台一致性测试
python _verify_forms.py --form=NAR1 --ci

# 退出码: 0=通过, 1=文本不匹配, 2=其他错误
```

---

## 8. 已知差异与对策

| 差异 | 影响 | 应对 |
|------|------|------|
| **字体文件名不同** | 字体找不到 | 本地 `C:/Windows/Fonts/simhei.ttf`，生产 R2 `fonts/NotoSansTC-*.woff2` |
| **D1 vs SQLite SQL 方言** | ALTER TABLE 语法不同 | D1 不支持 `DEFAULT (datetime('now'))`，改用 `DEFAULT ''` 或 `DEFAULT NULL` |
| **CPU 限制** | Cloudflare Workers 免费 10ms | 大模板去 CJK 字体（Helvetica-only）、跳过 `form.flatten()`、用 R2 背景模板 + 文字叠加 |
| **Request 超时** | Workers 30s 硬超时 | 单个端点只做一种登记册，不合并多个 PDF 生成 |
| **PyMuPDF 版本** | API 差异 | `w._annot` 是 Annot 对象非 dict → `w._annot.get('AP')` → `AttributeError`，用 `doc.xref_get_key(xref, 'AS')` |

---

## 9. 参考文件

- 本地 Flask server: `darling-dupe-maker/local-server/server.py`
- 云端 PDF 生成: `darling-dupe-maker/functions/api/generate-*.ts`
- 共享 AcroForm 工具: `darling-dupe-maker/functions/api/_acroform.ts`
- 共享 PDF 工具: `darling-dupe-maker/functions/api/_pdf-utils.ts`
- 验证脚本: `_verify_forms.py`（含 `--ci` 模式）
- 系统对比报告: `_system_comparison_report.md`
