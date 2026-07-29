#!/usr/bin/env python3
"""
PDF Form Verification Script - local vs cloud PDF output comparison

Usage:
  python _verify_forms.py [--form NAR1] [--company-id UUID] [--vision] [--all]

  --form     Form type (NAR1/ND2A/ND2B/ND4/NDR1/NR1/NSC1/NNC1/NNC2/NN1/NN3/NN6/NN7/NN9)
  --company  Company ID (default: Paul Tang)
  --vision   Enable Qwen Vision API comparison (requires QWEN_API_KEY)
  --all      Verify all 14 forms
"""

import sys
import io

# Fix Windows console encoding for emoji
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import requests
import base64
import json
import os
import sys
import io
import time
import argparse
import difflib
from pathlib import Path

# ─── Config ───
LOCAL_API = "http://127.0.0.1:5000"
CLOUD_API = "https://secretary-system-9cl.pages.dev"
TEST_DIR = Path(__file__).parent / "_verify_output"
TEST_DIR.mkdir(exist_ok=True)

# Auth tokens (separate for local and cloud)
AUTH_TOKEN_LOCAL = None
AUTH_TOKEN_CLOUD = None

# ─── 14 Template-Filling Forms ───
ALL_FORMS = [
    "NAR1", "ND2A", "ND2B", "ND4", "NDR1", "NR1",
    "NSC1", "NNC1", "NNC2", "NN1", "NN3", "NN6", "NN7", "NN9"
]

# Forms that share the same endpoint
FORM_ENDPOINTS = {
    "NAR1": "/api/generate-nar1-pdf",
    "ND2A": "/api/generate-nd2a-pdf",
    "ND2B": "/api/generate-nd2b-pdf",
    "ND4": "/api/generate-nd4-pdf",
    "NDR1": "/api/generate-ndr1-pdf",
    "NR1": "/api/generate-nr1-pdf",
    "NSC1": "/api/generate-nsc1-pdf",
    "NNC1": "/api/generate-nnc1-pdf",
    "NNC2": "/api/generate-nnc2-pdf",
    "NN1": "/api/generate-nn1-pdf",
    "NN3": "/api/generate-nn3-pdf",
    "NN6": "/api/generate-nn6-pdf",
    "NN7": "/api/generate-nn7-pdf",
    "NN9": "/api/generate-nn9-pdf",
}


def get_auth_token(api_base=LOCAL_API):
    """Login to get JWT token for specific API"""
    global AUTH_TOKEN_LOCAL, AUTH_TOKEN_CLOUD

    if api_base == LOCAL_API and AUTH_TOKEN_LOCAL:
        return AUTH_TOKEN_LOCAL
    if api_base == CLOUD_API and AUTH_TOKEN_CLOUD:
        return AUTH_TOKEN_CLOUD

    try:
        label = "local" if api_base == LOCAL_API else "cloud"
        resp = requests.post(f"{api_base}/api/auth/login", json={
            "email": "admin@localhost",
            "password": "admin123"
        }, timeout=10)
        if resp.status_code != 200:
            print(f"⚠️ {label} auth failed: HTTP {resp.status_code} {resp.text[:100]}")
            return None
        data = resp.json()
        token = data.get("token") or data.get("jwt")
        if token:
            if api_base == LOCAL_API:
                AUTH_TOKEN_LOCAL = token
            else:
                AUTH_TOKEN_CLOUD = token
            print(f"✅ Authenticated via {label}")
            return token
    except Exception as e:
        label = "local" if api_base == LOCAL_API else "cloud"
        print(f"⚠️ {label} auth error: {e}")
    return None


