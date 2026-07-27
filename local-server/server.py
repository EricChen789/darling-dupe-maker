#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Local API server for darling-dupe-maker
Mimics Cloudflare Pages Functions API with SQLite
Dev mode: no auth required for any operation
"""
import sqlite3
import uuid
import hashlib
import hmac
import json
import os
import re
import time
import base64
import smtplib
import threading
import urllib.request
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, g, Response
from fpdf import FPDF, XPos, YPos

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), 'local.db')
JWT_SECRET = 'local-dev-secret-do-not-use-in-production'

# ─── Database ───
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db

@app.teardown_appcontext
def close_db(e):
    db = g.pop('db', None)
    if db:
        db.close()

# ─── CORS ───
@app.after_request
def cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, apikey'
    return resp

# ─── JWT ───
def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

JWT_TTL_SECONDS = 7 * 24 * 60 * 60  # token 有效期 7 天（配合 verify_jwt 的 exp 檢查）

def sign_jwt(payload: dict) -> str:
    header = base64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    now = int(time.time())
    p = {"exp": now + JWT_TTL_SECONDS, **payload, "iat": now}
    payload_b64 = base64url(json.dumps(p).encode())
    sig = hmac.new(JWT_SECRET.encode(), f"{header}.{payload_b64}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload_b64}.{base64url(sig)}"

def verify_jwt(token: str) -> dict | None:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts
        expected_sig = base64url(hmac.new(JWT_SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest())
        if sig_b64 != expected_sig:
            return None
        # Fix padding for base64 decode
        payload_b64 = payload_b64 + '=' * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        if payload.get('exp') and payload['exp'] < time.time():
            return None
        return payload
    except Exception as e:
        print(f"[JWT] Verification failed: {e}")
        return None

# ─── Password ───
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000, dklen=32)
    return f"{base64url(salt)}:{base64url(key)}"

def verify_password(password: str, stored: str) -> bool:
    try:
        salt_b64, hash_b64 = stored.split(':')
        salt = base64.urlsafe_b64decode(salt_b64 + '=' * (4 - len(salt_b64) % 4))
        key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000, dklen=32)
        return base64url(key) == hash_b64
    except (ValueError, TypeError) as e:
        print(f"[AUTH] Password verification error: {e}")
        return False

# ─── Auth (dev mode: always returns admin) ───
def get_user():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return None
    payload = verify_jwt(token)
    if not payload:
        return None
    return {
        'id': payload['sub'],
        'email': payload['email'],
        'display_name': payload.get('display_name', ''),
        'role': payload.get('role', 'user'),
    }

# ─── Init DB ───
def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS auth_users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS user_roles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (user_id, role)
        );

        CREATE TABLE IF NOT EXISTS company_versions (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            version_no INTEGER NOT NULL DEFAULT 1,
            snapshot TEXT NOT NULL DEFAULT '{}',
            changed_fields TEXT NOT NULL DEFAULT '[]',
            change_summary TEXT DEFAULT '',
            changed_by TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS companies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            chinese_name TEXT DEFAULT '',
            company_number TEXT DEFAULT '',
            trading_name TEXT DEFAULT '',
            business_nature TEXT DEFAULT '',
            company_type TEXT DEFAULT '私人公司 Private company',
            business_code TEXT DEFAULT '',
            company_group TEXT DEFAULT '',
            quorum TEXT DEFAULT '',
            register_date TEXT DEFAULT '',
            reg_flat TEXT DEFAULT '',
            reg_building TEXT DEFAULT '',
            reg_street TEXT DEFAULT '',
            reg_district TEXT DEFAULT '',
            reg_region TEXT DEFAULT '香港 Hong Kong',
            incorporation_date TEXT DEFAULT '',
            jurisdiction TEXT DEFAULT 'Hong Kong',
            ci_file_path TEXT DEFAULT '',
            br_file_path TEXT DEFAULT '',
            preferred_presenter_id TEXT,
            presenter_reference TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            ci_number TEXT DEFAULT '',
            email TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            signer_role_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS officers (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            name_english TEXT NOT NULL DEFAULT '',
            name_chinese TEXT DEFAULT '',
            identity TEXT NOT NULL DEFAULT 'natural',
            role TEXT NOT NULL CHECK (role IN ('director', 'secretary')),
            id_number TEXT DEFAULT '',
            address TEXT DEFAULT '',
            date_appointed TEXT DEFAULT '',
            date_ceased TEXT DEFAULT '',
            place_incorporated TEXT DEFAULT '',
            company_number_ref TEXT DEFAULT '',
            service_address TEXT DEFAULT '',
            passport_number TEXT DEFAULT '',
            passport_expiry TEXT DEFAULT '',
            whatsapp TEXT DEFAULT '',
            email TEXT DEFAULT '',
            passport_file_path TEXT DEFAULT '',
            id_card_file_path TEXT DEFAULT '',
            address_proof_file_path TEXT DEFAULT '',
            tcsp_number TEXT DEFAULT '',
            previous_name_chinese TEXT DEFAULT '',
            previous_name_english TEXT DEFAULT '',
            alias_chinese TEXT DEFAULT '',
            alias_english TEXT DEFAULT '',
            date_of_birth TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS shareholders (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            name TEXT NOT NULL DEFAULT '',
            shares INTEGER NOT NULL DEFAULT 0,
            identity TEXT NOT NULL DEFAULT 'natural',
            id_number TEXT DEFAULT '',
            name_chinese TEXT DEFAULT '',
            name_english TEXT DEFAULT '',
            address TEXT DEFAULT '',
            email TEXT DEFAULT '',
            share_type TEXT DEFAULT '',
            service_address TEXT DEFAULT '',
            issue_price TEXT DEFAULT '',
            currency TEXT DEFAULT 'HKD',
            paid_up TEXT DEFAULT '',
            unpaid TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS persons (
            id TEXT PRIMARY KEY,
            identity TEXT NOT NULL DEFAULT 'natural',
            name_english TEXT NOT NULL DEFAULT '',
            name_chinese TEXT DEFAULT '',
            previous_name_english TEXT DEFAULT '',
            previous_name_chinese TEXT DEFAULT '',
            alias_english TEXT DEFAULT '',
            alias_chinese TEXT DEFAULT '',
            id_number TEXT DEFAULT '',
            passport_number TEXT DEFAULT '',
            passport_expiry TEXT DEFAULT '',
            passport_country TEXT DEFAULT '',
            address TEXT DEFAULT '',
            service_address TEXT DEFAULT '',
            addr_flat TEXT DEFAULT '',
            addr_building TEXT DEFAULT '',
            addr_street TEXT DEFAULT '',
            addr_district TEXT DEFAULT '',
            addr_region TEXT DEFAULT '',
            svc_addr_flat TEXT DEFAULT '',
            svc_addr_building TEXT DEFAULT '',
            svc_addr_street TEXT DEFAULT '',
            svc_addr_district TEXT DEFAULT '',
            svc_addr_region TEXT DEFAULT '',
            email TEXT DEFAULT '',
            whatsapp TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            place_incorporated TEXT DEFAULT '',
            company_number_ref TEXT DEFAULT '',
            tcsp_number TEXT DEFAULT '',
            passport_file_path TEXT DEFAULT '',
            id_card_file_path TEXT DEFAULT '',
            address_proof_file_path TEXT DEFAULT '',
            normalized_key TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            date_of_birth TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS person_company_roles (
            id TEXT PRIMARY KEY,
            person_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            role TEXT NOT NULL,
            date_appointed TEXT DEFAULT '',
            date_ceased TEXT DEFAULT '',
            service_address_override TEXT DEFAULT '',
            shares INTEGER DEFAULT 0,
            share_type TEXT DEFAULT '',
            currency TEXT DEFAULT 'HKD',
            issue_price TEXT DEFAULT '',
            paid_up TEXT DEFAULT '',
            unpaid TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            is_reserve INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS presenters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT DEFAULT '',
            contact TEXT DEFAULT '',
            type TEXT NOT NULL DEFAULT 'individual',
            phone TEXT DEFAULT '',
            fax TEXT DEFAULT '',
            email TEXT DEFAULT '',
            reference TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS significant_controllers (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            identity TEXT NOT NULL DEFAULT 'natural',
            name_english TEXT NOT NULL DEFAULT '',
            name_chinese TEXT DEFAULT '',
            id_number TEXT DEFAULT '',
            address TEXT DEFAULT '',
            service_address TEXT DEFAULT '',
            date_became TEXT DEFAULT '',
            date_ceased TEXT DEFAULT '',
            nature_shares INTEGER DEFAULT 0,
            nature_voting INTEGER DEFAULT 0,
            nature_appoint INTEGER DEFAULT 0,
            nature_influence INTEGER DEFAULT 0,
            nature_trust INTEGER DEFAULT 0,
            nature_other TEXT DEFAULT '',
            is_designated_rep INTEGER DEFAULT 0,
            designated_rep_name TEXT DEFAULT '',
            designated_rep_contact TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS company_logs (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            company_name_hint TEXT DEFAULT '',
            source_folder TEXT DEFAULT '',
            doc_type TEXT DEFAULT '',
            original_filename TEXT DEFAULT '',
            storage_path TEXT DEFAULT '',
            html_content TEXT DEFAULT '',
            text_content TEXT DEFAULT '',
            doc_date TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            company_id TEXT,
            reminder_type TEXT DEFAULT 'NAR1',
            title TEXT DEFAULT '',
            due_date TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            notes TEXT DEFAULT '',
            notified_at TEXT DEFAULT NULL,
            completed_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS resolutions (
            id TEXT PRIMARY KEY,
            company_id TEXT,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            resolution_type TEXT DEFAULT '',
            resolution_date TEXT DEFAULT '',
            signers TEXT DEFAULT '',
            is_ai_generated INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS secretary_templates (
            id TEXT PRIMARY KEY,
            label TEXT DEFAULT '',
            identity TEXT DEFAULT 'corporate',
            name_english TEXT DEFAULT '',
            name_chinese TEXT DEFAULT '',
            id_number TEXT DEFAULT '',
            br_number TEXT DEFAULT '',
            tcsp_number TEXT DEFAULT '',
            place_incorporated TEXT DEFAULT '',
            address TEXT DEFAULT '',
            service_address TEXT DEFAULT '',
            email TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            is_default INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS share_transactions (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            transaction_date TEXT NOT NULL DEFAULT '',
            transaction_type TEXT NOT NULL DEFAULT 'transfer',
            from_person_id TEXT,
            from_name TEXT DEFAULT '',
            to_person_id TEXT,
            to_name TEXT DEFAULT '',
            shares INTEGER NOT NULL DEFAULT 0,
            share_type TEXT DEFAULT '',
            currency TEXT DEFAULT 'HKD',
            price_per_share TEXT DEFAULT '',
            total_consideration TEXT DEFAULT '',
            instrument_number TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            invoice_number TEXT DEFAULT '',
            description TEXT DEFAULT '',
            amount REAL NOT NULL DEFAULT 0,
            currency TEXT DEFAULT 'HKD',
            status TEXT DEFAULT 'pending',
            issue_date TEXT DEFAULT '',
            due_date TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS email_templates (
            id TEXT PRIMARY KEY,
            name TEXT DEFAULT '',
            template_type TEXT DEFAULT 'general',
            subject TEXT DEFAULT '',
            body TEXT DEFAULT '',
            is_default INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS email_logs (
            id TEXT PRIMARY KEY,
            company_id TEXT,
            template_id TEXT,
            to_email TEXT DEFAULT '',
            cc_email TEXT DEFAULT '',
            subject TEXT DEFAULT '',
            body TEXT DEFAULT '',
            status TEXT DEFAULT 'sent',
            scheduled_at TEXT DEFAULT NULL,
            sent_at TEXT DEFAULT NULL,
            error TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    db.commit()

    # Seed admin user if not exists
    admin = db.execute("SELECT id FROM auth_users WHERE email = 'admin@localhost'").fetchone()
    if not admin:
        uid = str(uuid.uuid4())
        pwd_hash = hash_password('admin123')
        db.execute("INSERT INTO auth_users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
                   (uid, 'admin@localhost', pwd_hash, 'Admin'))
        db.execute("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)",
                   (str(uuid.uuid4()), uid, 'admin'))
        db.commit()
        print(f"[INIT] Created admin user: admin@localhost / admin123")
    db.close()

# ─── Font & PDF helpers ───
FONT_PATH = os.path.join(os.path.dirname(__file__), 'NotoSansTC-Regular.otf')
FONT_URL = "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansTC-Regular.otf"
SYSTEM_FONT_FALLBACKS = [
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/STXIHEI.TTF",
    "C:/Windows/Fonts/STKAITI.TTF",
    "C:/Windows/Fonts/STSONG.TTF",
    "C:/Windows/Fonts/simkai.ttf",
]
_cached_font_path = None

def find_font():
    """Find an available CJK font. Returns path or None. Caches result."""
    global _cached_font_path
    if _cached_font_path:
        return _cached_font_path

    # 1. Downloaded font
    if os.path.exists(FONT_PATH) and os.path.getsize(FONT_PATH) > 10000:
        _cached_font_path = FONT_PATH
        return FONT_PATH

    # 2. Try to download
    try:
        req = urllib.request.Request(FONT_URL, headers={'User-Agent': 'Mozilla/5.0'})
        urllib.request.urlretrieve(FONT_URL, FONT_PATH)
        if os.path.exists(FONT_PATH) and os.path.getsize(FONT_PATH) > 10000:
            print(f"[FONT] Downloaded Noto Sans TC ({os.path.getsize(FONT_PATH)} bytes)")
            _cached_font_path = FONT_PATH
            return FONT_PATH
    except Exception as e:
        print(f"[FONT] Download failed: {e}")

    # 3. Fall back to Windows system CJK fonts
    for f in SYSTEM_FONT_FALLBACKS:
        if os.path.exists(f):
            print(f"[FONT] Using system font: {f}")
            _cached_font_path = f
            return f

    print("[FONT] WARNING: No CJK font found, PDF will have no Chinese text!")
    return None

def create_pdf(landscape=False):
    """Create an fpdf2 FPDF instance with Chinese font (cached) + Times New Roman."""
    orient = 'L' if landscape else 'P'
    font_path = find_font()
    pdf = FPDF(orientation=orient, unit='pt', format='A4')
    if font_path:
        try:
            pdf.add_font('TC', style='', fname=font_path)
            pdf.add_font('TC', style='B', fname=font_path)
        except Exception as e:
            print(f"[PDF] Failed to load font {font_path}: {e}")
    # Register Times New Roman for English text (Paul Tang reference style)
    tnr_dir = 'C:/Windows/Fonts'
    for style_name, fname in [('', 'times.ttf'), ('B', 'timesbd.ttf'), ('I', 'timesi.ttf'), ('BI', 'timesbi.ttf')]:
        tnr_path = os.path.join(tnr_dir, fname)
        if os.path.exists(tnr_path):
            try:
                pdf.add_font('TNR', style=style_name, fname=tnr_path)
            except Exception:
                pass
    if not font_path:
        pdf.set_font('Helvetica', size=10)
    pdf.set_auto_page_break(auto=True, margin=60)
    return pdf

def pdf_draw(pdf, text, x, y, size=10, gray=0, color=None, bold=False):
    """Draw text at absolute position. color=(r,g,b) or None=black; gray=int 0-255 fallback."""
    pdf.set_xy(x, y)
    style = 'B' if bold else ''
    pdf.set_font('TC', style, size=size)
    if color:
        pdf.set_text_color(*color)
    elif gray != 0:
        pdf.set_text_color(gray, gray, gray)
    else:
        pdf.set_text_color(0, 0, 0)
    pdf.cell(0, size + 2, text or '', new_x="LMARGIN", new_y="NEXT")


def pdf_draw_field(pdf, label, value, x_label, x_value, y, value_width, size=9, label_gray=100, line_height=None):
    """Draw a label-value pair with manual multi-line wrapping for long values.

    Returns the new y position after drawing.
    Uses cell() for all text — no multi_cell, to avoid font/page-break issues.
    """
    if line_height is None:
        line_height = size + 3

    pdf.set_font('TC', size=size)
    text = value or '-'

    # Measure how many lines this value needs
    tw = pdf.get_string_width(text)
    lines = max(1, -(-tw // value_width))  # ceiling division

    # Draw label with cell() at (x_label, y)
    pdf.set_xy(x_label, y)
    pdf.set_font('TC', size=size)
    pdf.set_text_color(label_gray, label_gray, label_gray)
    pdf.cell(0, line_height, label)

    # Draw value — manual line-wrapping via multiple cell() calls
    pdf.set_font('TC', size=size)
    pdf.set_text_color(0, 0, 0)

    if lines == 1:
        pdf.set_xy(x_value, y)
        pdf.cell(value_width, line_height, text)
    else:
        # Split text into lines that fit within value_width.
        # Walk character by character, measuring cumulative width.
        wrapped_lines = []
        current = ''
        for ch in text:
            trial = current + ch
            if pdf.get_string_width(trial) > value_width and current:
                wrapped_lines.append(current)
                current = ch
            else:
                current = trial
        if current:
            wrapped_lines.append(current)
        # Ensure we have at least `lines` entries (safety)
        while len(wrapped_lines) < lines:
            wrapped_lines.append('')

        for i, line_text in enumerate(wrapped_lines):
            if i >= lines:
                break
            pdf.set_xy(x_value, y + i * line_height)
            pdf.cell(value_width, line_height, line_text)

    return y + lines * line_height

def seed_gray(val):
    """Convert 0-1 float to 0-255 int for fpdf2."""
    return int(round(val * 255))

def rget(row, key, default=''):
    """Safely get value from sqlite3.Row or dict."""
    try:
        val = row[key]
        return val if val is not None else default
    except (KeyError, IndexError):
        return default

# ─── Auto-migration ───
def auto_migrate():
    """Add missing columns to existing tables (handles schema evolution)."""
    db = sqlite3.connect(DB_PATH)

    def ensure_columns(table, columns):
        """Ensure all columns exist in table. columns is {col_name: col_type}."""
        try:
            rows = db.execute(f"PRAGMA table_info({table})").fetchall()
            existing = {row[1] for row in rows}
        except sqlite3.OperationalError:
            return  # table doesn't exist yet
        for col, col_type in columns.items():
            if col not in existing:
                try:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                    print(f"[MIGRATE] Added {table}.{col}")
                except sqlite3.OperationalError as e:
                    print(f"[MIGRATE] Skip {table}.{col}: {e}")

    # officers: add updated_at (P3-1)
    ensure_columns('officers', {
        'updated_at': "TEXT NOT NULL DEFAULT (datetime('now'))",
    })

    # persons: split address fields (NP-05 地址分拆欄位) — 通訊 addr_* + 送達 svc_addr_*
    ensure_columns('persons', {
        'addr_flat': "TEXT DEFAULT ''",
        'addr_building': "TEXT DEFAULT ''",
        'addr_street': "TEXT DEFAULT ''",
        'addr_district': "TEXT DEFAULT ''",
        'addr_region': "TEXT DEFAULT ''",
        'svc_addr_flat': "TEXT DEFAULT ''",
        'svc_addr_building': "TEXT DEFAULT ''",
        'svc_addr_street': "TEXT DEFAULT ''",
        'svc_addr_district': "TEXT DEFAULT ''",
        'svc_addr_region': "TEXT DEFAULT ''",
    })

    # shareholders: add updated_at (P3-1)
    ensure_columns('shareholders', {
        'updated_at': "TEXT NOT NULL DEFAULT (datetime('now'))",
    })

    # user_roles: add updated_at (P3-1) — use simple default for SQLite compat
    ensure_columns('user_roles', {
        'updated_at': "TEXT DEFAULT ''",
    })

    # auth_users: add is_active (P1 — 停用/啟用用户，10.3)
    ensure_columns('auth_users', {
        'is_active': "INTEGER NOT NULL DEFAULT 1",
    })

    # resolutions: add 4 missing columns (P0-2)
    ensure_columns('resolutions', {
        'resolution_date': "TEXT DEFAULT ''",
        'signers': "TEXT DEFAULT ''",
        'is_ai_generated': "INTEGER DEFAULT 0",
        'notes': "TEXT DEFAULT ''",
    })

    # secretary_templates: replace old schema with new one (P0-1)
    try:
        rows = db.execute("PRAGMA table_info(secretary_templates)").fetchall()
        existing = {row[1] for row in rows}
    except sqlite3.OperationalError:
        existing = set()

    if 'name' in existing and 'label' not in existing:
        # Old schema detected — add all new columns
        new_columns = {
            'label': "TEXT DEFAULT ''",
            'identity': "TEXT DEFAULT 'corporate'",
            'name_english': "TEXT DEFAULT ''",
            'name_chinese': "TEXT DEFAULT ''",
            'id_number': "TEXT DEFAULT ''",
            'br_number': "TEXT DEFAULT ''",
            'tcsp_number': "TEXT DEFAULT ''",
            'place_incorporated': "TEXT DEFAULT ''",
            'address': "TEXT DEFAULT ''",
            'service_address': "TEXT DEFAULT ''",
            'email': "TEXT DEFAULT ''",
            'phone': "TEXT DEFAULT ''",
            'is_default': "INTEGER DEFAULT 0",
        }
        for col, col_type in new_columns.items():
            if col not in existing:
                try:
                    db.execute(f"ALTER TABLE secretary_templates ADD COLUMN {col} {col_type}")
                    print(f"[MIGRATE] Added secretary_templates.{col}")
                except sqlite3.OperationalError as e:
                    print(f"[MIGRATE] Skip secretary_templates.{col}: {e}")
        # Migrate data: copy name→label, content→(unused, keep as-is)
        try:
            count = db.execute("UPDATE secretary_templates SET label = COALESCE(name, '') WHERE label = '' OR label IS NULL").rowcount
            if count:
                print(f"[MIGRATE] Migrated {count} secretary_templates rows: name→label")
        except sqlite3.OperationalError as e:
            print(f"[MIGRATE] Data migration skip: {e}")

    # share_transactions: add columns that the frontend (RegistersTab) expects
    tx_columns = {
        'from_person_id': 'TEXT',
        'from_name': "TEXT DEFAULT ''",
        'to_person_id': 'TEXT',
        'to_name': "TEXT DEFAULT ''",
        'share_type': "TEXT DEFAULT ''",
        'currency': "TEXT DEFAULT 'HKD'",
        'price_per_share': "TEXT DEFAULT ''",
        'total_consideration': "TEXT DEFAULT ''",
        'instrument_number': "TEXT DEFAULT ''",
        'updated_at': "TEXT NOT NULL DEFAULT (datetime('now'))",
    }
    ensure_columns('share_transactions', tx_columns)

    # email_logs: add email_type column (EM-04/05)
    ensure_columns('email_logs', {'email_type': "TEXT DEFAULT 'general'"})

    db.commit()

    # Seed default email templates if none exist (Email Module 8.1)
    try:
        cnt = db.execute("SELECT COUNT(*) FROM email_templates").fetchone()[0]
    except sqlite3.OperationalError:
        cnt = None
    if cnt == 0:
        seeds = [
            ('invoice', '發票通知', '【{company_name}】服務發票 {invoice_number}',
             '致 {client_name}：\n\n茲附上貴公司 {company_name}（商業登記號碼：{br_number}）的服務發票。\n\n發票編號：{invoice_number}\n金額：{currency} {amount}\n到期日：{due_date}\n\n請於到期日前安排付款，如有查詢歡迎與我們聯絡。\n\n此致\n{sender_name}\n{today}'),
            ('collection', '客户資料收集', '【{company_name}】周年申報所需資料',
             '致 {client_name}：\n\n為辦理貴公司 {company_name} 的周年申報（NAR1），現需向  閣下收集以下資料：\n\n1. 各董事及股東之身份證明文件副本\n2. 最新之註冊辦事處地址證明\n3. 股本結構如有變動之詳情\n\n煩請於 {due_date} 前回覆，以便我們準時辦理。\n\n此致\n{sender_name}\n{today}'),
            ('reminder', '周年申報到期提醒', '【提醒】{company_name} 周年申報將於 {due_date} 到期',
             '致 {client_name}：\n\n謹此提醒，貴公司 {company_name}（商業登記號碼：{br_number}）的周年申報表（NAR1）將於 {due_date} 到期。\n\n請盡快與我們聯絡以安排辦理，避免逾期罰款。\n\n此致\n{sender_name}\n{today}'),
        ]
        for ttype, name, subject, body in seeds:
            db.execute(
                "INSERT INTO email_templates (id, name, template_type, subject, body, is_default) VALUES (?, ?, ?, ?, ?, 1)",
                (str(uuid.uuid4()), name, ttype, subject, body))
        db.commit()
        print(f"[MIGRATE] Seeded {len(seeds)} default email templates")

    # Seed sample email logs for EM-04/05/06 screenshots (if none exist)
    try:
        log_cnt = db.execute("SELECT COUNT(*) FROM email_logs").fetchone()[0]
    except sqlite3.OperationalError:
        log_cnt = None
    if log_cnt == 0:
        # Get first company & template ids
        company = db.execute("SELECT id, name, email FROM companies LIMIT 1").fetchone()
        cid = company[0] if company else None
        templates = {r[0]: r[1] for r in db.execute("SELECT template_type, id FROM email_templates").fetchall()}
        now = datetime.now(timezone.utc).isoformat()
        # EM-04: sent invoice email
        if cid and 'invoice' in templates:
            db.execute(
                "INSERT INTO email_logs (id, company_id, template_id, to_email, subject, body, status, sent_at, email_type) "
                "VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, 'invoice')",
                (str(uuid.uuid4()), cid, templates['invoice'], 'client@example.com',
                 '【PAUL TANG AND COMPANY LIMITED】服務發票 INV-2026-0042',
                 '致 Tang Siu Fan：\n\n茲附上貴公司 PAUL TANG AND COMPANY LIMITED（商業登記號碼：07281051）的服務發票。\n\n發票編號：INV-2026-0042\n金額：HKD 8,500.00\n到期日：2026/07/15\n\n請於到期日前安排付款，如有查詢歡迎與我們聯絡。\n\n此致\nMuse Labs 公司秘書\n2026/07/05',
                 now))
        # EM-05: sent collection email
        if cid and 'collection' in templates:
            db.execute(
                "INSERT INTO email_logs (id, company_id, template_id, to_email, subject, body, status, sent_at, email_type) "
                "VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, 'collection')",
                (str(uuid.uuid4()), cid, templates['collection'], 'client@example.com',
                 '【PAUL TANG AND COMPANY LIMITED】周年申報所需資料',
                 '致 Tang Siu Fan：\n\n為辦理貴公司 PAUL TANG AND COMPANY LIMITED 的周年申報（NAR1），現需向 閣下收集以下資料：\n\n1. 各董事及股東之身份證明文件副本\n2. 最新之註冊辦事處地址證明\n3. 股本結構如有變動之詳情\n\n煩請於 2026/07/20 前回覆，以便我們準時辦理。\n\n此致\nMuse Labs 公司秘書\n2026/07/03',
                 now))
        # EM-06: scheduled reminder (future)
        if cid and 'reminder' in templates:
            future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
            db.execute(
                "INSERT INTO email_logs (id, company_id, template_id, to_email, subject, body, status, scheduled_at, email_type) "
                "VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, 'reminder')",
                (str(uuid.uuid4()), cid, templates['reminder'], 'client@example.com',
                 '【提醒】PAUL TANG AND COMPANY LIMITED 周年申報將於 2026/07/31 到期',
                 '致 Tang Siu Fan：\n\n謹此提醒，貴公司 PAUL TANG AND COMPANY LIMITED（商業登記號碼：07281051）的周年申報表（NAR1）將於 2026/07/31 到期。\n\n請盡快與我們聯絡以安排辦理，避免逾期罰款。\n\n此致\nMuse Labs 公司秘書\n2026/07/09',
                 future))
        db.commit()
        after_cnt = db.execute("SELECT COUNT(*) FROM email_logs").fetchone()[0]
        print(f"[MIGRATE] Seeded {after_cnt} sample email logs (invoice/collection/reminder)")

    # Seed baseline (v1) version snapshot for any company that has none (VE-01)
    try:
        company_ids = [r[0] for r in db.execute("SELECT id FROM companies").fetchall()]
        seeded = 0
        for cid in company_ids:
            has = db.execute(
                "SELECT COUNT(*) FROM company_versions WHERE company_id = ?", (cid,)
            ).fetchone()[0]
            if has == 0:
                cols = [c[1] for c in db.execute("PRAGMA table_info(companies)").fetchall()]
                row = db.execute("SELECT * FROM companies WHERE id = ?", (cid,)).fetchone()
                d = dict(zip(cols, row))
                snap = {k: (d.get(k) if d.get(k) is not None else '') for k in VERSION_FIELDS}
                db.execute(
                    "INSERT INTO company_versions (id, company_id, version_no, snapshot, changed_fields, change_summary) "
                    "VALUES (?, ?, 1, ?, '[]', '建立初始版本')",
                    (str(uuid.uuid4()), cid, json.dumps(snap, ensure_ascii=False)))
                seeded += 1
        if seeded:
            db.commit()
            print(f"[MIGRATE] Seeded baseline versions for {seeded} companies")
    except sqlite3.OperationalError as e:
        print(f"[MIGRATE] Baseline version seed skip: {e}")

    db.close()

# ─── Email module ───
# Priority: Resend API > SMTP > simulated
# - RESEND_API_KEY: use Resend API (free 100/day, onboarding@resend.dev)
# - SMTP_HOST: use SMTP (legacy)
# - neither: simulated (log only, no real send)
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
# Fallback: read from local file (Windows env var propagation can be flaky with Flask reloader)
if not RESEND_API_KEY:
    _key_file = os.path.join(os.path.dirname(__file__), '.resend_key')
    if os.path.exists(_key_file):
        with open(_key_file, 'r') as f:
            RESEND_API_KEY = f.read().strip()
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASS = os.environ.get('SMTP_PASS', '')
SMTP_FROM = os.environ.get('SMTP_FROM', SMTP_USER or 'no-reply@muselabs.local')
SMTP_FROM_NAME = os.environ.get('SMTP_FROM_NAME', 'Muse Labs 公司秘書')


def substitute_vars(text, variables):
    """Replace {key} placeholders with values (unknown placeholders left intact)."""
    if not text:
        return ''
    def repl(m):
        key = m.group(1)
        return str(variables.get(key, m.group(0)))
    return re.sub(r'\{([a-zA-Z_][a-zA-Z0-9_]*)\}', repl, text)


def deliver_email(to_email, subject, body, cc_email=''):
    """Send an email via Resend API > SMTP > simulated.
    Returns (ok: bool, error: str, simulated: bool)."""
    if not to_email:
        return False, 'Missing recipient', False

    # ── Resend API (preferred) ──
    if RESEND_API_KEY:
        try:
            payload = {
                'from': f'{SMTP_FROM_NAME} <onboarding@resend.dev>',
                'to': [to_email],
                'subject': subject,
                'html': body.replace('\n', '<br>'),
            }
            if cc_email:
                payload['cc'] = [cc_email]
            resp = requests.post(
                'https://api.resend.com/emails',
                json=payload,
                headers={
                    'Authorization': f'Bearer {RESEND_API_KEY}',
                    'Content-Type': 'application/json',
                },
                timeout=15,
            )
            if resp.ok:
                print(f"[EMAIL:RESEND] to={to_email} subject={subject!r} id={resp.json().get('id','?')}")
                return True, '', False
            else:
                err = f'Resend HTTP {resp.status_code}: {resp.text[:300]}'
                print(f"[EMAIL:FAILED] to={to_email}: {err}")
                return False, err, False
        except Exception as e:
            print(f"[EMAIL:FAILED] to={to_email}: {e}")
            return False, str(e), False

    # ── SMTP (legacy) ──
    if SMTP_HOST:
        try:
            msg = MIMEMultipart()
            msg['From'] = formataddr((SMTP_FROM_NAME, SMTP_FROM))
            msg['To'] = to_email
            if cc_email:
                msg['Cc'] = cc_email
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain', 'utf-8'))
            recipients = [e.strip() for e in (to_email + ',' + cc_email).split(',') if e.strip()]
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
                s.starttls()
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASS)
                s.sendmail(SMTP_FROM, recipients, msg.as_string())
            print(f"[EMAIL:SMTP] to={to_email} subject={subject!r}")
            return True, '', False
        except Exception as e:
            print(f"[EMAIL:FAILED] to={to_email}: {e}")
            return False, str(e), False

    # ── Simulated (no backend configured) ──
    print(f"[EMAIL:SIMULATED] to={to_email} cc={cc_email} subject={subject!r}")
    return True, '', True


def process_scheduled_emails():
    """Send any scheduled emails whose scheduled_at has passed. Called by the
    background scheduler thread. Uses its own connection (runs off-request)."""
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
        due = db.execute(
            "SELECT * FROM email_logs WHERE status = 'scheduled' AND scheduled_at IS NOT NULL "
            "AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 50",
            (now,)
        ).fetchall()
        for row in due:
            ok, err, _sim = deliver_email(row['to_email'], row['subject'], row['body'], row['cc_email'] or '')
            db.execute(
                "UPDATE email_logs SET status = ?, sent_at = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
                ('sent' if ok else 'failed', datetime.now(timezone.utc).isoformat() if ok else None, err, row['id'])
            )
            db.commit()
            print(f"[SCHEDULER] Processed scheduled email {row['id']} -> {'sent' if ok else 'failed'}")
    except sqlite3.OperationalError as e:
        print(f"[SCHEDULER] skip: {e}")
    finally:
        db.close()


def scheduler_loop():
    while True:
        try:
            process_scheduled_emails()
        except Exception as e:
            print(f"[SCHEDULER] error: {e}")
        time.sleep(60)


# ─── Routes ───
TABLES = ['companies', 'officers', 'shareholders', 'persons', 'person_company_roles',
          'presenters', 'significant_controllers', 'company_logs', 'reminders', 'invoices',
          'resolutions', 'secretary_templates', 'share_transactions', 'user_roles',
          'email_templates', 'email_logs', 'company_versions']

@app.route('/api/send-email', methods=['POST', 'OPTIONS'])
def send_email():
    """Send (or schedule) an email. Body: {to, cc, subject, body, company_id,
    template_id, scheduled_at, variables}. If `variables` is provided, {key}
    placeholders in subject/body are substituted server-side. If `scheduled_at`
    is a future ISO timestamp, the email is queued (status='scheduled') and sent
    by the background scheduler; otherwise it is delivered immediately."""
    if request.method == 'OPTIONS':
        return ('', 204)
    data = request.json or {}
    to_email = (data.get('to') or '').strip()
    cc_email = (data.get('cc') or '').strip()
    subject = data.get('subject') or ''
    body = data.get('body') or ''
    variables = data.get('variables') or {}
    if variables:
        subject = substitute_vars(subject, variables)
        body = substitute_vars(body, variables)
    if not to_email:
        return jsonify({'error': '缺少收件人 (to)'}), 400

    scheduled_at = (data.get('scheduled_at') or '').strip()
    log_id = str(uuid.uuid4())
    db = get_db()

    # Lookup template_type for the log record (EM-04/05)
    email_type = 'general'
    template_id = data.get('template_id')
    if template_id:
        trow = db.execute("SELECT template_type FROM email_templates WHERE id = ?", (template_id,)).fetchone()
        if trow:
            email_type = trow[0]

    # Determine if this is a future-dated (scheduled) send.
    is_scheduled = False
    if scheduled_at:
        try:
            when = datetime.fromisoformat(scheduled_at.replace('Z', ''))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            is_scheduled = when > datetime.now(timezone.utc)
        except (ValueError, TypeError):
            is_scheduled = False

    if is_scheduled:
        db.execute(
            "INSERT INTO email_logs (id, company_id, template_id, to_email, cc_email, subject, body, status, scheduled_at, email_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)",
            (log_id, data.get('company_id'), data.get('template_id'), to_email, cc_email, subject, body, scheduled_at, email_type)
        )
        db.commit()
        return jsonify({'success': True, 'id': log_id, 'status': 'scheduled', 'scheduled_at': scheduled_at})

    ok, err, simulated = deliver_email(to_email, subject, body, cc_email)
    status = 'sent' if ok else 'failed'
    db.execute(
        "INSERT INTO email_logs (id, company_id, template_id, to_email, cc_email, subject, body, status, sent_at, error, email_type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (log_id, data.get('company_id'), data.get('template_id'), to_email, cc_email, subject, body,
         status, datetime.now(timezone.utc).isoformat() if ok else None, err, email_type)
    )
    db.commit()
    return jsonify({'success': ok, 'id': log_id, 'status': status, 'simulated': simulated, 'error': err}), (200 if ok else 502)

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    data = request.json
    email = (data.get('email', '')).lower().strip()
    password = data.get('password', '')
    display_name = data.get('display_name', email)
    role = data.get('role', 'user')

    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM auth_users WHERE email = ?", (email,)).fetchone()
    if existing:
        return jsonify({'error': 'Email already exists'}), 409

    uid = str(uuid.uuid4())
    pwd_hash = hash_password(password)
    db.execute("INSERT INTO auth_users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
               (uid, email, pwd_hash, display_name))
    if role == 'admin':
        db.execute("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)",
                   (str(uuid.uuid4()), uid, 'admin'))
    db.commit()
    return jsonify({'id': uid, 'email': email, 'display_name': display_name}), 201

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json
    email = (data.get('email', '')).lower().strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400

    db = get_db()
    user = db.execute("SELECT * FROM auth_users WHERE email = ?", (email,)).fetchone()
    if not user or not verify_password(password, user['password_hash']):
        return jsonify({'error': 'Invalid email or password'}), 401

    if 'is_active' in user.keys() and user['is_active'] == 0:
        return jsonify({'error': 'Account is deactivated'}), 403

    roles = [r['role'] for r in db.execute(
        "SELECT role FROM user_roles WHERE user_id = ?", (user['id'],)).fetchall()]
    role = 'admin' if 'admin' in roles else ('moderator' if 'moderator' in roles else 'user')

    token = sign_jwt({'sub': user['id'], 'email': user['email'],
                      'display_name': user['display_name'], 'role': role})
    return jsonify({
        'token': token,
        'user': {'id': user['id'], 'email': user['email'],
                 'display_name': user['display_name'], 'role': role}
    })

@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    u = get_user()
    if not u:
        return jsonify({'error': 'Not authenticated'}), 401
    return jsonify(u)

# ─── 用户管理（admin，10.1–10.3；本地 dev 模式不強制鑑權）───
VALID_ROLES = ('admin', 'moderator', 'user')


@app.route('/api/admin/users', methods=['GET', 'OPTIONS'])
def admin_users_list():
    if request.method == 'OPTIONS':
        return ('', 204)
    db = get_db()
    users = db.execute(
        "SELECT id, email, display_name, is_active, created_at FROM auth_users ORDER BY created_at"
    ).fetchall()
    roles = db.execute("SELECT user_id, role FROM user_roles").fetchall()
    role_map = {}
    for r in roles:
        role_map.setdefault(r['user_id'], []).append(r['role'])
    out = []
    for u in users:
        d = dict(u)
        d['roles'] = role_map.get(u['id'], [])
        out.append(d)
    return jsonify(out)


@app.route('/api/admin/users', methods=['POST'])
def admin_users_create():
    data = request.json or {}
    email = (data.get('email', '')).lower().strip()
    password = data.get('password', '')
    display_name = data.get('display_name') or email
    role = data.get('role', 'user')
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    db = get_db()
    if db.execute("SELECT id FROM auth_users WHERE email = ?", (email,)).fetchone():
        return jsonify({'error': 'Email already exists'}), 409
    uid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO auth_users (id, email, password_hash, display_name, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
        (uid, email, hash_password(password), display_name, datetime.now().isoformat()))
    if role in VALID_ROLES:
        db.execute("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)",
                   (str(uuid.uuid4()), uid, role))
    db.commit()
    return jsonify({'id': uid, 'email': email, 'display_name': display_name,
                    'roles': [role] if role in VALID_ROLES else [], 'is_active': 1}), 201


@app.route('/api/admin/users/<uid>', methods=['PUT'])
def admin_users_update(uid):
    data = request.json or {}
    db = get_db()
    if not db.execute("SELECT id FROM auth_users WHERE id = ?", (uid,)).fetchone():
        return jsonify({'error': 'User not found'}), 404
    if 'is_active' in data:
        db.execute("UPDATE auth_users SET is_active = ? WHERE id = ?",
                   (1 if data['is_active'] else 0, uid))
    if 'display_name' in data:
        db.execute("UPDATE auth_users SET display_name = ? WHERE id = ?", (data['display_name'], uid))
    if 'password' in data and data['password']:
        db.execute("UPDATE auth_users SET password_hash = ? WHERE id = ?",
                   (hash_password(data['password']), uid))
    if 'role' in data:
        db.execute("DELETE FROM user_roles WHERE user_id = ?", (uid,))
        if data['role'] in VALID_ROLES:
            db.execute("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)",
                       (str(uuid.uuid4()), uid, data['role']))
    db.commit()
    return jsonify({'success': True})


@app.route('/api/admin/users/<uid>', methods=['DELETE'])
def admin_users_delete(uid):
    db = get_db()
    db.execute("DELETE FROM user_roles WHERE user_id = ?", (uid,))
    db.execute("DELETE FROM auth_users WHERE id = ?", (uid,))
    db.commit()
    return jsonify({'success': True})

# ─── Register PDF helpers (matching Paul Tang RTF samples) ───
MARGIN = 28  # ~1cm, matching RTF sample margins
PAGE_H = 842
PAGE_W = 595
CONTENT_W = PAGE_W - MARGIN * 2
BLUE = (0, 0, 255)
GREY_HDR = (227, 227, 227)


def pdf_draw_right(pdf, text, x, y, size=10, color=None):
    """Draw text right-aligned at given right-edge x position."""
    pdf.set_font('TC', size=size)
    if color:
        pdf.set_text_color(*color)
    else:
        pdf.set_text_color(0, 0, 0)
    tw = pdf.get_string_width(str(text or ''))
    pdf.set_xy(x - tw, y)
    pdf.cell(tw, size + 2, str(text or ''))


def pdf_line_h(pdf, x1, x2, y, color=(180, 180, 180), width=0.2):
    """Draw a horizontal line."""
    pdf.set_draw_color(*color)
    pdf.set_line_width(width)
    pdf.line(x1, y, x2, y)
    pdf.set_line_width(0.2)


def pdf_rect_fill(pdf, x, y, w, h, color):
    """Draw a filled rectangle."""
    pdf.set_fill_color(*color)
    pdf.rect(x, y, w, h, style='F')


def pdf_wrap_text(pdf, text, width, size=7):
    """Split text into lines that fit within width. Handles \\n and CJK."""
    if not text:
        return ['']
    pdf.set_font('TC', size=size)
    result = []
    for paragraph in str(text).split('\n'):
        if not paragraph:
            result.append('')
            continue
        current = ''
        for ch in paragraph:
            trial = current + ch
            if pdf.get_string_width(trial) > width and current:
                result.append(current)
                current = ch
            else:
                current = trial
        if current:
            result.append(current)
    if not result:
        result.append('')
    return result


def draw_register_header(pdf, company, title_en, quorum=None):
    """Draw the standard register page header — Paul Tang black & white style.
    Returns y position after header + separator line."""
    y = 45

    # Company name — TNR bold, black
    co_name = rget(company, 'name') or ''
    pdf.set_font('TNR', 'B', 14)
    pdf.set_text_color(0, 0, 0)
    tw = pdf.get_string_width(co_name)
    pdf.set_xy(PAGE_W / 2 - tw / 2, y)
    pdf.cell(tw, 16, co_name)
    y += 19

    br = rget(company, 'company_number')
    cn_line = f"Company Number:  {br}" if br else "Company Number:"
    pdf.set_font('TNR', '', 10)
    tw2 = pdf.get_string_width(cn_line)
    pdf.set_xy(PAGE_W / 2 - tw2 / 2, y)
    pdf.cell(tw2, 12, cn_line)

    if quorum is not None:
        pdf.set_font('TNR', '', 9)
        q_text = f"Quorum:  {quorum}"
        qw = pdf.get_string_width(q_text)
        pdf.set_xy(PAGE_W - MARGIN - qw, y)
        pdf.cell(qw, 12, q_text)
    y += 20

    today = datetime.now().strftime('%d/%m/%Y')
    title_full = f"{title_en} AT {today}"
    pdf.set_font('TNR', 'B', 12)
    pdf.set_text_color(0, 0, 0)
    pdf.set_xy(MARGIN, y)
    pdf.cell(0, 14, title_full)
    y += 22

    pdf_line_h(pdf, MARGIN, PAGE_W - MARGIN, y, color=(0, 0, 0), width=0.8)
    return y + 12


def draw_form_label(pdf, label, x_label, y, size=9):
    """Draw a bold form label (like 'Name', 'Address', 'Security')."""
    pdf_draw(pdf, label, x_label, y, size=size, bold=True)


def draw_form_value(pdf, value, x_val, y, size=9):
    """Draw a form value after a label."""
    pdf_draw(pdf, value, x_val, y, size=size)


def draw_grey_header_row(pdf, cols, y):
    """Draw a white-background header row (Paul Tang style). cols = [(text, x, w), ...].
    Returns y below row. Text wraps within column width. No grey fill, no vertical lines."""
    hdr_size = 7
    label_lines = []
    max_lines = 1
    for text, x, w in cols:
        lines = pdf_wrap_text(pdf, text, w - 6, hdr_size)
        label_lines.append(lines)
        max_lines = max(max_lines, len(lines))
    row_h = max(max_lines * 11 + 6, 22)

    # White background — no fill (transparent)
    # Draw header text in black
    pdf.set_text_color(0, 0, 0)
    for i, (text, x, w) in enumerate(cols):
        for li, line_text in enumerate(label_lines[i]):
            pdf.set_xy(x, y + 3 + li * 10)
            # Use TNR for ASCII, TC for CJK
            has_cjk = any('一' <= ch <= '鿿' or '　' <= ch <= '〿' for ch in line_text)
            if has_cjk:
                pdf.set_font('TC', size=hdr_size)
            else:
                pdf.set_font('TNR', size=hdr_size)
            pdf.cell(w, 10, line_text)

    # Top + bottom borders only (black, no vertical dividers)
    pdf.set_draw_color(0, 0, 0)
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y)
    pdf.line(MARGIN, y + row_h, PAGE_W - MARGIN, y + row_h)
    pdf.set_draw_color(0, 0, 0)

    return y + row_h


def draw_data_row(pdf, cols, y, alt=False):
    """Draw a data row (Paul Tang style — no alternating colour, no vertical lines).
    cols = [(text, x, w), ...]. Returns y below row."""
    size = 7
    wrapped = []
    max_lines = 1
    for text, x, w in cols:
        lines = pdf_wrap_text(pdf, str(text or ''), w - 6, size)
        wrapped.append(lines)
        max_lines = max(max_lines, len(lines))
    row_h = max(max_lines * 11 + 6, 20)

    # No alternating background
    pdf.set_text_color(0, 0, 0)
    for i, (text, x, w) in enumerate(cols):
        for li, line_text in enumerate(wrapped[i]):
            pdf.set_xy(x, y + 3 + li * 10)
            has_cjk = any('一' <= ch <= '鿿' or '　' <= ch <= '〿' for ch in line_text)
            if has_cjk:
                pdf.set_font('TC', size=size)
            else:
                pdf.set_font('TNR', size=size)
            pdf.cell(w, 10, line_text)

    # Thin bottom border only (no vertical lines)
    pdf.set_draw_color(180, 180, 180)
    pdf.line(MARGIN, y + row_h, PAGE_W - MARGIN, y + row_h)
    pdf.set_draw_color(0, 0, 0)

    return y + row_h


# ─── PDF Generation ───

# ROM Share Transaction sub-column layout:
# This matches the 11 sub-columns in the RTF sample's grey header
# Positions calculated proportionally from the RTF twip coordinates
def _rom_txn_cols():
    """Return [(label, x, w), ...] for the ROM share transaction table."""
    x0 = MARGIN + 5
    return [
        ("Date Entered\n/ Ceased",      x0,        57),
        ("Transaction\nType",            x0 + 58,   60),
        ("Units",                        x0 + 119,  75),
        ("Par Value\nPer Share",         x0 + 195,  75),
        ("Paid Up Value\nPer Share",    x0 + 271,  75),
        ("Certificate\nNo",             x0 + 347,  50),
        ("Distinctive\nNumbers",        x0 + 398,  115),
        ("Balance",                     x0 + 514,  55),
        ("Transferred To/From,\nRedeemed, Reissued", x0 + 570, 140),
    ]


@app.route('/api/generate-shareholders-register-pdf', methods=['POST'])
def generate_shareholders_register_pdf():
    """Register of Members (ROM) — matching Paul Tang & Co reference format.
    Portrait A4, 18-column table, white headers, Times New Roman, thin black lines."""
    data = request.get_json(silent=True) or {}
    company_id = data.get('companyId', '')
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400

    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Company not found'}), 404

    roles = db.execute(
        "SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder'",
        (company_id,)).fetchall()
    txs = db.execute(
        "SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date",
        (company_id,)).fetchall()

    person_ids = [r['person_id'] for r in roles]
    person_map = {}
    if person_ids:
        placeholders = ','.join(['?'] * len(person_ids))
        persons = db.execute(
            f"SELECT * FROM persons WHERE id IN ({placeholders})", person_ids).fetchall()
        person_map = {p['id']: p for p in persons}

    tx_by_person = {}
    for t in txs:
        key = (rget(t, 'from_name') or rget(t, 'to_name') or '').strip().upper()
        if key:
            tx_by_person.setdefault(key, []).append(t)

    M = 28  # margin
    PW, PH = 595, 842  # A4 portrait in pt
    CW = PW - 2 * M  # content width

    pdf = create_pdf()
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)

    # ── Helper: draw text with TNR (English) or TC (CJK) ──
    def tnr(text, x, y, size=9, bold=False, align='L', color=(0, 0, 0)):
        """Draw text with Times New Roman font."""
        style = 'B' if bold else ''
        pdf.set_font('TNR', style, size)
        pdf.set_text_color(*color)
        if align == 'C':
            tw = pdf.get_string_width(str(text or ''))
            x = x - tw / 2
        elif align == 'R':
            tw = pdf.get_string_width(str(text or ''))
            x = x - tw
        pdf.set_xy(x, y)
        pdf.cell(0, size + 2, str(text or ''))

    def tc(text, x, y, size=9, bold=False, align='L', color=(0, 0, 0)):
        """Draw text with CJK font."""
        style = 'B' if bold else ''
        pdf.set_font('TC', style, size)
        pdf.set_text_color(*color)
        if align == 'C':
            tw = pdf.get_string_width(str(text or ''))
            x = x - tw / 2
        elif align == 'R':
            tw = pdf.get_string_width(str(text or ''))
            x = x - tw
        pdf.set_xy(x, y)
        pdf.cell(0, size + 2, str(text or ''))

    def line_h(x1, x2, y, w=0.3, color=(0, 0, 0)):
        pdf.set_draw_color(*color)
        pdf.set_line_width(w)
        pdf.line(x1, y, x2, y)

    def line_v(x, y1, y2, w=0.3, color=(0, 0, 0)):
        pdf.set_draw_color(*color)
        pdf.set_line_width(w)
        pdf.line(x, y1, x, y2)

    # ── Page Header ──
    y = 35
    co_name = rget(company, 'name') or ''
    tnr(co_name, PW / 2, y, size=12, bold=True, align='C')
    y += 18
    br = rget(company, 'company_number') or ''
    tnr(f"Company Number: {br}", PW / 2, y, size=9, align='C')
    y += 2

    # "REGISTER OF MEMBERS" right-aligned
    tnr("REGISTER OF MEMBERS", PW - M, 35, size=13, bold=True, align='R')

    y += 14
    line_h(M, PW - M, y, w=0.4)

    # ── Table columns (18 cols, based on Paul Tang reference) ──
    # Adjust widths for portrait A4 (CW ≈ 539pt)
    col_w = [
        54,  # 1. Full Name
        60,  # 2. Address
        37,  # 3. Occupation
        37,  # 4. Merchant
        40,  # 5. Date Entered
        40,  # 6. Date Ceasing
        # Shares Acquired (5 sub-cols):
        28,  # 7. Cert No
        46,  # 8. Distinctive Nos
        28,  # 9. No. of Shares
        30,  # 10. Consideration
        30,  # 11. Transfer Deed No
        # Shares Transferred (4 sub-cols):
        28,  # 12. Cert No
        46,  # 13. Distinctive Nos
        28,  # 14. No. of Shares
        30,  # 15. Consideration
        30,  # 16. Total Shares Held
        32,  # 17. Remarks
        32,  # 18. Entry Made By
    ]
    # Build x positions
    col_x = [M]
    for w in col_w[:-1]:
        col_x.append(col_x[-1] + w)

    def draw_table_border(top_y, bottom_y):
        """Draw outer border and vertical lines for the table."""
        line_h(M, PW - M, top_y, w=0.4)
        line_h(M, PW - M, bottom_y, w=0.4)
        line_v(M, top_y, bottom_y, w=0.4)
        line_v(PW - M, top_y, bottom_y, w=0.4)

    def draw_row_sep(row_y, start_col=0):
        """Draw horizontal line across row, and vertical lines between cols."""
        end_x = PW - M
        line_h(col_x[start_col], end_x, row_y, w=0.25, color=(100, 100, 100))
        for i in range(start_col, len(col_x)):
            line_v(col_x[i], row_y - 50, row_y, w=0.2, color=(150, 150, 150))

    # ── Table Header Row 1: Main headers ──
    y += 8
    hdr_y0 = y
    hdr1_labels = [
        ("Full\nName", 0), ("Address", 1), ("Occupation", 2), ("Merchant", 3),
        ("Date Entered\nas Member", 4), ("Date Ceasing\nto be Member", 5),
    ]
    # Draw hdr row 1 labels
    hdr_size = 6.5
    row_h1 = 26
    for label, ci in hdr1_labels:
        cx = col_x[ci]
        cw_val = col_w[ci]
        tnr(label, cx + 1, y + 1, size=hdr_size, bold=True)
    # "Shares Acquired" spanning cols 6-10
    sacq_x1 = col_x[6]
    sacq_x2 = col_x[10] + col_w[10]
    sacq_cx = (sacq_x1 + sacq_x2) / 2
    tnr("Shares Acquired", sacq_cx, y + 1, size=hdr_size, bold=True, align='C')
    # "Shares Transferred" spanning cols 11-14
    strf_x1 = col_x[11]
    strf_x2 = col_x[14] + col_w[14]
    strf_cx = (strf_x1 + strf_x2) / 2
    tnr("Shares Transferred", strf_cx, y + 1, size=hdr_size, bold=True, align='C')
    # Remaining headers
    for label, ci in [("Total\nShares Held", 15), ("Remarks", 16), ("Entry\nMade By", 17)]:
        cx = col_x[ci]
        tnr(label, cx + 1, y + 1, size=hdr_size, bold=True)

    y += row_h1
    line_h(M, PW - M, y, w=0.3)
    # Vertical separators for header row 1
    for ci in [0, 1, 2, 3, 4, 5, 6, 11, 15, 16, 17]:
        line_v(col_x[ci], hdr_y0, y, w=0.2, color=(150, 150, 150))
    line_v(col_x[10] + col_w[10], hdr_y0, y, w=0.2, color=(150, 150, 150))
    line_v(col_x[14] + col_w[14], hdr_y0, y, w=0.2, color=(150, 150, 150))

    # ── Table Header Row 2: Sub-columns under Shares Acquired / Transferred ──
    hdr_y1 = y
    row_h2 = 22
    sub_labels = [
        ("Cert\nNo", 6), ("Distinctive Nos.\n(From → To)", 7),
        ("No. of\nShares", 8), ("Consideration\nPaid", 9), ("Transfer\nDeed No", 10),
        ("Cert\nNo", 11), ("Distinctive Nos.\n(From → To)", 12),
        ("No. of\nShares", 13), ("Consideration\nPaid", 14),
    ]
    for label, ci in sub_labels:
        tnr(label, col_x[ci] + 1, y + 1, size=6, bold=True)
    y += row_h2
    line_h(M, PW - M, y, w=0.4)

    table_top_y = hdr_y0
    table_bottom_y = y

    # ── Data Rows ──
    row_num = 0
    data_size = 6.5
    data_row_h = 16

    if not roles:
        tc("(No shareholders / 尚無股東記錄)", M + 3, y + 8, size=9)
        y += 24
        table_bottom_y = y
    else:
        for r in roles:
            p = person_map.get(r['person_id'], {})
            name_en = rget(p, 'name_english') or rget(p, 'name_chinese') or '(unnamed)'
            is_nat = rget(p, 'identity') != 'corporate'
            hkid = rget(p, 'id_number') or rget(p, 'passport_number') or ''
            addr = rget(p, 'address') or ''
            occupation = rget(p, 'occupation') or ''
            merchant = rget(p, 'merchant') or ''

            date_app = rget(r, 'date_appointed') or '-'
            date_cea = rget(r, 'date_ceased') or ''

            share_type = rget(r, 'share_type') or 'ORD'
            currency = rget(r, 'currency') or 'HKD'
            issue_price = rget(r, 'issue_price') or '1.00'
            shares = rget(r, 'shares') or 0
            cert_no = rget(r, 'certificate_number') or '-'

            person_name_key = name_en.strip().upper()
            person_txs = tx_by_person.get(person_name_key, [])

            # Page break if needed (each member ~3-5 data rows)
            if y + 80 > PH - 50:
                pdf.add_page()
                y = 35
                tnr(co_name, PW / 2, y, size=12, bold=True, align='C')
                y += 18
                tnr(f"Company Number: {br}", PW / 2, y, size=9, align='C')
                tnr("REGISTER OF MEMBERS (Cont'd)", PW - M, 35, size=13, bold=True, align='R')
                y += 14
                line_h(M, PW - M, y, w=0.4)
                y += 8
                # Redraw headers (simplified)
                hdr_y0 = y
                for label, ci in hdr1_labels:
                    tnr(label.replace('\n', ' '), col_x[ci] + 1, y + 1, size=hdr_size, bold=True)
                tnr("Shares Acquired", sacq_cx, y + 1, size=hdr_size, bold=True, align='C')
                tnr("Shares Transferred", strf_cx, y + 1, size=hdr_size, bold=True, align='C')
                for label, ci in [("Total\nShares Held", 15), ("Remarks", 16), ("Entry\nMade By", 17)]:
                    tnr(label, col_x[ci] + 1, y + 1, size=hdr_size, bold=True)
                y += row_h1
                line_h(M, PW - M, y, w=0.3)
                for label, ci in sub_labels:
                    tnr(label.replace('\n', ' '), col_x[ci] + 1, y + 1, size=6, bold=True)
                y += row_h2
                line_h(M, PW - M, y, w=0.4)
                table_top_y = hdr_y0

            row_num += 1
            row_start_y = y

            if not person_txs:
                # Single row with all data
                row_data = [
                    name_en, addr, occupation, merchant, date_app, date_cea,
                    cert_no, '-', str(shares), f"{currency}${issue_price}", '-',
                    '-', '-', '-', '-',
                    str(shares), '', ''
                ]
                for i, val in enumerate(row_data):
                    tnr(str(val)[:30], col_x[i] + 1, y + 1, size=data_size)
                y += data_row_h
            else:
                # First row: member info + first transaction
                running_balance = 0
                first_tx = person_txs[0]
                tx_type = rget(first_tx, 'transaction_type') or 'Transfer'
                tx_date = rget(first_tx, 'transaction_date') or '-'
                tx_shares = int(first_tx['shares'] or 0)
                tx_price = rget(first_tx, 'price_per_share') or issue_price
                tx_currency = rget(first_tx, 'currency') or currency
                tx_from = rget(first_tx, 'from_name') or ''
                tx_to = rget(first_tx, 'to_name') or ''
                tx_inst = rget(first_tx, 'instrument_number') or '-'
                tx_cert = rget(first_tx, 'certificate_number') or cert_no

                is_in = tx_to.strip().upper() == person_name_key
                is_out = tx_from.strip().upper() == person_name_key
                if is_in:
                    running_balance = tx_shares
                elif is_out:
                    running_balance = -tx_shares
                else:
                    running_balance = tx_shares

                first_row = [
                    name_en, addr, occupation, merchant, date_app, date_cea,
                    tx_cert, f"{tx_inst}", str(tx_shares), f"{tx_currency}${tx_price}", tx_inst,
                    '-', '-', '-', '-',
                    str(running_balance), '', ''
                ]
                for i, val in enumerate(first_row):
                    tnr(str(val)[:30], col_x[i] + 1, y + 1, size=data_size)
                y += data_row_h

                # Subsequent transaction rows
                for tx in person_txs[1:]:
                    if y + data_row_h > PH - 50:
                        pdf.add_page()
                        y = 35
                        tnr(co_name, PW / 2, y, size=12, bold=True, align='C')
                        tnr("REGISTER OF MEMBERS (Cont'd)", PW - M, 35, size=13, bold=True, align='R')
                        y += 32
                        line_h(M, PW - M, y, w=0.4)
                        y += 8
                        hdr_y0 = y
                        for label, ci in hdr1_labels:
                            tnr(label.replace('\n', ' '), col_x[ci] + 1, y + 1, size=hdr_size, bold=True)
                        tnr("Shares Acquired", sacq_cx, y + 1, size=hdr_size, bold=True, align='C')
                        tnr("Shares Transferred", strf_cx, y + 1, size=hdr_size, bold=True, align='C')
                        for label, ci in [("Total\nShares Held", 15), ("Remarks", 16), ("Entry\nMade By", 17)]:
                            tnr(label, col_x[ci] + 1, y + 1, size=hdr_size, bold=True)
                        y += row_h1
                        line_h(M, PW - M, y, w=0.3)
                        for label, ci in sub_labels:
                            tnr(label.replace('\n', ' '), col_x[ci] + 1, y + 1, size=6, bold=True)
                        y += row_h2
                        line_h(M, PW - M, y, w=0.4)

                    tx_type = rget(tx, 'transaction_type') or 'Transfer'
                    tx_date = rget(tx, 'transaction_date') or '-'
                    tx_shares = int(tx['shares'] or 0)
                    tx_price = rget(tx, 'price_per_share') or issue_price
                    tx_currency = rget(tx, 'currency') or currency
                    tx_from = rget(tx, 'from_name') or ''
                    tx_to = rget(tx, 'to_name') or ''
                    tx_inst = rget(tx, 'instrument_number') or '-'
                    tx_cert = rget(tx, 'certificate_number') or '-'

                    is_in = tx_to.strip().upper() == person_name_key
                    is_out = tx_from.strip().upper() == person_name_key
                    if is_in:
                        running_balance += tx_shares
                    elif is_out:
                        running_balance -= tx_shares
                    else:
                        running_balance += tx_shares

                    tx_row = [
                        '', '', '', '', tx_date, '',
                        tx_cert, f"{tx_inst}", str(tx_shares), f"{tx_currency}${tx_price}", tx_inst,
                        '-', '-', '-', '-',
                        str(running_balance), '', ''
                    ]
                    for i, val in enumerate(tx_row):
                        if val:
                            tnr(str(val)[:30], col_x[i] + 1, y + 1, size=data_size)
                    y += data_row_h

            # Row separator line
            line_h(M, PW - M, y, w=0.2, color=(180, 180, 180))
            table_bottom_y = y

    # Draw outer table border
    line_h(M, PW - M, table_top_y, w=0.5)
    line_h(M, PW - M, table_bottom_y, w=0.5)
    line_v(M, table_top_y, table_bottom_y, w=0.5)
    line_v(PW - M, table_top_y, table_bottom_y, w=0.5)

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})

@app.route('/api/generate-directors-register-pdf', methods=['POST'])
def generate_directors_register_pdf():
    """Register of Directors (ROD) — matching RTF sample layout."""
    data = request.get_json(silent=True) or {}
    company_id = data.get('companyId', '')
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400

    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Company not found'}), 404

    roles = db.execute(
        "SELECT * FROM person_company_roles WHERE company_id = ? AND role IN ('director', 'secretary')",
        (company_id,)).fetchall()
    person_ids = [r['person_id'] for r in roles]
    person_map = {}
    if person_ids:
        placeholders = ','.join(['?'] * len(person_ids))
        persons = db.execute(
            f"SELECT * FROM persons WHERE id IN ({placeholders})", person_ids).fetchall()
        person_map = {p['id']: p for p in persons}

    directors = [r for r in roles if r['role'] == 'director']
    secretaries = [r for r in roles if r['role'] == 'secretary']

    pdf = create_pdf()
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)

    quorum = len(directors) if directors else None
    y = draw_register_header(pdf, company, "REGISTER OF OFFICERS", quorum)

    # ROD columns matching RTF sample — 6 columns
    x0 = MARGIN + 3
    rod_cols = [
        ("Name / Service /\nResidential Address",   x0,         130),
        ("Date / Place Birth /\nPlace Incorporated /\nOccupation /", x0 + 131,  75),
        ("ID No / Passport\nDetails",               x0 + 207,   67),
        ("Position",                                x0 + 275,   48),
        ("Date(s) Appointed\n/Meeting",             x0 + 324,   78),
        ("Reason / Date(s)\nCeased",                x0 + 403,   78),
    ]

    y = draw_grey_header_row(pdf, rod_cols, y)

    row_num = 0

    def render_section(items, is_secretary=False):
        nonlocal y, row_num
        for r in items:
            p = person_map.get(r['person_id'], {})
            name_en = rget(p, 'name_english') or rget(p, 'name_chinese') or '(unnamed)'
            name_ch = rget(p, 'name_chinese') if rget(p, 'name_english') else ''
            is_nat = rget(p, 'identity') != 'corporate'

            # Build Name/Address block
            addr = (rget(p, 'address') or '') if is_nat else (rget(p, 'registered_office') or rget(p, 'address') or '')
            name_block = name_en
            if name_ch:
                name_block += f"\n{name_ch}"
            if addr:
                name_block += f"\n{addr[:120]}"

            # DOB/Place/Nation block
            if is_nat:
                dob = rget(p, 'date_of_birth') or '-'
                pob = rget(p, 'place_of_birth') or '-'
                nat = rget(p, 'nationality') or '-'
                dob_block = f"{dob}\n{pob}\n{nat}"
            else:
                poi = rget(p, 'place_incorporated') or '-'
                dob_block = f"{poi}\n-\n-"

            # ID block
            id_info = (rget(p, 'id_number') or rget(p, 'passport_number') or '-') if is_nat else (rget(p, 'company_number_ref') or '-')

            # Position
            if is_secretary:
                position = "Secretary"
            else:
                position = "Reserve Director" if rget(r, 'is_reserve') else "Director"

            # Date Appointed
            date_app = rget(r, 'date_appointed') or '-'

            # Date Ceased / Reason
            date_cea = rget(r, 'date_ceased')
            if date_cea:
                reason_block = f"Resigned\n{date_cea}"
            else:
                reason_block = "Current\n現任"

            row_num += 1
            if y + 50 > PAGE_H - 50:
                pdf.add_page()
                y = draw_register_header(pdf, company, "REGISTER OF OFFICERS (Cont'd)", quorum)
                y = draw_grey_header_row(pdf, rod_cols, y)

            row_data = [
                (name_block,       rod_cols[0][1], rod_cols[0][2]),
                (dob_block,        rod_cols[1][1], rod_cols[1][2]),
                (id_info,          rod_cols[2][1], rod_cols[2][2]),
                (position,         rod_cols[3][1], rod_cols[3][2]),
                (date_app,         rod_cols[4][1], rod_cols[4][2]),
                (reason_block,     rod_cols[5][1], rod_cols[5][2]),
            ]
            y = draw_data_row(pdf, row_data, y, alt=(row_num % 2 == 0))

    # Directors first
    if directors:
        render_section(directors)
    else:
        pdf_draw(pdf, "(No directors / 尚無董事記錄)", MARGIN + 5, y + 12, size=8)
        y += 22

    # Secretaries below directors with same column layout
    if secretaries:
        if y + 40 > PAGE_H - 50:
            pdf.add_page()
            y = draw_register_header(pdf, company, "REGISTER OF OFFICERS (Cont'd)", quorum)
        y += 6
        render_section(secretaries, is_secretary=True)

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})


@app.route('/api/generate-secretaries-register-pdf', methods=['POST'])
def generate_secretaries_register_pdf():
    """Standalone Register of Secretaries — matching ROD style."""
    data = request.get_json(silent=True) or {}
    company_id = data.get('companyId', '')
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400

    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Company not found'}), 404

    roles = db.execute(
        "SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'secretary'",
        (company_id,)).fetchall()
    person_ids = [r['person_id'] for r in roles]
    person_map = {}
    if person_ids:
        placeholders = ','.join(['?'] * len(person_ids))
        persons = db.execute(
            f"SELECT * FROM persons WHERE id IN ({placeholders})", person_ids).fetchall()
        person_map = {p['id']: p for p in persons}

    pdf = create_pdf()
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)

    y = draw_register_header(pdf, company, "REGISTER OF COMPANY SECRETARIES")

    x0 = MARGIN + 3
    sec_cols = [
        ("Name / Service /\nResidential Address",   x0,         140),
        ("ID No / Passport\nDetails",               x0 + 141,   80),
        ("TCSP Licence\nNo.",                       x0 + 222,   60),
        ("Position",                                x0 + 283,   55),
        ("Date(s) Appointed",                       x0 + 339,   75),
        ("Reason / Date(s)\nCeased",                x0 + 415,   75),
    ]

    y = draw_grey_header_row(pdf, sec_cols, y)
    row_num = 0

    if not roles:
        pdf_draw(pdf, "(No secretaries / 尚無公司秘書記錄)", MARGIN + 5, y + 12, size=8)
    else:
        for r in roles:
            p = person_map.get(r['person_id'], {})
            name_en = rget(p, 'name_english') or rget(p, 'name_chinese') or '(unnamed)'
            name_ch = rget(p, 'name_chinese') if rget(p, 'name_english') else ''
            is_nat = rget(p, 'identity') != 'corporate'

            addr = (rget(p, 'address') or '') if is_nat else (rget(p, 'registered_office') or rget(p, 'address') or '')
            name_block = name_en
            if name_ch:
                name_block += f"\n{name_ch}"
            if addr:
                name_block += f"\n{addr[:100]}"

            id_info = (rget(p, 'id_number') or rget(p, 'passport_number') or '-') if is_nat else (rget(p, 'company_number_ref') or '-')
            tcsp = rget(p, 'tcsp_number') or '-'
            position = "Company Secretary"
            date_app = rget(r, 'date_appointed') or '-'
            date_cea = rget(r, 'date_ceased')
            reason_block = f"Resigned\n{date_cea}" if date_cea else "Current\n現任"

            row_num += 1
            if y + 40 > PAGE_H - 50:
                pdf.add_page()
                y = draw_register_header(pdf, company, "REGISTER OF COMPANY SECRETARIES (Cont'd)")
                y = draw_grey_header_row(pdf, sec_cols, y)

            row_data = [
                (name_block,       sec_cols[0][1], sec_cols[0][2]),
                (id_info,          sec_cols[1][1], sec_cols[1][2]),
                (tcsp,             sec_cols[2][1], sec_cols[2][2]),
                (position,         sec_cols[3][1], sec_cols[3][2]),
                (date_app,         sec_cols[4][1], sec_cols[4][2]),
                (reason_block,     sec_cols[5][1], sec_cols[5][2]),
            ]
            y = draw_data_row(pdf, row_data, y, alt=(row_num % 2 == 0))

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})


@app.route('/api/generate-scr-pdf', methods=['POST'])
def generate_scr_pdf():
    """Significant Controllers Register — matching Paul Tang & Co reference format.
    Landscape A4, 7-column table, bilingual headers, grid borders, Times New Roman + TC."""
    data = request.get_json(silent=True) or {}
    company_id = data.get('companyId', '')
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400

    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Company not found'}), 404

    scrs = db.execute(
        "SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at",
        (company_id,)).fetchall()

    M = 28
    PW, PH = 842, 595  # Landscape A4
    CW = PW - 2 * M  # 786pt content width

    pdf = create_pdf(landscape=True)
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)

    # ── Helpers ──
    def has_cjk(text):
        s = str(text or '')
        return any('一' <= ch <= '鿿' or '　' <= ch <= '〿' or '＀' <= ch <= '￯' for ch in s)

    def tnr(text, x, y, size=8, bold=False, align='L'):
        style = 'B' if bold else ''
        pdf.set_font('TNR', style, size)
        pdf.set_text_color(0, 0, 0)
        tw = pdf.get_string_width(str(text or ''))
        if align == 'C': x = x - tw / 2
        elif align == 'R': x = x - tw
        pdf.set_xy(x, y)
        pdf.cell(tw + 2, size + 2, str(text or ''))

    def tc(text, x, y, size=8, bold=False, align='L'):
        style = 'B' if bold else ''
        pdf.set_font('TC', style, size)
        pdf.set_text_color(0, 0, 0)
        tw = pdf.get_string_width(str(text or ''))
        if align == 'C': x = x - tw / 2
        elif align == 'R': x = x - tw
        pdf.set_xy(x, y)
        pdf.cell(tw + 2, size + 2, str(text or ''))

    def line_h(x1, x2, y, w=0.3, color=(0, 0, 0)):
        pdf.set_draw_color(*color)
        pdf.set_line_width(w)
        pdf.line(x1, y, x2, y)

    def line_v(x, y1, y2, w=0.3, color=(0, 0, 0)):
        pdf.set_draw_color(*color)
        pdf.set_line_width(w)
        pdf.line(x, y1, x, y2)

    def draw_cell_border(x0, y0, w, h):
        pdf.set_draw_color(0, 0, 0)
        pdf.set_line_width(0.3)
        pdf.rect(x0, y0, w, h)

    def wrap_text_to_lines(text, font_name, style, size, max_w):
        if not text:
            return ['']
        s = str(text)
        pdf.set_font(font_name, style, size)
        all_lines = []
        # First split by explicit newlines, then wrap each chunk
        for chunk in s.split('\n'):
            if not chunk:
                all_lines.append('')
                continue
            current = ''
            for ch in chunk:
                trial = current + ch
                if pdf.get_string_width(trial) > max_w and current:
                    all_lines.append(current)
                    current = ch
                else:
                    current = trial
            if current:
                all_lines.append(current)
        return all_lines if all_lines else ['']

    # ── Company Data ──
    co_name = rget(company, 'name') or ''
    co_name_ch = rget(company, 'chinese_name') or ''
    br = rget(company, 'company_number') or ''

    # ═══════════════════════════════════════════════════════
    # HEADER BLOCK (borderless table: company info left, title right)
    # Per docx: header table first, then JURISDICTION below
    # ═══════════════════════════════════════════════════════

    y = 22
    hdr_size = 8

    # ── Title on right side ──
    title_x = PW - M
    tnr("SIGNIFICANT CONTROLLERS REGISTER", title_x, y, size=13, bold=True, align='R')
    tc("重要控制人登記冊", title_x, y + 18, size=11, bold=True, align='R')

    # ── Header: NAME OF COMPANY full width, then COMPANY NUMBER || JURISDICTION side by side ──
    col_a_x = M

    # Row 1 (English): NAME OF COMPANY — label only, no value/underline
    tnr("NAME OF COMPANY:  ", col_a_x, y, size=hdr_size, bold=True)

    y += 12

    # Row 2 (Chinese): 公司名稱 — with value + underline
    tc("公司名稱:  ", col_a_x, y, size=hdr_size)
    cn_label_w = pdf.get_string_width("公司名稱:  ")
    tc(co_name_ch if co_name_ch else co_name, col_a_x + cn_label_w, y, size=hdr_size)
    cn_val_w = pdf.get_string_width(co_name_ch or co_name)
    line_h(col_a_x + cn_label_w, col_a_x + cn_label_w + max(cn_val_w, 150), y + 11)

    y += 16

    # Row 3 (English): COMPANY NUMBER  |  JURISDICTION — labels only, no values/underlines
    tnr("COMPANY NUMBER:  ", col_a_x, y, size=hdr_size, bold=True)
    num_label_w = pdf.get_string_width("COMPANY NUMBER:  ")
    br_underline_end = col_a_x + num_label_w + 100

    jur_x = br_underline_end + 24
    tnr("JURISDICTION:  ", jur_x, y, size=hdr_size, bold=True)

    y += 14

    # Row 4 (Chinese): 公司編號 _______  司法管轄區: HONG KONG — with underlines
    tc("公司編號:  ", col_a_x, y, size=hdr_size)
    num2_label_w = pdf.get_string_width("公司編號:  ")
    tc(br, col_a_x + num2_label_w, y, size=hdr_size)
    br2_val_w = pdf.get_string_width(br)
    br2_underline_end = col_a_x + num2_label_w + max(br2_val_w, 100)
    line_h(col_a_x + num2_label_w, br2_underline_end, y + 11)

    tc("司法管轄區:  HONG KONG", jur_x, y, size=hdr_size)
    line_h(jur_x, jur_x + 120, y + 11)

    y += 16

    # Separator
    line_h(M, PW - M, y, w=0.5)
    y += 12

    # ═══════════════════════════════════════════════════════
    # DATA TABLE (7 columns, grid borders, bilingual headers)
    # Column widths per docx gridCol proportions with ID column widened
    # ═══════════════════════════════════════════════════════

    # Docx gridCol DXA: merged[1526], 2154, 2835, 2551, 2551, 1701, 1814
    # Total=15132 DXA. Scale to CW=786pt, then widen ID col (+8pt) and narrow Nature (-8pt)
    col_ratios = [1526, 2154, 2835, 2551, 2551, 1701, 1814]
    total_dxa = sum(col_ratios)
    col_w = [r * CW / total_dxa for r in col_ratios]
    # Widen ID column (index 3) and narrow Nature column (index 4)
    col_w[3] += 8   # ID: ~140pt
    col_w[4] -= 8   # Nature: ~124pt

    col_x = [M]
    for w in col_w[:-1]:
        col_x.append(col_x[-1] + w)
    end_x = PW - M

    # ── Bilingual Multi-line Table Headers ──
    hdr_labels = [
        ("Entry Date", 0),
        ("Name", 1),
        ("Correspondence Address\n (for Registrable Person)\n通訊地址（自然人）\nRegistered Office Address (for Legal Entity)\n註冊／主要營業地址\n（法律實體）", 2),
        ("ID / PPT No. (Issuing Country)\n(for Registrable Person)\n身份證／護照號碼\n（簽發國家）（自然人）\nCompany No. (Place of Incorp.)\nLegal Form (for Legal Entity)\n公司編號（成立地方）\n法律形式（法律實體）", 3),
        ("Nature of Control\n控制性質", 4),
        ("Becoming Date\n(Cessation Date)\n起始日期\n（終止日期）", 5),
        ("Remarks\n備註", 6),
    ]

    hdr_lines_counts = [len(lbl.split('\n')) for lbl, _ in hdr_labels]
    hdr_line_h = 10
    max_hdr_lines = max(hdr_lines_counts)
    hdr_h = max_hdr_lines * hdr_line_h + 6

    hdr_y0 = y

    for label, ci in hdr_labels:
        x0 = col_x[ci]
        cw_val = col_w[ci] if ci < len(col_w) else (end_x - col_x[ci])
        draw_cell_border(x0, y, cw_val, hdr_h)
        lines = label.split('\n')
        text_block_h = len(lines) * hdr_line_h
        text_start_y = y + (hdr_h - text_block_h) / 2
        for li, line_text in enumerate(lines):
            font_name = 'TC' if has_cjk(line_text) else 'TNR'
            pdf.set_font(font_name, 'B', 7)
            pdf.set_text_color(0, 0, 0)
            lw = pdf.get_string_width(line_text)
            lx = x0 + (cw_val - lw) / 2
            pdf.set_xy(lx, text_start_y + li * hdr_line_h)
            pdf.cell(lw, hdr_line_h, line_text)

    y += hdr_h
    table_top_y = hdr_y0

    # ── Data Rows ──
    data_size = 8
    min_row_h = 20

    if not scrs:
        empty_h = min_row_h
        for ci in range(len(col_x)):
            cw_val = col_w[ci] if ci < len(col_w) else (end_x - col_x[ci])
            draw_cell_border(col_x[ci], y, cw_val, empty_h)
        tc("(No SCR records / 尚無重要控制人記錄)", M + 4, y + 4, size=8)
        y += empty_h
    else:
        for s in scrs:
            # Build nature of control
            natures = []
            if rget(s, 'nature_shares'): natures.append('>25% shares')
            if rget(s, 'nature_voting'): natures.append('>25% voting')
            if rget(s, 'nature_appoint'): natures.append('Appoint/remove directors')
            if rget(s, 'nature_influence'): natures.append('Sig. influence')
            if rget(s, 'nature_trust'): natures.append('Trust control')
            if rget(s, 'nature_other'): natures.append(rget(s, 'nature_other'))

            is_nat = rget(s, 'identity') != 'corporate'
            name_en = rget(s, 'name_english') or ''
            name_ch = rget(s, 'name_chinese') or ''
            name_display = f"{name_ch}  {name_en}".strip() if name_ch else (name_en or '(unnamed)')

            # ID / Company info
            if is_nat:
                id_no = rget(s, 'id_number') or rget(s, 'passport_number') or '-'
                passport_country = rget(s, 'passport_country') or ''
                id_block = f"ID/PPT: {id_no}"
                if passport_country:
                    id_block += f" ({passport_country})"
                id_block += " | Natural Person"
            else:
                comp_no = rget(s, 'company_number_ref') or '-'
                place_incorp = rget(s, 'place_of_incorporation') or ''
                legal_form = rget(s, 'legal_form') or ''
                id_block = f"Co No: {comp_no}"
                if place_incorp:
                    id_block += f" ({place_incorp})"
                if legal_form:
                    id_block += f" | {legal_form}"
                id_block += " | Body Corporate"

            addr = (rget(s, 'address') or '')[:200]
            nature_text = ', '.join(natures) if natures else '-'
            date_became = rget(s, 'date_became') or '-'
            date_cea = rget(s, 'date_ceased') or ''
            # Paul Tang format: date column has "YYYY-MM-DD  /" (current) or "YYYY-MM-DD  /  YYYY-MM-DD" (ceased)
            date_display = f"{date_became}  /  {date_cea}" if date_cea else f"{date_became}  /"

            entry_date = rget(s, 'created_at') or ''
            if entry_date and len(entry_date) > 10:
                entry_date = entry_date[:10]

            # Remarks: "Current / 現任" goes here per Paul Tang format, + designated rep + user remarks
            remarks_parts = []
            if not date_cea:
                remarks_parts.append("Current / 現任")
            if rget(s, 'is_designated_rep') and rget(s, 'designated_rep_name'):
                remarks_parts.append(f"Rep: {rget(s, 'designated_rep_name')}")
            user_remarks = rget(s, 'remarks') or ''
            if user_remarks:
                remarks_parts.append(user_remarks)
            remarks = '\n'.join(remarks_parts) if remarks_parts else ''
            row_data = [entry_date, name_display, addr, id_block, nature_text, date_display, remarks]

            # Calculate row height from longest wrapped cell
            row_h = min_row_h
            cell_lines_list = []
            for ci, txt in enumerate(row_data):
                if not txt:
                    cell_lines_list.append(1)
                    continue
                font_name = 'TC' if has_cjk(str(txt)) else 'TNR'
                pdf.set_font(font_name, '', data_size)
                cell_pad = 4
                cw_avail = (col_w[ci] if ci < len(col_w) else (end_x - col_x[ci])) - cell_pad
                if cw_avail < 20:
                    cw_avail = 20
                lines = wrap_text_to_lines(str(txt), font_name, '', data_size, cw_avail)
                cell_lines_list.append(len(lines))
                row_h = max(row_h, len(lines) * (data_size + 4) + 4)

            # Page break
            if y + row_h > PH - 70:
                line_h(M, end_x, y, w=0.5)
                pdf.add_page()
                y = 22
                tnr("SIGNIFICANT CONTROLLERS REGISTER (Cont'd)", PW / 2, y, size=13, bold=True, align='C')
                y += 16
                tc("重要控制人登記冊（續）", PW / 2, y, size=11, bold=True, align='C')
                y += 14
                line_h(M, PW - M, y, w=0.5)
                y += 8
                hdr_y0 = y
                for label, ci in hdr_labels:
                    x0 = col_x[ci]
                    cw_val = col_w[ci] if ci < len(col_w) else (end_x - col_x[ci])
                    draw_cell_border(x0, y, cw_val, hdr_h)
                    lines = label.split('\n')
                    text_block_h = len(lines) * hdr_line_h
                    text_start_y = y + (hdr_h - text_block_h) / 2
                    for li, line_text in enumerate(lines):
                        font_name = 'TC' if has_cjk(line_text) else 'TNR'
                        pdf.set_font(font_name, 'B', 7)
                        pdf.set_text_color(0, 0, 0)
                        lw = pdf.get_string_width(line_text)
                        lx = x0 + (cw_val - lw) / 2
                        pdf.set_xy(lx, text_start_y + li * hdr_line_h)
                        pdf.cell(lw, hdr_line_h, line_text)
                y += hdr_h
                table_top_y = hdr_y0

            # Draw row cells
            for ci, txt in enumerate(row_data):
                x0 = col_x[ci]
                cw_val = col_w[ci] if ci < len(col_w) else (end_x - col_x[ci])
                draw_cell_border(x0, y, cw_val, row_h)
                if txt:
                    font_name = 'TC' if has_cjk(str(txt)) else 'TNR'
                    pdf.set_font(font_name, '', data_size)
                    pdf.set_text_color(0, 0, 0)
                    cell_pad = 3
                    cw_avail = cw_val - cell_pad * 2
                    if cw_avail < 20:
                        cw_avail = 20
                    lines = wrap_text_to_lines(str(txt), font_name, '', data_size, cw_avail)
                    is_remarks_col = (ci == 6)  # Remarks column — center per Paul Tang format
                    for li, line_text in enumerate(lines):
                        if is_remarks_col:
                            lw = pdf.get_string_width(line_text)
                            lx = x0 + (cw_val - lw) / 2
                        else:
                            lx = x0 + cell_pad
                        pdf.set_xy(lx, y + 2 + li * (data_size + 4))
                        pdf.cell(cw_avail, data_size + 4, line_text)
            y += row_h

    # Table bottom border
    line_h(M, end_x, y, w=0.5)
    y += 14

    # ═══════════════════════════════════════════════════════
    # ADDITIONAL MATTERS — 2×2 table (header row + content row)
    # ═══════════════════════════════════════════════════════
    add_h_hdr = 26  # header row height
    add_h_content = 48  # content row height
    add_w = CW * 0.5

    # Row 0: Headers — vertically centered with more bottom padding
    add_y0 = y
    draw_cell_border(M, y, add_w, add_h_hdr)
    draw_cell_border(M + add_w, y, add_w, add_h_hdr)
    tnr("Additional Matterse", M + 3, y + 4, size=7, bold=True)
    tc("额外事項", M + 3, y + 14, size=7)
    # Remarks — centered horizontally in right cell
    rmk_text = "Remarks"
    pdf.set_font('TNR', 'B', 7)
    rmk_w = pdf.get_string_width(rmk_text)
    tnr(rmk_text, M + add_w + (add_w - rmk_w) / 2, y + 4, size=7, bold=True)
    rmk_ch = "備註"
    pdf.set_font('TC', '', 7)
    rmk_ch_w = pdf.get_string_width(rmk_ch)
    tc(rmk_ch, M + add_w + (add_w - rmk_ch_w) / 2, y + 14, size=7)
    y += add_h_hdr

    # Row 1: Empty content cells
    draw_cell_border(M, y, add_w, add_h_content)
    draw_cell_border(M + add_w, y, add_w, add_h_content)
    y += add_h_content

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})

# ─── R2 存儲本地替身（文件系統，鏡像生產 /api/storage/<bucket>/<file...>）───
STORAGE_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'storage')
STORAGE_BUCKETS = {'pdf-templates', 'company-documents', 'company-logs', 'backups'}


def _storage_resolve(bucket, filepath):
    """把 <bucket>/<filepath> 解析成安全的本地絕對路徑，阻止路徑穿越。非法返回 None。"""
    if bucket not in STORAGE_BUCKETS:
        return None
    bucket_dir = os.path.abspath(os.path.join(STORAGE_ROOT, bucket))
    target = os.path.abspath(os.path.join(bucket_dir, filepath))
    # 確保 target 仍在 bucket_dir 之內（防 ../ 穿越）
    if target != bucket_dir and not target.startswith(bucket_dir + os.sep):
        return None
    return target


@app.route('/api/storage/<bucket>/<path:filepath>', methods=['GET', 'OPTIONS'])
def storage_get(bucket, filepath):
    if request.method == 'OPTIONS':
        return ('', 204)
    target = _storage_resolve(bucket, filepath)
    if not target:
        return jsonify({'error': 'Invalid bucket or path'}), 400
    if not os.path.isfile(target):
        return jsonify({'error': 'File not found'}), 404
    import mimetypes
    ctype = mimetypes.guess_type(target)[0] or 'application/octet-stream'
    with open(target, 'rb') as f:
        data = f.read()
    resp = Response(data, mimetype=ctype)
    dl = request.args.get('download')
    if dl:
        resp.headers['Content-Disposition'] = f'attachment; filename="{dl}"'
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


@app.route('/api/storage/<bucket>/<path:filepath>', methods=['POST'])
def storage_put(bucket, filepath):
    target = _storage_resolve(bucket, filepath)
    if not target:
        return jsonify({'error': 'Invalid bucket or path'}), 400
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as f:
        f.write(request.get_data())
    return jsonify({'success': True, 'path': filepath}), 201


@app.route('/api/storage/<bucket>/<path:filepath>', methods=['DELETE'])
def storage_delete(bucket, filepath):
    target = _storage_resolve(bucket, filepath)
    if not target:
        return jsonify({'error': 'Invalid bucket or path'}), 400
    if os.path.isfile(target):
        os.remove(target)
    return jsonify({'success': True})


# ─── Share Transfer PDFs (Instrument / Bought&Sold Note / Share Certificate) ───
@app.route('/api/generate-share-transfer-pdf', methods=['POST'])
def generate_share_transfer_pdf():
    data = request.get_json(silent=True) or {}
    company_id = data.get('companyId', '')
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400

    doc_type = data.get('documentType', 'instrument_of_transfer')

    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Company not found'}), 404

    txs = db.execute(
        "SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date DESC",
        (company_id,)).fetchall()

    tx = txs[0] if txs else {}
    company_dict = dict(company)
    tx_dict = dict(tx) if tx else {}
    all_tx_dicts = [dict(t) for t in txs]

    pdf = create_pdf()
    if doc_type == 'share_certificate':
        _build_share_certificate(pdf, company_dict, tx_dict)
    elif doc_type == 'bought_sold_note':
        _build_bought_sold_note(pdf, company_dict, tx_dict)
    else:
        _build_instrument_of_transfer(pdf, company_dict, tx_dict, all_tx_dicts)

    pdf_bytes = pdf.output()
    return jsonify({'pdf': base64.b64encode(pdf_bytes).decode('utf-8')})


def _build_instrument_of_transfer(pdf, company, tx, all_txs):
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)
    y, left = 45, 45
    page_w = 595

    pdf_draw(pdf, "股份轉讓文書 / Instrument of Transfer", left, y, size=15)
    y += 20
    pdf.line(left, y, page_w - left, y)
    y += 14

    def draw_line(label, value):
        nonlocal y
        pdf_draw(pdf, label, left, y, size=10, gray=80)
        pdf_draw(pdf, value or "__________________________", left + 140, y, size=10)
        y += 22

    draw_line("公司名稱 Company:", company.get('name', ''))
    draw_line("BR 號碼:", company.get('company_number', ''))
    if company.get('chinese_name'):
        draw_line("中文名稱:", company.get('chinese_name', ''))

    y += 10
    pdf_draw(pdf, "轉讓詳情 / Transfer Details", left, y, size=12)
    y += 6
    pdf.line(left, y, page_w - left, y)
    y += 16

    itx_shares = tx.get('shares', 0) or 0
    itx_par_val = float(tx.get('price_per_share') or 1.00)
    itx_cons = tx.get('total_consideration') or (itx_shares * itx_par_val)

    draw_line("轉讓人 Transferor:", tx.get('from_name', ''))
    draw_line("受讓人 Transferee:", tx.get('to_name', ''))
    draw_line("股份數目 No. of Shares:",
              f"{itx_shares:,}  of  HK${itx_par_val:,.2f}  each" if tx.get('shares') else "________________")
    draw_line("股份類別 Share Class:", tx.get('share_type', 'Ordinary'))
    draw_line("每股代價 Price per Share:",
              f"{tx.get('currency', '')} {tx.get('price_per_share', '')}" if tx.get('price_per_share') else "________________")
    draw_line("總代價 Total Consideration:",
              f"HK${itx_cons:,.2f}" if (tx.get('total_consideration') or tx.get('shares')) else "________________")
    draw_line("轉讓日期 Transfer Date:", tx.get('transaction_date', ''))
    draw_line("文書編號 Instrument No:", tx.get('instrument_number', ''))

    y += 20
    pdf_draw(pdf, "轉讓人簽署 / Signed by Transferor:", left, y, size=10)
    pdf_draw(pdf, "____________________________", left + 200, y, size=10)
    y += 25
    pdf_draw(pdf, "受讓人簽署 / Signed by Transferee:", left, y, size=10)
    pdf_draw(pdf, "____________________________", left + 200, y, size=10)
    y += 25
    pdf_draw(pdf, "日期 Date: ____/____/________", left, y, size=10)

    pdf_draw(pdf, f"由 Muse Labs Engineering Limited 秘書系統生成 | {datetime.now().strftime('%Y-%m-%d')}",
             left, 30, size=7, gray=150)


def _build_bought_sold_note(pdf, company, tx):
    """Bought & Sold Note — matching Paul Tang & Co reference format.
    Free-form layout (no table), tab-stop alignment, Times New Roman, thick title lines."""
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)
    M = 40  # margin
    PW, PH = 595, 842
    half_h = PH / 2
    label_x = M + 5
    value_x = PW / 3 + 10  # ~30% for label, 70% for value

    from_name = tx.get('from_name', '')
    to_name = tx.get('to_name', '')
    shares = tx.get('shares', 0) or 0
    par_val = tx.get('price_per_share', '1.00')
    if not par_val or par_val == '':
        par_val = '1.00'
    consideration = tx.get('total_consideration') or (shares * float(par_val))
    tx_date = tx.get('transaction_date', '')
    co_name = company.get('name', '')

    def tnr(text, x, y, size=12, bold=False, align='L'):
        style = 'B' if bold else ''
        pdf.set_font('TNR', style, size)
        pdf.set_text_color(0, 0, 0)
        if align == 'C':
            tw = pdf.get_string_width(str(text or ''))
            x = x - tw / 2
        pdf.set_xy(x, y)
        pdf.cell(0, size + 3, str(text or ''))

    def tc(text, x, y, size=12, bold=False):
        style = 'B' if bold else ''
        pdf.set_font('TC', style, size)
        pdf.set_text_color(0, 0, 0)
        pdf.set_xy(x, y)
        pdf.cell(0, size + 3, str(text or ''))

    def draw_row(label, value, y_pos, size=12):
        """Draw label (left) + value (right) pair using tab-stop alignment."""
        tnr(label, label_x, y_pos, size=size)
        tnr(str(value or ''), value_x, y_pos, size=size)

    # ══════════════════════════════════════
    # SOLD NOTE — TOP half
    # ══════════════════════════════════════
    y = PH - 50

    # Title: centered, 16pt bold TNR
    tnr("Sold Note", PW / 2, y, size=16, bold=True, align='C')
    y -= 4
    tc("賣出票據", PW / 2, y, size=11, bold=False)
    y -= 22

    # Thick black line under title (1.5pt, ~70% page width)
    line_w = (PW - 2 * M) * 0.7
    line_start = (PW - line_w) / 2
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(1.5)
    pdf.line(line_start, y, line_start + line_w, y)
    pdf.set_line_width(0.3)
    y -= 18

    # Content rows — 12pt TNR
    draw_row("Name of Purchaser (Transferee):", to_name, y); y -= 18
    draw_row("Address:", "", y); y -= 18
    draw_row("Occupation:", "", y); y -= 18
    draw_row("Name of Company:", co_name, y); y -= 18
    draw_row("Number of Shares:", f"{shares:,}  of  HK${par_val}  each", y); y -= 18
    if consideration:
        draw_row("Consideration Received:", f"HK${consideration:,.2f}", y); y -= 18
    else:
        draw_row("Consideration Received:", "", y); y -= 18

    y -= 10
    # Transferor signature line
    tnr(f"(Transferor)  {from_name}", label_x, y, size=12)
    sig_tf_w = pdf.get_string_width(f"(Transferor)  {from_name}")
    sig_end = label_x + sig_tf_w + 10
    # Signature underline from end of text to right margin
    pdf.set_line_width(0.6)
    pdf.line(sig_end, y + 3, PW - M, y + 3)
    pdf.set_line_width(0.3)
    y -= 16
    tnr(co_name, sig_end, y, size=8)
    y -= 14

    # Date line
    tnr(f"Hong Kong, Dated  {tx_date}", label_x, y, size=12)
    y -= 24

    # ══════════════════════════════════════
    # DIVIDER
    # ══════════════════════════════════════
    pdf.set_draw_color(100, 100, 100)
    pdf.set_line_width(0.5)
    pdf.line(M, half_h, PW - M, half_h)
    pdf.set_line_width(0.3)
    pdf.set_draw_color(0, 0, 0)

    y = half_h - 18

    # ══════════════════════════════════════
    # BOUGHT NOTE — BOTTOM half
    # ══════════════════════════════════════
    # Title: centered, 16pt bold TNR
    tnr("Bought Note", PW / 2, y, size=16, bold=True, align='C')
    y -= 4
    tc("買入票據", PW / 2, y, size=11)
    y -= 22

    # Thick black line under title
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(1.5)
    pdf.line(line_start, y, line_start + line_w, y)
    pdf.set_line_width(0.3)
    y -= 18

    # Content rows
    draw_row("Name of Seller (Transferor):", from_name, y); y -= 18
    draw_row("Address:", "", y); y -= 18
    draw_row("Occupation:", "", y); y -= 18
    draw_row("Name of Company:", co_name, y); y -= 18
    draw_row("Number of Shares:", f"{shares:,}  of  HK${par_val}  each", y); y -= 18
    if consideration:
        draw_row("Consideration Received:", f"HK${consideration:,.2f}", y); y -= 18
    else:
        draw_row("Consideration Received:", "", y); y -= 18

    y -= 10
    # Transferee signature line
    tnr(f"(Transferee)  {to_name}", label_x, y, size=12)
    sig_tee_w = pdf.get_string_width(f"(Transferee)  {to_name}")
    sig_tee_end = label_x + sig_tee_w + 10
    pdf.set_line_width(0.6)
    pdf.line(sig_tee_end, y + 3, PW - M, y + 3)  # horizontal line to right
    pdf.set_line_width(0.3)
    y -= 18
    tnr(f"Hong Kong, Dated  {tx_date}", label_x, y, size=12)

    # Footer
    tnr(f"Generated by Muse Labs | {datetime.now().strftime('%Y-%m-%d')}",
        M, 20, size=7)


def _build_share_certificate(pdf, company, tx):
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)
    y, left, page_w = 45, 45, 595
    page_h = 842

    # Ornate border
    pdf.set_draw_color(25, 76, 25)
    pdf.set_line_width(3)
    pdf.rect(15, 15, page_w - 30, page_h - 30)
    pdf.set_draw_color(51, 127, 51)
    pdf.set_line_width(0.5)
    pdf.rect(22, 22, page_w - 44, page_h - 44)
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.2)

    y = page_h - 70
    pdf_draw(pdf, "股票證書 / SHARE CERTIFICATE", page_w / 2 - 150, y, size=16)
    y -= 28
    pdf.line(80, y, page_w - 80, y)
    y -= 24

    pdf_draw(pdf, f"公司名稱: {company.get('name', '________________________________')}", 50, y, size=10)
    y -= 18
    if company.get('chinese_name'):
        pdf_draw(pdf, f"中文名稱: {company.get('chinese_name', '')}", 50, y, size=10)
        y -= 18
    pdf_draw(pdf, f"商業登記號碼: {company.get('company_number', '________________')}", 50, y, size=10)
    y -= 18
    reg_office = company.get('address') or company.get('registered_office', '')
    pdf_draw(pdf, f"註冊辦事處地址: {reg_office or '________________________________'}", 50, y, size=10)

    y -= 30
    pdf_draw(pdf, "茲證明 / THIS IS TO CERTIFY that", 50, y, size=10, gray=80)
    y -= 24

    holder_name = tx.get('to_name', '________________________________')
    share_class = tx.get('share_type', 'Ordinary')
    shares_val = tx.get('shares', '________')
    price = tx.get('price_per_share', '____')

    pdf_draw(pdf, holder_name, page_w / 2 - 80, y, size=13)
    y -= 22
    pdf_draw(pdf, "is/are the registered holder(s) of", 50, y, size=10, gray=80)
    y -= 22
    pdf_draw(pdf, f"{shares_val} {share_class} Share(s)", page_w / 2 - 60, y, size=13)
    y -= 22
    pdf_draw(pdf, f"of HK$ {price} each fully paid", 50, y, size=10, gray=80)
    y -= 22
    pdf_draw(pdf, "in the above-named Company", 50, y, size=10, gray=80)

    y -= 30
    pdf_draw(pdf, f"證書編號 Certificate No: {tx.get('instrument_number', '______________')}",
             50, y, size=9, gray=100)

    y -= 50
    pdf.line(50, y, 200, y)
    pdf.line(page_w - 200, y, page_w - 50, y)
    y -= 14
    pdf_draw(pdf, "董事 Director", 50, y, size=8, gray=100)
    pdf_draw(pdf, "公司秘書 Secretary", page_w - 200, y, size=8, gray=100)

    y -= 24
    pdf_draw(pdf, f"簽發日期 Issue Date: {tx.get('transaction_date', '________________')}",
             50, y, size=9)

    pdf_draw(pdf, "由 Muse Labs Engineering Limited 秘書系統生成",
             page_w / 2 - 80, 30, size=7, gray=150)


# ─── Generic CRUD ───
# SQL-safe identifier pattern: alphanumeric + underscore, must start with letter or underscore
_SAFE_ID_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')

def _safe_ident(name: str) -> bool:
    """Return True if `name` is a safe SQL identifier (no injection risk)."""
    return bool(_SAFE_ID_RE.match(name))


@app.route('/api/<table_name>', methods=['GET'])
def table_list(table_name):
    if table_name not in TABLES:
        return jsonify({'error': 'Not found'}), 404
    db = get_db()
    # Build query from search params — supports operator suffixes: __neq, __gt, __lt,
    # __gte, __lte, __like, __ilike, __in, __is.  Plain keys → eq.
    reserved = {'search', 'limit', 'offset', '_order', '_order_dir'}
    where = []
    bindings = []
    for key in request.args:
        if key in reserved:
            continue
        val = request.args.get(key)
        if val is None or val == '':
            continue
        # Operator suffix: column__op
        if '__' in key:
            col, op = key.rsplit('__', 1)
            if not _safe_ident(col):
                continue  # skip unsafe column names
            if op == 'neq':
                where.append(f"{col} != ?")
                bindings.append(val)
            elif op == 'gt':
                where.append(f"{col} > ?")
                bindings.append(val)
            elif op == 'lt':
                where.append(f"{col} < ?")
                bindings.append(val)
            elif op == 'gte':
                where.append(f"{col} >= ?")
                bindings.append(val)
            elif op == 'lte':
                where.append(f"{col} <= ?")
                bindings.append(val)
            elif op in ('like', 'ilike'):
                where.append(f"{col} LIKE ?")
                bindings.append(val)
            elif op == 'in':
                vals = [v.strip() for v in val.split(',') if v.strip()]
                if vals:
                    placeholders = ','.join(['?'] * len(vals))
                    where.append(f"{col} IN ({placeholders})")
                    bindings.extend(vals)
            elif op == 'is':
                where.append(f"{col} IS {val}")  # val is SQL literal e.g. NULL, NOT NULL
            else:
                where.append(f"{key} = ?")
                bindings.append(val)
        else:
            if not _safe_ident(key):
                continue  # skip unsafe column names
            where.append(f"{key} = ?")
            bindings.append(val)
    search = request.args.get('search')
    if search:
        s = f"%{search}%"
        where.append("(name LIKE ? OR name_english LIKE ? OR name_chinese LIKE ?)")
        bindings.extend([s, s, s])
    sql = f"SELECT * FROM {table_name}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    # Order: use _order param if provided, otherwise default to created_at DESC
    order_col = request.args.get('_order')
    if order_col and _safe_ident(order_col):
        order_dir = request.args.get('_order_dir', 'asc')
        sql += f" ORDER BY {order_col} {'DESC' if order_dir == 'desc' else 'ASC'}"
    else:
        try:
            db.execute(f"SELECT created_at FROM {table_name} LIMIT 1")
            sql += " ORDER BY created_at DESC"
        except sqlite3.OperationalError:
            pass
    limit = min(int(request.args.get( 'limit', '100')), 1000)
    offset = int(request.args.get( 'offset', '0'))
    sql += f" LIMIT {limit} OFFSET {offset}"
    rows = db.execute(sql, bindings).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/<table_name>/<item_id>', methods=['GET'])
def table_get(table_name, item_id):
    if table_name not in TABLES:
        return jsonify({'error': 'Not found'}), 404
    db = get_db()
    row = db.execute(f"SELECT * FROM {table_name} WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(dict(row))

# ─── Company version snapshots (VE-01/02/03/08) ───
# 需納入版本快照 / 差異比對的公司欄位 → 繁體標籤
VERSION_FIELDS = {
    'name': '英文名稱', 'chinese_name': '中文名稱', 'company_number': '商業登記號碼',
    'ci_number': '公司註冊編號', 'trading_name': '商業名稱', 'business_nature': '業務性質',
    'company_type': '公司類型', 'business_code': '業務代碼', 'status': '狀態',
    'incorporation_date': '成立日期', 'jurisdiction': '司法管轄區',
    'reg_flat': '註冊地址-室/樓/座', 'reg_building': '註冊地址-大廈',
    'reg_street': '註冊地址-街道', 'reg_district': '註冊地址-區', 'reg_region': '註冊地址-地區',
    'email': '電郵地址', 'phone': '電話', 'signer_role_id': '簽署人',
}


def _company_snapshot(db, company_id):
    """回傳公司當前資料的 dict 快照（僅 VERSION_FIELDS 欄位）。"""
    row = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    return {k: (d.get(k) if d.get(k) is not None else '') for k in VERSION_FIELDS}


def _latest_version(db, company_id):
    """回傳該公司最新版本 row(dict)，無則 None。"""
    r = db.execute(
        "SELECT * FROM company_versions WHERE company_id = ? ORDER BY version_no DESC LIMIT 1",
        (company_id,)
    ).fetchone()
    return dict(r) if r else None


def record_company_version(db, company_id, changed_by=''):
    """在公司資料變更後寫入一筆版本快照。僅當相對上一版有差異（或首版）時寫入。
    回傳新版本號，或 None（無變化未寫入）。"""
    snap = _company_snapshot(db, company_id)
    if snap is None:
        return None
    prev = _latest_version(db, company_id)
    changed = []
    if prev:
        try:
            prev_snap = json.loads(prev.get('snapshot') or '{}')
        except (ValueError, TypeError):
            prev_snap = {}
        for k in VERSION_FIELDS:
            if str(prev_snap.get(k, '')) != str(snap.get(k, '')):
                changed.append(k)
        if not changed:
            return None  # 無實質變化，不製造重複版本
        version_no = int(prev.get('version_no') or 0) + 1
    else:
        version_no = 1  # 首版（基線），changed 留空
    labels = [VERSION_FIELDS[k] for k in changed]
    summary = ('建立初始版本' if version_no == 1
               else '更新：' + '、'.join(labels) if labels else '更新')
    db.execute(
        "INSERT INTO company_versions (id, company_id, version_no, snapshot, changed_fields, change_summary, changed_by) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), company_id, version_no, json.dumps(snap, ensure_ascii=False),
         json.dumps(changed, ensure_ascii=False), summary, changed_by)
    )
    return version_no


@app.route('/api/companies/<company_id>/versions', methods=['GET'])
def company_versions_list(company_id):
    """列出公司所有版本（新→舊），含解析後的 snapshot / changed_fields。"""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM company_versions WHERE company_id = ? ORDER BY version_no DESC",
        (company_id,)
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d['snapshot'] = json.loads(d.get('snapshot') or '{}')
        except (ValueError, TypeError):
            d['snapshot'] = {}
        try:
            d['changed_fields'] = json.loads(d.get('changed_fields') or '[]')
        except (ValueError, TypeError):
            d['changed_fields'] = []
        out.append(d)
    return jsonify(out)


@app.route('/api/companies/<company_id>/versions/snapshot', methods=['POST'])
def company_version_snapshot(company_id):
    """手動建立一個當前資料的版本快照（VE 手動存檔）。"""
    db = get_db()
    changed_by = (request.json or {}).get('changed_by', '') if request.is_json else ''
    v = record_company_version(db, company_id, changed_by)
    db.commit()
    return jsonify({'success': True, 'version_no': v, 'created': v is not None})


@app.route('/api/<table_name>', methods=['POST'])
def table_create(table_name):
    if table_name not in TABLES:
        return jsonify({'error': 'Not found'}), 404
    data = request.json
    if 'id' not in data:
        data['id'] = str(uuid.uuid4())
    db = get_db()
    keys = list(data.keys())
    vals = list(data.values())
    placeholders = ', '.join(['?'] * len(keys))
    db.execute(f"INSERT INTO {table_name} ({', '.join(keys)}) VALUES ({placeholders})", vals)
    db.commit()
    return jsonify({'success': True, 'id': data['id']}), 201

@app.route('/api/<table_name>/<item_id>', methods=['PUT'])
def table_update(table_name, item_id):
    if table_name not in TABLES:
        return jsonify({'error': 'Not found'}), 404
    data = request.json
    db = get_db()
    sets = [f"{k} = ?" for k in data.keys()]
    vals = list(data.values()) + [item_id]
    db.execute(f"UPDATE {table_name} SET {', '.join(sets)}, updated_at = datetime('now') WHERE id = ?", vals)
    # 公司資料變更後，自動記錄版本快照（VE-01/02/03）
    if table_name == 'companies':
        try:
            record_company_version(db, item_id)
        except Exception as e:
            print(f"[VERSION] snapshot failed: {e}")
    db.commit()
    return jsonify({'success': True})

@app.route('/api/<table_name>/<item_id>', methods=['DELETE'])
def table_delete(table_name, item_id):
    if table_name not in TABLES:
        return jsonify({'error': 'Not found'}), 404
    db = get_db()

    if table_name == 'companies':
        # ─── Cascade delete: clean up all related records ───
        # 1. Find persons that will become orphaned (only in this company)
        orphan_person_ids = [
            row[0] for row in db.execute(
                "SELECT person_id FROM person_company_roles WHERE company_id = ?", (item_id,)
            ).fetchall()
        ]
        # 2. Delete all related records across tables
        for tbl in ['person_company_roles', 'reminders', 'company_logs',
                     'resolutions', 'significant_controllers', 'share_transactions', 'invoices']:
            db.execute(f"DELETE FROM {tbl} WHERE company_id = ?", (item_id,))
        # 3. Delete orphaned persons (no remaining roles in any company)
        for pid in orphan_person_ids:
            remaining = db.execute(
                "SELECT COUNT(*) FROM person_company_roles WHERE person_id = ?", (pid,)
            ).fetchone()[0]
            if remaining == 0:
                db.execute("DELETE FROM persons WHERE id = ?", (pid,))
        # 4. officers & shareholders have ON DELETE CASCADE, auto-cleaned
        db.execute("DELETE FROM companies WHERE id = ?", (item_id,))
    elif table_name == 'persons':
        # Cascade: clean up person_company_roles before deleting person
        db.execute("DELETE FROM person_company_roles WHERE person_id = ?", (item_id,))
        db.execute("DELETE FROM persons WHERE id = ?", (item_id,))
    else:
        db.execute(f"DELETE FROM {table_name} WHERE id = ?", (item_id,))

    db.commit()
    return jsonify({'success': True})

@app.route('/api/<table_name>', methods=['DELETE'])
def table_delete_filtered(table_name):
    if table_name not in TABLES:
        return jsonify({'error': 'Not found'}), 404
    db = get_db()
    where = []
    bindings = []
    for key in request.args:
        where.append(f"{key} = ?")
        bindings.append(request.args.get(key))
    if where:
        db.execute(f"DELETE FROM {table_name} WHERE {' AND '.join(where)}", bindings)
    db.commit()
    return jsonify({'success': True})

# ─── Special routes ───
@app.route('/api/persons/cleanup-orphans', methods=['POST'])
def cleanup_orphan_persons():
    """Delete all persons that have no person_company_roles (no company binding)."""
    db = get_db()
    result = db.execute('''
        DELETE FROM persons WHERE id IN (
            SELECT p.id FROM persons p
            LEFT JOIN person_company_roles r ON p.id = r.person_id
            WHERE r.person_id IS NULL
        )
    ''')
    db.commit()
    count = result.rowcount
    return jsonify({'success': True, 'deleted': count})

@app.route('/api/search', methods=['GET'])
def search():
    q = request.args.get( 'q', '')
    if not q:
        return jsonify([])
    s = f"%{q}%"
    db = get_db()
    companies = db.execute(
        "SELECT id, name, chinese_name, company_number, ci_number, company_type, status, 'company' as type "
        "FROM companies WHERE name LIKE ? OR chinese_name LIKE ? OR company_number LIKE ? OR ci_number LIKE ? "
        "ORDER BY name LIMIT 30",
        (s, s, s, s)).fetchall()
    persons = db.execute(
        "SELECT id, name_english, name_chinese, identity, id_number, passport_number, 'person' as type "
        "FROM persons WHERE name_english LIKE ? OR name_chinese LIKE ? OR id_number LIKE ? OR passport_number LIKE ? "
        "ORDER BY name_english LIMIT 30",
        (s, s, s, s)).fetchall()
    out = [dict(r) for r in companies]
    for r in persons:
        p = dict(r)
        # 附上關聯公司+角色，讓前端點擊可定位公司登記冊
        p['roles'] = [dict(x) for x in db.execute(
            "SELECT pcr.role, pcr.date_ceased, c.id AS company_id, c.name AS company_name "
            "FROM person_company_roles pcr JOIN companies c ON c.id = pcr.company_id "
            "WHERE pcr.person_id = ?", (p['id'],)).fetchall()]
        out.append(p)
    return jsonify(out)

@app.route('/api/companies/<item_id>/full', methods=['GET'])
def company_full(item_id):
    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (item_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Not found'}), 404
    officers = db.execute("SELECT * FROM officers WHERE company_id = ?", (item_id,)).fetchall()
    # Read shareholders from person_company_roles (same source as frontend hooks)
    shareholder_roles = db.execute(
        "SELECT pcr.*, p.name_english AS person_name_english, p.name_chinese AS person_name_chinese, "
        "p.identity AS person_identity, p.id_number AS person_id_number, p.address AS person_address, "
        "p.email AS person_email, p.service_address AS person_service_address "
        "FROM person_company_roles pcr "
        "LEFT JOIN persons p ON p.id = pcr.person_id "
        "WHERE pcr.company_id = ? AND pcr.role = 'shareholder'",
        (item_id,)).fetchall()
    shareholders = [dict(r) for r in shareholder_roles]
    scrs = db.execute("SELECT * FROM significant_controllers WHERE company_id = ?", (item_id,)).fetchall()
    logs = db.execute("SELECT * FROM company_logs WHERE company_id = ?", (item_id,)).fetchall()
    return jsonify({**dict(company),
                    'officers': [dict(r) for r in officers],
                    'shareholders': [dict(r) for r in shareholders],
                    'significant_controllers': [dict(r) for r in scrs],
                    'logs': [dict(r) for r in logs]})

@app.route('/api/backup', methods=['POST'])
def backup():
    return jsonify({'success': True, 'message': 'Local backup skipped (dev mode)'})

# ─── NAR1 PDF 生成（本地 Python + PyMuPDF） ───
import fitz  # PyMuPDF

_CJK_RE = re.compile(r'[㐀-鿿豈-﫿]')
_PURE_NUMBER_RE = re.compile(r'^[\d,.\s]+$')
_ADDR_FLAT_RE = re.compile(
    r'^(?:flat|room|rm|unit|shop|suite|ste|workshop|portion|floor|fl|level|lvl|\d+/f|g/f|gf|lg/f|ug/f|m/f|b\d*/f)'
    r'|\b(?:tower|twr|block|blk)\b'
    r'|\ball\s+(?:that|those)\b',
    re.IGNORECASE
)
_ADDR_BUILDING_RE = re.compile(
    r'\b(?:building|bldg|mansion|centre|center|tower|house|plaza|estate|court|gardens|industrial|commercial|factory|hotel|complex|arcade|heights|square|place|lane|exchange|finance|financial|plaza|villa)\b',
    re.IGNORECASE
)
_ADDR_STREET_RE = re.compile(
    r'\b(?:road|street|avenue|drive|lane|path|way|boulevard|terrace|row|close|crescent|highway|bridge|pier|ferry|circus|central|plaza)\b|^\d',
    re.IGNORECASE
)
# Broad HK regions that should always merge into country (too large to be a district).
# "Kowloon" is intentionally excluded — it can be a valid district when no more-specific
# area is present (e.g. "22 Nathan Road, Kowloon, Hong Kong").
_ADDR_REGION_RE = re.compile(
    r'^(?:new\s+territories|n\.?\s*t\.?|新界)$',
    re.IGNORECASE
)
_ADDR_COUNTRY_RE = re.compile(
    r'(hong\s*kong|hk\b|china|prc|macau|macao|singapore|taiwan|united\s+\w+|\busa\b|\buk\b|canada|australia|japan|korea|h\.?k\.?\s*sar|kowloon|kln\b|new\s+territories|n\.?\s*t\.?\b|british\s+virgin\s+islands|bvi\b|香港|中國|澳門|台灣|新加坡|日本|韓國|英國|美國|加拿大|澳洲|九龍|新界)',
    re.IGNORECASE
)

def _is_ascii(s):
    return all(ord(c) < 128 for c in s)

def _parse_english_name(full_name):
    """返回 (surname, otherNames)"""
    cleaned = (full_name or '').replace(r'\s+', ' ').strip()
    if not cleaned or not any(c.isascii() and c.isalpha() for c in cleaned):
        return '', ''
    if _CJK_RE.search(cleaned):
        cleaned = _CJK_RE.sub(' ', cleaned).replace(r'\s+', ' ').strip()
        if not cleaned:
            return '', ''
    if ',' in cleaned:
        segs = [s.strip() for s in cleaned.split(',') if s.strip()]
        if len(segs) >= 2:
            return segs[0], ' '.join(segs[1:])
        if len(segs) == 1:
            return segs[0], ''
    parts = cleaned.split()
    if not parts:
        return '', ''
    surname = parts[0].rstrip(',')
    other = ' '.join(parts[1:]).lstrip(', ')
    return surname, other

def _parse_address(addr):
    """Parse a free-text address (typically comma-separated HK address) into
    {flat, building, street, district, country} for NAR1/ND2A/ND2B form fields.

    HK address convention: Flat → Floor → Building → Street No + Name → District → Region/Country
    """
    if not addr:
        return {'flat': '', 'building': '', 'street': '', 'district': '', 'country': ''}
    parts = [s.strip() for s in addr.split(',') if s.strip() and not _PURE_NUMBER_RE.match(s.strip())]
    if not parts:
        return {'flat': '', 'building': '', 'street': '', 'district': '', 'country': ''}

    # Single-part address: if it's a country/region → country, else → street
    if len(parts) == 1:
        if _ADDR_COUNTRY_RE.search(parts[0]):
            return {'flat': '', 'building': '', 'street': '', 'district': '', 'country': parts[0]}
        return {'flat': '', 'building': '', 'street': parts[0], 'district': '', 'country': ''}

    # ── Extract country (last part) ──
    country = ''
    if _ADDR_COUNTRY_RE.search(parts[-1]):
        country = parts.pop()

    # ── Extract district from the end ──
    district = ''
    if len(parts) >= 2:
        candidate = parts[-1]
        is_postal = len(candidate) <= 10 and re.match(r'^[A-Za-z]{0,3}\d[\dA-Za-z]*$', candidate)
        is_street = bool(_ADDR_STREET_RE.search(candidate))
        is_region = bool(_ADDR_REGION_RE.search(candidate))

        if is_region:
            # Broad region (New Territories / NT / 新界) → always merge into country
            region = parts.pop()
            country = region + ', ' + country
            # Re-extract: is there a real district before the region?
            if len(parts) >= 2:
                c2 = parts[-1]
                is_postal2 = len(c2) <= 10 and re.match(r'^[A-Za-z]{0,3}\d[\dA-Za-z]*$', c2)
                if not _ADDR_STREET_RE.search(c2) and not is_postal2 and not _ADDR_REGION_RE.search(c2) and not _ADDR_BUILDING_RE.search(c2) and not _ADDR_FLAT_RE.search(c2):
                    district = parts.pop()
        elif not is_street and not is_postal and not _ADDR_BUILDING_RE.search(candidate) and not _ADDR_FLAT_RE.search(candidate):
            district = parts.pop()

    # ── Extract flat/floor/unit/tower from the front ──
    flat_parts = []
    while len(parts) > 1 and _ADDR_FLAT_RE.search(parts[0]):
        flat_parts.append(parts.pop(0))
    flat = ', '.join(flat_parts)

    # ── Assign building and street ──
    if len(parts) == 1:
        part = parts[0]
        if _ADDR_BUILDING_RE.search(part) and not _ADDR_STREET_RE.search(part):
            building, street = part, ''
        elif _ADDR_FLAT_RE.search(part):
            flat = (flat + ', ' + part).strip(', ')
            building, street = '', ''
        else:
            building, street = '', part
    elif len(parts) >= 2:
        building = parts.pop(0)
        street = ', '.join(parts)
    else:
        building, street = '', ''

    return {'flat': flat, 'building': building, 'street': street, 'district': district, 'country': country}

def _parse_hkid_partial(id_number):
    if not id_number:
        return ''
    return re.sub(r'[()\-\s]', '', id_number).upper()[:4]

def _parse_passport_partial(passport_number):
    if not passport_number:
        return ''
    cleaned = re.sub(r'[^A-Za-z0-9]', '', passport_number).upper()
    return cleaned[:len(cleaned) // 2 + len(cleaned) % 2]

def _fmt_amount(n):
    return f'{n:,.2f}'

def _fmt_int(n):
    return f'{n:,}'

def _build_field_page_map(doc):
    """遍歷所有頁面，建立 field_name → page_index 映射（不存儲 widget 引用，避免 Annot not bound to page）"""
    fmap = {}
    for pi in range(doc.page_count):
        for w in doc[pi].widgets():
            name = w.field_name
            if name:
                fmap[name] = pi
    return fmap

def _set_text(doc, fmap, name, value):
    """在指定頁面上查找 widget 並設置值（必須在迭代內完成 update，widget 引用不能外傳）"""
    if name not in fmap:
        return False
    pi = fmap[name]
    for w in doc[pi].widgets():
        if w.field_name == name:
            try:
                w.field_value = value if value else ''
                w.update()
                return True
            except Exception:
                pass
            break
    return False

def _set_text_size(doc, fmap, name, value, font_size):
    """在指定頁面上查找 widget，設定值並縮小字號"""
    if name not in fmap or not value:
        return False
    pi = fmap[name]
    for w in doc[pi].widgets():
        if w.field_name == name:
            try:
                w.text_fontsize = float(font_size)
                w.field_value = str(value)
                w.update()
                return True
            except Exception:
                pass
            break
    return False

def _check(doc, fmap, name, should_check):
    """在指定頁面上查找 checkbox 並勾選"""
    if not should_check or name not in fmap:
        return False
    pi = fmap[name]
    for w in doc[pi].widgets():
        if w.field_name == name:
            try:
                # PyMuPDF 1.28+: w._annot is an Annot object (not dict),
                # so .get('AP') raises AttributeError. Use w.field_value = True
                # which automatically selects the "On" appearance state.
                w.field_value = True
                w.update()
                return True
            except Exception:
                pass
            break
    return False


def _select_dropdown(doc, fmap, name, value):
    """在指定頁面上查找 dropdown 並設置選中值"""
    if name not in fmap:
        return False
    pi = fmap[name]
    for w in doc[pi].widgets():
        if w.field_name == name:
            try:
                w.field_value = value
                w.update()
                return True
            except Exception:
                pass
            break
    return False

def _fill_nar1_pdf(data):
    """填充 NAR1 PDF 模板，返回 bytes"""
    import os
    template_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'templates', 'NAR1-template-new.pdf')
    doc = fitz.open(template_path)
    fmap = _build_field_page_map(doc)

    return_date = data.get('returnDate', '')
    if return_date:
        parts = return_date.split('-')
        year, month, day = parts[0], parts[1], parts[2]
    else:
        from datetime import date
        today = date.today()
        year, month, day = str(today.year), f'{today.month:02d}', f'{today.day:02d}'

    office = data.get('registeredOffice') or {}
    # NAR1 is a HK Companies Registry form — if registered office has
    # address fields but no country/region, default to 'Hong Kong'
    if not office.get('region') and not office.get('country'):
        has_addr = any(office.get(k) for k in ['flat', 'building', 'street', 'district'])
        if has_addr:
            office = dict(office)
            office['region'] = 'Hong Kong'
    br8 = (data.get('brNumber') or '').replace(r'[^0-9A-Za-z]', '')[:8]
    company_type = data.get('companyType') or ''
    ct_lower = company_type.lower()

    # ── P.1 公司資料 ──
    _set_text(doc, fmap, 'fill_1_P.1', br8)
    full_name = '\n'.join(filter(None, [data.get('name', ''), data.get('chineseName', '')]))
    _set_text(doc, fmap, 'fill_2_P.1', full_name)
    _set_text(doc, fmap, 'fill_3_P.1', data.get('tradingName', ''))
    _check(doc, fmap, 'cb_1_P.1', '私人' in company_type or 'private' in ct_lower)
    _check(doc, fmap, 'cb_2_P.1', '公眾' in company_type or 'public' in ct_lower)
    _check(doc, fmap, 'cb_3_P.1', '擔保' in company_type)
    _set_text(doc, fmap, 'fill_4_P.1', data.get('businessCode', ''))
    _set_text(doc, fmap, 'fill_5_P.1', data.get('businessNature', ''))
    _set_text(doc, fmap, 'fill_6_P.1', day)
    _set_text(doc, fmap, 'fill_7_P.1', month)
    _set_text(doc, fmap, 'fill_8_P.1', year)
    _set_text(doc, fmap, 'fill_15_P.1', office.get('flat', ''))
    _set_text(doc, fmap, 'fill_16_P.1', office.get('building', ''))
    _set_text(doc, fmap, 'fill_17_P.1', office.get('street', ''))
    _set_text(doc, fmap, 'fill_18_P.1', office.get('district', ''))
    # 區域下拉
    p1_region = office.get('region') or office.get('country', '')
    if p1_region:
        for name in ['Dropdown1_P.1', 'Dropdown_1_P.1']:
            if name in fmap:
                pi = fmap[name]
                for w in doc[pi].widgets():
                    if w.field_name == name:
                        try:
                            w.field_value = p1_region
                            w.update()
                        except Exception:
                            pass
                        break
                break

    presenter = data.get('presenter') or {}
    if presenter.get('name'):
        _set_text(doc, fmap, 'fill_19_P.1', presenter['name'])
    if presenter.get('address'):
        _set_text(doc, fmap, 'fill_20_P.1', presenter['address'])
    if presenter.get('phone'):
        _set_text_size(doc, fmap, 'fill_21_P.1', presenter['phone'], 10)
    if presenter.get('fax'):
        _set_text_size(doc, fmap, 'fill_22_P.1', presenter['fax'], 10)
    if presenter.get('email'):
        _set_text_size(doc, fmap, 'fill_23_P.1', presenter['email'], 10)
    if presenter.get('reference'):
        _set_text_size(doc, fmap, 'fill_24_P.1', presenter['reference'], 10)

    # ── P.2 股本 ──
    _set_text(doc, fmap, 'fill_1_P.2', br8)
    shareholders = data.get('shareholders') or []

    def _norm_class(raw):
        t = (raw or '').strip()
        if not t or 'ord' in t.lower() or '普通' in t:
            return 'ORDINARY SHARES'
        if 'pref' in t.lower() or '優先' in t:
            return 'PREFERENCE SHARES'
        return t.upper()

    def _norm_currency(raw):
        c = (raw or 'HKD').strip().upper()
        return 'HK$' if c in ('HKD', 'HK$') else ('US$' if c in ('USD', 'US$') else c)

    share_type_map = {}
    for sh in shareholders:
        cls = _norm_class(sh.get('shareType', ''))
        cur = _norm_currency(sh.get('currency', ''))
        ip = float(sh.get('issuePrice', 0) or 0)
        key = f'{cls}||{cur}||{ip}'
        if key not in share_type_map:
            share_type_map[key] = {'className': cls, 'currency': cur, 'issuePrice': ip, 'shares': 0, 'paidUp': 0.0, 'unpaid': 0.0}
        info = share_type_map[key]
        info['shares'] += int(sh.get('shares', 0) or 0)
        info['paidUp'] += float(sh.get('paidUp', 0) or 0)
        info['unpaid'] += float(sh.get('unpaid', 0) or 0)

    share_infos = list(share_type_map.values())
    total_shares, total_amount, total_paid, first_currency = 0, 0.0, 0.0, ''
    for i, info in enumerate(share_infos[:4]):
        base = 6 + i * 5
        issued = (info['paidUp'] + info['unpaid']) or (info['issuePrice'] * info['shares']) or (info['shares'] * 1.0)
        _set_text(doc, fmap, f'fill_{base}_P.2', info['className'])
        _set_text(doc, fmap, f'fill_{base+1}_P.2', info['currency'])
        _set_text(doc, fmap, f'fill_{base+2}_P.2', _fmt_int(info['shares']))
        _set_text(doc, fmap, f'fill_{base+3}_P.2', _fmt_amount(issued))
        _set_text(doc, fmap, f'fill_{base+4}_P.2', _fmt_amount(info['paidUp'] or issued))
        total_shares += info['shares']
        total_amount += issued
        total_paid += info['paidUp'] or issued
        if not first_currency:
            first_currency = info['currency']

    if share_infos:
        _set_text(doc, fmap, 'fill_26_P.2', first_currency)
        _set_text(doc, fmap, 'fill_27_P.2', _fmt_int(total_shares))
        _set_text(doc, fmap, 'fill_28_P.2', _fmt_amount(total_amount))
        _set_text(doc, fmap, 'fill_29_P.2', _fmt_amount(total_paid))

    secretaries = data.get('secretaries') or []
    directors = data.get('directors') or []
    nat_secs = [s for s in secretaries if s.get('identity') == 'natural']
    corp_secs = [s for s in secretaries if s.get('identity') == 'corporate']
    nat_dirs = [d for d in directors if d.get('identity') == 'natural']
    corp_dirs = [d for d in directors if d.get('identity') == 'corporate']

    # ── P.3 自然人秘書 ──
    _set_text(doc, fmap, 'fill_1_P.3', br8)
    if nat_secs:
        s = nat_secs[0]
        surname, other = _parse_english_name(s.get('nameEnglish', ''))
        _set_text(doc, fmap, 'fill_2_P.3', s.get('nameChinese', ''))
        _set_text(doc, fmap, 'fill_3_P.3', surname)
        _set_text(doc, fmap, 'fill_4_P.3', other)
        addr = _parse_address(s.get('address', ''))
        _set_text(doc, fmap, 'fill_9_P.3', addr['flat'])
        _set_text(doc, fmap, 'fill_10_P.3', addr['building'])
        _set_text(doc, fmap, 'fill_11_P.3', addr['street'])
        _set_text(doc, fmap, 'fill_12_P.3', addr['district'])
        _set_text(doc, fmap, 'fill_13_P.3', s.get('email', ''))
        hkid = _parse_hkid_partial(s.get('idNumber', ''))
        if hkid:
            _set_text(doc, fmap, 'fill_14_P.3', hkid)
        if s.get('passportCountry'):
            _set_text(doc, fmap, 'fill_15_P.3', s.get('passportCountry', ''))
        if s.get('passportNumber'):
            _set_text(doc, fmap, 'fill_16_P.3', _parse_passport_partial(s['passportNumber']))

    # ── P.4 法人秘書 ──
    _set_text(doc, fmap, 'fill_1_P.4', br8)
    if corp_secs:
        s = corp_secs[0]
        _set_text(doc, fmap, 'fill_2_P.4', s.get('nameChinese', ''))
        _set_text(doc, fmap, 'fill_3_P.4', s.get('nameEnglish', ''))
        addr = _parse_address(s.get('serviceAddress') or s.get('address', ''))
        _set_text(doc, fmap, 'fill_4_P.4', addr['flat'])
        _set_text(doc, fmap, 'fill_5_P.4', addr['building'])
        _set_text(doc, fmap, 'fill_6_P.4', addr['street'])
        _set_text(doc, fmap, 'fill_7_P.4', addr['district'])
        _set_text(doc, fmap, 'fill_8_P.4', s.get('email', ''))
        _set_text(doc, fmap, 'fill_9_P.4', s.get('companyNumberRef') or s.get('brNumber', '') or s.get('idNumber', ''))
        tcsp = s.get('tcspNumber', '') or s.get('licenceNumber', '')
        if tcsp:
            _set_text(doc, fmap, 'fill_10_P.4', tcsp)

    # ── P.5 自然人董事 ──
    _set_text(doc, fmap, 'fill_1_P.5', br8)
    if nat_dirs:
        d = nat_dirs[0]
        _check(doc, fmap, 'cb_1_P.5', True)
        surname, other = _parse_english_name(d.get('nameEnglish', ''))
        _set_text(doc, fmap, 'fill_3_P.5', d.get('nameChinese', ''))
        _set_text(doc, fmap, 'fill_4_P.5', surname)
        _set_text(doc, fmap, 'fill_5_P.5', other)
        # Directors use registered office as address
        _set_text(doc, fmap, 'fill_10_P.5', office.get('flat', ''))
        _set_text(doc, fmap, 'fill_11_P.5', office.get('building', ''))
        _set_text(doc, fmap, 'fill_12_P.5', office.get('street', ''))
        _set_text(doc, fmap, 'fill_13_P.5', office.get('district', ''))
        _set_text(doc, fmap, 'fill_14_P.5', office.get('region') or office.get('country', ''))
        _set_text(doc, fmap, 'fill_15_P.5', d.get('email', ''))
        hkid = _parse_hkid_partial(d.get('idNumber', ''))
        if hkid:
            _set_text(doc, fmap, 'fill_16_P.5', hkid)
        if d.get('passportCountry'):
            _set_text(doc, fmap, 'fill_17_P.5', d.get('passportCountry', ''))
        if d.get('passportNumber'):
            _set_text(doc, fmap, 'fill_18_P.5', _parse_passport_partial(d['passportNumber']))

    # ── P.6 法人董事 ──
    _set_text(doc, fmap, 'fill_1_P.6', br8)
    if corp_dirs:
        d = corp_dirs[0]
        _check(doc, fmap, 'cb_1_P.6', True)
        _set_text(doc, fmap, 'fill_3_P.6', d.get('nameChinese', ''))
        _set_text(doc, fmap, 'fill_4_P.6', d.get('nameEnglish', ''))
        _set_text(doc, fmap, 'fill_5_P.6', office.get('flat', ''))
        _set_text(doc, fmap, 'fill_6_P.6', office.get('building', ''))
        _set_text(doc, fmap, 'fill_7_P.6', office.get('street', ''))
        _set_text(doc, fmap, 'fill_8_P.6', office.get('district', ''))
        _set_text(doc, fmap, 'fill_9_P.6', office.get('region') or office.get('country', ''))
        _set_text(doc, fmap, 'fill_10_P.6', d.get('email', ''))
        _set_text(doc, fmap, 'fill_11_P.6', d.get('companyNumberRef') or d.get('brNumber', '') or d.get('idNumber', ''))

    # ── P.7 ──
    _set_text(doc, fmap, 'fill_1_P.7', br8)

    # ── P.8 總結 + 簽署 ──
    _set_text(doc, fmap, 'fill_1_P.8', br8)
    valid_members = [sh for sh in shareholders if (int(sh.get('shares', 0) or 0)) > 0]
    is_listed = '上市' in company_type or 'listed' in ct_lower
    if not is_listed:
        _check(doc, fmap, 'cb_4_P.8', True)

    sheet_a = max(0, len(nat_secs) - 1)
    sheet_b = max(0, len(corp_secs) - 1)
    sheet_c = max(0, len(nat_dirs) - 1)
    sheet_d_pages = max(0, (len(corp_dirs) - 1 + 1) // 2) if len(corp_dirs) > 1 else 0
    sched1_pages = 0 if is_listed else ((len(valid_members) + 1) // 2 if valid_members else 0)
    sched2_pages = 1 if is_listed else 0

    if sheet_a > 0:
        _set_text(doc, fmap, 'fill_4_P.8', str(sheet_a))
    if sheet_b > 0:
        _set_text(doc, fmap, 'fill_5_P.8', str(sheet_b))
    if sheet_c > 0:
        _set_text(doc, fmap, 'fill_6_P.8', str(sheet_c))
    if sheet_d_pages > 0:
        _set_text(doc, fmap, 'fill_7_P.8', str(sheet_d_pages))
    if sched1_pages > 0:
        _set_text(doc, fmap, 'fill_9_P.8', str(sched1_pages))
    if sched2_pages > 0:
        _set_text(doc, fmap, 'fill_10_P.8', str(sched2_pages))

    # 簽署人
    signer = data.get('signer')
    signer_name = (signer or {}).get('name') or presenter.get('name', '')
    signer_role = (signer or {}).get('role', '')
    if signer_name:
        _set_text(doc, fmap, 'fill_11_P.8', signer_name)
    if day and month and year:
        _set_text(doc, fmap, 'fill_12_P.8', f'{day}/{month}/{year}')

    # Handle Director / Company Secretary cross-out dropdowns on P.8
    # Dropdown_1_P.8 → strikethrough "Director"  (widget at x=143-205, y=745-756)
    # Dropdown_2_P.8 → strikethrough "Company Secretary" (widget at x=209-343, y=745-756)
    # Each dropdown has two options in /Opt: ' ' (blank) and hex bytes <8484...>
    # that render as a horizontal line with the original font.  We set /V to the
    # hex option + /I index, then draw a PDF line to guarantee visible rendering.
    if signer_role in ('director', 'secretary'):
        # signer_role='secretary' → cross out "Director"     → Dropdown_1_P.8
        # signer_role='director'  → cross out "Company Secretary" → Dropdown_2_P.8
        cross_out_widget = 'Dropdown_1_P.8' if signer_role == 'secretary' else 'Dropdown_2_P.8'

        for widget_name in ('Dropdown_1_P.8', 'Dropdown_2_P.8'):
            if widget_name in fmap:
                pi = fmap[widget_name]
                for w in doc[pi].widgets():
                    if w.field_name == widget_name:
                        try:
                            use_dashes = (widget_name == cross_out_widget)
                            # Set the dropdown to the correct option via its /Opt index
                            opt_idx = 1 if use_dashes else 0
                            doc.xref_set_key(w._annot.xref, 'I', f'[{opt_idx}]')
                            # Set /V to the chosen option value
                            val = w.choice_values[opt_idx]
                            doc.xref_set_key(w._annot.xref, 'V', fitz.get_pdf_str(val))
                            # Visible + printable
                            doc.xref_set_key(w._annot.xref, 'F', '4')

                            # Draw a visible line through the text area
                            # (the font-based AP from the original template is
                            # hard to replicate without its exact subset font)
                            if use_dashes:
                                doc[pi].draw_line(
                                    fitz.Point(w.rect.x0 + 2, w.rect.y0 + w.rect.height / 2),
                                    fitz.Point(w.rect.x1 - 2, w.rect.y0 + w.rect.height / 2),
                                    color=(0, 0, 0), width=1.0
                                )
                        except Exception:
                            pass
                        break

    # ── P.9 附表一（股東，前2人） ──
    if valid_members and not is_listed:
        _set_text(doc, fmap, 'fill_1_P.9', day)
        _set_text(doc, fmap, 'fill_2_P.9', month)
        _set_text(doc, fmap, 'fill_3_P.9', year)
        _set_text(doc, fmap, 'fill_4_P.9', br8)
        if share_infos:
            _set_text(doc, fmap, 'fill_5_P.9', share_infos[0]['className'])
            _set_text(doc, fmap, 'fill_6_P.9', _fmt_int(share_infos[0]['shares']))

        # P.9 slot layout (verified against template field positions 2026-07-24):
        #   pos0=name(7/18)  pos1=shares(16/27)  pos2=surname(8/19)
        #   pos3=other(9/20)  pos4=joint(10/21)
        #   pos5-9=address(11-15/22-26)  pos10=full_addr(17/28)
        slots_ts = [
            {'name': 7, 'surname': 8, 'other': 9, 'shares': 16, 'flat': 11, 'building': 12, 'street': 13, 'district': 14, 'country': 15},
            {'name': 18, 'surname': 19, 'other': 20, 'shares': 27, 'flat': 22, 'building': 23, 'street': 24, 'district': 25, 'country': 26},
        ]
        for idx, sh in enumerate(valid_members[:2]):
            F = slots_ts[idx]
            is_corp = sh.get('identity') == 'corporate'
            full = sh.get('nameEnglish') or sh.get('name', '')
            surname, other = _parse_english_name(full)
            addr = _parse_address(sh.get('address', ''))
            def _safe(v):
                return '' if (v and _PURE_NUMBER_RE.match(v)) else v
            country = _safe(addr['country']) or 'Hong Kong'

            _set_text(doc, fmap, f'fill_{F["name"]}_P.9', sh.get('nameChinese', ''))
            if is_corp:
                _set_text(doc, fmap, f'fill_{F["surname"]}_P.9', full)
            else:
                _set_text(doc, fmap, f'fill_{F["surname"]}_P.9', surname)
                _set_text(doc, fmap, f'fill_{F["other"]}_P.9', other)
            shares_num = int(sh.get('shares', 0) or 0)
            _set_text(doc, fmap, f'fill_{F["shares"]}_P.9', _fmt_int(shares_num) if shares_num > 0 else '0')
            _set_text(doc, fmap, f'fill_{F["flat"]}_P.9', _safe(addr['flat']))
            _set_text(doc, fmap, f'fill_{F["building"]}_P.9', _safe(addr['building']))
            _set_text(doc, fmap, f'fill_{F["street"]}_P.9', _safe(addr['street']))
            _set_text(doc, fmap, f'fill_{F["district"]}_P.9', _safe(addr['district']))
            _set_text(doc, fmap, f'fill_{F["country"]}_P.9', country)

        total_sch1 = (len(valid_members) + 1) // 2
        _set_text(doc, fmap, 'fill_29_P.9', '1')  # current page
        _set_text(doc, fmap, 'fill_30_P.9', str(total_sch1))

    # ── P.10 附表一續（股東 #3+#4）──
    if len(valid_members) > 2 and not is_listed:
        _set_text(doc, fmap, 'fill_1_P.10', day)
        _set_text(doc, fmap, 'fill_2_P.10', month)
        _set_text(doc, fmap, 'fill_3_P.10', year)
        _set_text(doc, fmap, 'fill_4_P.10', br8)
        if share_infos:
            _set_text(doc, fmap, 'fill_5_P.10', share_infos[0]['className'])
            _set_text(doc, fmap, 'fill_6_P.10', _fmt_int(share_infos[0]['shares']))
        # P.10 uses same field structure as P.9 (same x positions, different y)
        #   Slot1: name(7), shares(16), surname(8), other(9), joint(10)
        #          addr: flat(11), building(12), street(13), district(14), country(15)
        #   Slot2: name(19), shares(28), surname(20), other(21), joint(22)
        #          addr: flat(23), building(24), street(25), district(26), country(27)
        slots_p10 = [
            {'name': 7, 'surname': 8, 'other': 9, 'shares': 16, 'flat': 11, 'building': 12, 'street': 13, 'district': 14, 'country': 15},
            {'name': 19, 'surname': 20, 'other': 21, 'shares': 28, 'flat': 23, 'building': 24, 'street': 25, 'district': 26, 'country': 27},
        ]
        for idx, sh in enumerate(valid_members[2:4]):
            F = slots_p10[idx]
            is_corp = sh.get('identity') == 'corporate'
            full = sh.get('nameEnglish') or sh.get('name', '')
            surname, other = _parse_english_name(full)
            addr = _parse_address(sh.get('address', ''))
            def _safe(v):
                return '' if (v and _PURE_NUMBER_RE.match(v)) else v
            country = _safe(addr['country']) or 'Hong Kong'
            _set_text(doc, fmap, f'fill_{F["name"]}_P.10', sh.get('nameChinese', ''))
            if is_corp:
                _set_text(doc, fmap, f'fill_{F["surname"]}_P.10', full)
            else:
                _set_text(doc, fmap, f'fill_{F["surname"]}_P.10', surname)
                _set_text(doc, fmap, f'fill_{F["other"]}_P.10', other)
            shares_num = int(sh.get('shares', 0) or 0)
            _set_text(doc, fmap, f'fill_{F["shares"]}_P.10', _fmt_int(shares_num) if shares_num > 0 else '0')
            _set_text(doc, fmap, f'fill_{F["flat"]}_P.10', _safe(addr['flat']))
            _set_text(doc, fmap, f'fill_{F["building"]}_P.10', _safe(addr['building']))
            _set_text(doc, fmap, f'fill_{F["street"]}_P.10', _safe(addr['street']))
            _set_text(doc, fmap, f'fill_{F["district"]}_P.10', _safe(addr['district']))
            _set_text(doc, fmap, f'fill_{F["country"]}_P.10', country)
        _set_text(doc, fmap, 'fill_31_P.10', '2')
        _set_text(doc, fmap, 'fill_32_P.10', str(total_sch1))

    # ── P.10 附表二（上市公司）──
    if is_listed:
        _set_text(doc, fmap, 'fill_1_P.10', day)
        _set_text(doc, fmap, 'fill_2_P.10', month)
        _set_text(doc, fmap, 'fill_3_P.10', year)
        _set_text(doc, fmap, 'fill_4_P.10', br8)
        if share_infos:
            _set_text(doc, fmap, 'fill_5_P.10', share_infos[0]['className'])
            _set_text(doc, fmap, 'fill_6_P.10', _fmt_int(share_infos[0]['shares']))

    # ── P.11 續頁A：自然人秘書 #2 ──
    if len(nat_secs) > 1:
        s = nat_secs[1]
        _set_text(doc, fmap, 'fill_1_P.11', day)
        _set_text(doc, fmap, 'fill_2_P.11', month)
        _set_text(doc, fmap, 'fill_3_P.11', year)
        _set_text(doc, fmap, 'fill_4_P.11', br8)
        _set_text(doc, fmap, 'fill_5_P.11', s.get('nameChinese', ''))
        surname, other = _parse_english_name(s.get('nameEnglish', ''))
        _set_text(doc, fmap, 'fill_6_P.11', surname)
        _set_text(doc, fmap, 'fill_7_P.11', other)
        addr = _parse_address(s.get('address', ''))
        _set_text(doc, fmap, 'fill_8_P.11', addr['flat'])
        _set_text(doc, fmap, 'fill_9_P.11', addr['building'])  # P.11 has split flat/building row
        _set_text(doc, fmap, 'fill_10_P.11', addr['street'])
        _set_text(doc, fmap, 'fill_11_P.11', addr['district'])
        _set_text(doc, fmap, 'fill_12_P.11', addr.get('country') or addr.get('region', '香港 Hong Kong'))
        _set_text(doc, fmap, 'fill_13_P.11', addr['country'] or '香港 Hong Kong')
        _set_text(doc, fmap, 'fill_15_P.11', s.get('serviceAddress', '') or s.get('address', ''))
        _set_text(doc, fmap, 'fill_16_P.11', s.get('email', ''))
        hkid = _parse_hkid_partial(s.get('idNumber', ''))
        if hkid:
            _set_text(doc, fmap, 'fill_17_P.11', hkid)
        if s.get('passportCountry'):
            _set_text(doc, fmap, 'fill_18_P.11', s.get('passportCountry', ''))
        if s.get('passportNumber'):
            _set_text(doc, fmap, 'fill_19_P.11', _parse_passport_partial(s['passportNumber']))
        tcsp = s.get('tcspNumber', '')
        if tcsp:
            _set_text(doc, fmap, 'fill_20_P.11', tcsp)

    # ── P.12 續頁B：法人秘書 #2 ──
    if len(corp_secs) > 1:
        s = corp_secs[1]
        _set_text(doc, fmap, 'fill_1_P.12', day)
        _set_text(doc, fmap, 'fill_2_P.12', month)
        _set_text(doc, fmap, 'fill_3_P.12', year)
        _set_text(doc, fmap, 'fill_4_P.12', br8)
        _set_text(doc, fmap, 'fill_5_P.12', s.get('nameChinese', ''))
        _set_text(doc, fmap, 'fill_6_P.12', s.get('nameEnglish', ''))
        addr = _parse_address(s.get('serviceAddress') or s.get('address', ''))
        _set_text(doc, fmap, 'fill_7_P.12', addr['flat'])
        _set_text(doc, fmap, 'fill_8_P.12', addr['building'])
        _set_text(doc, fmap, 'fill_9_P.12', addr['street'])
        _set_text(doc, fmap, 'fill_10_P.12', addr['district'])
        _set_text(doc, fmap, 'fill_11_P.12', s.get('email', ''))
        _set_text(doc, fmap, 'fill_12_P.12', s.get('companyNumberRef') or s.get('brNumber', '') or s.get('idNumber', ''))
        tcsp = s.get('tcspNumber', '')
        if tcsp:
            _set_text(doc, fmap, 'fill_13_P.12', tcsp)

    # ── P.13 續頁C：自然人董事 #2 ──
    if len(nat_dirs) > 1:
        d = nat_dirs[1]
        _set_text(doc, fmap, 'fill_1_P.13', day)
        _set_text(doc, fmap, 'fill_2_P.13', month)
        _set_text(doc, fmap, 'fill_3_P.13', year)
        _set_text(doc, fmap, 'fill_4_P.13', br8)
        _check(doc, fmap, 'cb_1_P.13', True)
        _set_text(doc, fmap, 'fill_5_P.13', d.get('nameChinese', ''))
        surname, other = _parse_english_name(d.get('nameEnglish', ''))
        _set_text(doc, fmap, 'fill_6_P.13', surname)
        _set_text(doc, fmap, 'fill_7_P.13', other)
        _set_text(doc, fmap, 'fill_8_P.13', office.get('flat', ''))
        _set_text(doc, fmap, 'fill_9_P.13', office.get('building', ''))
        _set_text(doc, fmap, 'fill_10_P.13', office.get('street', ''))
        _set_text(doc, fmap, 'fill_11_P.13', office.get('district', ''))
        _set_text(doc, fmap, 'fill_12_P.13', office.get('region') or office.get('country', ''))
        _set_text(doc, fmap, 'fill_15_P.13', office.get('region') or office.get('country', '香港 Hong Kong'))
        _set_text(doc, fmap, 'fill_16_P.13', d.get('email', ''))
        hkid = _parse_hkid_partial(d.get('idNumber', ''))
        if hkid:
            _set_text(doc, fmap, 'fill_17_P.13', hkid)
        if d.get('passportCountry'):
            _set_text(doc, fmap, 'fill_18_P.13', d.get('passportCountry', ''))
        if d.get('passportNumber'):
            _set_text(doc, fmap, 'fill_19_P.13', _parse_passport_partial(d['passportNumber']))

    # ── P.14 續頁D：法人董事 #2+#3 ──
    extra_corp_dirs = corp_dirs[1:]
    if extra_corp_dirs:
        _set_text(doc, fmap, 'fill_1_P.14', day)
        _set_text(doc, fmap, 'fill_2_P.14', month)
        _set_text(doc, fmap, 'fill_3_P.14', year)
        _set_text(doc, fmap, 'fill_4_P.14', br8)
        # Slot 1: fields 5-14, checkboxes cb_1, cb_2
        # Slot 2: fields 15-24, checkboxes cb_3, cb_4
        slots_p14 = [
            {'cb_dir': 'cb_1_P.14', 'cb_reserve': 'cb_2_P.14', 'name_cn': 5, 'name_en': 6,
             'flat': 7, 'building': 8, 'street': 9, 'district': 10, 'region': 11,
             'country': 12, 'service_addr': 13, 'email': 14},
            {'cb_dir': 'cb_3_P.14', 'cb_reserve': 'cb_4_P.14', 'name_cn': 15, 'name_en': 16,
             'flat': 17, 'building': 18, 'street': 19, 'district': 20, 'region': 21,
             'country': 22, 'service_addr': 23, 'email': 24},
        ]
        for idx, d in enumerate(extra_corp_dirs[:2]):
            F = slots_p14[idx]
            _check(doc, fmap, F['cb_dir'], True)
            _set_text(doc, fmap, f'fill_{F["name_cn"]}_P.14', d.get('nameChinese', ''))
            _set_text(doc, fmap, f'fill_{F["name_en"]}_P.14', d.get('nameEnglish', ''))
            _set_text(doc, fmap, f'fill_{F["flat"]}_P.14', office.get('flat', ''))
            _set_text(doc, fmap, f'fill_{F["building"]}_P.14', office.get('building', ''))
            _set_text(doc, fmap, f'fill_{F["street"]}_P.14', office.get('street', ''))
            _set_text(doc, fmap, f'fill_{F["district"]}_P.14', office.get('district', ''))
            _set_text(doc, fmap, f'fill_{F["region"]}_P.14', office.get('region') or office.get('country', ''))
            _set_text(doc, fmap, f'fill_{F["country"]}_P.14', office.get('region') or office.get('country', '香港 Hong Kong'))
            _set_text(doc, fmap, f'fill_{F["email"]}_P.14', d.get('email', ''))

    # ── P.15 續頁E：公司紀錄保存地點 ──
    company_records = data.get('companyRecords') or []
    valid_records = [r for r in company_records if (r.get('records', '') or '').strip() or (r.get('address', '') or '').strip()]
    if valid_records:
        _set_text(doc, fmap, 'fill_1_P.15', day)
        _set_text(doc, fmap, 'fill_2_P.15', month)
        _set_text(doc, fmap, 'fill_3_P.15', year)
        _set_text(doc, fmap, 'fill_4_P.15', br8)
        records_text = '\n\n'.join([r.get('records', '') or '' for r in valid_records])
        address_text = '\n\n'.join([r.get('address', '') or '' for r in valid_records])
        _set_text(doc, fmap, 'fill_5_P.15', records_text)
        _set_text(doc, fmap, 'fill_6_P.15', address_text)

    # ── 刪除無數據的附頁（P.9-P.15）──
    pages_to_delete = []

    # P.9 (idx 8): 附表一 page 1 — 股東 #1+#2
    if not (valid_members and not is_listed):
        pages_to_delete.append(8)

    # P.10 (idx 9): 附表一 page 2 OR 附表二
    has_sch1_p2 = len(valid_members) > 2 and not is_listed
    has_sch2 = is_listed
    if not (has_sch1_p2 or has_sch2):
        pages_to_delete.append(9)

    # P.11 (idx 10): 續頁A — 第2位自然人秘書
    if len(nat_secs) <= 1:
        pages_to_delete.append(10)

    # P.12 (idx 11): 續頁B — 第2位法人秘書
    if len(corp_secs) <= 1:
        pages_to_delete.append(11)

    # P.13 (idx 12): 續頁C — 第2位自然人董事
    if len(nat_dirs) <= 1:
        pages_to_delete.append(12)

    # P.14 (idx 13): 續頁D — 法人董事 #2+#3
    if len(corp_dirs) <= 1:
        pages_to_delete.append(13)

    # P.15 (idx 14): 續頁E — 公司紀錄保存地點
    if not valid_records:
        pages_to_delete.append(14)

    for pi in reversed(pages_to_delete):
        doc.delete_page(pi)

    # ── 刪除空白頁（原 P.16-P.27，索引因附頁刪除已位移）──
    blank_pages = []
    scan_start = 15 - len(pages_to_delete)  # 原 P.16 的新索引
    for pi in range(scan_start, doc.page_count):
        if not list(doc[pi].widgets()):
            blank_pages.append(pi)
    for pi in reversed(blank_pages):
        doc.delete_page(pi)

    # ── 保存 ──
    pdf_bytes = doc.write(deflate=True)
    doc.close()
    return pdf_bytes

@app.route('/api/generate-nar1-pdf', methods=['POST'])
def generate_nar1_pdf():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400
        pdf_bytes = _fill_nar1_pdf(data)
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ─── NR1 PDF 生成（本地 Python + PyMuPDF） ───

def _fill_nr1_pdf(data):
    """填充 NR1 PDF 模板，返回 bytes"""
    template_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'templates', 'NR1-template.pdf')
    doc = fitz.open(template_path)
    fmap = {}
    for pi in range(doc.page_count):
        for w in doc[pi].widgets():
            if w.field_name:
                fmap[w.field_name] = pi

    br8 = (data.get('brNumber', '') or '').replace(r'[^0-9A-Za-z]', '')[:8]

    field_map = {
        'fill_1_P.1': br8,
        'fill_2_P.1': data.get('companyName', ''),
        'fill_3_P.1': data.get('flat', ''),
        'fill_4_P.1': data.get('building', ''),
        'fill_5_P.1': data.get('street', ''),
        'fill_6_P.1': data.get('district', ''),
        'fill_7_P.1': data.get('addressEffectiveDay', ''),
        'fill_8_P.1': data.get('addressEffectiveMonth', ''),
        'fill_9_P.1': data.get('addressEffectiveYear', ''),
        'fill_10_P.1': data.get('email', ''),
        'fill_11_P.1': data.get('emailEffectiveDay', ''),
        'fill_12_P.1': data.get('emailEffectiveMonth', ''),
        'fill_13_P.1': data.get('emailEffectiveYear', ''),
        'fill_14_P.1': data.get('phone', ''),
        'fill_15_P.1': data.get('phoneEffectiveDay', ''),
        'fill_16_P.1': data.get('phoneEffectiveMonth', ''),
        'fill_17_P.1': data.get('phoneEffectiveYear', ''),
        'fill_18_P.1': data.get('signerName', ''),
        'fill_19_P.1': f"{data.get('signDateDay','')}/{data.get('signDateMonth','')}/{data.get('signDateYear','')}",
        'fill_20_P.1': data.get('presentorName', ''),
        'fill_21_P.1': data.get('presentorAddress', ''),
        'fill_22_P.1': data.get('presentorContact', ''),
    }

    for name, value in field_map.items():
        if name not in fmap:
            continue
        pi = fmap[name]
        for w in doc[pi].widgets():
            if w.field_name == name:
                try:
                    w.field_value = value if value else ''
                    w.update()
                except Exception:
                    pass
                break

    # Region dropdown
    region = data.get('region', '')
    if region and 'Dropdown1_P.1' in fmap:
        pi = fmap['Dropdown1_P.1']
        for w in doc[pi].widgets():
            if w.field_name == 'Dropdown1_P.1':
                try:
                    for choice_val, _ in (w.choice_values or []):
                        if choice_val in region or region in choice_val:
                            w.field_value = choice_val
                            w.update()
                            break
                except Exception:
                    pass
                break

    pdf_bytes = doc.write(deflate=True)
    doc.close()
    return pdf_bytes


@app.route('/api/generate-nr1-pdf', methods=['POST'])
def generate_nr1_pdf():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400
        pdf_bytes = _fill_nr1_pdf(data)
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── ND2A PDF 生成（委任/停任董事秘書） ───

def _fill_nd2a_pdf(data, template='ND2A-template.pdf'):
    """Fill ND2A/NN6 PDF template using PyMuPDF"""
    template_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'templates', template)
    doc = fitz.open(template_path)
    fmap = {}
    for pi in range(doc.page_count):
        for w in doc[pi].widgets():
            if w.field_name:
                fmap[w.field_name] = pi

    def _set(name, value):
        if name not in fmap or not value:
            return
        pi = fmap[name]
        for w in doc[pi].widgets():
            if w.field_name == name:
                try:
                    w.field_value = str(value) if value else ''
                    w.update()
                except Exception:
                    pass
                break

    def _check(name):
        if name not in fmap:
            return
        pi = fmap[name]
        for w in doc[pi].widgets():
            if w.field_name == name:
                try:
                    # PyMuPDF 1.28+: w._annot is an Annot object (not dict),
                    # so .get('AP') raises AttributeError. Use w.field_value = True
                    # which automatically selects the "On" appearance state.
                    w.field_value = True
                    w.update()
                except Exception:
                    pass
                break

    br8 = (data.get('brNumber', '') or '').replace(r'[^0-9A-Za-z]', '')[:8]

    # P.1: Company info
    _set('fill_1_P.1', br8)
    _set('fill_2_P.1', data.get('companyName', ''))

    # 每页右上角都填商业登记号码
    for pi in range(2, doc.page_count + 1):
        _set(f'fill_1_P.{pi}', br8)

    officers = data.get('officers') or []
    nat_appt_idx = 0   # 自然人委任計數
    nat_cess_idx = 0   # 自然人停任計數
    corp_idx = 0       # 法人計數
    for i, officer in enumerate(officers[:3]):
        is_natural = officer.get('identity') == 'natural'
        is_cessation = officer.get('type') == 'cessation'

        if is_natural:
            if is_cessation:
                # 自然人停任 → P.4（續頁A）
                page = 4
                nat_cess_idx += 1
            else:
                # 自然人委任：P.2（第1個詳細）→ P.6（PI-ND2A 續頁C，第2個）→ P.7（PI-ND2A 續頁，第3個）
                page = [2, 6, 7][nat_appt_idx] if nat_appt_idx < 3 else 7
                nat_appt_idx += 1
        else:
            # 法人：依序 P.3, P.5, P.7
            page = (corp_idx * 2) + 3
            corp_idx += 1
        p = page

        if is_natural:
            # Split English name: prefer explicit surname/otherNames, fallback to parse
            eng = officer.get('nameEnglish', '') or ''
            surname = officer.get('nameSurname', '') or ''
            other = officer.get('nameOtherNames', '') or officer.get('nameOther', '') or ''
            if not surname and eng:
                parts = eng.strip().split()
                surname = parts[-1] if len(parts) > 1 else (parts[0] if parts else '')
                other = ' '.join(parts[:-1]) if len(parts) > 1 else ''
            chinese = officer.get('nameChinese', '')

            # ── Page-specific field mapping (each ND2A page has different widget layout) ──
            if p == 2:
                # P.2: Natural person appointment — detailed info
                # fill_2 = 代替 Alternate to (only for alternate director)
                if officer.get('role') == 'alternate':
                    _set(f'fill_2_P.2', officer.get('alternateTo', ''))
                # Names
                _set('fill_3_P.2', chinese)
                _set('fill_4_P.2', surname)
                _set('fill_5_P.2', other)
                # Structured address: fill_10~14
                addr_fb = officer.get('addrFlatBlock', '')
                addr_bld = officer.get('addrBuilding', '')
                addr_se = officer.get('addrStreetEstate', '')
                addr_dist = officer.get('addrDistrict', '')
                addr_reg = officer.get('addrRegion', '')
                if any([addr_fb, addr_bld, addr_se, addr_dist, addr_reg]):
                    _set('fill_10_P.2', addr_fb)
                    _set('fill_11_P.2', addr_bld)
                    _set('fill_12_P.2', addr_se)
                    _set('fill_13_P.2', addr_dist)
                    _set('fill_14_P.2', addr_reg)
                else:
                    # Fallback: flat address → fill_10
                    _set('fill_10_P.2', officer.get('address', ''))
                # HKID + Passport
                _set('fill_16_P.2', (officer.get('idNumber', '') or '')[:4])
                if officer.get('passportCountry'):
                    _set('fill_17_P.2', officer.get('passportCountry', ''))
                if officer.get('passportNumber'):
                    _set('fill_18_P.2', _parse_passport_partial(officer['passportNumber']))
                # Date: fill_21/22/23 = D/M/Y（底部三窄栏）
                date_str = officer.get('dateAppointed') if officer.get('type') == 'appointment' else officer.get('dateCeased')
                if date_str:
                    parts = date_str.split('-')
                    if len(parts) >= 3:
                        _set('fill_21_P.2', parts[2])
                        _set('fill_22_P.2', parts[1])
                        _set('fill_23_P.2', parts[0])
                # Role checkboxes on P.2: cb_1=秘書, cb_2=董事, cb_3=候補
                # 每個角色只勾一個 checkbox（互斥）
                role = officer.get('role', 'director')
                if role == 'secretary':
                    _check('cb_1_P.2')
                elif role == 'alternate':
                    _check('cb_3_P.2')
                else:
                    _check('cb_2_P.2')

                # P.2 底部聲明：cross out "董事" or "候補董事" in consent statement
                # Dropdown_1_P.2 → "董事" (director), Dropdown_2_P.2 → "候補董事*" (alternate director)
                # role='director'  → cross out "候補董事" (Dropdown_2)
                # role='alternate' → cross out "董事" (Dropdown_1)
                # NOTE: ND2A has duplicate widget instances (Chinese + English rows), so no break
                if role in ('director', 'alternate'):
                    cross_widget = f'Dropdown_{2 if role == "director" else 1}_P.2'
                    for wn in (f'Dropdown_1_P.2', f'Dropdown_2_P.2'):
                        if wn not in fmap:
                            continue
                        pi = fmap[wn]
                        for w in doc[pi].widgets():
                            if w.field_name == wn:
                                try:
                                    use_dashes = (wn == cross_widget)
                                    opt_idx = 1 if use_dashes else 0
                                    doc.xref_set_key(w._annot.xref, 'I', f'[{opt_idx}]')
                                    val = w.choice_values[opt_idx]
                                    doc.xref_set_key(w._annot.xref, 'V', fitz.get_pdf_str(val))
                                    doc.xref_set_key(w._annot.xref, 'F', '4')
                                    if use_dashes:
                                        doc[pi].draw_line(
                                            fitz.Point(w.rect.x0 + 2, w.rect.y0 + w.rect.height / 2),
                                            fitz.Point(w.rect.x1 - 2, w.rect.y0 + w.rect.height / 2),
                                            color=(0, 0, 0), width=1.0
                                        )
                                except Exception:
                                    pass

                # Already director? cb_5=是, cb_6=否
                if officer.get('alreadyDirector') == 'yes':
                    _check('cb_5_P.2')
                elif officer.get('alreadyDirector') == 'no':
                    _check('cb_6_P.2')
            elif p == 4:
                # P.4: Natural person cessation continuation (續頁A 停任)
                _set('fill_3_P.4', chinese)
                _set('fill_4_P.4', surname)
                _set('fill_5_P.4', other)
                _set('fill_6_P.4', officer.get('idNumber', ''))
                _set('fill_7_P.4', officer.get('passportNumber', ''))
                # Address: two tall fields
                addr_parts = [officer.get('addrFlatBlock', ''), officer.get('addrBuilding', ''),
                              officer.get('addrStreetEstate', ''), officer.get('addrDistrict', ''),
                              officer.get('addrRegion', '')]
                addr_has = [x for x in addr_parts if x]
                if addr_has:
                    _set('fill_8_P.4', ', '.join(addr_has[:3]))
                    _set('fill_9_P.4', ', '.join(addr_has[3:]))
                else:
                    _set('fill_8_P.4', officer.get('address', ''))
                # Cessation date: fill_10/11/12 = D/M/Y
                date_str = officer.get('dateCeased') or officer.get('dateAppointed')
                if date_str:
                    parts = date_str.split('-')
                    if len(parts) >= 3:
                        _set('fill_10_P.4', parts[2])
                        _set('fill_11_P.4', parts[1])
                        _set('fill_12_P.4', parts[0])
                # Role
                role = officer.get('role', 'director')
                if role == 'secretary':
                    _check('cb_1_P.4')
                elif role == 'alternate':
                    _check('cb_3_P.4')
                else:
                    _check('cb_2_P.4')
                _check('cb_4_P.4')  # cessation
            elif p == 6:
                # P.6 (PI-ND2A 續頁C) — different layout from P.2
                # fill_2 = 代替 Alternate to (僅候補董事填)
                if officer.get('role') == 'alternate':
                    _set(f'fill_2_P.{p}', officer.get('alternateTo', ''))
                # fill_3 = 中文姓名, fill_4 = 姓氏, fill_5 = 名字
                _set(f'fill_3_P.{p}', chinese)
                _set(f'fill_4_P.{p}', surname)
                _set(f'fill_5_P.{p}', other)
                # fill_8 = 住址, fill_9 = 國家／地區 (護照簽發國), fill_10 = 通訊地址
                _set(f'fill_8_P.{p}', officer.get('address', ''))
                if officer.get('passportCountry'):
                    _set(f'fill_9_P.{p}', officer.get('passportCountry', ''))
                # fill_11 = 身份證號碼（完整號碼，不截斷）
                if officer.get('idNumber'):
                    _set(f'fill_11_P.{p}', officer['idNumber'])
                # 護照號碼：P.6 無獨立欄位，與身份證號碼共用 fill_11
                if officer.get('passportNumber'):
                    existing = officer.get('idNumber', '')
                    if existing:
                        _set(f'fill_11_P.{p}', f'{existing} / {officer["passportNumber"]}')
                    else:
                        _set(f'fill_11_P.{p}', officer['passportNumber'])
                # Dates: fill_14/15/16 = D/M/Y
                date_str = officer.get('dateAppointed') if officer.get('type') == 'appointment' else officer.get('dateCeased')
                if date_str:
                    parts = date_str.split('-')
                    if len(parts) >= 3:
                        _set(f'fill_14_P.{p}', parts[2])
                        _set(f'fill_15_P.{p}', parts[1])
                        _set(f'fill_16_P.{p}', parts[0])
                role = officer.get('role', 'director')
                if role == 'secretary':
                    _check(f'cb_1_P.{p}')
                elif role == 'alternate':
                    _check(f'cb_3_P.{p}')
                else:
                    _check(f'cb_2_P.{p}')
                if officer.get('type') == 'cessation':
                    _check(f'cb_4_P.{p}')

                # P.6 底部聲明：cross out "董事" or "候補董事" in consent statement
                # (same pattern as P.2 — only pages that have the dropdowns)
                if f'Dropdown_1_P.{p}' in fmap:
                    if role in ('director', 'alternate'):
                        cross_widget = f'Dropdown_{2 if role == "director" else 1}_P.{p}'
                        for wn in (f'Dropdown_1_P.{p}', f'Dropdown_2_P.{p}'):
                            if wn not in fmap:
                                continue
                            pi2 = fmap[wn]
                            for w in doc[pi2].widgets():
                                if w.field_name == wn:
                                    try:
                                        use_dashes = (wn == cross_widget)
                                        opt_idx = 1 if use_dashes else 0
                                        doc.xref_set_key(w._annot.xref, 'I', f'[{opt_idx}]')
                                        val = w.choice_values[opt_idx]
                                        doc.xref_set_key(w._annot.xref, 'V', fitz.get_pdf_str(val))
                                        doc.xref_set_key(w._annot.xref, 'F', '4')
                                        if use_dashes:
                                            doc[pi2].draw_line(
                                                fitz.Point(w.rect.x0 + 2, w.rect.y0 + w.rect.height / 2),
                                                fitz.Point(w.rect.x1 - 2, w.rect.y0 + w.rect.height / 2),
                                                color=(0, 0, 0), width=1.0
                                            )
                                    except Exception:
                                        pass
            elif p == 7:
                # P.7 (PI-ND2A 續頁) — different layout from P.6
                # No D/M/Y narrow fields (fill_14/15/16 don't exist), no Dropdowns
                # Available: fill_1(BR) fill_2(代替) fill_3(name) fill_4(name) fill_5(ID wide)
                #            fill_6(ID narrow) fill_7(addr1) fill_8(addr2) fill_9~13(wide text)
                #            cb_1/2/3(role)
                if officer.get('role') == 'alternate':
                    _set(f'fill_2_P.{p}', officer.get('alternateTo', ''))
                # fill_3 = 中文姓名, fill_4 = 英文姓名（姓+名）
                _set(f'fill_3_P.{p}', chinese)
                eng_full = f'{surname} {other}'.strip() if (surname or other) else officer.get('nameEnglish', '')
                _set(f'fill_4_P.{p}', eng_full)
                # fill_5 = 證件號碼（完整）, fill_6 = 校驗位／後綴
                id_full = officer.get('idNumber', '')
                passport = officer.get('passportNumber', '')
                if id_full and passport:
                    _set(f'fill_5_P.{p}', f'{id_full} / {passport}')
                elif id_full:
                    _set(f'fill_5_P.{p}', id_full)
                elif passport:
                    _set(f'fill_5_P.{p}', passport)
                # fill_7 = 住址第1行, fill_8 = 住址第2行
                addr_parts = [officer.get('addrFlatBlock', ''), officer.get('addrBuilding', ''),
                              officer.get('addrStreetEstate', '')]
                addr_dist_parts = [officer.get('addrDistrict', ''), officer.get('addrRegion', '')]
                addr1 = ', '.join([x for x in addr_parts if x])
                addr2 = ', '.join([x for x in addr_dist_parts if x])
                if addr1 or addr2:
                    _set(f'fill_7_P.{p}', addr1)
                    _set(f'fill_8_P.{p}', addr2)
                else:
                    _set(f'fill_7_P.{p}', officer.get('address', ''))
                # fill_9 = 護照簽發國家／地區
                if officer.get('passportCountry'):
                    _set(f'fill_9_P.{p}', officer.get('passportCountry', ''))
                # fill_10 = 護照號碼（若未合併到 fill_5）
                # (already handled in fill_5 above; use fill_10 for additional info)
                # fill_11 = 委任／停任日期（完整日期字串，P.7 無 D/M/Y 分欄）
                date_str = officer.get('dateAppointed') if officer.get('type') == 'appointment' else officer.get('dateCeased')
                if date_str:
                    _set(f'fill_11_P.{p}', date_str)
                # Role checkboxes
                role = officer.get('role', 'director')
                if role == 'secretary':
                    _check(f'cb_1_P.{p}')
                elif role == 'alternate':
                    _check(f'cb_3_P.{p}')
                else:
                    _check(f'cb_2_P.{p}')
                # Note: P.7 has no cb_4 (cessation) and no Dropdown fields
            else:
                # Should not reach here for natural persons; fallback to P.6-style
                pass
        else:
            _set(f'fill_3_P.{p}', officer.get('companyName', officer.get('nameEnglish', '')))
            _set(f'fill_5_P.{p}', officer.get('companyNumber', ''))
            _set(f'fill_6_P.{p}', officer.get('placeIncorporated', ''))
            _set(f'fill_7_P.{p}', officer.get('address', ''))
            # Appointment/cessation date for corporate officers
            date_str = None
            if officer.get('type') == 'appointment':
                date_str = officer.get('dateAppointed')
            elif officer.get('type') == 'cessation':
                date_str = officer.get('dateCeased')
            if date_str:
                parts = date_str.split('-')
                if len(parts) >= 3:
                    _set(f'fill_9_P.{p}', parts[2])
                    _set(f'fill_10_P.{p}', parts[1])
                    _set(f'fill_11_P.{p}', parts[0])
            # Role: cb_1=秘書, cb_2=董事, cb_3=候補董事
            role = officer.get('role', 'director')
            if role == 'secretary':
                _check(f'cb_1_P.{p}')
            elif role == 'alternate':
                _check(f'cb_3_P.{p}')
            else:
                _check(f'cb_2_P.{p}')
            # Type: only cessation needs checkbox (appointment is implicit)
            if officer.get('type') == 'cessation':
                _check(f'cb_4_P.{p}')

    # ── P.1 日期（僅停任，取自第一個 officer） ──
    # fill_11/12/13 = D/M/Y（三個並排窄框），委任不填 P.1 日期
    if officers and officers[0].get('type') == 'cessation':
        date_str = officers[0].get('dateCeased')
        if date_str:
            if '-' in date_str:
                parts = date_str.split('-')
                if len(parts) >= 3:
                    _set('fill_11_P.1', parts[2])  # day
                    _set('fill_12_P.1', parts[1])  # month
                    _set('fill_13_P.1', parts[0])  # year
            elif '/' in date_str:
                parts = date_str.split('/')
                if len(parts) >= 3:
                    _set('fill_11_P.1', parts[0])  # day
                    _set('fill_12_P.1', parts[1])  # month
                    _set('fill_13_P.1', parts[2])  # year

    # ── P.1 提交人信息 ──

    # 缩小提交人字段字号（12pt → 9pt），避免长文本溢出
    for field_name in ('fill_14_P.1', 'fill_16_P.1', 'fill_17_P.1', 'fill_18_P.1', 'fill_19_P.1'):
        if field_name in fmap:
            pi = fmap[field_name]
            for w in doc[pi].widgets():
                if w.field_name == field_name:
                    try:
                        xref = w._annot.xref
                        da = doc.xref_get_key(xref, 'DA')
                        if da[0] == 'string':
                            import re
                            new_da = re.sub(r'\d+(?:\.\d+)?\s+Tf', '9 Tf', da[1])
                            doc.xref_set_key(xref, 'DA', fitz.get_pdf_str(new_da))
                    except Exception:
                        pass
                    break

    # fill_14 = 提交人名稱, fill_15 = 提交人地址
    _set('fill_14_P.1', data.get('presentorName', ''))
    _set('fill_15_P.1', data.get('presentorAddress', ''))

    # fill_16-19 = 電話 / 傳真 / 電郵 / 檔號
    _set('fill_16_P.1', data.get('presentorPhone', data.get('presentorContact', '')))
    _set('fill_17_P.1', data.get('presentorFax', ''))
    _set('fill_18_P.1', data.get('presentorEmail', ''))
    _set('fill_19_P.1', data.get('presentorReference', ''))

    # ⚠️ 不删页：保留模板全部页面（仅 NAR1 可以删空页）
    pdf_bytes = doc.write(deflate=True)
    doc.close()
    return pdf_bytes


@app.route('/api/generate-nd2a-pdf', methods=['POST'])
def generate_nd2a_pdf():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400
        pdf_bytes = _fill_nd2a_pdf(data)
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── NN6 PDF 生成（非香港公司更改秘書及董事） ───

@app.route('/api/generate-nn6-pdf', methods=['POST'])
def generate_nn6_pdf():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400
        pdf_bytes = _fill_nd2a_pdf(data, template='NN6-template.pdf')
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── ND2B PDF 生成（更改董事秘書詳情） ───

def _fill_nd2b_pdf(data, template='ND2B-template.pdf'):
    """Fill ND2B/NN7 PDF template using PyMuPDF"""
    template_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'templates', template)
    doc = fitz.open(template_path)
    fmap = {}
    for pi in range(doc.page_count):
        for w in doc[pi].widgets():
            if w.field_name:
                fmap[w.field_name] = pi

    def _set(name, value):
        if name not in fmap or not value:
            return
        pi = fmap[name]
        for w in doc[pi].widgets():
            if w.field_name == name:
                try:
                    w.field_value = str(value) if value else ''
                    w.update()
                except Exception:
                    pass
                break

    def _check(name):
        if name not in fmap:
            return
        pi = fmap[name]
        for w in doc[pi].widgets():
            if w.field_name == name:
                try:
                    # PyMuPDF 1.28+: w._annot is an Annot object (not dict),
                    # so .get('AP') raises AttributeError. Use w.field_value = True
                    # which automatically selects the "On" appearance state.
                    w.field_value = True
                    w.update()
                except Exception:
                    pass
                break

    br8 = (data.get('brNumber', '') or '').replace(r'[^0-9A-Za-z]', '')[:8]
    name_parts = (data.get('nameEnglish', '') or '').strip().split()
    surname = name_parts[-1] if len(name_parts) > 1 else (name_parts[0] if name_parts else '')
    other = ' '.join(name_parts[:-1]) if len(name_parts) > 1 else ''

    # P.1: Company info
    _set('fill_1_P.1', br8)
    _set('fill_2_P.1', data.get('companyName', ''))

    is_natural = data.get('identity') == 'natural'
    role = data.get('role', '')

    if is_natural:
        if role == 'secretary':
            _check('cb_1_P.1')
        else:
            _check('cb_2_P.1')
        _set('fill_3_P.1', data.get('nameChinese', ''))
        _set('fill_4_P.1', surname)
        _set('fill_5_P.1', other)
        _set('fill_7_P.1', data.get('idNumber', ''))
        if data.get('passportCountry') or data.get('passportPlaceOfIssue'):
            _set('fill_7b_P.1', data.get('passportCountry') or data.get('passportPlaceOfIssue', ''))
        if data.get('passportNumber'):
            _set('fill_7c_P.1', _parse_passport_partial(data['passportNumber']))

        # P.2: Change details
        if data.get('changeType') == 'address' and data.get('newAddress'):
            _set('fill_19_P.2', data.get('newAddress', ''))

        # P.6: Protected Information
        if role == 'secretary':
            _check('cb_1_P.6')
        else:
            _check('cb_2_P.6')
        _set('fill_2_P.6', data.get('nameChinese', ''))
        _set('fill_3_P.6', surname)
        _set('fill_4_P.6', other)
        _set('fill_9_P.6', data.get('newAddress', ''))

    # ── P.1 提交人信息 ──
    # fill_8 = 提交人名稱, fill_9 = 提交人地址
    _set('fill_8_P.1', data.get('presentorName', ''))
    _set('fill_9_P.1', data.get('presentorAddress', ''))
    # fill_10-13 = 電話 / 傳真 / 電郵 / 檔號
    _set('fill_10_P.1', data.get('presentorPhone', data.get('presentorContact', '')))
    _set('fill_11_P.1', data.get('presentorFax', ''))
    _set('fill_12_P.1', data.get('presentorEmail', ''))
    _set('fill_13_P.1', data.get('presentorReference', ''))

    # P.3: Signature
    _set('fill_30_P.3', data.get('signerName', ''))
    _set('fill_31_P.3', data.get('signDate', ''))

    # ⚠️ 不删页：保留模板全部页面（仅 NAR1 可以删空页）
    pdf_bytes = doc.write(deflate=True)
    doc.close()
    return pdf_bytes


@app.route('/api/generate-nd2b-pdf', methods=['POST'])
def generate_nd2b_pdf():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400
        pdf_bytes = _fill_nd2b_pdf(data)
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── NN7 PDF 生成（非香港公司更改秘書及董事詳情） ───

@app.route('/api/generate-nn7-pdf', methods=['POST'])
def generate_nn7_pdf():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400
        pdf_bytes = _fill_nd2b_pdf(data, template='NN7-template.pdf')
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── Generic Form PDF 生成（Resolution / Rename / NewCompany） ───

@app.route('/api/generate-generic-form-pdf', methods=['POST'])
def generate_generic_form_pdf():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400

        pdf = FPDF()
        pdf.add_page()
        # Use system CJK font directly (font download in find_font() can hang)
        font_path = None
        for sys_font in ['C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/Deng.ttf', 'C:/Windows/Fonts/simsun.ttc']:
            if os.path.exists(sys_font):
                font_path = sys_font
                break
        if font_path:
            pdf.add_font('TC', '', font_path)
            pdf.add_font('TC', 'B', font_path)
            font_name = 'TC'
        else:
            font_name = 'Helvetica'

        def safe_text(text):
            return (text or '').encode('utf-8', errors='replace').decode('utf-8')

        # Title
        pdf.set_font(font_name, 'B', 16)
        pdf.cell(0, 10, safe_text(data.get('title', '')), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        if data.get('subtitle'):
            pdf.set_font(font_name, '', 10)
            pdf.cell(0, 7, safe_text(data['subtitle']), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        pdf.ln(4)

        # Form code + company info
        pdf.set_font(font_name, '', 10)
        if data.get('formCode'):
            pdf.cell(30, 6, 'Form Code:', 0, 0)
            pdf.cell(0, 6, safe_text(data['formCode']), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if data.get('companyName'):
            pdf.cell(30, 6, 'Company:', 0, 0)
            pdf.cell(0, 6, safe_text(data['companyName']), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if data.get('brNumber'):
            pdf.cell(30, 6, 'BR No.:', 0, 0)
            pdf.cell(0, 6, safe_text(data['brNumber']), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(4)

        # Sections
        sections = data.get('sections') or []
        for sec in sections:
            if sec.get('heading'):
                pdf.set_font(font_name, 'B', 11)
                pdf.cell(0, 7, safe_text(sec['heading']), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.ln(1)

            if sec.get('rows'):
                pdf.set_font(font_name, '', 9)
                for row in sec['rows']:
                    label = safe_text(row[0]) if len(row) > 0 else ''
                    value = safe_text(row[1]) if len(row) > 1 else ''
                    pdf.cell(50, 5, label + ':', 0, 0)
                    pdf.cell(0, 5, value, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.ln(2)

            if sec.get('paragraph'):
                pdf.set_font(font_name, '', 9)
                pdf.multi_cell(0, 5, safe_text(sec['paragraph']))
                pdf.ln(2)

            if sec.get('bullets'):
                pdf.set_font(font_name, '', 9)
                for b in sec['bullets']:
                    pdf.cell(5, 5, '', 0, 0)
                    pdf.cell(0, 5, chr(8226) + ' ' + safe_text(b), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.ln(2)

        # Signature lines
        sig_lines = data.get('signatureLines') or []
        if sig_lines:
            pdf.ln(6)
            pdf.set_font(font_name, '', 10)
            for sl in sig_lines:
                pdf.cell(0, 8, safe_text(sl), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.ln(2)

        pdf_bytes = bytes(pdf.output())
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── Auto-Fill CR Form PDF（自動填入公司資料的政府表格 PDF） ───

@app.route('/api/generate-cr-form-pdf', methods=['POST', 'OPTIONS'])
def generate_cr_form_pdf():
    """Auto-fill a CR form PDF from company database data.
    Request: {company_id, form_code (nar1|nd2a|...|nn9)}"""
    if request.method == 'OPTIONS':
        return ('', 204)
    try:
        u = get_user()
        if not u:
            return jsonify({'error': 'Not authenticated'}), 401

        data = request.get_json(force=True, silent=True) or {}
        company_id = data.get('company_id')
        form_code = (data.get('form_code') or '').lower()
        if not company_id or not form_code:
            return jsonify({'error': '缺少 company_id 或 form_code'}), 400

        meta = CR_FORM_META.get(form_code)
        if not meta:
            return jsonify({'error': f'不支援的表格代碼：{form_code}'}), 400

        db = get_db()
        bundle = _docx_company_bundle(db, company_id)
        if not bundle:
            return jsonify({'error': '找不到該公司'}), 404
        c = bundle['c']
        name_en = c.get('name') or ''
        name_cn = c.get('chinese_name') or ''
        br = c.get('company_number') or ''
        cr_num = c.get('ci_number') or ''

        # Build PDF with fpdf2
        pdf = FPDF()
        pdf.add_page()
        font_path = None
        for sys_font in ['C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/Deng.ttf', 'C:/Windows/Fonts/simsun.ttc']:
            if os.path.exists(sys_font):
                font_path = sys_font
                break
        if font_path:
            pdf.add_font('TC', '', font_path)
            pdf.add_font('TC', 'B', font_path)
            ft = 'TC'
        else:
            ft = 'Helvetica'

        def _t(text):
            return (text or '').encode('utf-8', errors='replace').decode('utf-8')

        def _person_label(m):
            en = (m.get('name_english') or '').strip()
            cn = (m.get('name_chinese') or '').strip()
            if en and cn:
                return f"{en}（{cn}）"
            return en or cn or '—'

        # Header
        pdf.set_font(ft, 'B', 16)
        pdf.cell(0, 10, _t(meta['title']), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        pdf.set_font(ft, '', 10)
        pdf.cell(0, 7, _t(f"{meta['code']} — {meta['title_en']}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        pdf.cell(0, 7, _t(f"公司註冊處表格 · 由系統自動填入 {name_en or name_cn} 的資料生成草稿"),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        pdf.ln(4)

        # Company info section
        pdf.set_font(ft, 'B', 12)
        pdf.cell(0, 7, _t('公司基本資料'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font(ft, '', 9)
        info_rows = [
            ('英文名稱', name_en), ('中文名稱', name_cn),
            ('商業登記號碼 (BR)', br), ('公司註冊編號 (CR)', cr_num),
            ('公司類型', c.get('company_type')), ('成立日期', _docx_fmt_date(c.get('incorporation_date'))),
            ('狀態', c.get('status')), ('註冊辦事處地址', bundle['address']),
            ('電郵', c.get('email')), ('電話', c.get('phone')),
        ]
        for label, val in info_rows:
            if val:
                pdf.cell(50, 5, _t(label) + ':', 0, 0)
                pdf.cell(0, 5, _t(str(val)), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(3)

        # Directors & Secretaries (most forms)
        has_officers = form_code in ('nar1','nd2a','nd2b','nd4','nnc1','nn1','nn3','nn6','nn7')
        if has_officers:
            pdf.set_font(ft, 'B', 11)
            pdf.cell(0, 7, _t(f"董事（{len(bundle['directors'])} 人）"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_font(ft, '', 9)
            if bundle['directors']:
                for d in bundle['directors']:
                    pdf.cell(0, 5, _t(f"  {_person_label(d)}  |  {d.get('id_number') or d.get('passport_number') or ''}  |  委任: {_docx_fmt_date(d.get('date_appointed'))}  |  {d.get('address') or ''}"),
                             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            else:
                pdf.cell(0, 5, _t('  （無董事記錄）'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(2)

            pdf.set_font(ft, 'B', 11)
            pdf.cell(0, 7, _t(f"公司秘書（{len(bundle['secretaries'])} 人）"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_font(ft, '', 9)
            if bundle['secretaries']:
                for s in bundle['secretaries']:
                    pdf.cell(0, 5, _t(f"  {_person_label(s)}  |  TCSP: {s.get('tcsp_number') or ''}  |  委任: {_docx_fmt_date(s.get('date_appointed'))}"),
                             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            else:
                pdf.cell(0, 5, _t('  （無秘書記錄）'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(3)

        # Shareholders
        has_shares = form_code in ('nar1','nsc1','nnc1','nn1','nn3')
        if has_shares:
            ts = bundle['total_shares']
            pdf.set_font(ft, 'B', 11)
            pdf.cell(0, 7, _t(f"股東／股本結構（總發行股數：{ts}）"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_font(ft, '', 9)
            if bundle['shareholders']:
                for sh in bundle['shareholders']:
                    pct = f"{round(int(sh.get('shares') or 0) * 100 / ts, 2)}%" if ts else '—'
                    pdf.cell(0, 5, _t(f"  {_person_label(sh)}  |  {sh.get('shares')} 股  |  {sh.get('share_type') or '普通股'}  |  {pct}"),
                             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            else:
                pdf.cell(0, 5, _t('  （無股東記錄）'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(3)

        # Form-specific blocks
        if form_code == 'nar1':
            pdf.set_font(ft, '', 9)
            pdf.cell(0, 5, _t('重要控制人登記冊 (SCR) 是否備存於公司註冊辦事處？  是 □  否 □'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.cell(0, 5, _t('截至申報日期之董事／秘書／股東資料以上表為準。'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if form_code in ('nr1', 'ndr1', 'nn9'):
            pdf.set_font(ft, '', 9)
            pdf.cell(0, 5, _t(f"現有註冊地址：{bundle['address'] or '（未填）'}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.cell(0, 5, _t('變更後註冊地址（請手動填寫）：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if form_code == 'nsc1':
            pdf.set_font(ft, '', 9)
            for line in ['配發日期：＿＿＿＿＿＿＿＿', '配發股份類別：＿＿＿＿＿＿＿＿', '每股發行價：＿＿＿＿＿＿＿＿', '配發總額：＿＿＿＿＿＿＿＿']:
                pdf.cell(0, 5, _t(line), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if form_code in ('nnc1', 'nn1'):
            pdf.set_font(ft, '', 9)
            pdf.cell(0, 5, _t('擬成立公司之名稱／形式等詳情，請參考上方公司基本資料。'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if form_code in ('nnc2',):
            pdf.set_font(ft, '', 9)
            pdf.cell(0, 5, _t('更改後公司名稱（請手動填寫）：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # Signature block
        pdf.ln(6)
        pdf.set_font(ft, 'B', 11)
        pdf.cell(0, 7, _t('簽署 / SIGNED:'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(5)
        pdf.set_font(ft, '', 10)
        pdf.cell(0, 8, _t('_______________________________'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.cell(0, 6, _t('董事 / Director       日期 Date：＿＿＿＿＿＿'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(3)
        pdf.cell(0, 8, _t('_______________________________'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.cell(0, 6, _t('公司秘書 / Company Secretary       日期 Date：＿＿＿＿＿＿'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # Footer
        pdf.ln(6)
        pdf.set_font(ft, '', 7)
        pdf.cell(0, 5, _t(f"本文件由公司秘書管理系統自動生成 · {datetime.now().strftime('%Y-%m-%d %H:%M')}"),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')

        pdf_bytes = bytes(pdf.output())
        safe_name = re.sub(r'[^\w一-鿿-]', '_', (name_en or name_cn or 'company'))[:30]
        filename = f"{meta['code']}_{meta['title']}_{safe_name}.pdf"
        return jsonify({
            'success': True,
            'pdf': base64.b64encode(pdf_bytes).decode('ascii'),
            'filename': filename,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── Generic Template PDF Filler（PyMuPDF 填充任何 AcroForm 模板） ───

@app.route('/api/generate-template-pdf', methods=['POST'])
def generate_template_pdf():
    """Fill any AcroForm PDF template with provided field values.
    Request: {template: 'ND4-template.pdf', fields: {'fill_1_P.1': 'val', ...}, checkboxes: ['cb_1_P.1', ...]}"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400

        template_name = data.get('template', '')
        if not template_name:
            return jsonify({'error': 'template name required'}), 400

        # Security: only allow .pdf files in templates dir
        safe_name = os.path.basename(template_name)
        if not safe_name.endswith('.pdf') or '..' in safe_name:
            return jsonify({'error': 'invalid template name'}), 400

        template_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'templates', safe_name)
        if not os.path.exists(template_path):
            return jsonify({'error': f'Template not found: {safe_name}'}), 404

        doc = fitz.open(template_path)

        # Build field → page map
        fmap = {}
        for pi in range(doc.page_count):
            for w in doc[pi].widgets():
                if w.field_name:
                    fmap[w.field_name] = pi

        fields = data.get('fields') or {}
        checkboxes = data.get('checkboxes') or []

        # Fill text fields
        for name, value in fields.items():
            if name not in fmap:
                continue
            pi = fmap[name]
            for w in doc[pi].widgets():
                if w.field_name == name:
                    try:
                        w.field_value = str(value) if value else ''
                        w.update()
                    except Exception:
                        pass
                    break

        # Check checkboxes
        for name in checkboxes:
            if name not in fmap:
                continue
            pi = fmap[name]
            for w in doc[pi].widgets():
                if w.field_name == name:
                    try:
                        w.field_value = True
                        w.update()
                    except Exception:
                        pass
                    break

        pdf_bytes = doc.write(deflate=True)
        doc.close()

        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── Resolution AI 生成（DeepSeek） ───

