#!/usr/bin/env python
"""Sync local SQLite data to remote Cloudflare D1 database using --file approach."""
import sqlite3
import subprocess
import os
import sys
import tempfile

# Force UTF-8
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

os.chdir("D:/myproject/darling-dupe-maker")
LOCAL_DB = "local-server/local.db"
WRANGLER = "npx wrangler d1 execute secretary-db --remote"

# Only sync tables that need it (skip already-done ones)
# Run with no args = sync all. Run with args = sync only those tables.
TARGET_TABLES = sys.argv[1:] if len(sys.argv) > 1 else None

def get_tables():
    db = sqlite3.connect(LOCAL_DB)
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).fetchall()]
    db.close()
    return tables

def get_local_data(table):
    db = sqlite3.connect(LOCAL_DB)
    db.row_factory = sqlite3.Row
    try:
        rows = db.execute(f"SELECT * FROM \"{table}\"").fetchall()
        if rows:
            return [dict(r) for r in rows], list(rows[0].keys())
        return [], []
    except Exception as e:
        print(f"  [SKIP] {table}: {e}")
        return None, None
    finally:
        db.close()

def escape_sql(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"

def sync_table(table):
    data, cols = get_local_data(table)
    if data is None:
        return True
    if not data:
        print(f"  {table}: empty, skip")
        return True

    col_list = ", ".join(f'"{c}"' for c in cols)
    total = len(data)

    tmpfile = os.path.join(tempfile.gettempdir(), f"_d1sync_{table}.sql")

    # Write all SQL to a single file (DELETE + INSERTs)
    lines = [f'DELETE FROM "{table}";']
    for row in data:
        values = ", ".join(escape_sql(row[c]) for c in cols)
        lines.append(f'INSERT INTO "{table}" ({col_list}) VALUES ({values});')

    # Split into chunks of 30 statements
    chunk_size = 30
    try:
        for chunk_start in range(0, len(lines), chunk_size):
            chunk = lines[chunk_start:chunk_start+chunk_size]
            with open(tmpfile, 'w', encoding='utf-8') as f:
                f.write('\n'.join(chunk))

            r = subprocess.run(
                f'{WRANGLER} --file="{tmpfile}"',
                shell=True, capture_output=True, text=True, encoding='utf-8', errors='replace'
            )

            if r.returncode != 0:
                print(f"    ERR code={r.returncode}: {(r.stderr or '')[:200]}")
                return False

            row_progress = min(chunk_start + chunk_size - 1, total)
            print(f"    {row_progress}/{total}")
    finally:
        try:
            os.unlink(tmpfile)
        except:
            pass

    print(f"  {table}: OK {total}")
    return True

def main():
    print("=== Sync local DB -> Cloud D1 (secretary-db) ===\n")
    tables = TARGET_TABLES if TARGET_TABLES else get_tables()
    print(f"Tables to sync: {tables}\n")

    ok = 0
    fail = 0
    for table in tables:
        if sync_table(table):
            ok += 1
        else:
            fail += 1

    print(f"\n=== Done: {ok} OK, {fail} FAIL ===")

if __name__ == "__main__":
    main()
