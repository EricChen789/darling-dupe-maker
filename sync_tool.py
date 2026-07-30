#!/usr/bin/env python3
"""
Local ↔ Cloud Data Sync Tool
darling-dupe-maker 本地 SQLite ↔ Cloudflare D1 双向同步工具

Usage:
  python sync_tool.py compare              对比所有表差异
  python sync_tool.py compare --table companies  对比单表
  python sync_tool.py push                 本地 → 云端 推送 (默认 dry-run)
  python sync_tool.py push --confirm       确认执行
  python sync_tool.py pull                 云端 → 本地 拉取 (默认 dry-run)
  python sync_tool.py pull --confirm       确认执行
  python sync_tool.py push --table persons --confirm  单表同步
"""

import sqlite3
import json
import hmac
import hashlib
import base64
import time
import shutil
import os
import sys
import argparse
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Fix Unicode output on Windows GBK terminals
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ─── Config ───────────────────────────────────────────────────────────────────

LOCAL_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local-server", "local.db")
CLOUD_BASE = "https://secretary-system-9cl.pages.dev"
JWT_SECRET = "d54891cbb3df4705dec96bef87297447df29ee64bebf7413d1186786f777ecb8"
JWT_EMAIL = "admin@localhost"  # admin user for cloud API
JWT_SUB = "f0e8d7c6-b5a4-4932-8180-abcdef123456"  # admin user ID on cloud

# Tables to sync in FK-safe order (must exist on both local and cloud)
SYNC_TABLES = [
    # Master tables
    "companies", "persons", "presenters", "significant_controllers",
    # Junction / dependent tables
    "person_company_roles", "shareholders", "officers", "share_transactions",
    # Business tables
    "resolutions", "reminders", "nar1_filings", "change_events",
    "form_linkages", "company_versions",
    # History / logs
    "form_history",
]

# Tables to skip (auth different per env, logs not meaningful to sync)
SKIP_TABLES = [
    "auth_users", "user_roles",
    "company_logs", "email_logs", "whatsapp_logs", "whatsapp_queue",
    "email_templates", "secretary_templates", "invoices",
]

# Tables where 'id' could be INTEGER (local) vs TEXT/UUID (cloud)
# The compare/sync handles this by converting both to string for matching
INTEGER_ID_TABLES = {"form_history"}  # local uses AUTOINCREMENT, cloud uses TEXT UUID

# Fields to exclude from comparison (auto-generated timestamps etc.)
IGNORE_COMPARE_FIELDS = {"created_at", "updated_at"}

# ─── ANSI Colors ──────────────────────────────────────────────────────────────

C = {
    "R": "\033[91m", "G": "\033[92m", "Y": "\033[93m",
    "B": "\033[94m", "M": "\033[95m", "C": "\033[96m",
    "W": "\033[97m", "D": "\033[90m",
    "BR": "\033[1;91m", "BG": "\033[1;92m", "BY": "\033[1;93m",
    "BB": "\033[1;94m", "BW": "\033[1;97m",
    "X": "\033[0m",
}

def green(s):  return f"{C['G']}{s}{C['X']}"
def red(s):    return f"{C['R']}{s}{C['X']}"
def yellow(s): return f"{C['Y']}{s}{C['X']}"
def blue(s):   return f"{C['B']}{s}{C['X']}"
def cyan(s):   return f"{C['C']}{s}{C['X']}"
def dim(s):    return f"{C['D']}{s}{C['X']}"
def bold(s):   return f"{C['BW']}{s}{C['X']}"
def bg(s):     return f"{C['BG']}{s}{C['X']}"
def br(s):     return f"{C['BR']}{s}{C['X']}"

# ─── JWT ──────────────────────────────────────────────────────────────────────

