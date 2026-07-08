import sqlite3, uuid, datetime

db = sqlite3.connect('D:/myproject/darling-dupe-maker/local-server/local.db')
db.row_factory = sqlite3.Row

now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
abc_id = 'b407d180-3746-4aef-8c48-6c2e72e3f68f'
testhk_id = 'd3eb259b-f1f6-40df-b2cf-2e099165dae9'

logs = [
    # ABC Trading Limited
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '公司註冊證書及商業登記證', 'doc_type': 'CI_BR',
        'original_filename': 'ABC_CI_BR_2024.pdf', 'storage_path': '/uploads/abc_ci_br.pdf',
        'html_content': '<p>公司註冊證書及商業登記證掃描檔</p>',
        'text_content': 'CI+BR | 公司編號 12345678',
        'doc_date': '2024-01-15', 'notes': '2024年度更新版',
    },
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '周年申報表', 'doc_type': 'NAR1',
        'original_filename': 'ABC_NAR1_2024.pdf', 'storage_path': '/uploads/abc_nar1_2024.pdf',
        'html_content': '<p>2024年度 NAR1 周年申報表</p><p>提交日期：2024-03-20</p>',
        'text_content': 'NAR1 周年申報表 | 申報年度 2024 | 提交日期 2024-03-20',
        'doc_date': '2024-03-20', 'notes': '已提交至公司註冊處',
    },
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '董事會議記錄', 'doc_type': 'MINUTES',
        'original_filename': 'ABC_Board_Minutes_2024Q1.pdf', 'storage_path': '/uploads/abc_board_q1.pdf',
        'html_content': '<p><b>董事會議記錄</b></p><p>日期：2024-03-15</p><p>出席：Chan Tai Man, Lee Siu Ming</p><p>議程：通過2023財務報表、宣布派息、續聘核數師</p>',
        'text_content': '董事會議記錄 | 2024-03-15 | 通過2023財務報表 | 派息每股0.50 | 續聘核數師',
        'doc_date': '2024-03-15', 'notes': 'Q1 董事例會',
    },
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '股東會議記錄', 'doc_type': 'MINUTES',
        'original_filename': 'ABC_AGM_Minutes_2024.pdf', 'storage_path': '/uploads/abc_agm_2024.pdf',
        'html_content': '<p><b>股東週年大會記錄</b></p><p>日期：2024-05-10</p><p>出席：Chan Tai Man (50%), Oceanwide (30%), Wong Ka Yan (20%)</p>',
        'text_content': 'AGM 股東週年大會 | 2024-05-10 | 重選董事 | 通過財務報表',
        'doc_date': '2024-05-10', 'notes': '2024年度股東週年大會',
    },
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '股份轉讓文件', 'doc_type': 'SHARE_TRANSFER',
        'original_filename': 'ABC_Share_Transfer_202406.pdf', 'storage_path': '/uploads/abc_share_transfer.pdf',
        'html_content': '<p><b>股份轉讓文書</b></p><p>轉讓人：Oceanwide Holdings Ltd</p><p>受讓人：Wong Ka Yan</p><p>股份：500股 | 代價：50,000</p>',
        'text_content': '股份轉讓 | Oceanwide -> Wong Ka Yan | 500股 | 代價 50,000',
        'doc_date': '2024-06-01', 'notes': '股東之間股份轉讓',
    },
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '董事變更通知', 'doc_type': 'ND2A',
        'original_filename': 'ABC_ND2A_202402.pdf', 'storage_path': '/uploads/abc_nd2a.pdf',
        'html_content': '<p>ND2A 董事委任通知書</p><p>委任 Lee Siu Ming 為董事</p><p>生效日期：2024-02-01</p>',
        'text_content': 'ND2A | 委任 Lee Siu Ming 為董事 | 生效 2024-02-01',
        'doc_date': '2024-02-05', 'notes': '新增董事 - 已提交公司註冊處',
    },
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '信函往來', 'doc_type': 'CORRESPONDENCE',
        'original_filename': 'ABC_IRD_Letter_202505.pdf', 'storage_path': '/uploads/abc_ird_letter.pdf',
        'html_content': '<p>稅務局來函 - 2024/25利得稅報稅表</p><p>發出日期：2025-05-02</p><p>回覆截止：2025-06-02</p>',
        'text_content': '稅務局來函 | 2024/25 利得稅報稅表 | 截止 2025-06-02',
        'doc_date': '2025-05-02', 'notes': '需於6月2日前回覆',
    },
    {
        'company_id': abc_id, 'company_name_hint': 'ABC Trading Limited',
        'source_folder': '銀行文件', 'doc_type': 'BANKING',
        'original_filename': 'ABC_HSBC_Bank_Confirmation.pdf', 'storage_path': '/uploads/abc_bank_conf.pdf',
        'html_content': '<p>HSBC 銀行確認函</p><p>確認日期：2025-01-10</p>',
        'text_content': '銀行確認函 | HSBC Hong Kong | 年度審計用',
        'doc_date': '2025-01-10', 'notes': '年度審計用銀行確認函',
    },
    # TestHK Ltd
    {
        'company_id': testhk_id, 'company_name_hint': 'TestHK Ltd',
        'source_folder': '公司註冊證書及商業登記證', 'doc_type': 'CI_BR',
        'original_filename': 'TestHK_CI_BR.pdf', 'storage_path': '/uploads/testhk_ci_br.pdf',
        'html_content': '<p>公司註冊證書及商業登記證</p>',
        'text_content': 'TestHK Ltd CI & BR | 新成立公司',
        'doc_date': '2025-06-01', 'notes': '新成立公司初始文件',
    },
    {
        'company_id': testhk_id, 'company_name_hint': 'TestHK Ltd',
        'source_folder': '公司查冊報告', 'doc_type': 'SEARCH',
        'original_filename': 'TestHK_CR_Search_202507.pdf', 'storage_path': '/uploads/testhk_cr_search.pdf',
        'html_content': '<p>公司註冊處查冊報告</p><p>查冊日期：2025-07-01</p>',
        'text_content': '公司查冊報告 | 2025-07-01 | 公司狀況：仍註冊',
        'doc_date': '2025-07-01', 'notes': '定期合規查冊',
    },
]

for log in logs:
    log_id = str(uuid.uuid4())
    db.execute('''
        INSERT INTO company_logs
        (id, company_id, company_name_hint, source_folder, doc_type,
         original_filename, storage_path, html_content, text_content,
         doc_date, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        log_id, log['company_id'], log['company_name_hint'], log['source_folder'], log['doc_type'],
        log['original_filename'], log['storage_path'], log['html_content'], log['text_content'],
        log['doc_date'], log['notes'], now, now
    ))

db.commit()

cnt = db.execute('SELECT COUNT(*) as cnt FROM company_logs').fetchone()
print(f'Done! {len(logs)} logs inserted. Total in DB: {cnt["cnt"]}')

for co_id, co_name in [(abc_id, 'ABC Trading Limited'), (testhk_id, 'TestHK Ltd')]:
    logs_co = db.execute(
        'SELECT doc_type, original_filename, doc_date, notes FROM company_logs WHERE company_id=? ORDER BY doc_date',
        (co_id,)
    ).fetchall()
    print(f'\n{co_name} ({len(logs_co)} logs):')
    for l in logs_co:
        print(f'  [{l["doc_type"]:15s}] {l["doc_date"]} | {l["original_filename"]} | {l["notes"]}')

db.close()