@app.route('/api/generate-resolution', methods=['POST'])
def generate_resolution():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Empty request body'}), 400
        if not data.get('companyName') or not data.get('resolutionType'):
            return jsonify({'error': 'companyName and resolutionType required'}), 400

        lang = data.get('language', 'bilingual')
        lang_instruction = (
            "Output in Traditional Chinese only."
            if lang == 'zh' else
            "Output in English only."
            if lang == 'en' else
            "Output bilingually: each major paragraph in English, followed by Traditional Chinese on a new line."
        )

        system_prompt = f"""You are a Hong Kong corporate secretarial assistant. Generate a formal company resolution.
Follow Hong Kong Companies Ordinance conventions. Use the WRITTEN RESOLUTION format unless the user asks for a meeting minute.
Structure:
1. Header: company name + Chinese name + BR number + "Written Resolution of Directors / Members"
2. Resolution number (e.g. "RESOLVED THAT:")
3. Body — clear, formal, numbered if multiple items
4. Effective date
5. Signature block (Director(s) / Members)
{lang_instruction}
Return ONLY the resolution body text, no markdown headers, no commentary, ready to paste into a PDF."""

        user_prompt = f"""Generate a {data['resolutionType']} resolution for:
Company: {data.get('companyName', '')}{' (' + data.get('companyChineseName', '') + ')' if data.get('companyChineseName') else ''}
BR Number: {data.get('brNumber', '—')}
Resolution Date: {data.get('resolutionDate', '')}

Context / Specific details from user:
{data.get('context', '(no extra context provided)')}"""

        api_key = os.environ.get('DEEPSEEK_API_KEY', '')
        if not api_key:
            return jsonify({'error': 'DEEPSEEK_API_KEY not configured'}), 500

        req_body = json.dumps({
            'model': 'deepseek-chat',
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
        }).encode('utf-8')

        ai_req = urllib.request.Request(
            'https://api.deepseek.com/v1/chat/completions',
            data=req_body,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            }
        )
        ai_resp = urllib.request.urlopen(ai_req, timeout=120)
        result = json.loads(ai_resp.read())
        content = result.get('choices', [{}])[0].get('message', {}).get('content', '')

        return jsonify({'content': content})
    except urllib.error.HTTPError as e:
        return jsonify({'error': f'AI API error {e.code}: {e.reason}'}), 502
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── DOCX Document Generation (功能說明書 7.1) ───
# Generate Microsoft Word (.docx) company secretarial documents from system data.

