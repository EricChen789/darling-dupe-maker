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
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from datetime import datetime
from flask import Flask, request, jsonify, g, Response
from fpdf import FPDF

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

def sign_jwt(payload: dict) -> str:
    header = base64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = {**payload, "iat": int(time.time())}
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
    except Exception:
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
    except Exception:
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

def create_pdf():
    """Create an fpdf2 FPDF instance with Chinese font (cached)."""
    font_path = find_font()
    pdf = FPDF(orientation='P', unit='pt', format='A4')
    if font_path:
        try:
            pdf.add_font('TC', style='', fname=font_path, uni=True)
        except Exception as e:
            print(f"[PDF] Failed to load font {font_path}: {e}")
    if not font_path:
        pdf.set_font('Helvetica', size=10)
    pdf.set_auto_page_break(auto=True, margin=60)
    return pdf

def pdf_draw(pdf, text, x, y, size=10, gray=0):
    """Draw text at absolute position (matching pdf-lib drawText API)."""
    pdf.set_xy(x, y)
    pdf.set_font('TC', size=size)
    pdf.set_text_color(gray, gray, gray)
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

    # shareholders: add updated_at (P3-1)
    ensure_columns('shareholders', {
        'updated_at': "TEXT NOT NULL DEFAULT (datetime('now'))",
    })

    # user_roles: add updated_at (P3-1) — use simple default for SQLite compat
    ensure_columns('user_roles', {
        'updated_at': "TEXT DEFAULT ''",
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
            ('collection', '客戶資料收集', '【{company_name}】周年申報所需資料',
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

    db.close()

# ─── Email module ───
# SMTP config via environment (optional). When unset, sending is SIMULATED:
# the email is recorded in email_logs with status='sent' but nothing leaves
# the machine — perfect for local dev / UAT demos without a real mail server.
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
    """Send an email via SMTP if configured, else simulate.
    Returns (ok: bool, error: str, simulated: bool)."""
    if not to_email:
        return False, 'Missing recipient', False
    if not SMTP_HOST:
        # Simulated send — log to console so it's visible during dev.
        print(f"[EMAIL:SIMULATED] to={to_email} cc={cc_email} subject={subject!r}")
        return True, '', True
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
        print(f"[EMAIL:SENT] to={to_email} subject={subject!r}")
        return True, '', False
    except Exception as e:
        print(f"[EMAIL:FAILED] to={to_email}: {e}")
        return False, str(e), False


def process_scheduled_emails():
    """Send any scheduled emails whose scheduled_at has passed. Called by the
    background scheduler thread. Uses its own connection (runs off-request)."""
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S')
        due = db.execute(
            "SELECT * FROM email_logs WHERE status = 'scheduled' AND scheduled_at IS NOT NULL "
            "AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 50",
            (now,)
        ).fetchall()
        for row in due:
            ok, err, _sim = deliver_email(row['to_email'], row['subject'], row['body'], row['cc_email'] or '')
            db.execute(
                "UPDATE email_logs SET status = ?, sent_at = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
                ('sent' if ok else 'failed', datetime.utcnow().isoformat() if ok else None, err, row['id'])
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
          'email_templates', 'email_logs']

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

    # Determine if this is a future-dated (scheduled) send.
    is_scheduled = False
    if scheduled_at:
        try:
            when = datetime.fromisoformat(scheduled_at.replace('Z', ''))
            is_scheduled = when > datetime.utcnow()
        except ValueError:
            is_scheduled = False

    if is_scheduled:
        db.execute(
            "INSERT INTO email_logs (id, company_id, template_id, to_email, cc_email, subject, body, status, scheduled_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)",
            (log_id, data.get('company_id'), data.get('template_id'), to_email, cc_email, subject, body, scheduled_at)
        )
        db.commit()
        return jsonify({'success': True, 'id': log_id, 'status': 'scheduled', 'scheduled_at': scheduled_at})

    ok, err, simulated = deliver_email(to_email, subject, body, cc_email)
    status = 'sent' if ok else 'failed'
    db.execute(
        "INSERT INTO email_logs (id, company_id, template_id, to_email, cc_email, subject, body, status, sent_at, error) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (log_id, data.get('company_id'), data.get('template_id'), to_email, cc_email, subject, body,
         status, datetime.utcnow().isoformat() if ok else None, err)
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

    role_row = db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'",
                          (user['id'],)).fetchone()
    role = 'admin' if role_row else 'user'

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

# ─── PDF Generation ───
@app.route('/api/generate-shareholders-register-pdf', methods=['POST'])
def generate_shareholders_register_pdf():
    data = request.get_json(silent=True) or {}
    company_id = data.get('companyId', '')
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400

    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Company not found'}), 404

    # Read shareholders from person_company_roles (same source as frontend)
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

    pdf = create_pdf()
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)  # manual page breaks only
    y, left = 50, 50
    GRAY_LABEL = 100
    GRAY_DIM = 128

    # Title
    pdf_draw(pdf, "股東登記冊 / Register of Members", left, y, size=16)
    y += 22
    pdf_draw(pdf, f"公司名稱: {company['name'] or ''}", left, y, size=11)
    y += 14
    if company['chinese_name']:
        pdf_draw(pdf, f"中文名稱: {company['chinese_name']}", left, y)
        y += 14
    pdf_draw(pdf, f"商業登記號碼 BR: {company['company_number'] or '-'}", left, y)
    y += 14
    pdf_draw(pdf, f"生成日期: {datetime.now().strftime('%Y-%m-%d')}", left, y)
    y += 22

    # Current Shareholders
    pdf_draw(pdf, "現有股東 Current Shareholders", left, y, size=13)
    y += 18

    if not roles:
        pdf_draw(pdf, "(無記錄 / None)", left, y, size=10, gray=GRAY_DIM)
        y += 20
    else:
        for idx, r in enumerate(roles):
            p = person_map.get(r['person_id'], {})
            pdf_draw(pdf, f"{idx+1}. {rget(p, 'name_english') or rget(p, 'name_chinese') or '(unnamed)'}", left, y, size=11)
            y += 15
            rows = [
                ("身份 Identity", "Corporate / 法人" if rget(p, 'identity') == 'corporate' else "Natural / 自然人"),
                ("中文姓名", rget(p, 'name_chinese') or '-'),
                ("身份證/護照/編號", rget(p, 'id_number') or '-'),
                ("出生日期 DOB", rget(p, 'date_of_birth') or '-'),
                ("地址 Address", rget(p, 'address') or '-'),
                ("持股數 Shares", str(r['shares'] or 0)),
                ("股份類別 Class", r['share_type'] or '-'),
                ("每股價 Issue Price", f"{r['currency'] or 'HKD'} {r['issue_price'] or '-'}"),
                ("實繳 Paid Up", r['paid_up'] or '-'),
                ("未繳 Unpaid", r['unpaid'] or '-'),
            ]
            for k, v in rows:
                if y > 740:
                    pdf.add_page()
                    y = 50
                y = pdf_draw_field(pdf, f"  {k}:", v, left, left + 160, y, 280, size=9, label_gray=GRAY_LABEL)
                y += 4
            y += 6
            if y > 740:
                pdf.add_page()
                y = 50

    y += 10
    if y > 740:
        pdf.add_page()
        y = 50

    # Share Transfer History
    pdf_draw(pdf, "股份轉讓記錄 Share Transfer History", left, y, size=13)
    y += 18

    if not txs:
        pdf_draw(pdf, "(無轉讓記錄 / No transfers recorded)", left, y, size=10, gray=GRAY_DIM)
        y += 20
    else:
        for idx, t in enumerate(txs):
            pdf_draw(pdf, f"{idx+1}. {t['transaction_date'] or '-'}  ({t['transaction_type'] or 'transfer'})", left, y, size=11)
            y += 14
            rows = [
                ("轉讓人 From", rget(t, 'from_name') or '-'),
                ("受讓人 To", rget(t, 'to_name') or '-'),
                ("股數 Shares", str(t['shares'] or 0)),
                ("股份類別 Class", rget(t, 'share_type') or '-'),
                ("每股價格", f"{rget(t, 'currency') or 'HKD'} {rget(t, 'price_per_share') or '-'}"),
                ("總代價 Consideration", rget(t, 'total_consideration') or '-'),
                ("文件編號 Instrument", rget(t, 'instrument_number') or '-'),
                ("備註 Notes", rget(t, 'notes') or '-'),
            ]
            for k, v in rows:
                if y > 740:
                    pdf.add_page()
                    y = 50
                y = pdf_draw_field(pdf, f"  {k}:", v, left, left + 160, y, 280, size=9, label_gray=GRAY_LABEL)
                y += 4
            y += 6
            if y > 740:
                pdf.add_page()
                y = 50

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})

