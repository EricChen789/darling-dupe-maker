# -*- coding: utf-8 -*-
"""Arial ASCII+Latin1 子集字体生成（ROM 叠加文字用，匹配模板 Arial 字体）
输出: _verify_output/arial-subset.ttf → 上传 R2: fonts/arial-subset.ttf
"""
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont
import os

chars = (
    ''.join(chr(i) for i in range(0x20, 0x7F))    # Basic Latin (printable)
    + ''.join(chr(i) for i in range(0xA0, 0x100)) # Latin-1 Supplement (é £ ¥ ° etc.)
    + '€•–—‘’“”'
)

options = Options()
options.name_IDs = [0, 1, 2, 3, 4, 6]  # 保留 name 表（Family=Arial, PostScript=ArialMT）
options.notdef_outline = True
options.recommended_glyphs = True
options.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'kern', 'OS/2', 'VDMX', 'hdmx', 'LTSH', 'DSIG']

font = TTFont(r'C:\Windows\Fonts\arial.ttf')
ss = Subsetter(options)
ss.populate(text=chars)
ss.subset(font)

out = os.path.join(os.path.dirname(__file__), '..', '_verify_output', 'arial-subset.ttf')
font.save(out)
print(f'✅ {out}')
print(f'   chars={len(set(chars))} tables={sorted(font.keys())}')