def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def generate_jwt(secret: str, sub: str, email: str, ttl: int = 3600) -> str:
    """Generate HMAC SHA-256 JWT matching cloud _auth.ts format."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {"sub": sub, "email": email, "iat": now, "exp": now + ttl}

    header_b64 = base64url(json.dumps(header).encode())
    payload_b64 = base64url(json.dumps(payload).encode())
    signing_input = f"{header_b64}.{payload_b64}"

    sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    sig_b64 = base64url(sig)

    return f"{signing_input}.{sig_b64}"

# ─── Data Sources ─────────────────────────────────────────────────────────────

class LocalDB:
    """Read/write local SQLite database."""

    def __init__(self, path: str):
        self.path = path
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row

    def get_all(self, table: str) -> list[dict]:
        try:
            rows = self.conn.execute(f"SELECT * FROM [{table}]").fetchall()
            return [dict(r) for r in rows]
        except sqlite3.OperationalError as e:
            print(f"  {red('Error')} reading local {table}: {e}")
            return []

    def get_columns(self, table: str) -> list[str]:
        cols = self.conn.execute(f"PRAGMA table_info([{table}])").fetchall()
        return [c[1] for c in cols]

    def insert(self, table: str, record: dict):
        cols = self.get_columns(table)
        filtered = {k: v for k, v in record.items() if k in cols}
        if not filtered:
            return
        keys = list(filtered.keys())
        placeholders = ", ".join(["?"] * len(keys))
        cols_str = ", ".join([f"[{k}]" for k in keys])
        values = [filtered[k] for k in keys]
        self.conn.execute(
            f"INSERT OR REPLACE INTO [{table}] ({cols_str}) VALUES ({placeholders})", values
        )

    def update(self, table: str, record_id: str, record: dict):
        cols = self.get_columns(table)
        filtered = {k: v for k, v in record.items() if k in cols and k != "id"}
        if not filtered:
            return
        sets = ", ".join([f"[{k}] = ?" for k in filtered])
        values = list(filtered.values()) + [record_id]
        self.conn.execute(f"UPDATE [{table}] SET {sets} WHERE id = ?", values)

    def commit(self):
        self.conn.commit()

    def backup(self):
        bak = self.path + ".bak"
        shutil.copy2(self.path, bak)
        return bak

    def close(self):
        self.conn.close()


class CloudAPI:
    """Read/write cloud D1 via REST API."""

    def __init__(self, base_url: str, jwt_token: str = ""):
        self.base = base_url
        self.token = jwt_token
        self._admin_token: str | None = None  # cached admin token for writes

    def _auth_headers(self, require_admin: bool = False) -> dict:
        """Build headers. Uses admin token if available and required."""
        h = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SyncTool/1.0",
            "Accept": "application/json",
        }
        token = self._admin_token or self.token
        if token:
            h["Authorization"] = f"Bearer {token}"
        return h

    def _req(self, method: str, path: str, body: dict | list | None = None,
             require_admin: bool = False) -> tuple[int, any]:
        url = f"{self.base}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = self._auth_headers(require_admin)

        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=30) as resp:
                content = resp.read()
                if content:
                    return resp.status, json.loads(content)
                return resp.status, None
        except HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            return e.code, {"error": err_body[:200]}
        except URLError as e:
            return 0, {"error": str(e.reason)}

    def get_all(self, table: str) -> list[dict]:
        """Fetch all records from a table (paginated)."""
        all_rows = []
        offset = 0
        limit = 500
        while True:
            status, data = self._req("GET", f"/api/{table}?limit={limit}&offset={offset}")
            if status == 404:
                print(f"  {yellow('Skip')} cloud table {table}: 404 (not available)")
                return []
            if status != 200:
                print(f"  {red('Error')} GET /api/{table}: HTTP {status} {data}")
                return []
            if isinstance(data, dict) and "error" in data:
                # Some tables may not exist on cloud
                if "not found" in str(data.get("error", "")).lower() or status == 404:
                    print(f"  {yellow('Skip')} cloud table {table}: {data.get('error')}")
                    return []
                print(f"  {red('Error')} GET /api/{table}: {data}")
                return []
            if not isinstance(data, list):
                if isinstance(data, dict):
                    data = data.get("data", data.get("results", []))
                else:
                    break
            if not data:
                break
            all_rows.extend(data)
            if len(data) < limit:
                break
            offset += limit
        return all_rows

    def try_login(self, email: str, password: str) -> bool:
        """Try to login and get an admin token for write operations."""
        status, data = self._req("POST", "/api/auth/login",
                                  {"email": email, "password": password})
        if status == 200 and data.get("token"):
            self._admin_token = data["token"]
            print(f"  {green('✓')} Logged in as {data.get('user', {}).get('email', email)} "
                  f"(role: {data.get('user', {}).get('role', '?')})")
            return True
        return False

    def post(self, table: str, record: dict) -> bool:
        status, data = self._req("POST", f"/api/{table}", record, require_admin=True)
        ok = status in (200, 201)
        if not ok:
            print(f"    POST /api/{table} → HTTP {status}: {data}")
        return ok

    def put(self, table: str, record_id: str, record: dict) -> bool:
        status, data = self._req("PUT", f"/api/{table}/{record_id}", record, require_admin=True)
        ok = status in (200, 201, 204)
        if not ok:
            print(f"    PUT /api/{table}/{record_id} → HTTP {status}: {data}")
        return ok

# ─── Compare Engine ───────────────────────────────────────────────────────────

def normalize_value(v):
    """Normalize values for comparison — JSON types might differ across SQLite/D1."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return 1 if v else 0
    return str(v)