DOCX_TYPES = {
    'company_profile':   '公司資料摘要',
    'directors_register': '董事名冊',
    'members_register':  '成員（股東）名冊',
    'board_resolution':  '董事會書面決議',
    'meeting_minutes':   '董事會會議記錄',
    'cr_form':           '政府表格 (Word)',
}
CR_FORM_META = {
    'nar1':  {'code': 'NAR1',  'title': '周年申報表',           'title_en': 'Annual Return'},
    'nd2a':  {'code': 'ND2A',  'title': '更改公司秘書及董事通知書（委任／停任）', 'title_en': 'Notice of Change of Company Secretary and Director (Appointment/Cessation)'},
    'nd2b':  {'code': 'ND2B',  'title': '更改公司秘書及董事詳情通知書',       'title_en': 'Notice of Change in Particulars of Company Secretary and Director'},
    'nd4':   {'code': 'ND4',   'title': '公司秘書及董事辭任通知書',           'title_en': 'Notice of Resignation of Company Secretary and Director'},
    'ndr1':  {'code': 'NDR1',  'title': '撤銷註冊申請書',                    'title_en': 'Application for Deregistration'},
    'nr1':   {'code': 'NR1',   'title': '註冊辦事處地址變更通知書',           'title_en': 'Notice of Change of Registered Office Address'},
    'nsc1':  {'code': 'NSC1',  'title': '股份配發申報書',                    'title_en': 'Return of Allotment'},
    'nnc1':  {'code': 'NNC1',  'title': '法團成立表格（股份有限公司）',        'title_en': 'Incorporation Form (Company Limited by Shares)'},
    'nnc2':  {'code': 'NNC2',  'title': '更改公司名稱通知書',                 'title_en': 'Notice of Change of Company Name'},
    'nn1':   {'code': 'NN1',   'title': '註冊非香港公司註冊申請書',            'title_en': 'Application for Registration as Registered Non-Hong Kong Company'},
    'nn3':   {'code': 'NN3',   'title': '註冊非香港公司周年申報表',            'title_en': 'Annual Return of Registered Non-Hong Kong Company'},
    'nn6':   {'code': 'NN6',   'title': '非香港公司更改秘書及董事（委任／停任）', 'title_en': 'Change of Company Secretary and Director of Non-Hong Kong Company'},
    'nn7':   {'code': 'NN7',   'title': '非香港公司更改秘書及董事詳情',         'title_en': 'Change in Particulars of Company Secretary and Director of Non-Hong Kong Company'},
    'nn9':   {'code': 'NN9',   'title': '非香港公司更改地址申報表',            'title_en': 'Notice of Change of Address of Non-Hong Kong Company'},
}