@app.route('/api/generate-directors-register-pdf', methods=['POST'])
def generate_directors_register_pdf():
    data = request.get_json(silent=True) or {}
    company_id = data.get('companyId', '')
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400

    db = get_db()
    company = db.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not company:
        return jsonify({'error': 'Company not found'}), 404

    roles = db.execute(
        "SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'director'",
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
    pdf.set_auto_page_break(auto=False)  # manual page breaks only
    y, left = 50, 50
    GRAY_LABEL = 100
    GRAY_DIM = 128

    pdf_draw(pdf, "董事登記冊 / Register of Directors", left, y, size=16)
    y += 22
    pdf_draw(pdf, f"公司名稱: {company['name'] or ''}", left, y, size=11)
    y += 14
    if company['chinese_name']:
        pdf_draw(pdf, f"中文名稱: {company['chinese_name']}", left, y)
        y += 14
    pdf_draw(pdf, f"商業登記號碼 BR: {company['company_number'] or '-'}", left, y)
    y += 14
    pdf_draw(pdf, f"生成日期: {datetime.now().strftime('%Y-%m-%d')}", left, y)
    y += 22

    directors = [r for r in roles if r['role'] == 'director']

    def draw_section(title, items):
        nonlocal y
        pdf_draw(pdf, title, left, y, size=13)
        y += 18
        if not items:
            pdf_draw(pdf, "(無記錄 / None)", left, y, size=10, gray=GRAY_DIM)
            y += 20
            return
        for idx, r in enumerate(items):
            p = person_map.get(r['person_id'], {})
            label = f"{idx+1}. {rget(p, 'name_english') or rget(p, 'name_chinese') or '(unnamed)'}"
            if rget(r, 'is_reserve'):
                label += "  [預備董事 Reserve]"
            pdf_draw(pdf, label, left, y, size=11)
            y += 15
            rows = [
                ("身份 Identity", "Corporate / 法人" if rget(p, 'identity') == 'corporate' else "Natural / 自然人"),
                ("中文姓名", rget(p, 'name_chinese') or '-'),
                ("身份證/護照/編號", rget(p, 'id_number') or '-'),
                ("出生日期 DOB", rget(p, 'date_of_birth') or '-'),
                ("地址 Address", rget(p, 'address') or '-'),
                ("服務地址 Service Address", rget(r, 'service_address_override') or rget(p, 'service_address') or '-'),
                ("委任日期 Date Appointed", rget(r, 'date_appointed') or '-'),
                ("停止日期 Date Ceased", rget(r, 'date_ceased') or '-'),
            ]
            if rget(p, 'identity') == 'corporate':
                rows.append(("註冊地 Place Incorporated", rget(p, 'place_incorporated') or '-'))
                rows.append(("公司編號 Company No.", rget(p, 'company_number_ref') or '-'))
            for k, v in rows:
                if y > 740:
                    pdf.add_page()
                    y = 50
                y = pdf_draw_field(pdf, f"  {k}:", v, left, left + 160, y, 280, size=9, label_gray=GRAY_LABEL)
                y += 4
            y += 6
            if y > 740:
                pdf.add_page()
                y = 50

    draw_section("董事 Directors", directors)

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})