def records_diff(local: list[dict], cloud: list[dict], table: str) -> dict:
    """
    Compare two lists of records by 'id'.
    Normalizes IDs to strings (some tables use INTEGER locally, TEXT/UUID on cloud).
    Returns: {
        "local_only": [...], "cloud_only": [...],
        "modified": [{id, local, cloud, changes: [...]}],
        "same": count
    }
    """
    def _key(r):
        return str(r.get("id", ""))

    local_by_id = {_key(r): r for r in local if r.get("id") is not None}
    cloud_by_id = {_key(r): r for r in cloud if r.get("id") is not None}

    local_ids = set(local_by_id.keys())
    cloud_ids = set(cloud_by_id.keys())

    result = {
        "local_only": [local_by_id[i] for i in sorted(local_ids - cloud_ids)],
        "cloud_only": [cloud_by_id[i] for i in sorted(cloud_ids - local_ids)],
        "modified": [],
        "same": 0,
    }

    for rid in sorted(local_ids & cloud_ids):
        lr = local_by_id[rid]
        cr = cloud_by_id[rid]
        changes = []
        all_keys = set(lr.keys()) | set(cr.keys())
        for k in sorted(all_keys):
            if k in IGNORE_COMPARE_FIELDS:
                continue
            lv = normalize_value(lr.get(k))
            cv = normalize_value(cr.get(k))
            if lv != cv:
                # For 'id' field, only compare as strings
                if k == "id":
                    if str(lv) != str(cv):
                        changes.append({"field": k, "local": lv, "cloud": cv})
                else:
                    changes.append({"field": k, "local": lv, "cloud": cv})

        if changes:
            result["modified"].append({"id": rid, "local": lr, "cloud": cr, "changes": changes})
        else:
            result["same"] += 1

    return result

# ─── Display ──────────────────────────────────────────────────────────────────

def print_header(text: str):
    print(f"\n{bold('═══')} {bold(text)} {bold('═══')}")

def print_diff_summary(diff: dict, table: str):
    lo = len(diff["local_only"])
    co = len(diff["cloud_only"])
    mod = len(diff["modified"])
    same = diff["same"]

    parts = []
    if same: parts.append(f"{same} same")
    if lo: parts.append(green(f"{lo} local-only"))
    if co: parts.append(red(f"{co} cloud-only"))
    if mod: parts.append(yellow(f"{mod} modified"))
    if not parts: parts.append(dim("empty"))

    print(f"  {cyan(table):<24} {', '.join(parts)}")