def _docx_fmt_date(s):
    """Normalise stored dates. DDMMYYYY -> DD/MM/YYYY; pass through otherwise."""
    if not s:
        return ''
    s = str(s).strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:2]}/{s[2:4]}/{s[4:8]}"
    return s


def _docx_company_bundle(db, company_id):
    """Assemble a company + its members (directors / secretaries / shareholders)."""
    row = db.execute("SELECT * FROM companies WHERE id=?", (company_id,)).fetchone()
    if not row:
        return None
    c = dict(row)
    members = [dict(r) for r in db.execute(
        """SELECT pcr.role, pcr.shares, pcr.share_type, pcr.currency, pcr.paid_up,
                  pcr.date_appointed, pcr.date_ceased, pcr.is_reserve,
                  p.name_english, p.name_chinese, p.id_number, p.passport_number,
                  p.address, p.service_address, p.email, p.phone, p.identity, p.tcsp_number
           FROM person_company_roles pcr JOIN persons p ON p.id = pcr.person_id
           WHERE pcr.company_id=? AND (pcr.date_ceased IS NULL OR pcr.date_ceased='')
           ORDER BY pcr.role, p.name_english""", (company_id,)).fetchall()]
    directors = [m for m in members if m['role'] == 'director']
    secretaries = [m for m in members if m['role'] == 'secretary']
    shareholders = [m for m in members if m['role'] == 'shareholder']
    total_shares = sum(int(m['shares'] or 0) for m in shareholders)
    addr = ', '.join(filter(None, [
        c.get('reg_flat'), c.get('reg_building'), c.get('reg_street'),
        c.get('reg_district'), c.get('reg_region')]))
    return {
        'c': c, 'address': addr,
        'directors': directors, 'secretaries': secretaries,
        'shareholders': shareholders, 'total_shares': total_shares,
    }