@app.route('/api/generate-secretaries-register-pdf', methods=['POST'])
def generate_secretaries_register_pdf():
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
    pdf.set_auto_page_break(auto=False)  # manual page breaks only
    y, left = 50, 50
    GRAY_LABEL = 100
    GRAY_DIM = 128

    pdf_draw(pdf, "公司秘書登記冊 / Register of Company Secretaries", left, y, size=16)
    y += 22
    pdf_draw(pdf, f"公司名稱: {company['name'] or ''}", left, y, size=11)
    y += 14
    if company['chinese_name']:
        pdf_draw(pdf, f"中文名稱: {company['chinese_name']}", left, y)
        y += 14
    pdf_draw(pdf, f"商業登記號碼 BR: {company['company_number'] or '-'}", left, y)
    y += 14
    pdf_draw(pdf, f"生成日期: {datetime.now().strftime('%Y-%m-%d')}", left, y)
    y += 22

    if not roles:
        pdf_draw(pdf, "(無記錄 / None)", left, y, size=10, gray=GRAY_DIM)
        y += 20
    else:
        for idx, r in enumerate(roles):
            p = person_map.get(r['person_id'], {})
            label = f"{idx+1}. {rget(p, 'name_english') or rget(p, 'name_chinese') or '(unnamed)'}"
            pdf_draw(pdf, label, left, y, size=11)
            y += 15
            rows = [
                ("身份 Identity", "Corporate / 法人" if rget(p, 'identity') == 'corporate' else "Natural / 自然人"),
                ("中文姓名", rget(p, 'name_chinese') or '-'),
                ("身份證/護照/編號", rget(p, 'id_number') or '-'),
                ("TCSP 牌照號碼", rget(p, 'tcsp_number') or '-'),
                ("地址 Address", rget(p, 'address') or '-'),
                ("服務地址 Service Address", rget(r, 'service_address_override') or rget(p, 'service_address') or '-'),
                ("委任日期 Date Appointed", rget(r, 'date_appointed') or '-'),
                ("停止日期 Date Ceased", rget(r, 'date_ceased') or '-'),
            ]
            if rget(p, 'identity') == 'corporate':
                rows.append(("註冊地 Place Incorporated", rget(p, 'place_incorporated') or '-'))
                rows.append(("公司編號 Company No.", rget(p, 'company_number_ref') or '-'))
            for k, v in rows:
                if y > 740:
                    pdf.add_page()
                    y = 50
                y = pdf_draw_field(pdf, f"  {k}:", v, left, left + 160, y, 280, size=9, label_gray=GRAY_LABEL)
                y += 4
            y += 6
            if y > 740:
                pdf.add_page()
                y = 50

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})