def print_detailed_diff(diff: dict, table: str):
    """Print detailed difference for a single table."""
    print(f"\n  {bold(cyan(table))} — "
          f"{green(str(len(diff['local_only'])))} local-only, "
          f"{red(str(len(diff['cloud_only'])))} cloud-only, "
          f"{yellow(str(len(diff['modified'])))} modified, "
          f"{dim(str(diff['same']))} same")

    if diff["local_only"]:
        print(f"    {green('▶ Local only:')}")
        for r in diff["local_only"][:5]:
            name = r.get("name", r.get("display_name", r.get("subject", "")))
            print(f"      {r['id'][:8]} {name}")
        if len(diff["local_only"]) > 5:
            print(f"      {dim(f'... and {len(diff['local_only']) - 5} more')}")

    if diff["cloud_only"]:
        print(f"    {red('▶ Cloud only:')}")
        for r in diff["cloud_only"][:5]:
            name = r.get("name", r.get("display_name", r.get("subject", "")))
            print(f"      {r['id'][:8]} {name}")
        if len(diff["cloud_only"]) > 5:
            print(f"      {dim(f'... and {len(diff['cloud_only']) - 5} more')}")

    if diff["modified"]:
        print(f"    {yellow('▶ Modified:')}")
        for m in diff["modified"][:10]:
            name = m["local"].get("name", m["local"].get("display_name", ""))
            changed = ", ".join(c["field"] for c in m["changes"][:5])
            more = f" +{len(m['changes']) - 5} more" if len(m["changes"]) > 5 else ""
            print(f"      {m['id'][:8]} {name}")
            print(f"        {yellow(changed)}{dim(more)}")
            # Show first 3 value changes
            for c in m["changes"][:3]:
                print(f"        {dim(c['field'])}: {dim(str(c['cloud'])[:40])} → {str(c['local'])[:40]}")

# ─── Sync Operations ──────────────────────────────────────────────────────────

def push_table(local_db: LocalDB, cloud: CloudAPI, table: str, dry_run: bool, verbose: bool):
    """Push local data to cloud."""
    local_rows = local_db.get_all(table)
    cloud_rows = cloud.get_all(table)
    diff = records_diff(local_rows, cloud_rows, table)

    lo = len(diff["local_only"])
    mod = len(diff["modified"])

    if lo == 0 and mod == 0:
        if verbose:
            print(f"  {cyan(table):<24} {dim('up to date')}")
        return {"created": 0, "updated": 0, "errors": 0}

    print(f"  {cyan(table):<24} {green(f'+{lo}')} {yellow(f'~{mod}')}", end="")

    if dry_run:
        print(f"  {dim('[dry-run]')}")
        return {"created": lo, "updated": mod, "errors": 0}

    created, updated, errors = 0, 0, 0

    for r in diff["local_only"]:
        if cloud.post(table, r):
            created += 1
        else:
            errors += 1

    for m in diff["modified"]:
        if cloud.put(table, m["id"], m["local"]):
            updated += 1
        else:
            errors += 1

    result_parts = [bg(f"{created} created")] if created else []
    if updated: result_parts.append(yellow(f"{updated} updated"))
    if errors: result_parts.append(red(f"{errors} errors"))
    print(f"  → {' '.join(result_parts)}" if result_parts else "")

    return {"created": created, "updated": updated, "errors": errors}


def pull_table(local_db: LocalDB, cloud: CloudAPI, table: str, dry_run: bool, verbose: bool):
    """Pull cloud data to local."""
    local_rows = local_db.get_all(table)
    cloud_rows = cloud.get_all(table)
    diff = records_diff(local_rows, cloud_rows, table)

    co = len(diff["cloud_only"])
    mod = len(diff["modified"])

    if co == 0 and mod == 0:
        if verbose:
            print(f"  {cyan(table):<24} {dim('up to date')}")
        return {"created": 0, "updated": 0, "errors": 0}

    print(f"  {cyan(table):<24} {red(f'+{co}')} {yellow(f'~{mod}')}", end="")

    if dry_run:
        print(f"  {dim('[dry-run]')}")
        return {"created": co, "updated": mod, "errors": 0}

    created, updated, errors = 0, 0, 0

    for r in diff["cloud_only"]:
        try:
            local_db.insert(table, r)
            created += 1
        except Exception as e:
            errors += 1
            print(f"    INSERT error: {e}")

    for m in diff["modified"]:
        try:
            local_db.update(table, m["id"], m["cloud"])
            updated += 1
        except Exception as e:
            errors += 1
            print(f"    UPDATE error: {e}")

    local_db.commit()

    result_parts = [bg(f"{created} created")] if created else []
    if updated: result_parts.append(yellow(f"{updated} updated"))
    if errors: result_parts.append(red(f"{errors} errors"))
    print(f"  → {' '.join(result_parts)}" if result_parts else "")

    return {"created": created, "updated": updated, "errors": errors}

# ─── Main Commands ────────────────────────────────────────────────────────────