def call_api(api_base, endpoint, payload, token=None):
    """Call an API endpoint, return response JSON"""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = f"{api_base}{endpoint}"
    print(f"  → {api_base.split('//')[1].split('/')[0]}{endpoint} ...", end=" ")
    start = time.time()
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=120)
        elapsed = time.time() - start

        if resp.status_code != 200:
            print(f"❌ HTTP {resp.status_code} ({elapsed:.1f}s)")
            try:
                print(f"    Body: {resp.text[:200]}")
            except:
                pass
            return None

        # Check content type
        ct = resp.headers.get("Content-Type", "")
        if "application/pdf" in ct:
            # Raw PDF bytes
            pdf_bytes = resp.content
            print(f"✅ raw PDF {len(pdf_bytes)} bytes ({elapsed:.1f}s)")
            return {"_raw_pdf": True, "_pdf_bytes": pdf_bytes}

        data = resp.json()
        print(f"✅ JSON ({elapsed:.1f}s)")
        return data
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection refused ({elapsed:.1f}s)")
        return None
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def extract_pdf_bytes(response_data):
    """Extract PDF bytes from API response (handles both formats)"""
    if not response_data:
        return None

    # Raw PDF bytes
    if response_data.get("_raw_pdf"):
        return response_data["_pdf_bytes"]

    # JSON + base64
    pdf_b64 = response_data.get("pdf") or response_data.get("data")
    if pdf_b64:
        try:
            return base64.b64decode(pdf_b64)
        except:
            pass

    return None


def extract_text_from_pdf(pdf_bytes):
    """Extract text from PDF using PyMuPDF"""
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages_text = []
        for page in doc:
            text = page.get_text("text")
            pages_text.append(text)
        doc.close()
        return pages_text
    except ImportError:
        print("⚠️ PyMuPDF not installed. Install: pip install pymupdf")
        return None
    except Exception as e:
        print(f"⚠️ Text extraction error: {e}")
        return None


def compare_texts(local_pages, cloud_pages, form_name):
    """Compare text extracted from local vs cloud PDFs"""
    if local_pages is None or cloud_pages is None:
        return {"match": False, "reason": "extraction_failed"}

    max_pages = max(len(local_pages), len(cloud_pages))
    results = []

    for i in range(max_pages):
        local_text = local_pages[i] if i < len(local_pages) else "(MISSING)"
        cloud_text = cloud_pages[i] if i < len(cloud_pages) else "(MISSING)"

        # Normalize whitespace for comparison
        local_norm = " ".join(local_text.split())
        cloud_norm = " ".join(cloud_text.split())

        if local_norm == cloud_norm:
            results.append({"page": i+1, "match": True})
        else:
            # Calculate similarity
            ratio = difflib.SequenceMatcher(None, local_norm, cloud_norm).ratio()
            results.append({
                "page": i+1,
                "match": ratio > 0.95,
                "similarity": round(ratio, 3),
                "local_len": len(local_norm),
                "cloud_len": len(cloud_norm),
            })

    all_match = all(r["match"] for r in results)
    return {
        "match": all_match,
        "pages": max_pages,
        "details": results,
    }