def _docx_set_cjk_font(doc, font='Microsoft JhengHei'):
    """Ensure East-Asian glyphs render (Traditional Chinese) in the Normal style."""
    from docx.oxml.ns import qn
    style = doc.styles['Normal']
    style.font.name = font
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn('w:ascii'), font)
    rfonts.set(qn('w:hAnsi'), font)
    rfonts.set(qn('w:eastAsia'), font)


def _docx_person_label(m):
    en = (m.get('name_english') or '').strip()
    cn = (m.get('name_chinese') or '').strip()
    if en and cn:
        return f"{en}（{cn}）"
    return en or cn or '—'


def _build_docx(db, company_id, doc_type, extra=None):
    """Return (docx_bytes, filename) for the requested document type."""
    from docx import Document
    from docx.shared import Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    extra = extra or {}
    bundle = _docx_company_bundle(db, company_id)
    if not bundle:
        return None, None
    c = bundle['c']
    name_en = c.get('name') or ''
    name_cn = c.get('chinese_name') or ''
    br = c.get('company_number') or ''
    cr = c.get('ci_number') or ''

    doc = Document()
    _docx_set_cjk_font(doc)

    def h(text, size=16, bold=True, center=True, space_after=6):
        p = doc.add_paragraph()
        if center:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(text)
        r.bold = bold
        r.font.size = Pt(size)
        p.paragraph_format.space_after = Pt(space_after)
        return p

    def para(text, size=11, bold=False, center=False):
        p = doc.add_paragraph()
        if center:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(text)
        r.bold = bold
        r.font.size = Pt(size)
        return p

    def kv_table(rows):
        t = doc.add_table(rows=0, cols=2)
        t.style = 'Light Grid Accent 1'
        for k, v in rows:
            cells = t.add_row().cells
            cells[0].text = k
            cells[1].text = v or '—'
            cells[0].paragraphs[0].runs[0].bold = True
        return t

    def members_table(headers, data_rows):
        t = doc.add_table(rows=1, cols=len(headers))
        t.style = 'Light Grid Accent 1'
        for i, hd in enumerate(headers):
            cell = t.rows[0].cells[i]
            cell.text = hd
            cell.paragraphs[0].runs[0].bold = True
        for dr in data_rows:
            cells = t.add_row().cells
            for i, val in enumerate(dr):
                cells[i].text = str(val) if val not in (None, '') else '—'
        return t

    # Company header block (shared)
    def company_header():
        h(name_en or name_cn or '公司', size=18)
        if name_cn and name_en:
            h(name_cn, size=14, bold=False)
        sub = []
        if br:
            sub.append(f"商業登記號碼 (BR)：{br}")
        if cr:
            sub.append(f"公司註冊編號 (CR)：{cr}")
        if sub:
            para('　｜　'.join(sub), size=10, center=True)
        doc.add_paragraph()

    label = DOCX_TYPES.get(doc_type, '公司文件')

    if doc_type == 'company_profile':
        company_header()
        h('公司資料摘要', size=15)
        kv_table([
            ('英文名稱', name_en),
            ('中文名稱', name_cn),
            ('商業登記號碼 (BR)', br),
            ('公司註冊編號 (CR)', cr),
            ('公司類型', c.get('company_type')),
            ('成立日期', _docx_fmt_date(c.get('incorporation_date'))),
            ('狀態', c.get('status')),
            ('註冊辦事處地址', bundle['address']),
            ('電郵', c.get('email')),
            ('電話', c.get('phone')),
        ])
        doc.add_paragraph()
        h(f"董事（{len(bundle['directors'])}）", size=13, center=False)
        members_table(['姓名', '身份證／護照', '委任日期', '地址'],
                      [[_docx_person_label(m), m.get('id_number') or m.get('passport_number'),
                        _docx_fmt_date(m.get('date_appointed')), m.get('address')]
                       for m in bundle['directors']] or [['（無）', '', '', '']])
        doc.add_paragraph()
        h(f"公司秘書（{len(bundle['secretaries'])}）", size=13, center=False)
        members_table(['姓名', 'TCSP 號碼', '委任日期', '地址'],
                      [[_docx_person_label(m), m.get('tcsp_number'),
                        _docx_fmt_date(m.get('date_appointed')), m.get('address')]
                       for m in bundle['secretaries']] or [['（無）', '', '', '']])
        doc.add_paragraph()
        ts = bundle['total_shares']
        h(f"股東 / 股本結構（總發行股數：{ts}）", size=13, center=False)
        members_table(['股東', '持股', '股份類別', '佔比'],
                      [[_docx_person_label(m), m.get('shares'), m.get('share_type') or '普通股',
                        (f"{round(int(m.get('shares') or 0) * 100 / ts, 2)}%" if ts else '—')]
                       for m in bundle['shareholders']] or [['（無）', '', '', '']])

    elif doc_type == 'directors_register':
        company_header()
        h('董事名冊 / Register of Directors', size=15)
        para('依據《公司條例》(第622章) 第 641 條備存。', size=10)
        doc.add_paragraph()
        members_table(['姓名', '身份證／護照', '委任日期', '住址', '電郵'],
                      [[_docx_person_label(m), m.get('id_number') or m.get('passport_number'),
                        _docx_fmt_date(m.get('date_appointed')), m.get('address'), m.get('email')]
                       for m in bundle['directors']] or [['（無董事記錄）', '', '', '', '']])

    elif doc_type == 'members_register':
        company_header()
        h('成員（股東）名冊 / Register of Members', size=15)
        para('依據《公司條例》(第622章) 第 627 條備存。', size=10)
        doc.add_paragraph()
        ts = bundle['total_shares']
        members_table(['股東', '持股數', '股份類別', '已繳股款', '佔比'],
                      [[_docx_person_label(m), m.get('shares'), m.get('share_type') or '普通股',
                        m.get('paid_up'),
                        (f"{round(int(m.get('shares') or 0) * 100 / ts, 2)}%" if ts else '—')]
                       for m in bundle['shareholders']] or [['（無股東記錄）', '', '', '', '']])
        doc.add_paragraph()
        para(f"總發行股數：{ts}", bold=True)

    elif doc_type in ('board_resolution', 'meeting_minutes'):
        is_min = doc_type == 'meeting_minutes'
        company_header()
        m_date = extra.get('meeting_date') or ''
        location = extra.get('location') or '公司註冊辦事處'
        if is_min:
            h('董事會會議記錄', size=15)
            h('MINUTES OF MEETING OF THE BOARD OF DIRECTORS', size=11, bold=False)
            doc.add_paragraph()
            kv_table([
                ('會議日期 Date', m_date),
                ('會議地點 Venue', location),
                ('出席董事 Present', '；'.join(_docx_person_label(m) for m in bundle['directors']) or '—'),
                ('主席 Chairman', _docx_person_label(bundle['directors'][0]) if bundle['directors'] else '—'),
            ])
        else:
            h('董事會書面決議', size=15)
            h('WRITTEN RESOLUTION OF THE DIRECTORS', size=11, bold=False)
            doc.add_paragraph()
            kv_table([
                ('決議日期 Date', m_date),
                ('簽署董事 Directors', '；'.join(_docx_person_label(m) for m in bundle['directors']) or '—'),
            ])
        doc.add_paragraph()
        para('議決事項 / RESOLVED THAT:', bold=True, size=12)
        content = (extra.get('content') or '').strip()
        if content:
            for line in content.split('\n'):
                para(line, size=11)
        else:
            para('1. ＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿', size=11)
            para('2. ＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿', size=11)
        doc.add_paragraph()
        doc.add_paragraph()
        para('簽署 / SIGNED:', bold=True)
        for m in (bundle['directors'] or [{'name_english': '＿＿＿＿＿＿'}]):
            doc.add_paragraph()
            para('_______________________________', size=11)
            para(f"{_docx_person_label(m)}　董事 / Director", size=10)
    elif doc_type == 'cr_form':
        form_code = (extra.get('form_code') or '').lower()
        meta = CR_FORM_META.get(form_code, {})
        if not meta:
            return None, None
        label = f"{meta['code']}_{meta['title']}"  # 檔名含表格編號+中文名
        company_header()
        h(f"{meta['title']} {meta['code']}", size=15)
        h(meta['title_en'], size=11, bold=False)
        para(f'公司註冊處表格 {meta["code"]} — 由系統自動填入公司資料生成草稿', size=9)
        doc.add_paragraph()

        # ── 共用欄位：公司基本資料 ──
        kv_table([
            ('公司英文名稱', name_en),
            ('公司中文名稱', name_cn),
            ('商業登記號碼 (BR)', br),
            ('公司註冊編號 (CR)', cr),
            ('公司類型', c.get('company_type')),
            ('註冊辦事處地址', bundle['address']),
            ('電郵', c.get('email')),
            ('電話', c.get('phone')),
            ('成立日期', _docx_fmt_date(c.get('incorporation_date'))),
            ('公司狀態', c.get('status')),
        ])
        doc.add_paragraph()

        # ── 董事 / 秘書（大部分表格都需要）──
        has_officers = form_code in ('nar1','nd2a','nd2b','nd4','nnc1','nn1','nn3','nn6','nn7')
        if has_officers:
            h(f"董事（{len(bundle['directors'])}）", size=13, center=False)
            members_table(
                ['姓名', '身份', '身份證／護照／公司編號', '委任日期', '辭任日期', '地址', '電郵'],
                [[_docx_person_label(m),
                  '法人' if m.get('identity') == 'corporate' else '自然人',
                  m.get('id_number') or m.get('passport_number') or m.get('tcsp_number') or '',
                  _docx_fmt_date(m.get('date_appointed')),
                  _docx_fmt_date(m.get('date_ceased')),
                  m.get('address') or '',
                  m.get('email') or '']
                 for m in bundle['directors']] or [['（無）', '', '', '', '', '', '']])
            doc.add_paragraph()
            h(f"公司秘書（{len(bundle['secretaries'])}）", size=13, center=False)
            members_table(
                ['姓名', '身份', 'TCSP／公司編號', '委任日期', '地址', '電郵'],
                [[_docx_person_label(m),
                  '法人' if m.get('identity') == 'corporate' else '自然人',
                  m.get('tcsp_number') or '',
                  _docx_fmt_date(m.get('date_appointed')),
                  m.get('address') or '',
                  m.get('email') or '']
                 for m in bundle['secretaries']] or [['（無）', '', '', '', '', '']])
            doc.add_paragraph()

        # ── 股東 / 股本 ──
        has_shares = form_code in ('nar1','nsc1','nnc1','nn1','nn3')
        if has_shares:
            ts = bundle['total_shares']
            h(f"股東／股本結構（總發行股數：{ts}）", size=13, center=False)
            members_table(
                ['股東', '持股數', '股份類別', '已繳股款', '佔比'],
                [[_docx_person_label(m),
                  m.get('shares') or '0',
                  m.get('share_type') or '普通股',
                  m.get('paid_up') or '',
                  (f"{round(int(m.get('shares') or 0) * 100 / ts, 2)}%" if ts else '—')]
                 for m in bundle['shareholders']] or [['（無）', '', '', '', '']])
            doc.add_paragraph()

        # ── NAR1 額外欄位 ──
        if form_code == 'nar1':
            para('重要控制人登記冊 (SCR) 是否備存於公司註冊辦事處？　是 □　否 □', size=11)
            para(f"截至申報日期之董事／秘書／股東資料以上表為準。", size=10)
            doc.add_paragraph()

        # ── 地址變更類 (NR1 / NDR1 / NN9) ──
        if form_code in ('nr1', 'ndr1', 'nn9'):
            para('現有註冊地址：', bold=True, size=11)
            para(bundle['address'] or '（未填）', size=11)
            para('變更後註冊地址（請手動填寫）：', bold=True, size=11)
            para('＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿', size=11)
            doc.add_paragraph()

        # ── 股份配發 (NSC1) 額外欄位 ──
        if form_code == 'nsc1':
            para('配發日期：＿＿＿＿＿＿＿＿', size=11)
            para('配發股份類別：＿＿＿＿＿＿＿＿', size=11)
            para('每股發行價：＿＿＿＿＿＿＿＿', size=11)
            para('配發總額：＿＿＿＿＿＿＿＿', size=11)
            doc.add_paragraph()

        # ── 簽署區 ──
        doc.add_paragraph()
        para('簽署 / SIGNED:', bold=True, size=11)
        doc.add_paragraph()
        para('_______________________________', size=11)
        para(f"董事 / Director　　日期 Date：＿＿＿＿＿＿＿＿", size=10)
        doc.add_paragraph()
        para('_______________________________', size=11)
        para(f"公司秘書 / Company Secretary　　日期 Date：＿＿＿＿＿＿＿＿", size=10)

    else:
        return None, None

    # Footer note
    doc.add_paragraph()
    footer = para(f"本文件由公司秘書管理系統自動生成 · {datetime.now().strftime('%Y-%m-%d %H:%M')}", size=8)
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER

    import io as _io
    buf = _io.BytesIO()
    doc.save(buf)
    safe_name = re.sub(r'[^\w一-鿿-]', '_', (name_en or name_cn or 'company'))[:40]
    filename = f"{safe_name}_{label}.docx"
    return buf.getvalue(), filename