@app.route('/api/generate-scr-pdf', methods=['POST'])
def generate_scr_pdf():
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

    pdf = create_pdf()
    pdf.add_page()
    pdf.set_auto_page_break(auto=False)  # manual page breaks only
    y, left = 50, 50
    GRAY_LABEL = 100
    GRAY_DIM = 128

    pdf_draw(pdf, "重要控制人登記冊 / Significant Controllers Register", left, y, size=16)
    y += 22
    pdf_draw(pdf, f"公司名稱: {company['name'] or ''}", left, y, size=11)
    y += 14
    if company['chinese_name']:
        pdf_draw(pdf, f"中文名稱: {company['chinese_name']}", left, y)
        y += 14
    pdf_draw(pdf, f"商業登記號碼 BR: {company['company_number'] or '-'}", left, y)
    y += 14
    pdf_draw(pdf, f"生成日期: {datetime.now().strftime('%Y-%m-%d')}", left, y)
    y += 22

    if not scrs:
        pdf_draw(pdf, "(無記錄 / None)", left, y, size=10, gray=GRAY_DIM)
        y += 20
    else:
        for idx, s in enumerate(scrs):
            pdf_draw(pdf, f"{idx+1}. {rget(s, 'name_english') or rget(s, 'name_chinese') or '(unnamed)'}", left, y, size=12)
            y += 16
            natures = []
            if rget(s, 'nature_shares'): natures.append('持股 >25%')
            if rget(s, 'nature_voting'): natures.append('表決權 >25%')
            if rget(s, 'nature_appoint'): natures.append('任命董事權')
            if rget(s, 'nature_influence'): natures.append('重大影響')
            if rget(s, 'nature_trust'): natures.append('信託控制')
            if rget(s, 'nature_other'): natures.append(s['nature_other'])
            rows = [
                ("身份 Identity", "法人 Corporate" if rget(s, 'identity') == 'corporate' else "自然人 Natural"),
                ("身份證/編號", rget(s, 'id_number') or '-'),
                ("中文名稱", rget(s, 'name_chinese') or '-'),
                ("居住/註冊地址", rget(s, 'address') or '-'),
                ("服務地址 Service Address", rget(s, 'service_address') or '-'),
                ("成為控制人日期", rget(s, 'date_became') or '-'),
                ("停止日期 Date Ceased", rget(s, 'date_ceased') or '-'),
                ("控制性質 Nature of Control", '、'.join(natures) or '-'),
            ]
            if rget(s, 'is_designated_rep'):
                rows.append(("指定代表 Designated Rep", f"{rget(s, 'designated_rep_name') or '-'} ({rget(s, 'designated_rep_contact') or '-'})"))
            for k, v in rows:
                if y > 740:
                    pdf.add_page()
                    y = 50
                y = pdf_draw_field(pdf, f"  {k}:", v, left, left + 160, y, 280, size=9, label_gray=GRAY_LABEL)
                y += 4
            y += 8
            if y > 740:
                pdf.add_page()
                y = 50

    pdf_bytes = bytes(pdf.output())
    import base64 as b64
    return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})