def verify_form(form_type, company_id, use_vision=False):
    """Verify a single form type"""
    print(f"\n{'='*60}")
    print(f"🔍 Verifying: {form_type}")
    print(f"{'='*60}")

    endpoint = FORM_ENDPOINTS.get(form_type)
    if not endpoint:
        print(f"  ⚠️ Unknown form type: {form_type}")
        return None

    # Build payload
    payload = {"companyId": company_id, "formType": form_type}

    # Add form-specific required fields
    if form_type == "ND2A":
        payload["officers"] = []
    elif form_type == "ND2B":
        payload["officers"] = []
    elif form_type in ("NNC1", "NNC2", "NN1"):
        payload["companyId"] = company_id
    elif form_type in ("NN3", "NN9"):
        payload["companyId"] = company_id

    # Generate locally
    local_token = get_auth_token(LOCAL_API)
    print(f"  📍 Local:")
    local_resp = call_api(LOCAL_API, endpoint, payload, local_token)
    local_pdf = extract_pdf_bytes(local_resp)

    if local_pdf:
        local_path = TEST_DIR / f"{form_type}_local.pdf"
        local_path.write_bytes(local_pdf)
        print(f"    Saved: {local_path} ({len(local_pdf)} bytes)")

    # Generate from cloud
    cloud_token = get_auth_token(CLOUD_API)
    print(f"  ☁️  Cloud:")
    cloud_resp = call_api(CLOUD_API, endpoint, payload, cloud_token)
    cloud_pdf = extract_pdf_bytes(cloud_resp)

    if cloud_pdf:
        cloud_path = TEST_DIR / f"{form_type}_cloud.pdf"
        cloud_path.write_bytes(cloud_pdf)
        print(f"    Saved: {cloud_path} ({len(cloud_pdf)} bytes)")

    # Compare
    if local_pdf and cloud_pdf:
        print(f"  📊 Comparing text...")
        local_text = extract_text_from_pdf(local_pdf)
        cloud_text = extract_text_from_pdf(cloud_pdf)

        result = compare_texts(local_text, cloud_text, form_type)

        if result["match"]:
            print(f"  ✅ TEXT MATCH — all {result['pages']} pages identical")
        else:
            print(f"  ❌ TEXT MISMATCH — {result['pages']} pages, differences found:")
            for d in result.get("details", []):
                if not d["match"]:
                    print(f"    Page {d['page']}: similarity={d['similarity']}, "
                          f"local={d.get('local_len', '?')} chars, "
                          f"cloud={d.get('cloud_len', '?')} chars")

        # Vision comparison (optional)
        vision_result = None
        if use_vision and not result["match"]:
            print(f"  👁️  Qwen Vision comparison...")
            vision_result = qwen_vision_compare(local_pdf, cloud_pdf, form_type)

        return {
            "form": form_type,
            "text_match": result["match"],
            "text_details": result,
            "local_size": len(local_pdf),
            "cloud_size": len(cloud_pdf),
            "vision_result": vision_result,
        }
    else:
        status = "⚠️"
        if not local_pdf:
            status += " LOCAL_FAIL"
        if not cloud_pdf:
            status += " CLOUD_FAIL"
        print(f"  {status}")
        return {
            "form": form_type,
            "text_match": False,
            "error": status.strip(),
        }


def qwen_vision_compare(local_pdf_bytes, cloud_pdf_bytes, form_name):
    """Use Qwen Vision API to compare two PDFs"""
    api_key = os.environ.get("QWEN_API_KEY")
    if not api_key:
        print("    ⚠️ QWEN_API_KEY not set, skipping vision comparison")
        return None

    # Convert PDF pages to images
    try:
        import fitz
        local_doc = fitz.open(stream=local_pdf_bytes, filetype="pdf")
        cloud_doc = fitz.open(stream=cloud_pdf_bytes, filetype="pdf")

        max_pages = min(len(local_doc), len(cloud_doc), 3)  # Compare first 3 pages
        results = []

        for i in range(max_pages):
            # Render pages as images
            local_page = local_doc[i]
            cloud_page = cloud_doc[i]

            # Render at 150 DPI
            local_pix = local_page.get_pixmap(dpi=150)
            cloud_pix = cloud_page.get_pixmap(dpi=150)

            local_img_b64 = base64.b64encode(local_pix.tobytes("png")).decode()
            cloud_img_b64 = base64.b64encode(cloud_pix.tobytes("png")).decode()

            # Call Qwen Vision
            result = call_qwen_vision(local_img_b64, cloud_img_b64, form_name, i+1, api_key)
            results.append(result)

        local_doc.close()
        cloud_doc.close()

        all_match = all(r.get("match", False) for r in results)
        print(f"    Vision result: {'✅ MATCH' if all_match else '❌ DIFFERENCES'}")
        return {"match": all_match, "pages": results}

    except Exception as e:
        print(f"    ⚠️ Vision comparison error: {e}")
        return None