@app.route('/api/generate-docx', methods=['POST', 'OPTIONS'])
def generate_docx():
    if request.method == 'OPTIONS':
        return ('', 204)
    try:
        u = get_user()
        if not u:
            return jsonify({'error': 'Not authenticated'}), 401

        data = request.get_json(force=True, silent=True) or {}
        company_id = data.get('company_id')
        doc_type = data.get('doc_type')
        if not company_id:
            return jsonify({'error': '缺少 company_id'}), 400
        if doc_type not in DOCX_TYPES:
            return jsonify({'error': f'不支援的文件類型：{doc_type}',
                            'supported': list(DOCX_TYPES.keys())}), 400
        db = get_db()
        docx_bytes, filename = _build_docx(
            db, company_id, doc_type,
            extra={
                'content': data.get('content'),
                'meeting_date': data.get('meeting_date'),
                'location': data.get('location'),
                'form_code': data.get('form_code'),
            })
        if docx_bytes is None:
            return jsonify({'error': '找不到該公司'}), 404
        return jsonify({
            'success': True,
            'docx': base64.b64encode(docx_bytes).decode('ascii'),
            'filename': filename,
            'doc_type': doc_type,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/docx-types', methods=['GET'])
def docx_types():
    return jsonify([{'key': k, 'label': v} for k, v in DOCX_TYPES.items()])


# ─── 檢索服務 (功能說明書 6.1–6.6) ───

@app.route('/api/company-registers', methods=['GET'])
def company_registers():
    """6.2–6.6 公司登記冊明細：當前/歷史董事、股東、股份轉讓、SCR。"""
    company_id = request.args.get('company_id')
    if not company_id:
        return jsonify({'error': '缺少 company_id'}), 400
    db = get_db()
    company = db.execute("SELECT id, name, chinese_name, company_number FROM companies WHERE id=?",
                         (company_id,)).fetchone()
    if not company:
        return jsonify({'error': '找不到該公司'}), 404

    def roles(role, historical):
        cond = ("(pcr.date_ceased IS NOT NULL AND pcr.date_ceased != '')" if historical
                else "(pcr.date_ceased IS NULL OR pcr.date_ceased = '')")
        return [dict(r) for r in db.execute(
            f"""SELECT pcr.role, pcr.shares, pcr.share_type, pcr.currency, pcr.paid_up, pcr.unpaid,
                       pcr.date_appointed, pcr.date_ceased, pcr.is_reserve,
                       p.id AS person_id, p.identity, p.name_english, p.name_chinese,
                       p.id_number, p.passport_number, p.address, p.email, p.phone
                FROM person_company_roles pcr JOIN persons p ON p.id = pcr.person_id
                WHERE pcr.company_id = ? AND pcr.role = ? AND {cond}
                ORDER BY p.name_english""", (company_id, role)).fetchall()]

    share_tx = [dict(r) for r in db.execute(
        """SELECT * FROM share_transactions WHERE company_id = ?
           ORDER BY transaction_date DESC, created_at DESC""", (company_id,)).fetchall()]
    scr = [dict(r) for r in db.execute(
        "SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY name_english",
        (company_id,)).fetchall()]

    return jsonify({
        'company': dict(company),
        'current_directors': roles('director', False),
        'historical_directors': roles('director', True),
        'current_shareholders': roles('shareholder', False),
        'historical_shareholders': roles('shareholder', True),
        'secretaries': roles('secretary', False),
        'share_transactions': share_tx,
        'scr': scr,
    })


# ─── NAR1 Field Listing & Debug PDF ───

@app.route('/api/nar1-fields', methods=['GET'])
def nar1_fields():
    """List all AcroForm fields in the NAR1 template (for FieldMapping page)."""
    try:
        template_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'templates', 'NAR1-template-new.pdf')
        if not os.path.exists(template_path):
            return jsonify({'error': 'NAR1 template not found'}), 404
        doc = fitz.open(template_path)
        fields = []
        for pi in range(doc.page_count):
            for w in doc[pi].widgets():
                if w.field_name:
                    fields.append({
                        'name': w.field_name,
                        'type': 'checkbox' if w.field_name.startswith('cb_') else
                                'dropdown' if w.field_name.startswith('Dropdown') else 'text',
                        'page': pi + 1,
                    })
        doc.close()
        return jsonify({'fields': fields})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/nar1-debug-pdf', methods=['POST'])
def nar1_debug_pdf():
    """Generate a debug PDF with all field names filled into their widgets."""
    try:
        template_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'templates', 'NAR1-template-new.pdf')
        if not os.path.exists(template_path):
            return jsonify({'error': 'NAR1 template not found'}), 404
        doc = fitz.open(template_path)
        for pi in range(doc.page_count):
            for w in doc[pi].widgets():
                if not w.field_name:
                    continue
                try:
                    if w.field_name.startswith('cb_'):
                        # Check all checkboxes
                        w.field_value = True
                        w.update()
                    else:
                        w.field_value = w.field_name
                        w.update()
                except Exception:
                    pass
        pdf_bytes = doc.write(deflate=True)
        doc.close()
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── Full Export ───