def cmd_compare(args):
    """Compare local and cloud data. No auth needed (GET is public)."""
    print_header("Local ↔ Cloud Comparison")
    print(f"  Local:  {dim(LOCAL_DB)}")
    print(f"  Cloud:  {dim(CLOUD_BASE)}")

    cloud = CloudAPI(CLOUD_BASE)  # no auth needed for GET
    local_db = LocalDB(LOCAL_DB)

    tables = [args.table] if args.table else SYNC_TABLES
    total = {"local_only": 0, "cloud_only": 0, "modified": 0, "same": 0, "tables": 0}

    print(f"\n  {bold('Table')}                    {bold('Status')}")
    print(f"  {dim('─' * 60)}")

    for i, table in enumerate(tables):
        # Small delay between tables to avoid Cloudflare rate limiting
        if i > 0:
            time.sleep(0.5)

        # Check if table exists locally
        local_cols = local_db.get_columns(table)
        if not local_cols:
            if args.verbose:
                print(f"  {dim(table):<24} {dim('skip — not in local DB')}")
            continue

        local_rows = local_db.get_all(table)
        cloud_rows = cloud.get_all(table)

        if not cloud_rows and not local_rows:
            print(f"  {dim(table):<24} {dim('empty on both sides')}")
            continue

        diff = records_diff(local_rows, cloud_rows, table)
        print_diff_summary(diff, table)

        if args.verbose or args.table:
            print_detailed_diff(diff, table)

        total["local_only"] += len(diff["local_only"])
        total["cloud_only"] += len(diff["cloud_only"])
        total["modified"] += len(diff["modified"])
        total["same"] += diff["same"]
        total["tables"] += 1

    local_db.close()

    print(f"\n  {bold('Total')}: {total['tables']} tables, "
          f"{green(str(total['local_only']))} local-only, "
          f"{red(str(total['cloud_only']))} cloud-only, "
          f"{yellow(str(total['modified']))} modified, "
          f"{dim(str(total['same']))} same")

    if total["local_only"] or total["cloud_only"] or total["modified"]:
        print(f"\n  {yellow('▶')} Run {bold('python sync_tool.py push --confirm')} to push local → cloud")
        print(f"  {yellow('▶')} Run {bold('python sync_tool.py pull --confirm')} to pull cloud → local")
    else:
        print(f"\n  {green('✓ All in sync!')}")

    return total


def _get_admin_cloud(local_db: LocalDB) -> CloudAPI | None:
    """Try to authenticate to cloud for write operations.
    Tries: 1) Login with local admin creds 2) Self-signed JWT with local admin ID.
    """
    cloud = CloudAPI(CLOUD_BASE)

    # Method 1: Try login with local admin credentials
    print(f"  {dim('Authenticating to cloud...')}")
    if cloud.try_login("admin@localhost", "admin123"):
        return cloud

    # Method 2: Try self-signed JWT with local admin user ID
    admin = local_db.conn.execute(
        "SELECT a.id, a.email FROM auth_users a "
        "JOIN user_roles r ON r.user_id = a.id "
        "WHERE r.role = 'admin' LIMIT 1"
    ).fetchone()
    if admin:
        token = generate_jwt(JWT_SECRET, admin["id"], admin["email"])
        cloud2 = CloudAPI(CLOUD_BASE, token)
        # Test the token with a simple write check
        # (we'll know if it works when we try the first POST)
        print(f"  {dim('Using self-signed JWT for admin:')} {dim(admin['email'])}")
        return cloud2

    print(f"  {red('✗')} Cannot authenticate to cloud. Push/pull write operations will fail.")
    print(f"  {yellow('Tip:')} Make sure the cloud has a matching admin user.")
    return cloud  # return anyway, will fail on first write