# ─── Generic CRUD ───
@app.route('/api/<table_name>', methods=['GET'])
def table_list(table_name):
    if table_name not in TABLES:
        return jsonify({'error': 'Not found'}), 404
    db = get_db()
    # Build query from search params — allow any query param as WHERE filter
    reserved = {'search', 'limit', 'offset'}
    where = []
    bindings = []
    for key in request.args:
        if key in reserved:
            continue
        val = request.args.get(key)
        if val:
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
        "SELECT id, name, chinese_name, company_number, 'company' as type FROM companies WHERE name LIKE ? OR chinese_name LIKE ? OR company_number LIKE ? LIMIT 20",
        (s, s, s)).fetchall()
    persons = db.execute(
        "SELECT id, name_english, name_chinese, 'person' as type FROM persons WHERE name_english LIKE ? OR name_chinese LIKE ? LIMIT 20",
        (s, s)).fetchall()
    return jsonify([dict(r) for r in companies] + [dict(r) for r in persons])

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
    r'^(?:flat|room|rm|unit|shop|suite|ste|workshop|portion|floor|fl|\d+/f|g/f|gf|lg/f|ug/f|m/f|b\d*/f)',
    re.IGNORECASE
)
_ADDR_COUNTRY_RE = re.compile(
    r'(hong\s*kong|hk\b|china|prc|macau|macao|singapore|taiwan|united\s+\w+|\busa\b|\buk\b|canada|australia|japan|korea|h\.?k\.?\s*sar|香港|中國|澳門|台灣|新加坡|日本|韓國|英國|美國|加拿大|澳洲)',
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
    if not addr:
        return {'flat': '', 'building': '', 'street': '', 'district': '', 'country': ''}
    parts = [s.strip() for s in addr.split(',') if s.strip() and not _PURE_NUMBER_RE.match(s.strip())]
    if not parts:
        return {'flat': '', 'building': '', 'street': '', 'district': '', 'country': ''}
    if len(parts) == 1:
        return {'flat': '', 'building': '', 'street': parts[0], 'district': '', 'country': ''}
    country = ''
    if _ADDR_COUNTRY_RE.search(parts[-1]):
        country = parts.pop()
    district = ''
    if len(parts) > 1 and len(parts) >= 3:
        district = parts.pop()
    flat_parts = []
    while len(parts) > 1 and _ADDR_FLAT_RE.match(parts[0]):
        flat_parts.append(parts.pop(0))
    flat = ', '.join(flat_parts)
    building = parts.pop(0) if parts else ''
    street = ', '.join(parts)
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
    """遍历所有页面，建立 field_name → page_index 映射（不存储 widget 引用，避免 Annot not bound to page）"""
    fmap = {}
    for pi in range(doc.page_count):
        for w in doc[pi].widgets():
            name = w.field_name
            if name:
                fmap[name] = pi
    return fmap

def _set_text(doc, fmap, name, value):
    """在指定页面上查找 widget 并设置值（必须在迭代内完成 update，widget 引用不能外传）"""
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

def _check(doc, fmap, name, should_check):
    """在指定页面上查找 checkbox 并勾选"""
    if not should_check or name not in fmap:
        return False
    pi = fmap[name]
    for w in doc[pi].widgets():
        if w.field_name == name:
            try:
                # Discover the checkbox "On" state name from /AP/N dictionary
                on_state = 'Yes'
                try:
                    ap = w._annot.get('AP')
                    if ap:
                        ap_n = ap.get('N')
                        if ap_n and hasattr(ap_n, 'keys'):
                            for k in ap_n.keys():
                                kname = str(k).lstrip('/')
                                if kname and kname != 'Off':
                                    on_state = kname
                                    break
                except Exception:
                    pass
                w.field_value = on_state
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
    br8 = (data.get('brNumber') or '').replace(r'[^0-9A-Za-z]', '')[:8]
    company_type = data.get('companyType') or ''
    ct_lower = company_type.lower()

    # ── P.1 公司资料 ──
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
    # 区域下拉
    if office.get('region'):
        for name in ['Dropdown1_P.1', 'Dropdown_1_P.1']:
            if name in fmap:
                pi = fmap[name]
                for w in doc[pi].widgets():
                    if w.field_name == name:
                        try:
                            w.field_value = office['region']
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
        _set_text(doc, fmap, 'fill_21_P.1', presenter['phone'])
    if presenter.get('fax'):
        _set_text(doc, fmap, 'fill_22_P.1', presenter['fax'])
    if presenter.get('email'):
        _set_text(doc, fmap, 'fill_23_P.1', presenter['email'])
    if presenter.get('reference'):
        _set_text(doc, fmap, 'fill_24_P.1', presenter['reference'])

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
        issued = (info['paidUp'] + info['unpaid']) or (info['issuePrice'] * info['shares'])
        _set_text(doc, fmap, f'fill_{base}_P.2', info['className'])
        _set_text(doc, fmap, f'fill_{base+1}_P.2', info['currency'])
        _set_text(doc, fmap, f'fill_{base+2}_P.2', _fmt_int(info['shares']))
        if issued:
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
        if total_amount:
            _set_text(doc, fmap, 'fill_28_P.2', _fmt_amount(total_amount))
        if total_paid:
            _set_text(doc, fmap, 'fill_29_P.2', _fmt_amount(total_paid))

    secretaries = data.get('secretaries') or []
    directors = data.get('directors') or []
    nat_secs = [s for s in secretaries if s.get('identity') == 'natural']
    corp_secs = [s for s in secretaries if s.get('identity') == 'corporate']
    nat_dirs = [d for d in directors if d.get('identity') == 'natural']
    corp_dirs = [d for d in directors if d.get('identity') == 'corporate']

    # ── P.3 自然人秘书 ──
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

    # ── P.4 法人秘书 ──
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
        _set_text(doc, fmap, 'fill_9_P.4', s.get('companyNumberRef') or s.get('brNumber', ''))
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
        _set_text(doc, fmap, 'fill_14_P.5', office.get('region', ''))
        _set_text(doc, fmap, 'fill_15_P.5', d.get('email', ''))
        hkid = _parse_hkid_partial(d.get('idNumber', ''))
        if hkid:
            _set_text(doc, fmap, 'fill_16_P.5', hkid)
        elif d.get('passportNumber'):
            _set_text(doc, fmap, 'fill_17_P.5', d.get('nationality', '') or d.get('placeIncorporated', ''))
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
        _set_text(doc, fmap, 'fill_9_P.6', office.get('region', ''))
        _set_text(doc, fmap, 'fill_10_P.6', d.get('email', ''))
        _set_text(doc, fmap, 'fill_11_P.6', d.get('companyNumberRef') or d.get('brNumber', ''))

    # ── P.7 ──
    _set_text(doc, fmap, 'fill_1_P.7', br8)

    # ── P.8 总结 + 签署 ──
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

    # 签署人
    signer = data.get('signer')
    signer_name = (signer or {}).get('name') or presenter.get('name', '')
    if signer_name:
        _set_text(doc, fmap, 'fill_11_P.8', signer_name)
    if day and month and year:
        _set_text(doc, fmap, 'fill_12_P.8', f'{day}/{month}/{year}')

    # ── P.9 附表一（股东，前2人） ──
    if valid_members and not is_listed:
        _set_text(doc, fmap, 'fill_1_P.9', day)
        _set_text(doc, fmap, 'fill_2_P.9', month)
        _set_text(doc, fmap, 'fill_3_P.9', year)
        _set_text(doc, fmap, 'fill_4_P.9', br8)
        if share_infos:
            _set_text(doc, fmap, 'fill_5_P.9', share_infos[0]['className'])
            _set_text(doc, fmap, 'fill_6_P.9', _fmt_int(share_infos[0]['shares']))

        slots = [
            {'name': 7, 'surname': 8, 'other': 9, 'shares': 10, 'flat': 13, 'building': 14, 'street': 15, 'district': 16, 'country': 17},
            {'name': 18, 'surname': 19, 'other': 20, 'shares': 27, 'flat': 22, 'building': 23, 'street': 24, 'district': 25, 'country': 26},
            # 实际上 P.9 slots 的字段映射需要确认。使用原始 TS 代码中的映射。
        ]
        # 使用与 TS 代码一致的字段映射
        slots_ts = [
            {'name': 7, 'surname': 8, 'other': 9, 'shares': 10, 'flat': 13, 'building': 14, 'street': 15, 'district': 16, 'country': 17},
            {'name': 19, 'surname': 20, 'other': 21, 'shares': 22, 'flat': 25, 'building': 26, 'street': 27, 'district': 28, 'country': 29},
        ]
        for idx, sh in enumerate(valid_members[:2]):
            F = slots_ts[idx]
            is_corp = sh.get('identity') == 'corporate'
            full = sh.get('nameEnglish') or sh.get('name', '')
            surname, other = _parse_english_name(full)
            addr = _parse_address(sh.get('address', ''))
            def _safe(v):
                return '' if (v and _PURE_NUMBER_RE.match(v)) else v
            country = _safe(addr['country']) or '香港 Hong Kong'

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
        _set_text(doc, fmap, 'fill_31_P.9', '1')  # current page
        _set_text(doc, fmap, 'fill_32_P.9', str(total_sch1))

    # ── P.10 附表一续（股东 #3+#4）──
    if len(valid_members) > 2 and not is_listed:
        _set_text(doc, fmap, 'fill_1_P.10', day)
        _set_text(doc, fmap, 'fill_2_P.10', month)
        _set_text(doc, fmap, 'fill_3_P.10', year)
        _set_text(doc, fmap, 'fill_4_P.10', br8)
        if share_infos:
            _set_text(doc, fmap, 'fill_5_P.10', share_infos[0]['className'])
            _set_text(doc, fmap, 'fill_6_P.10', _fmt_int(share_infos[0]['shares']))
        # P.10 uses same slot layout as P.9 (32 fields + 2 cbs)
        slots_p10 = [
            {'name': 7, 'surname': 8, 'other': 9, 'shares': 10, 'flat': 13, 'building': 14, 'street': 15, 'district': 16, 'country': 17},
            {'name': 18, 'surname': 19, 'other': 20, 'shares': 27, 'flat': 22, 'building': 23, 'street': 24, 'district': 25, 'country': 26},
        ]
        for idx, sh in enumerate(valid_members[2:4]):
            F = slots_p10[idx]
            is_corp = sh.get('identity') == 'corporate'
            full = sh.get('nameEnglish') or sh.get('name', '')
            surname, other = _parse_english_name(full)
            addr = _parse_address(sh.get('address', ''))
            def _safe(v):
                return '' if (v and _PURE_NUMBER_RE.match(v)) else v
            country = _safe(addr['country']) or '香港 Hong Kong'
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

    # ── P.11 续页A：自然人秘书 #2 ──
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
        _set_text(doc, fmap, 'fill_12_P.11', addr.get('region', '香港 Hong Kong'))
        _set_text(doc, fmap, 'fill_13_P.11', addr['country'] or '香港 Hong Kong')
        _set_text(doc, fmap, 'fill_15_P.11', s.get('serviceAddress', '') or s.get('address', ''))
        _set_text(doc, fmap, 'fill_16_P.11', s.get('email', ''))
        hkid = _parse_hkid_partial(s.get('idNumber', ''))
        if hkid:
            _set_text(doc, fmap, 'fill_17_P.11', hkid)
        elif s.get('passportNumber'):
            _set_text(doc, fmap, 'fill_18_P.11', s.get('nationality', '') or s.get('placeIncorporated', ''))
            _set_text(doc, fmap, 'fill_19_P.11', _parse_passport_partial(s['passportNumber']))
        tcsp = s.get('tcspNumber', '')
        if tcsp:
            _set_text(doc, fmap, 'fill_20_P.11', tcsp)

    # ── P.12 续页B：法人秘书 #2 ──
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
        _set_text(doc, fmap, 'fill_12_P.12', s.get('companyNumberRef') or s.get('brNumber', ''))
        tcsp = s.get('tcspNumber', '')
        if tcsp:
            _set_text(doc, fmap, 'fill_13_P.12', tcsp)

    # ── P.13 续页C：自然人董事 #2 ──
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
        _set_text(doc, fmap, 'fill_12_P.13', office.get('region', ''))
        _set_text(doc, fmap, 'fill_15_P.13', office.get('region', '香港 Hong Kong'))
        _set_text(doc, fmap, 'fill_16_P.13', d.get('email', ''))
        hkid = _parse_hkid_partial(d.get('idNumber', ''))
        if hkid:
            _set_text(doc, fmap, 'fill_17_P.13', hkid)
        elif d.get('passportNumber'):
            _set_text(doc, fmap, 'fill_18_P.13', d.get('nationality', '') or d.get('placeIncorporated', ''))
            _set_text(doc, fmap, 'fill_19_P.13', _parse_passport_partial(d['passportNumber']))

    # ── P.14 续页D：法人董事 #2+#3 ──
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
            _set_text(doc, fmap, f'fill_{F["region"]}_P.14', office.get('region', ''))
            _set_text(doc, fmap, f'fill_{F["country"]}_P.14', office.get('region', '香港 Hong Kong'))
            _set_text(doc, fmap, f'fill_{F["email"]}_P.14', d.get('email', ''))

    # ── P.15 续页E：公司纪录保存地点 ──
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

    # ── 删除空白页（P.16-P.27 无 widget）──
    blank_pages = []
    for pi in range(15, doc.page_count):  # 0-indexed: pages 16-27
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
                    on_state = 'Yes'
                    ap = w._annot.get('AP')
                    if ap:
                        ap_n = ap.get('N')
                        if ap_n and hasattr(ap_n, 'keys'):
                            for k in ap_n.keys():
                                kname = str(k).lstrip('/')
                                if kname and kname != 'Off':
                                    on_state = kname
                                    break
                    w.field_value = on_state
                    w.update()
                except Exception:
                    pass
                break

    br8 = (data.get('brNumber', '') or '').replace(r'[^0-9A-Za-z]', '')[:8]

    # P.1: Company info
    _set('fill_1_P.1', br8)
    _set('fill_2_P.1', data.get('companyName', ''))

    officers = data.get('officers') or []
    for i, officer in enumerate(officers[:3]):
        is_natural = officer.get('identity') == 'natural'
        page = (i * 2) + 2  # natural: P.2, P.4, P.6; corporate: P.3, P.5, P.7
        if not is_natural:
            page = (i * 2) + 3
        p = page

        if is_natural:
            _set(f'fill_3_P.{p}', officer.get('nameEnglish', ''))
            _set(f'fill_4_P.{p}', officer.get('nameChinese', ''))
            _set(f'fill_7_P.{p}', officer.get('idNumber', ''))
            _set(f'fill_8_P.{p}', officer.get('address', ''))
            if officer.get('dateAppointed'):
                parts = officer['dateAppointed'].split('-')
                if len(parts) >= 3:
                    _set(f'fill_9_P.{p}', parts[2])
                    _set(f'fill_10_P.{p}', parts[1])
                    _set(f'fill_11_P.{p}', parts[0])
            elif officer.get('dateCeased'):
                parts = officer['dateCeased'].split('-')
                if len(parts) >= 3:
                    _set(f'fill_9_P.{p}', parts[2])
                    _set(f'fill_10_P.{p}', parts[1])
                    _set(f'fill_11_P.{p}', parts[0])

            if officer.get('role') == 'secretary':
                _check(f'cb_1_P.{p}')
            else:
                _check(f'cb_2_P.{p}')
            if officer.get('type') == 'appointment':
                _check(f'cb_3_P.{p}')
            else:
                _check(f'cb_4_P.{p}')
        else:
            _set(f'fill_3_P.{p}', officer.get('companyName', officer.get('nameEnglish', '')))
            _set(f'fill_5_P.{p}', officer.get('companyNumber', ''))
            _set(f'fill_6_P.{p}', officer.get('placeIncorporated', ''))
            _set(f'fill_7_P.{p}', officer.get('address', ''))
            if officer.get('role') == 'secretary':
                _check(f'cb_1_P.{p}')
            else:
                _check(f'cb_2_P.{p}')
            if officer.get('type') == 'appointment':
                _check(f'cb_3_P.{p}')
            else:
                _check(f'cb_4_P.{p}')

    # Signer date
    if data.get('signDate'):
        parts = data['signDate'].split('/')
        if len(parts) >= 3:
            _set('fill_11_P.1', f"{parts[2]}/{parts[1]}/{parts[0]}")
    _set('fill_12_P.1', data.get('signerName', ''))
    _set('fill_13_P.1', data.get('presentorName', ''))
    _set('fill_14_P.1', data.get('presentorAddress', ''))
    _set('fill_15_P.1', data.get('presentorContact', ''))

    # Only keep pages P.1 + any pages with widgets
    filled_pages = {0}
    for pi in range(doc.page_count):
        if pi == 0:
            continue
        widgets = list(doc[pi].widgets())
        has_filled = False
        for w in widgets:
            try:
                if w.field_value:
                    has_filled = True
                    break
            except Exception:
                pass
        if has_filled:
            filled_pages.add(pi)

    blank = [pi for pi in reversed(range(doc.page_count)) if pi not in filled_pages]
    for pi in blank:
        doc.delete_page(pi)

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
                    on_state = 'Yes'
                    ap = w._annot.get('AP')
                    if ap:
                        ap_n = ap.get('N')
                        if ap_n and hasattr(ap_n, 'keys'):
                            for k in ap_n.keys():
                                kname = str(k).lstrip('/')
                                if kname and kname != 'Off':
                                    on_state = kname
                                    break
                    w.field_value = on_state
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

    # Presentor (P.1 bottom)
    _set('fill_8_P.1', data.get('presentorName', ''))
    _set('fill_9_P.1', data.get('presentorAddress', ''))
    _set('fill_10_P.1', data.get('presentorContact', ''))

    # P.3: Signature
    _set('fill_30_P.3', data.get('signerName', ''))
    _set('fill_31_P.3', data.get('signDate', ''))

    # Remove blank pages (pages with no filled widgets, except P.1)
    filled_pages = {0}
    for pi in range(doc.page_count):
        if pi == 0:
            continue
        for w in doc[pi].widgets():
            try:
                if w.field_value:
                    filled_pages.add(pi)
                    break
            except Exception:
                pass

    blank = [pi for pi in reversed(range(doc.page_count)) if pi not in filled_pages]
    for pi in blank:
        doc.delete_page(pi)

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
        pdf.cell(0, 10, safe_text(data.get('title', '')), ln=True, align='C')
        if data.get('subtitle'):
            pdf.set_font(font_name, '', 10)
            pdf.cell(0, 7, safe_text(data['subtitle']), ln=True, align='C')
        pdf.ln(4)

        # Form code + company info
        pdf.set_font(font_name, '', 10)
        if data.get('formCode'):
            pdf.cell(30, 6, 'Form Code:', 0, 0)
            pdf.cell(0, 6, safe_text(data['formCode']), ln=True)
        if data.get('companyName'):
            pdf.cell(30, 6, 'Company:', 0, 0)
            pdf.cell(0, 6, safe_text(data['companyName']), ln=True)
        if data.get('brNumber'):
            pdf.cell(30, 6, 'BR No.:', 0, 0)
            pdf.cell(0, 6, safe_text(data['brNumber']), ln=True)
        pdf.ln(4)

        # Sections
        sections = data.get('sections') or []
        for sec in sections:
            if sec.get('heading'):
                pdf.set_font(font_name, 'B', 11)
                pdf.cell(0, 7, safe_text(sec['heading']), ln=True)
                pdf.ln(1)

            if sec.get('rows'):
                pdf.set_font(font_name, '', 9)
                for row in sec['rows']:
                    label = safe_text(row[0]) if len(row) > 0 else ''
                    value = safe_text(row[1]) if len(row) > 1 else ''
                    pdf.cell(50, 5, label + ':', 0, 0)
                    pdf.cell(0, 5, value, ln=True)
                pdf.ln(2)

            if sec.get('paragraph'):
                pdf.set_font(font_name, '', 9)
                pdf.multi_cell(0, 5, safe_text(sec['paragraph']))
                pdf.ln(2)

            if sec.get('bullets'):
                pdf.set_font(font_name, '', 9)
                for b in sec['bullets']:
                    pdf.cell(5, 5, '', 0, 0)
                    pdf.cell(0, 5, chr(8226) + ' ' + safe_text(b), ln=True)
                pdf.ln(2)

        # Signature lines
        sig_lines = data.get('signatureLines') or []
        if sig_lines:
            pdf.ln(6)
            pdf.set_font(font_name, '', 10)
            for sl in sig_lines:
                pdf.cell(0, 8, safe_text(sl), ln=True)
                pdf.ln(2)

        pdf_bytes = bytes(pdf.output())
        import base64 as b64
        return jsonify({'pdf': b64.b64encode(pdf_bytes).decode('ascii')})
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
                        ap = w._annot.get('AP')
                        if ap:
                            ap_n = ap.get('N')
                            if ap_n and hasattr(ap_n, 'keys'):
                                for k in ap_n.keys():
                                    kname = str(k).lstrip('/')
                                    if kname and kname != 'Off':
                                        w.field_value = kname
                                        w.update()
                                        break
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
    print(f"[SERVER] SMTP: {'configured (' + SMTP_HOST + ')' if SMTP_HOST else 'NOT configured — emails are SIMULATED & logged'}")
    app.run(host='0.0.0.0', port=5000, debug=True)
