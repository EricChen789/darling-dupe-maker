"""Convert NAR1 PDF pages to images and send to Qwen VL for visual analysis"""
import fitz, base64, requests, os, time, sys

QWEN_API_KEY = os.environ.get('QWEN_API_KEY', '')
if not QWEN_API_KEY:
    try:
        with open('.dev.vars', 'r') as f:
            for line in f:
                if 'QWEN_API_KEY' in line:
                    QWEN_API_KEY = line.split('=')[1].strip().strip('"').strip("'")
    except: pass

pdf_path = "_nar1_debug.pdf"
doc = fitz.open(pdf_path)
print(f"PDF: {doc.page_count} pages")

# Convert specific pages to PNG
target_pages = [1, 7, 9, 10]  # P.2, P.8, P.10(P.13 pre-built), P.11(dynC_2)
images_b64 = []
for pi in target_pages:
    if pi >= doc.page_count:
        print(f"Page {pi+1} (idx {pi}) out of range")
        continue
    page = doc[pi]
    pix = page.get_pixmap(dpi=150)
    img_bytes = pix.tobytes("png")
    images_b64.append((pi+1, base64.b64encode(img_bytes).decode()))
    print(f"Page {pi+1}: {len(img_bytes)} bytes -> base64")

doc.close()

if not images_b64:
    print("No images to analyze")
    sys.exit(1)

# Build Qwen request
content = [{
    'type': 'text',
    'text': (
        'This is a GENERATED Hong Kong NAR1 Annual Return PDF from an automated form-filling system.\n'
        'Analyze these pages carefully. The company is called "dawda", BR number 12112121.\n\n'
        'For EACH page, tell me:\n'
        '1. What data IS filled (working correctly)\n'
        '2. What data is MISSING or shows template placeholder text like "BRNumber"\n'
        '3. Any rendering issues (overlapping text, wrong font size, etc.)\n\n'
        'Pages being analyzed:\n'
        '- P.2 (Share Capital): Should show BR, email, phone, and 5 columns of share data (Class/Currency/Shares/Total Amount/Paid Up).'
        ' Are columns 4-5 (Total Amount, Total Amount Paid Up) showing numbers?\n'
        '- P.8 (Summary & Signature): Should show BR, continuation sheet counts (Sheet A/B/C/D, Schedule 1), signer name, date.'
        ' Is the "Schedule 1" 附表一 count field showing a number?\n'
        '- P.10 (Sheet C / Continuation Nat Dir #2): Should show date, BR, name fields filled with director data.'
        ' Are name (Chinese + English surname/given), address, HKID, email fields filled?\n'
        '- P.11 (Dynamic Sheet C / Extra Nat Dir #3): Same as above for 3rd+ director.'
        ' Is data showing? Look for field names with "_dynC" suffix.\n\n'
        'Answer in Chinese (Taiwan traditional).'
    )
}]

for page_num, b64 in images_b64:
    content.append({
        'type': 'image_url',
        'image_url': {'url': f'data:image/png;base64,{b64}'}
    })

print(f'Sending {len(content)} items to qwen-vl-max...')
start = time.time()
resp = requests.post(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    headers={'Authorization': f'Bearer {QWEN_API_KEY}', 'Content-Type': 'application/json'},
    json={'model': 'qwen-vl-max', 'messages': [{'role': 'user', 'content': content}], 'max_tokens': 4000},
    timeout=180
)
elapsed = time.time() - start
print(f'Done in {elapsed:.1f}s, status={resp.status_code}')

if resp.status_code == 200:
    answer = resp.json()['choices'][0]['message']['content']
    out = '_qwen_nar1_visual_check.txt'
    with open(out, 'w', encoding='utf-8') as f:
        f.write(answer)
    print(f'Saved to {out}')
    print('=' * 60)
    print(answer)
else:
    print(f'Error: {resp.text[:500]}')