def cmd_push(args):
    """Push local data to cloud."""
    dry_run = args.dry_run and not args.confirm
    mode = "DRY-RUN" if dry_run else "LIVE"
    mode_color = dim if dry_run else bg
    print_header(f"Push Local → Cloud [{mode_color(mode)}]")

    local_db = LocalDB(LOCAL_DB)

    if not dry_run:
        bak = local_db.backup()
        print(f"  {dim('Backup:')} {dim(bak)}")

    cloud = _get_admin_cloud(local_db) if not dry_run else CloudAPI(CLOUD_BASE)

    tables = [args.table] if args.table else SYNC_TABLES

    total = {"created": 0, "updated": 0, "errors": 0}

    print(f"\n  {bold('Table')}                    {bold('Actions')}")
    print(f"  {dim('─' * 60)}")

    for table in tables:
        result = push_table(local_db, cloud, table, dry_run, verbose=not args.table)
        total["created"] += result["created"]
        total["updated"] += result["updated"]
        total["errors"] += result["errors"]

    local_db.close()

    print(f"\n  {bold('Total')}: {bg(str(total['created']))} created, "
          f"{yellow(str(total['updated']))} updated, "
          f"{red(str(total['errors']))} errors")

    if dry_run:
        print(f"\n  {yellow('▶')} This was a dry-run. Add {bold('--confirm')} to execute.")


def cmd_pull(args):
    """Pull cloud data to local DB. No cloud auth needed (GET is public)."""
    dry_run = args.dry_run and not args.confirm
    mode = "DRY-RUN" if dry_run else "LIVE"
    mode_color = dim if dry_run else bg
    print_header(f"Pull Cloud → Local [{mode_color(mode)}]")

    local_db = LocalDB(LOCAL_DB)

    if not dry_run:
        bak = local_db.backup()
        print(f"  {dim('Backup:')} {dim(bak)}")

    cloud = CloudAPI(CLOUD_BASE)  # no auth needed for GET

    tables = [args.table] if args.table else SYNC_TABLES

    total = {"created": 0, "updated": 0, "errors": 0}

    print(f"\n  {bold('Table')}                    {bold('Actions')}")
    print(f"  {dim('─' * 60)}")

    for table in tables:
        result = pull_table(local_db, cloud, table, dry_run, verbose=not args.table)
        total["created"] += result["created"]
        total["updated"] += result["updated"]
        total["errors"] += result["errors"]

    local_db.close()

    print(f"\n  {bold('Total')}: {bg(str(total['created']))} created, "
          f"{yellow(str(total['updated']))} updated, "
          f"{red(str(total['errors']))} errors")

    if dry_run:
        print(f"\n  {yellow('▶')} This was a dry-run. Add {bold('--confirm')} to execute.")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Local ↔ Cloud Data Sync Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python sync_tool.py compare                    Compare all tables
  python sync_tool.py compare --table companies  Compare single table
  python sync_tool.py compare --verbose          Show detailed field diffs
  python sync_tool.py push                       Dry-run push local → cloud
  python sync_tool.py push --confirm             Execute push
  python sync_tool.py push --table persons --confirm   Push single table
  python sync_tool.py pull                       Dry-run pull cloud → local
  python sync_tool.py pull --confirm             Execute pull
        """,
    )
    sub = parser.add_subparsers(dest="command", help="Command")

    # compare
    p_cmp = sub.add_parser("compare", help="Compare local vs cloud data")
    p_cmp.add_argument("--table", help="Compare specific table only")
    p_cmp.add_argument("--verbose", "-v", action="store_true", help="Show detailed field diffs")

    # push
    p_push = sub.add_parser("push", help="Push local → cloud")
    p_push.add_argument("--table", help="Push specific table only")
    p_push.add_argument("--confirm", action="store_true", help="Confirm and execute (no dry-run)")
    p_push.add_argument("--dry-run", action="store_true", default=True, help=argparse.SUPPRESS)

    # pull
    p_pull = sub.add_parser("pull", help="Pull cloud → local")
    p_pull.add_argument("--table", help="Pull specific table only")
    p_pull.add_argument("--confirm", action="store_true", help="Confirm and execute (no dry-run)")
    p_pull.add_argument("--dry-run", action="store_true", default=True, help=argparse.SUPPRESS)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Ensure we're in the right directory
    if not os.path.exists(LOCAL_DB):
        print(f"{red('Error')}: Local DB not found at {LOCAL_DB}")
        print(f"  Run this script from darling-dupe-maker/ directory")
        sys.exit(1)

    if args.command == "compare":
        totals = cmd_compare(args)
        # Exit non-zero if differences found (useful for CI)
        if totals["local_only"] or totals["cloud_only"] or totals["modified"]:
            sys.exit(2)

    elif args.command == "push":
        cmd_push(args)

    elif args.command == "pull":
        cmd_pull(args)


if __name__ == "__main__":
    main()
