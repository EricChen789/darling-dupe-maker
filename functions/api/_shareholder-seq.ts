// 股東證書編號 —— 股東登記冊(ROM)與股票證書共用的唯一編號來源。
//
// 規則（2026-08-19 用戶定案）：
//   編號對象是「股東」而非「交易」—— 一位股東一個號，按**成為股東的時間**
//   (person_company_roles.date_appointed) 升序排 1、2、3、4…
//   某股東轉股給新人時，新股東排到隊尾拿下一個號，而**那筆交易開出的股票證書
//   用的就是新股東的號**（轉讓方的 ROM 轉讓行也記這個號，因為證書是為受讓人開的）。
//
// ⚠️ date_appointed 全庫混用三種格式（實測同一張表裡就有 '2026-08-16'、
//    '16/06/2026'、'27042026'）→ 一律先歸一化成 YYYYMMDD 再排序，
//    直接拿字符串 ORDER BY 會排出 4,2,1,3。

/** 把 ISO / DD/MM/YYYY / DDMMYYYY 歸一成可比較的 YYYYMMDD；認不出回 ''。 */
export function dateSortKey(d: unknown): string {
  const s = String(d ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);            // YYYY-MM-DD
  if (m) return m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);              // DD/MM/YYYY
  if (m) return m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0');
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/);                     // DDMMYYYY
  if (m) return m[3] + m[2] + m[1];
  return '';
}

export interface SeqRole {
  person_id?: string | null;
  date_appointed?: string | null;
  created_at?: string | null;
  certificate_number?: string | null;
}

/**
 * 按成為股東的時間排序（無日期的排最後，與交易編號的既有慣例一致）。
 * 同日再按 created_at；created_at 是 `TEXT NOT NULL DEFAULT ''` 且前端從不寫入，
 * 多數為空 → 靠 Array.sort 的穩定性保留原始行序。
 * 回傳新陣列，不改動入參。
 */
export function sortRolesByAppointment<T extends SeqRole>(roles: T[]): T[] {
  return roles
    .map((role, i) => ({ role, i, key: dateSortKey(role?.date_appointed) }))
    .sort((a, b) => {
      if (!a.key !== !b.key) return a.key ? -1 : 1;   // 無日期沉底
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      const ca = String(a.role?.created_at ?? '');
      const cb = String(b.role?.created_at ?? '');
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.i - b.i;
    })
    .map(x => x.role);
}

/** 手填編號優先（目前全庫皆空，等同直接用序號），否則用時序序號。 */
export function certNoOf(role: SeqRole | undefined, seq: number): string {
  const manual = String(role?.certificate_number ?? '').trim();
  return manual || String(seq);
}

/**
 * 由已排序的股東角色 + persons 資料建「英文姓名(大寫去空白) → 編號」查表。
 * 證書端只有 to_name 字串、ROM 的交易對手也只有 from_name/to_name，
 * 都得靠姓名回查編號。
 */
export function buildSeqByName(
  orderedRoles: SeqRole[],
  personOf: (personId: string) => any,
): Map<string, number> {
  const map = new Map<string, number>();
  orderedRoles.forEach((role, i) => {
    const p = personOf(String(role?.person_id ?? '')) || {};
    for (const raw of [p.name_english, p.name_chinese]) {
      const key = String(raw ?? '').trim().toUpperCase();
      if (key && !map.has(key)) map.set(key, i + 1);
    }
  });
  return map;
}
