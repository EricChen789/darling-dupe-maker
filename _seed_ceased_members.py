# -*- coding: utf-8 -*-
"""
檢索服務 SE-05 / SE-07 演示數據：
為 PAUL TANG AND COMPANY LIMITED 添加
  · 1 名「已辭任董事」（歷史董事，SE-07）
  · 1 名「已退出股東」（歷史股東，SE-05）
以便公司詳情「董事／股東」標籤的「歷史記錄」子視圖及檢索頁歷史 tab 有可截畫面。
冪等：以 id_number 判斷是否已存在，存在則跳過。
"""
import sqlite3
import uuid
import os

DB = os.path.join(os.path.dirname(__file__), 'local-server', 'local.db')
PAUL_TANG = '25104de2-583b-427f-a307-805a081981dc'


def norm(s):
    return ''.join(c for c in (s or '').lower() if c.isalnum())


def ensure_person(db, *, identity, name_en, name_zh, id_number, address):
    row = db.execute("SELECT id FROM persons WHERE id_number=?", (id_number,)).fetchone()
    if row:
        return row[0], False
    pid = str(uuid.uuid4())
    db.execute(
        """INSERT INTO persons (id, identity, name_english, name_chinese, id_number,
                                address, service_address, normalized_key)
           VALUES (?,?,?,?,?,?,?,?)""",
        (pid, identity, name_en, name_zh, id_number, address, address, norm(name_en)),
    )
    return pid, True


def ensure_role(db, *, person_id, role, date_appointed, date_ceased, shares=0,
                share_type='', currency='HKD', issue_price='', paid_up='', unpaid=''):
    row = db.execute(
        "SELECT id FROM person_company_roles WHERE person_id=? AND company_id=? AND role=?",
        (person_id, PAUL_TANG, role)).fetchone()
    if row:
        # 更新辭任日期，確保為歷史記錄
        db.execute("UPDATE person_company_roles SET date_ceased=? WHERE id=?", (date_ceased, row[0]))
        return row[0], False
    rid = str(uuid.uuid4())
    db.execute(
        """INSERT INTO person_company_roles
           (id, person_id, company_id, role, date_appointed, date_ceased,
            shares, share_type, currency, issue_price, paid_up, unpaid)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (rid, person_id, PAUL_TANG, role, date_appointed, date_ceased,
         shares, share_type, currency, issue_price, paid_up, unpaid),
    )
    return rid, True


def main():
    db = sqlite3.connect(DB)
    try:
        # ── 已辭任董事（SE-07）──
        dir_pid, dir_new = ensure_person(
            db, identity='natural', name_en='Chan Ho Yin', name_zh='陳浩然',
            id_number='Y654321(0)', address='Flat A, 12/F, Wing Cheong Building, 88 Des Voeux Road Central, Hong Kong')
        ensure_role(db, person_id=dir_pid, role='director',
                    date_appointed='01072015', date_ceased='31122022')

        # ── 已退出股東（SE-05）──
        sh_pid, sh_new = ensure_person(
            db, identity='natural', name_en='Lam Wai Keung', name_zh='林偉強',
            id_number='Z765432(1)', address='Room 5, 8/F, Kwong Fat Mansion, 22 Nathan Road, Kowloon, Hong Kong')
        ensure_role(db, person_id=sh_pid, role='shareholder',
                    date_appointed='15062016', date_ceased='15062021',
                    shares=2000, share_type='Ordinary 普通股', currency='HKD',
                    issue_price='1.00', paid_up='2000', unpaid='0')

        db.commit()
        print('已辭任董事 Chan Ho Yin 陳浩然 :', 'created' if dir_new else 'exists(updated ceased)')
        print('已退出股東 Lam Wai Keung 林偉強:', 'created' if sh_new else 'exists(updated ceased)')

        print('\n=== 驗證 PAUL TANG roles ===')
        db.row_factory = sqlite3.Row
        for r in db.execute(
            """SELECT r.role, r.date_appointed, r.date_ceased, r.shares, p.name_english, p.name_chinese
               FROM person_company_roles r JOIN persons p ON p.id=r.person_id
               WHERE r.company_id=? ORDER BY r.role, r.date_ceased""", (PAUL_TANG,)):
            d = dict(r)
            tag = '【歷史】' if d['date_ceased'] else '【當前】'
            print(tag, d['role'], '|', d['name_english'], d['name_chinese'],
                  '| appt=', d['date_appointed'], '| ceased=', d['date_ceased'], '| shares=', d['shares'])
    finally:
        db.close()


if __name__ == '__main__':
    main()