@app.route('/api/export-all', methods=['POST'])
def export_all():
    """Export all tables as a JSON dump. Returns JSON (zip requires extra deps)."""
    try:
        db = get_db()
        export = {}
        for table in TABLES:
            try:
                rows = db.execute(f"SELECT * FROM {table}").fetchall()
                export[table] = [dict(r) for r in rows]
            except sqlite3.OperationalError:
                export[table] = []
        return jsonify({'success': True, 'data': export, 'exported_at': datetime.now().isoformat()})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Handle OPTIONS preflight
@app.route('/api/<path:path>', methods=['OPTIONS'])
def handle_options(path=''):
    return '', 204

# ─── Form History endpoints (mirrors Cloudflare Functions /api/form-history/*) ───

@app.route('/api/form-history/list', methods=['GET'])
def form_history_list():
    u = get_user()
    if not u:
        return jsonify({'error': 'Not authenticated'}), 401
    form_type = request.args.get('formType', '')
    if not form_type:
        return jsonify({'entries': []})
    db = get_db()
    rows = db.execute(
        'SELECT id, label, form_type, submission_index, created_at FROM form_history WHERE user_id = ? AND form_type = ? ORDER BY submission_index DESC',
        (u['id'], form_type)
    ).fetchall()
    entries = [{'id': r['id'], 'label': r['label'], 'form_type': r['form_type'],
                'submission_index': r['submission_index'], 'created_at': r['created_at']} for r in rows]
    return jsonify({'entries': entries})