def call_qwen_vision(img1_b64, img2_b64, form_name, page_num, api_key):
    """Call Qwen Vision API to compare two page images"""
    import base64 as b64

    prompt = f"""You are a PDF form quality inspector. Compare these two images of page {page_num} from form {form_name}.

Image 1 is the GROUND TRUTH (generated locally, verified correct).
Image 2 is the TEST output (generated by cloud system).

Check carefully for:
1. Missing text or blank fields that should have content
2. Text in wrong positions or overlapping
3. Incorrect checkbox states (ticked vs unticked)
4. Font size differences (too large/small causing overflow)
5. Missing lines, borders, or stamps
6. Content cut off or truncated
7. Wrong alignment (e.g., left-aligned when should be right-aligned for HKID)

Reply with JSON only:
{{"match": true/false, "issues": ["issue 1", "issue 2"], "confidence": 0.0-1.0}}
If identical, match=true and issues=[]."""

    try:
        resp = requests.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "qwen-vl-max",
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img1_b64}"}},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img2_b64}"}},
                    ]
                }],
                "temperature": 0.1,
            },
            timeout=60
        )

        if resp.status_code != 200:
            print(f"    ⚠️ Qwen API error: {resp.status_code} {resp.text[:100]}")
            return {"match": None, "error": f"API {resp.status_code}"}

        content = resp.json()["choices"][0]["message"]["content"]
        # Extract JSON
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(content[json_start:json_end])
        return {"match": None, "raw": content[:200]}

    except Exception as e:
        return {"match": None, "error": str(e)}


def print_summary(all_results):
    """Print verification summary table"""
    print(f"\n{'='*60}")
    print(f"📋 VERIFICATION SUMMARY")
    print(f"{'='*60}")
    print(f"{'Form':<8} {'Text':<8} {'Local':<10} {'Cloud':<10} {'Notes'}")
    print(f"{'-'*8} {'-'*8} {'-'*10} {'-'*10} {'-'*20}")

    passed = 0
    failed = 0
    skipped = 0

    for r in all_results:
        if not r:
            continue
        form = r["form"]
        match = r.get("text_match", False)
        local_size = r.get("local_size", 0)
        cloud_size = r.get("cloud_size", 0)
        error = r.get("error", "")

        status = "✅" if match else "❌"
        if error:
            status = "⚠️"
            skipped += 1
        elif match:
            passed += 1
        else:
            failed += 1

        local_str = f"{local_size/1024:.0f}KB" if local_size else "N/A"
        cloud_str = f"{cloud_size/1024:.0f}KB" if cloud_size else "N/A"
        notes = error or (f"{r.get('text_details', {}).get('pages', '?')} pages")

        print(f"{form:<8} {status:<8} {local_str:<10} {cloud_str:<10} {notes}")

    print(f"\n{'='*60}")
    print(f"Passed: {passed} | Failed: {failed} | Skipped: {skipped} | Total: {len(all_results)}")

    return passed, failed, skipped


def main():
    parser = argparse.ArgumentParser(description="Verify PDF forms: local vs cloud")
    parser.add_argument("--form", help="Specific form type to verify")
    parser.add_argument("--company", default="25104de2-583b-427f-a307-805a081981dc",
                        help="Company ID (default: Paul Tang)")
    parser.add_argument("--vision", action="store_true", help="Enable Qwen Vision comparison")
    parser.add_argument("--all", action="store_true", help="Verify all 14 forms")
    args = parser.parse_args()

    # Determine which forms to verify
    if args.all:
        forms = ALL_FORMS
    elif args.form:
        forms = [args.form.upper()]
    else:
        # Default: verify the 3 critical AcroForm forms
        forms = ["NAR1", "ND2A", "NR1"]

    print(f"🔬 PDF Form Verification")
    print(f"   Company: {args.company}")
    print(f"   Forms: {', '.join(forms)}")
    print(f"   Vision: {'✅ enabled' if args.vision else '❌ disabled'}")
    print(f"   Output: {TEST_DIR}")

    # Verify each form
    results = []
    for form in forms:
        result = verify_form(form, args.company, use_vision=args.vision)
        results.append(result)
        if len(forms) > 1:
            time.sleep(1)  # Rate limiting

    # Print summary
    print_summary(results)

    # Save results to JSON
    results_path = TEST_DIR / "verify_results.json"
    results_path.write_text(json.dumps(results, indent=2, ensure_ascii=False, default=str), encoding='utf-8')
    print(f"\n📝 Results saved: {results_path}")

    # Return exit code
    failed_count = sum(1 for r in results if r and not r.get("text_match") and not r.get("error"))
    sys.exit(0 if failed_count == 0 else 1)


if __name__ == "__main__":
    main()
