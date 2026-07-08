"""
生成公司日志 — 以表单字段详情为主，不含叙事
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import sqlite3, uuid, datetime

db = sqlite3.connect('local-server/local.db')
db.row_factory = sqlite3.Row

companies = {}
for c in db.execute("SELECT id, name, company_number, ci_number, status, incorporation_date FROM companies"):
    companies[c['name']] = dict(c)

def make_log(company_id, company_name, doc_type, doc_date, notes, filename="", source_folder="", text=""):
    return {
        'id': str(uuid.uuid4()),
        'company_id': company_id,
        'company_name_hint': company_name,
        'source_folder': source_folder,
        'doc_type': doc_type,
        'original_filename': filename,
        'storage_path': '',
        'html_content': '',
        'text_content': text,
        'doc_date': doc_date,
        'notes': notes,
        'created_at': datetime.datetime.now().isoformat(),
        'updated_at': datetime.datetime.now().isoformat(),
    }

logs = []

# ═══════════════════════════════════════════
# 1. PAUL TANG AND COMPANY LIMITED (BR 07281051, 1981)
# ═══════════════════════════════════════════
co = companies['PAUL TANG AND COMPANY LIMITED']
cid = co['id']
cname = co['name']

logs.append(make_log(cid, cname,
    doc_type='NAR1',
    doc_date='2025-05-29',
    notes=(
        'NAR1 周年申报表 — 申报期 2024-05-29 至 2025-05-28\n'
        'P.1 第1栏 公司名称: PAUL TANG AND COMPANY LIMITED\n'
        'P.1 第2栏 商业登记号码: 07281051\n'
        'P.1 第3栏 公司类别: 私人公司\n'
        'P.1 第4栏 注册办事处地址: 香港德辅道中141号东宁大厦12楼1203室\n'
        'P.1 第5栏 业务性质: 会计师事务所\n'
        'P.2 第6-10栏 董事: Tang Siu Fan (自然人/身份证/P123456(7)/香港/委任日期 1981-05-29)\n'
        'P.3 第11栏 公司秘书: Tang Siu Fan (自然人/身份证/P123456(7))\n'
        'P.6 第14栏 已发行股本: HK$10,000 分 10,000 股普通股每股 HK$1.00\n'
        'P.6 第15栏 股东: Tang Siu Fan (5,000股/50%), Timothy Tang (5,000股/50%)\n'
        'P.1 第19-24栏 提交人: Tang Siu Fan (董事/香港身份证/P123456(7)/tel: 2525 5003)\n'
        '附表一 无变更。全体董事股东资料与上年度一致。'
    ),
    filename='NAR1_07281051_2025.pdf',
    source_folder='NAR1/2025/'))

logs.append(make_log(cid, cname,
    doc_type='ND2A',
    doc_date='2024-12-01',
    notes=(
        'ND2A 更改公司秘书及董事通知书(委任/停任) — 表格类别: 委任董事\n'
        'Section A 公司资料: PAUL TANG AND COMPANY LIMITED / BR 07281051\n'
        'Section B1 委任董事: Timothy Tang (自然人)\n'
        '  中文全名: — (无)\n'
        '  英文全名: Timothy Tang\n'
        '  别名/前用名: —\n'
        '  香港身份证号码: P234567(8)\n'
        '  护照号码: — / 签发国家: —\n'
        '  住址: Flat B, 23/F, 12-16 Wing Lok Street, Sheung Wan, Hong Kong\n'
        '  送達地址: 同住址\n'
        '  现任董事: 否 (首次获委任)\n'
        '  委任日期: 2024-12-01\n'
        'Section D 签署人: Tang Siu Fan (董事)\n'
        '提交日期: 2024-12-01 (15日内提交)\n'
        '附: 董事同意书 (Form NDA)'
    ),
    filename='ND2A_07281051_20241201.pdf',
    source_folder='ND2A/2024/'))

logs.append(make_log(cid, cname,
    doc_type='BIR51',
    doc_date='2025-04-01',
    notes=(
        '利得税报税表 BIR51 — 2024/25 课税年度\n'
        'IRD 档案号码: 07/281051\n'
        'IRD 发出日期: 2025-04-01 / 截止日期: 2025-05-02\n'
        'Part 1: 公司名称 PAUL TANG AND COMPANY LIMITED / BR 07281051\n'
        'Part 3: 业务性质 — 会计师事务所 (Accounting & Audit Services)\n'
        'Part 4: 评税基期 2024-01-01 至 2024-12-31\n'
        'Part 5: 是否已提交审计帐目 — 是 (核数师: 李振寧鄧信能會計師事務所)\n'
        'Part 6: 应评税利润 HK$3,200,000\n'
        'Part 7: 应缴税款 HK$528,000 (利得税税率 16.5%)\n'
        '签署人: Tang Siu Fan (董事) / 日期: 2025-04-20\n'
        '状态: 按时提交 / IRD 收讫确认编号: IRD20250420007841'
    ),
    filename='BIR51_2024-25_PAULTANG.pdf',
    source_folder='TAX/2024-25/'))

logs.append(make_log(cid, cname,
    doc_type='AUDIT_REPORT',
    doc_date='2024-12-31',
    notes=(
        '审计报告 — 截至 2024-12-31\n'
        '核数师: 李振寧鄧信能會計師事務所 (Practising Certificate No. S12345)\n'
        '意见类型: 无保留意见 (Unqualified Opinion)\n'
        '财务状况表 (Statement of Financial Position):\n'
        '  — 非流动资产: HK$2,100,000 (物业/设备/装修)\n'
        '  — 流动资产: HK$6,400,000 (应收账款 HK$4.2M + 银行现金 HK$2.2M)\n'
        '  — 总资产: HK$8,500,000\n'
        '  — 流动负债: HK$1,800,000 (应付账款 + 应付税款)\n'
        '  — 非流动负债: HK$1,500,000 (银行按揭)\n'
        '  — 净资产: HK$5,200,000\n'
        '收入: HK$8,900,000 / 税前利润: HK$3,200,000\n'
        '董事酬金: HK$1,200,000 (Tang Siu Fan)\n'
        'Emphasis of Matter: 公司董事同时担任多家客户公司的公司秘书\n'
        '签署日期: 2025-03-15'
    ),
    filename='Audit_Report_2024_PaulTang.pdf',
    source_folder='AUDIT/2024/'))

# ═══════════════════════════════════════════
# 2. PHYSICAL HEALTH CENTRE (TST) LIMITED (BR 22141993, 1998, deregistered)
# ═══════════════════════════════════════════
co = companies['PHYSICAL HEALTH CENTRE (TST) LIMITED']
cid = co['id']
cname = co['name']

logs.append(make_log(cid, cname,
    doc_type='NAR1',
    doc_date='2024-11-18',
    notes=(
        'NAR1 周年申报表 — 申报期 2023-11-18 至 2024-11-17\n'
        'P.1 第1栏 公司名称: PHYSICAL HEALTH CENTRE (TST) LIMITED\n'
        'P.1 第2栏 商业登记号码: 22141993\n'
        'P.1 第4栏 注册办事处地址: 香港九龙尖沙咀弥敦道132号美丽华广场11楼1101室\n'
        'P.1 第5栏 业务性质: 健身中心 (Fitness Centre)\n'
        'P.2 第6栏 董事: 陸毅強 Luk Ngai Keung (自然人/HKID/G123456(0)/委任日期 1998-11-18)\n'
        'P.2 第7栏 董事: 何玉華 Ho Yuk Wah (自然人/HKID/G234567(1)/委任日期 1998-11-18)\n'
        'P.6 第14栏 已发行股本: HK$1,000,000 分 1,000,000 股\n'
        'P.6 第15栏 股东: 陸毅強 (500,000股/50%), Physical Beauty & Fitness Holdings Limited (BVI/500,000股/50%)\n'
        '附表一 无变更。'
    ),
    filename='NAR1_22141993_2024.pdf',
    source_folder='NAR1/2024/'))

logs.append(make_log(cid, cname,
    doc_type='ND4',
    doc_date='2025-01-20',
    notes=(
        'ND4 公司秘书及董事辞职通知书 — 单一辞任: 董事\n'
        'Section A 公司资料: PHYSICAL HEALTH CENTRE (TST) LIMITED / BR 22141993\n'
        'Section B 辞职董事详情:\n'
        '  姓名: 何玉華 Ho Yuk Wah\n'
        '  香港身份证号码: G234567(1)\n'
        '  住址: Flat A, 8/F, 280 Lockhart Road, Wan Chai, Hong Kong\n'
        '  职位: 董事 (非执行)\n'
        '  辞任日期: 2025-01-20\n'
        'Section C 签署人: 何玉華 (辞任董事本人)\n'
        '  签署日期: 2025-01-20\n'
        '提交日期: 2025-01-20 (辞职后14日内提交)\n'
        '辞任后公司仍有董事: 陸毅強 Luk Ngai Keung (唯一留任董事)'
    ),
    filename='ND4_22141993_20250120.pdf',
    source_folder='ND4/2025/'))

logs.append(make_log(cid, cname,
    doc_type='WINDING_UP_ORDER',
    doc_date='2025-03-15',
    notes=(
        '高等法院清盘令 — 案件编号 HCCW 89/2025\n'
        '呈请人: MTR Corporation Limited (港铁公司)\n'
        '呈请日期: 2025-01-10\n'
        '聆讯日期: 2025-03-15\n'
        '呈请债项: 欠租 HK$4,800,000 (尖沙咀美丽华广场11楼 — 2024年6月至12月租金+管理费)\n'
        '法官: Hon. Harris J\n'
        '颁令: 公司根据《公司(清盘及杂项条文)条例》s.177 清盘\n'
        '委任临时清盘人: 德勤·关黄陈方会计师行 (Deloitte Touche Tohmatsu)\n'
        '清盘人联络: Mr. Chan Tai Man (Deliotte) / tel: 2852 1600\n'
        '公司须立即停止一切业务。董事陸毅強须于14日内提交公司事务陈述书 (Statement of Affairs)。\n'
        '宪报刊登编号: G.N. 2156 of 2025'
    ),
    filename='Court_Order_HCCW89_2025.pdf',
    source_folder='LIQUIDATION/2025/'))

logs.append(make_log(cid, cname,
    doc_type='STATEMENT_OF_AFFAIRS',
    doc_date='2025-03-29',
    notes=(
        '公司事务陈述书 (Statement of Affairs) — s.190 C(WUMP)O\n'
        '提交人: 陸毅強 Luk Ngai Keung (唯一留任董事)\n'
        '提交日期: 2025-03-29 (法庭颁令后14日内)\n'
        '资产 (账面值 / 预计可变现值):\n'
        '  健身器材及设备: HK$3.5M / HK$1.8M (二手拍卖估值)\n'
        '  银行存款: HK$0.2M / HK$0.2M\n'
        '  应收账款: HK$0.8M / HK$0.1M (大部分已坏账)\n'
        '  总资产: HK$4.5M / HK$2.1M\n'
        '负债:\n'
        '  有抵押债权人: — (无)\n'
        '  优先债权人 (员工欠薪+遣散费58人): HK$4.5M\n'
        '  无担保债权人 (租金/供应商/水电): HK$18.5M\n'
        '  总负债: HK$23.0M\n'
        '预计无担保债权人回收率: HK$0.00 per HK$1.00\n'
        '宣布及缴付股本: HK$1,000,000 已缴足\n'
        '董事声明: 据本人所知，以上陈述属实完整。'
    ),
    filename='Statement_of_Affairs_20250329.pdf',
    source_folder='LIQUIDATION/2025/'))

# ═══════════════════════════════════════════
# 3. GRAND POWER LOGISTICS GROUP LIMITED (BR 21710682, 2019, GEM:8489)
# ═══════════════════════════════════════════
co = companies['GRAND POWER LOGISTICS GROUP LIMITED']
cid = co['id']
cname = co['name']

logs.append(make_log(cid, cname,
    doc_type='NAR1',
    doc_date='2025-10-15',
    notes=(
        'NAR1 周年申报表 — 申报期 2024-10-15 至 2025-10-14\n'
        'P.1 第1栏 公司名称: GRAND POWER LOGISTICS GROUP LIMITED 裕程物流集团有限公司\n'
        'P.1 第2栏 商业登记号码: 21710682\n'
        'P.1 第4栏 注册办事处地址: 香港新界葵涌货柜码头路88号永得利广场10楼1001-1003室\n'
        'P.1 第5栏 业务性质: 跨境物流及国际货运代理 (Cross-border Logistics & Freight Forwarding)\n'
        'P.2 第6-10栏 董事:\n'
        '  ① 赵彤 Zhao Tong (主席/执行董事/HKID/G345678(2)/住址 九龙九龙塘牛津道1号/委任 2019-10-15)\n'
        '  ② 谢志坤 Xie Zhikun (CEO/执行董事/HKID/G456789(3)/委任 2019-10-15)\n'
        '  ③ 香伟强 Xiang Weiqiang (CFO/执行董事/HKID/G567890(4)/委任 2020-03-01)\n'
        '  ④ 王緗漌 Wang Xiangguan (独立非执行董事/HKID/G678901(5)/委任 2021-06-01)\n'
        'P.3 第11栏 公司秘书: 李震鋒 Li Zhenfeng (自然人/HKID/G789012(6))\n'
        'P.6 第14栏 已发行股本: HK$10,000,000 分 100,000,000 股每股 HK$0.10\n'
        'P.6 第15栏 股东:\n'
        '  ① Peak Connect International Limited (BVI/90,000,000股/90%)\n'
        '  ② 赵彤 Zhao Tong (10,000,000股/10%)\n'
        '附表一 公司成员资料与上年度无变更。'
    ),
    filename='NAR1_21710682_2025.pdf',
    source_folder='NAR1/2025/'))

logs.append(make_log(cid, cname,
    doc_type='SHARE_TRANSFER',
    doc_date='2025-01-14',
    notes=(
        '股份转让 — Bought & Sold Note (成交单据)\n'
        '转让方 (Transferor): 赵彤 Zhao Tong\n'
        '受让方 (Transferee): Peak Connect International Limited (BVI)\n'
        '转让股份: 1,200,000 股普通股 (每股面值 HK$0.10)\n'
        '每股作价: HK$0.85 (2025-01-13 联交所 GEM 收市价 HK$0.84)\n'
        '总代价: HK$1,020,000\n'
        '厘印费: HK$20,400 (买卖双方各半 / 每方 HK$10,200)\n'
        '转让后持股: 赵彤 10,000,000股(10%) / Peak Connect BVI 90,000,000股(90%)\n'
        '转让原因: 赵彤个人资产重组，将部分持股并入家族BVI控股公司\n'
        '提交股份转让文书 (Instrument of Transfer) + Bought & Sold Note 予 IRD 加盖厘印\n'
        'IRD 厘印编号: ST2025011400123\n'
        '公司秘书更新股东名册日期: 2025-01-21'
    ),
    filename='Share_Transfer_20250114.pdf',
    source_folder='SHARE_TRANSFER/2025/'))

logs.append(make_log(cid, cname,
    doc_type='BOARD_MINUTES',
    doc_date='2025-03-28',
    notes=(
        '董事会会议记录 — 2025-03-28 上午10:00 葵涌永得利广场总部\n'
        '出席董事: 赵彤(主席/主持)、谢志坤、香伟强、王緗漌 (全部4名董事出席，法定人数达标)\n'
        '列席: 李震鋒(公司秘书)\n'
        '决议1: 通过截至 2024-12-31 经审核综合财务报表。收入 HK$638M / 净利润 HK$12.8M / EPS HK$0.128\n'
        '决议2: 建议派发末期股息每股 HK$0.012，合计 HK$1,200,000。待 AGM 批准。除净日 2025-06-10 / 派发日 2025-06-30\n'
        '决议3: 续聘中审众环(香港)会计师事务所 (Union Alpha HK) 为核数师，任期至下届 AGM\n'
        '决议4: 授权公司秘书安排在 2025-05-28 举行股东周年大会\n'
        '决议5: 批准管理层展开东南亚(泰国/越南)跨境陆运可行性研究，预算 HK$500,000\n'
        '休会时间: 11:45。下次会议: 2025-05-15 (审批 Q1 业绩)'
    ),
    filename='Board_Minutes_20250328.pdf',
    source_folder='BOARD/2025/'))

logs.append(make_log(cid, cname,
    doc_type='ND2A',
    doc_date='2025-06-30',
    notes=(
        'ND2A 更改公司秘书及董事通知书 — 停任+委任: 核数师变更\n'
        'Section A 公司资料: GRAND POWER LOGISTICS GROUP LIMITED / BR 21710682\n'
        'Section B2 停任核数师 (该公司并非上市公司 — 实际上为GEM上市，此处因系统限制用ND2A申报):\n'
        '  核数师名称: Elite Partners CPA Limited 开元信德会计师事务所有限公司\n'
        '  停任日期: 2025-06-30\n'
        '  停任原因: 核数师自行辞任 — 需调配资源服务其他客户\n'
        'Section B1 委任核数师:\n'
        '  核数师名称: Union Alpha HK CPA Limited 中审众环(香港)会计师事务所有限公司\n'
        '  委任日期: 2025-06-30\n'
        'Section D 签署人: 赵彤 (董事) / 日期: 2025-07-07\n'
        '根据《公司条例》s.419 提交。核数师辞任确认信随附。\n'
        'AGM 通过日期: 2025-05-28 (第3项决议)'
    ),
    filename='ND2A_Auditor_Change_20250630.pdf',
    source_folder='AUDIT/2025/'))

# ═══════════════════════════════════════════
# 4. WAN LEADER INTERNATIONAL LIMITED (BR 26247831, 2017, GEM:8482)
# ═══════════════════════════════════════════
co = companies['WAN LEADER INTERNATIONAL LIMITED']
cid = co['id']
cname = co['name']

logs.append(make_log(cid, cname,
    doc_type='NAR1',
    doc_date='2025-08-22',
    notes=(
        'NAR1 周年申报表 — 申报期 2024-08-22 至 2025-08-21\n'
        'P.1 第1栏 公司名称: WAN LEADER INTERNATIONAL LIMITED 萬勵達國際有限公司\n'
        'P.1 第2栏 商业登记号码: 26247831\n'
        'P.1 第4栏 注册办事处地址: 香港九龙湾宏光道39号宏天广场15楼1501-1505室\n'
        'P.1 第5栏 业务性质: 货运代理及物流服务 (Freight Forwarding & Logistics)\n'
        'P.2 第6-10栏 董事 (5人):\n'
        '  ① 吕克宜 Lv Keyi (主席/执行董事/HKID/H123456(7)/委任 2017-08-22)\n'
        '  ② 张雱飞 Zhang Pangfei (CEO/执行董事/HKID/H234567(8)/委任 2017-08-22)\n'
        '  ③ 鄔雨杉 Wu Yushan (执行董事/HKID/H345678(9)/委任 2018-09-01)\n'
        '  ④ 严希茂 Yan Ximao (非执行董事/HKID/H456789(0)/委任 2019-12-01)\n'
        '  ⑤ 渠天芸 Qu Tianyun (独立非执行董事/HKID/H567890(1)/委任 2020-06-01)\n'
        'P.3 第11栏 公司秘书: TRICOR SERVICES LIMITED 卓佳专业商务有限公司 (法人/TCSP牌照 TC00001234)\n'
        'P.3 第12栏 授权代表: 吕克宜 Lv Keyi + Tricor\n'
        'P.6 第14栏 已发行股本: HK$50,000,000 分 500,000,000 股每股 HK$0.10\n'
        'P.6 第15栏 股东:\n'
        '  ① 廖代春 Liao Daichun (92,250,000股/18.45%)\n'
        '  ② 豪達有限公司 HAODA LIMITED (38,400,000股/7.68%)\n'
        '附表一 第③项 董事变更: 吕克宜住址已更新 (见 ND2B 2025-02-10)'
    ),
    filename='NAR1_26247831_2025.pdf',
    source_folder='NAR1/2025/'))

logs.append(make_log(cid, cname,
    doc_type='ND2B',
    doc_date='2025-02-10',
    notes=(
        'ND2B 更改公司秘书及董事详情通知书 — 更改董事住址\n'
        'Section A 公司资料: WAN LEADER INTERNATIONAL LIMITED / BR 26247831\n'
        'Section B 更改详情 (董事):\n'
        '  姓名: 吕克宜 Lv Keyi\n'
        '  香港身份证号码: H123456(7)\n'
        '  Part B1 — 更改项目: 住址 (Residential Address)\n'
        '  旧住址: Flat C, 12/F, Block 3, Amoy Gardens, 77 Ngau Tau Kok Road, Kowloon Bay, KLN\n'
        '  新住址: Flat A, 28/F, Tower 1, Celestial Heights, 80 Sheung Shing Street, Ho Man Tin, KLN\n'
        '  更改生效日期: 2025-02-01\n'
        '  Part B2 — 更改项目: — (无其他更改)\n'
        'Section D 签署人: 吕克宜 (董事本人) / 日期: 2025-02-10\n'
        '提交日期: 2025-02-10 (更改后15日内提交)\n'
        '附: 新住址证明 (3个月内发出的公用事业账单 — CLP电费单 2025年1月)'
    ),
    filename='ND2B_26247831_20250210.pdf',
    source_folder='ND2B/2025/'))

logs.append(make_log(cid, cname,
    doc_type='SHAREHOLDER_RESOLUTION',
    doc_date='2025-04-15',
    notes=(
        '股东书面决议 — 根据《公司条例》s.548 (无需开会)\n'
        '公司名称: WAN LEADER INTERNATIONAL LIMITED 萬勵達國際有限公司\n'
        '决议日期: 2025-04-15\n'
        '签署股东: 廖代春 (18.45%) + 豪達有限公司 (7.68%) = 合计 26.13% 表决权\n'
        '决议内容:\n'
        '  "RESOLVED THAT the name of the Company be changed to \'WAN LEADER INTERNATIONAL LIMITED 萬勵達國際有限公司\'."\n'
        '  即正式在公司组织章程细则中加入中文名称（中文名此前已在商业登记中使用但未入章程）\n'
        '授权公司秘书 Tricor Services Limited 办理:\n'
        '  ① 向公司注册处提交 NNC2 (更改公司名称通知书)\n'
        '  ② 向 IRD 更新商业登记证\n'
        '  ③ 更改公司印章和银行户口名称\n'
        'NNC2 提交日期: 2025-04-18 / 公司注册处批准日期: 2025-05-02\n'
        '公司注册证书 (更改名称) 签发编号: 26247831-CN1'
    ),
    filename='Shareholder_Resolution_20250415.pdf',
    source_folder='RESOLUTION/2025/'))

logs.append(make_log(cid, cname,
    doc_type='BR_RENEWAL',
    doc_date='2025-07-01',
    notes=(
        '商业登记证续期 — 税务局 (Inland Revenue Department)\n'
        '商业登记号码: 26247831-001\n'
        '公司名称: WAN LEADER INTERNATIONAL LIMITED 萬勵達國際有限公司\n'
        '登记证类别: 一年证 (1-Year Certificate)\n'
        '有效期: 2025-08-22 至 2026-08-21\n'
        '费用明细:\n'
        '  商业登记费: HK$2,150\n'
        '  破产欠薪保障基金征费: HK$250\n'
        '  合计: HK$2,400\n'
        '付款方式: 自动转账 (银行: HSBC / 户口尾号 8821)\n'
        '付款日期: 2025-07-01 (到期日前52天)\n'
        '新 BR 证书路径: company_documents/BR/26247831-001_2025-2026.pdf\n'
        '附注: 须于营业地址展示有效商业登记证 (Business Registration Ordinance s.12)'
    ),
    filename='BR_Renewal_2025_WANLEADER.pdf',
    source_folder='BR/2025/'))

# ═══════════════════════════════════════════
# 5. V & J INTERNATIONAL LIMITED (BR 35883934, 2005, struck off s.744(3))
# ═══════════════════════════════════════════
co = companies['V & J INTERNATIONAL LIMITED']
cid = co['id']
cname = co['name']

logs.append(make_log(cid, cname,
    doc_type='NAR1',
    doc_date='2021-06-24',
    notes=(
        'NAR1 周年申报表 — 申报期 2020-06-24 至 2021-06-23\n'
        'P.1 第1栏 公司名称: V & J INTERNATIONAL LIMITED 暉毅國際有限公司\n'
        'P.1 第2栏 商业登记号码: 35883934\n'
        'P.1 第5栏 业务性质: 进出口贸易 (Import & Export Trading)\n'
        'P.1 第4栏 注册办事处地址: 香港铜锣湾轩尼诗道489号铜锣湾广场一期15楼1502室\n'
        'P.2 第6栏 董事: [一名自然人董事/资料已隐藏于非公开版本]\n'
        'P.6 第14栏 已发行股本: HK$1,000,000 分 1,000,000 股\n'
        'P.6 第15栏 股东: [一名自然人股东持有全部已发行股份]\n'
        '附表一 无变更\n'
        '此为公司最后一份提交的 NAR1。此后 2022、2023、2024 年度均无申报。'
    ),
    filename='NAR1_35883934_2021.pdf',
    source_folder='NAR1/2021/'))

logs.append(make_log(cid, cname,
    doc_type='ND4',
    doc_date='2022-03-31',
    notes=(
        'ND4 公司秘书及董事辞职通知书 — 唯一董事辞任\n'
        'Section A 公司资料: V & J INTERNATIONAL LIMITED / BR 35883934\n'
        'Section B 辞职董事详情:\n'
        '  姓名: [唯一董事]\n'
        '  职位: 董事\n'
        '  辞任日期: 2022-03-31\n'
        'Section C 签署人: [辞任董事]\n'
        '签署日期: 2022-03-31\n'
        '提交日期: 2022-04-07\n'
        '⚠ 注意: 辞任后公司无董事在任，违反《公司条例》s.453 (私人公司须有最少1名自然人董事)\n'
        '公司注册处已记录此违规事项。'
    ),
    filename='ND4_35883934_20220331.pdf',
    source_folder='ND4/2022/'))

logs.append(make_log(cid, cname,
    doc_type='CR_STRIKE_OFF',
    doc_date='2024-03-01',
    notes=(
        '公司注册处 — 根据《公司条例》第744(3)条拟除名公告\n'
        '宪报编号: G.N. 1234 of 2024\n'
        '公司名称: V & J INTERNATIONAL LIMITED (CR No. 0987064)\n'
        '商业登记号码: 35883934\n'
        '除名原因:\n'
        '  ① 连续2年未提交周年申报表 (NAR1 2022 及 2023 年度)\n'
        '  ② 公司注册处处长有合理理由相信该公司已停止营业 (s.744(3))\n'
        '程序:\n'
        '  ① 处长向公司注册办事处寄出查询信 (2023-09-01) — 退回/无回复\n'
        '  ② 处长刊登拟除名公告 (本次)\n'
        '  ③ 如公告日期起计3个月内无人提出反对，公司将被正式除名\n'
        '  ④ 反对截止日期: 2024-06-01\n'
        '任何人如认为该公司不应被除名，须于截止日期前以书面提出反对并附理由。'
    ),
    filename='Strike_Off_Notice_20240301.pdf',
    source_folder='STRIKE_OFF/2024/'))

logs.append(make_log(cid, cname,
    doc_type='CR_DISSOLUTION',
    doc_date='2024-06-01',
    notes=(
        '公司注册处 — 公司解散公告\n'
        '宪报编号: G.N. 3456 of 2024\n'
        '公司名称: V & J INTERNATIONAL LIMITED (CR No. 0987064)\n'
        '解散日期: 2024-06-01\n'
        '法律依据: s.746 Companies Ordinance (Cap. 622)\n'
        '效果: 公司正式从公司登记册中剔除，公司不再存在\n'
        '后果:\n'
        '  — 公司所有未处置财产归属香港特别行政区政府 (bona vacantia)\n'
        '  — 董事/股东/成员的法律责任 (如有) 不受解散影响 (s.756)\n'
        '  — 任何人如欲恢复公司注册，须于解散后20年内向原讼法庭申请恢复令 (s.765)\n'
        '  — 申请恢复须证明公司除名时仍在营运、或公司财产须通过恢复来处理\n'
        '公司注册处处长签署 (电子签署)'
    ),
    filename='Gazette_Dissolution_20240601.pdf',
    source_folder='STRIKE_OFF/2024/'))

# ── 写入数据库 ──
db.execute('DELETE FROM company_logs')
count = 0
for log in logs:
    db.execute("""INSERT INTO company_logs (id, company_id, company_name_hint, source_folder, doc_type,
        original_filename, storage_path, html_content, text_content, doc_date, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (log['id'], log['company_id'], log['company_name_hint'], log['source_folder'], log['doc_type'],
         log['original_filename'], log['storage_path'], log['html_content'], log['text_content'],
         log['doc_date'], log['notes'], log['created_at'], log['updated_at']))
    count += 1

db.commit()
import sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
print('Done: %d logs inserted' % count)

print()
print('=== Summary ===')
for row in db.execute('''SELECT c.name, cl.doc_type, cl.doc_date,
    substr(cl.notes, 1, 100) as first_line
    FROM company_logs cl
    JOIN companies c ON c.id = cl.company_id
    ORDER BY c.name, cl.doc_date'''):
    d = dict(row)
    first = d['first_line'].split('\n')[0]
    print('  %s | %s | %s | %s' % (d['name'][:35], d['doc_type'], d['doc_date'], first))

db.close()
