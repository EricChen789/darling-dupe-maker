#!/usr/bin/env python3
"""
下載 Lovable Cloud 完整備份 (所有 tables + storage files)
透過 export-all edge function，免 service role key。

使用方式:
  pip install requests
  export LOVABLE_EMAIL="admin@example.com"
  export LOVABLE_PASSWORD="your-password"
  python download_backup.py [輸出路徑.zip]

需求: 該帳號必須在 user_roles 表有 admin 角色。
"""
import os
import sys
from pathlib import Path
import requests

SUPABASE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxY3NnbW1zcmd0bGNxdXRhb21nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMTA2NzYsImV4cCI6MjA4NTU4NjY3Nn0."
    "AWo97hF1eOJ43H4_deUplIS8Y7ckSIxWmw-7TlX9GY4"
)

EMAIL = os.environ.get("LOVABLE_EMAIL")
PASSWORD = os.environ.get("LOVABLE_PASSWORD")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "./backup.zip")

if not EMAIL or not PASSWORD:
    sys.exit("❌ 請先設定 LOVABLE_EMAIL 與 LOVABLE_PASSWORD 環境變數")

# 1) 用 email/password 登入取得 JWT
print(f"🔐 登入 {EMAIL} ...")
auth_resp = requests.post(
    f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
    headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
    json={"email": EMAIL, "password": PASSWORD},
)
if auth_resp.status_code != 200:
    sys.exit(f"❌ 登入失敗: {auth_resp.status_code} {auth_resp.text}")
access_token = auth_resp.json()["access_token"]
print("✅ 登入成功，取得 JWT")

# 2) 調用 export-all edge function
print("📦 呼叫 export-all edge function (可能需要數分鐘)...")
resp = requests.post(
    f"{SUPABASE_URL}/functions/v1/export-all",
    headers={
        "Authorization": f"Bearer {access_token}",
        "apikey": ANON_KEY,
    },
    stream=True,
    timeout=1800,  # 30 分鐘 timeout
)
if resp.status_code != 200:
    sys.exit(f"❌ Edge function 錯誤: {resp.status_code} {resp.text}")

# 3) 串流寫入本地 ZIP
total = 0
with open(OUT, "wb") as f:
    for chunk in resp.iter_content(chunk_size=8192):
        f.write(chunk)
        total += len(chunk)
        print(f"\r📥 已下載: {total / 1024 / 1024:.1f} MB", end="", flush=True)

print(f"\n✅ 備份完成: {OUT} ({total / 1024 / 1024:.1f} MB)")