@app.route('/api/form-history/load', methods=['GET'])
def form_history_load():
    u = get_user()
    if not u:
        return jsonify({'error': 'Not authenticated'}), 401
    entry_id = request.args.get('id', '')
    if not entry_id:
        return jsonify({'error': 'Missing id'}), 400
    db = get_db()
    row = db.execute(
        'SELECT id, form_data FROM form_history WHERE id = ? AND user_id = ?',
        (entry_id, u['id'])
    ).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    form_data = json.loads(row['form_data']) if row['form_data'] else {}
    return jsonify({'entry': {'id': row['id'], 'form_data': form_data}})


@app.route('/api/form-history/save', methods=['POST'])
def form_history_save():
    u = get_user()
    if not u:
        return jsonify({'error': 'Not authenticated'}), 401
    data = request.get_json(force=True, silent=True) or {}
    form_type = data.get('formType', '')
    form_data = data.get('formData')
    if not form_type or form_data is None:
        return jsonify({'error': 'formType and formData required'}), 400
    db = get_db()
    max_row = db.execute(
        'SELECT COALESCE(MAX(submission_index), 0) as max_idx FROM form_history WHERE user_id = ? AND form_type = ?',
        (u['id'], form_type)
    ).fetchone()
    next_idx = (max_row['max_idx'] or 0) + 1
    today = datetime.now().date().isoformat()
    label = f'{today}_{form_type}_{next_idx}'
    cursor = db.execute(
        'INSERT INTO form_history (user_id, user_email, form_type, submission_index, label, form_data) VALUES (?, ?, ?, ?, ?, ?)',
        (u['id'], u.get('email', ''), form_type, next_idx, label, json.dumps(form_data, ensure_ascii=False))
    )
    db.commit()
    return jsonify({'id': cursor.lastrowid, 'label': label, 'submission_index': next_idx}), 201


@app.route('/api/form-history/<entry_id>', methods=['DELETE'])
def form_history_delete(entry_id):
    u = get_user()
    if not u:
        return jsonify({'error': 'Not authenticated'}), 401
    if not entry_id:
        return jsonify({'error': 'Missing id'}), 400
    db = get_db()
    row = db.execute(
        'SELECT form_type, submission_index FROM form_history WHERE id = ? AND user_id = ?',
        (entry_id, u['id'])
    ).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    form_type = row['form_type']
    deleted_idx = row['submission_index']
    db.execute('DELETE FROM form_history WHERE id = ? AND user_id = ?', (entry_id, u['id']))
    db.execute(
        'UPDATE form_history SET submission_index = submission_index - 1 WHERE user_id = ? AND form_type = ? AND submission_index > ?',
        (u['id'], form_type, deleted_idx)
    )
    rows = db.execute(
        'SELECT id, created_at, submission_index FROM form_history WHERE user_id = ? AND form_type = ? AND submission_index >= ? ORDER BY submission_index',
        (u['id'], form_type, deleted_idx)
    ).fetchall()
    for r in rows:
        date_part = (r['created_at'] or '')[:10]
        new_label = f'{date_part}_{form_type}_{r["submission_index"]}'
        db.execute('UPDATE form_history SET label = ? WHERE id = ?', (new_label, r['id']))
    db.commit()
    return jsonify({'ok': True})


if __name__ == '__main__':
    init_db()
    auto_migrate()
    # Start the scheduled-email background thread once (avoid the Flask reloader
    # child spawning a second copy).
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        threading.Thread(target=scheduler_loop, daemon=True).start()
        print("[SERVER] Scheduled-email worker started (checks every 60s)")
    print("[SERVER] Local API running at http://localhost:5000")
    print("[SERVER] Admin account: admin@localhost / admin123")
    print("[SERVER] Register new accounts at /api/auth/register (no admin required)")
    if RESEND_API_KEY:
        print(f"[SERVER] Email: Resend API configured (onboarding@resend.dev)")
    elif SMTP_HOST:
        print(f"[SERVER] SMTP: configured ({SMTP_HOST})")
    else:
        print(f"[SERVER] Email: NOT configured — emails are SIMULATED & logged")
    app.run(host='0.0.0.0', port=5000, debug=True)
