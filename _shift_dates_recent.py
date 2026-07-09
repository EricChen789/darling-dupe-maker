# -*- coding: utf-8 -*-
"""
把系統內「業務活動日期」平移到近三個月（2026-04-09 ~ 2026-07-09，今天=07-09）。
保留 companies.incorporation_date（真實成立日期，TVP 真實數據賣點）。
確定性平移（按索引線性鋪開），可重複執行結果一致。
覆蓋：
  · person_company_roles.date_appointed / date_ceased（委任<辭任，保留原格式 DDMMYYYY/ISO）
  · reminders.due_date（+ 同步重算 notes 週年 + created_at）
  · company_logs.doc_date + created_at/updated_at（鋪開，讓日誌像三個月內陸續記錄）
  · significant_controllers.date_became
已在窗口內的（share_transactions / company_versions / resolutions）不動。
"""
import sys, os, re, sqlite3
from datetime import date, timedelta, datetime

sys.stdout.reconfigure(encoding='utf-8')
DB = os.path.join(os.path.dirname(__file__), 'local-server', 'local.db')

WIN_START = date(2026, 4, 9)
TODAY = date(2026, 7, 9)


def is_ddmmyyyy(s):
    return bool(re.match(r'^\d{8}$', (s or '').strip()))


def fmt(d, sample):
    """按 sample 的格式輸出 date：8位數字→DDMMYYYY，否則→ISO。"""
    return d.strftime('%d%m%Y') if is_ddmmyyyy(sample) else d.strftime('%Y-%m-%d')


def spread(n, start, end_incl):
    """把 n 個日期線性鋪在 [start, end_incl]。"""
    if n <= 0:
        return []
    if n == 1:
        return [start + timedelta(days=(end_incl - start).days // 2)]
    total = (end_incl - start).days
    return [start + timedelta(days=round(i * total / (n - 1))) for i in range(n)]


def main():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    log = []

    # ─── 1. person_company_roles 委任/辭任 ───
    rows = db.execute(
        """SELECT id, date_appointed, date_ceased FROM person_company_roles
           ORDER BY company_id, role, id""").fetchall()
    ceased = [r for r in rows if (r['date_ceased'] or '').strip()]
    # 委任日期（非空、且非辭任行）鋪開到 04-09 ~ 07-05
    appt_rows = [r for r in rows if (r['date_appointed'] or '').strip() and not (r['date_ceased'] or '').strip()]
    appt_dates = spread(len(appt_rows), WIN_START, date(2026, 7, 5))
    for r, d in zip(appt_rows, appt_dates):
        db.execute("UPDATE person_company_roles SET date_appointed=? WHERE id=?",
                   (fmt(d, r['date_appointed']), r['id']))
    log.append(f"委任日期(當前) 平移 {len(appt_rows)} 條 → {appt_dates[0]}..{appt_dates[-1]}" if appt_rows else "委任日期(當前) 0 條")

    # 辭任行：委任早(4月)、辭任晚(6月)，皆在窗口內
    ceased_plan = [
        (date(2026, 4, 15), date(2026, 6, 18)),
        (date(2026, 4, 22), date(2026, 6, 24)),
        (date(2026, 4, 28), date(2026, 6, 30)),
    ]
    for i, r in enumerate(ceased):
        a, c = ceased_plan[min(i, len(ceased_plan) - 1)]
        appt_fmt = fmt(a, r['date_appointed'] or r['date_ceased'])
        ceased_fmt = fmt(c, r['date_ceased'])
        db.execute("UPDATE person_company_roles SET date_appointed=?, date_ceased=? WHERE id=?",
                   (appt_fmt, ceased_fmt, r['id']))
    log.append(f"辭任行 平移 {len(ceased)} 條（委任<辭任，皆在窗口內）")

    # ─── 2. reminders 到期日 ───
    rem = db.execute("SELECT id, status, notes, due_date FROM reminders ORDER BY id").fetchall()
    # 已解決的鋪在窗口前中段，pending 放在近今天（剛到期）
    resolved = [r for r in rem if r['status'] in ('completed', 'submitted', 'ignored')]
    pending = [r for r in rem if r['status'] not in ('completed', 'submitted', 'ignored')]
    res_dates = spread(len(resolved), date(2026, 4, 20), date(2026, 6, 15))
    pend_dates = spread(len(pending), date(2026, 7, 5), date(2026, 7, 9))
    for r, d in list(zip(resolved, res_dates)) + list(zip(pending, pend_dates)):
        anniv = d - timedelta(days=42)
        notes = re.sub(r'成立週年\s*\d{4}-\d{2}-\d{2}', f'成立週年 {anniv.isoformat()}', r['notes'] or '') \
            if (r['notes'] and '成立週年' in r['notes']) else r['notes']
        created = (d - timedelta(days=20)).isoformat() + 'T09:00:00'
        db.execute("UPDATE reminders SET due_date=?, notes=?, created_at=? WHERE id=?",
                   (d.isoformat(), notes, created, r['id']))
    log.append(f"提醒到期日 平移 {len(rem)} 條（已解決 {len(resolved)} 在 4~6 月，待處理 {len(pending)} 在 7/5~7/9）")

    # ─── 3. company_logs 文件日期 + 記錄時間 ───
    logs = db.execute("SELECT id FROM company_logs ORDER BY company_id, id").fetchall()
    ld = spread(len(logs), WIN_START, date(2026, 7, 8))
    for r, d in zip(logs, ld):
        ts = datetime(d.year, d.month, d.day, 10, 0, 0).isoformat()
        db.execute("UPDATE company_logs SET doc_date=?, created_at=?, updated_at=? WHERE id=?",
                   (d.isoformat(), ts, ts, r['id']))
    log.append(f"公司日誌 doc_date+created_at 鋪開 {len(logs)} 條 → {ld[0]}..{ld[-1]}" if logs else "公司日誌 0 條")

    # ─── 4. significant_controllers 成為日期 ───
    scr = db.execute("SELECT id FROM significant_controllers ORDER BY id").fetchall()
    sd = spread(len(scr), date(2026, 4, 12), date(2026, 5, 30))
    for r, d in zip(scr, sd):
        db.execute("UPDATE significant_controllers SET date_became=? WHERE id=? AND (date_ceased IS NULL OR date_ceased='')",
                   (d.isoformat(), r['id']))
    log.append(f"重要控制人 date_became 設定 {len(scr)} 條")

    db.commit()
    print('=== 平移完成 ===')
    for l in log:
        print(' ·', l)

    # ── 驗證：列出各表日期範圍 ──
    print('\n=== 驗證（近三個月窗口 2026-04-09 ~ 2026-07-09）===')
    def rng(sql, label):
        vals = [r[0] for r in db.execute(sql) if r[0]]
        print(f'  {label}: n={len(vals)} min={min(vals)!r} max={max(vals)!r}' if vals else f'  {label}: (空)')
    rng("SELECT incorporation_date FROM companies", "成立日期(應不變)")
    rng("SELECT date_appointed FROM person_company_roles WHERE date_appointed!=''", "委任日期")
    rng("SELECT date_ceased FROM person_company_roles WHERE date_ceased!=''", "辭任日期")
    rng("SELECT due_date FROM reminders", "提醒到期日")
    rng("SELECT doc_date FROM company_logs", "日誌文件日期")
    rng("SELECT date(created_at) FROM company_logs", "日誌記錄日期")
    rng("SELECT date_became FROM significant_controllers WHERE date_became!=''", "SCR成為日期")
    db.close()


if __name__ == '__main__':
    main()
