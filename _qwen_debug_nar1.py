"""Qwen VL NAR1 调试分析 — 读取截图发送到千问"""
import requests, base64, os, sys, time, glob

QWEN_API_KEY = os.environ.get('QWEN_API_KEY', '')
if not QWEN_API_KEY:
    try:
        with open('.dev.vars', 'r') as f:
            for line in f:
                if 'QWEN_API_KEY' in line:
                    QWEN_API_KEY = line.split('=')[1].strip().strip('"').strip("'")
    except: pass

if not QWEN_API_KEY:
    print("QWEN_API_KEY not found")
    sys.exit(1)

# Find NAR1 page images
images = sorted(glob.glob('_nar1_p*.png'))
if not images:
    # Try clipboard-like files
    images = sorted(glob.glob('_clipboard*.png'))
if not images:
    print("No images found. Please provide image paths:")
    print("Usage: python _qwen_debug_nar1.py <image1.png> <image2.png> ...")
    sys.exit(1)

print(f"Found {len(images)} images: {', '.join(images)}")

# Build content
content = [{
    'type': 'text',
    'text': (
        'You are debugging a Hong Kong NAR1 Annual Return PDF form generation system.\n\n'
        'This is a GENERATED PDF (not the blank template). I need you to check:\n\n'
        '1. P.2 (Share Capital): Are the last two columns showing? Columns are: \n'
        '   Class of Shares | Currency | Number of Shares | Total Amount | Total Amount Paid Up\n'
        '   Is the currency showing "HKD"? Is "Total Amount" = shares × issue price?\n'
        '   Is there a blank continuation line with blue background at the bottom?\n\n'
        '2. P.8 (Summary): Is there a number in the "Schedule 1" 附表一 field?\n'
        '   Look for page count fields: Sheet A/B/C/D counts and Schedule 1 count.\n\n'
        '3. Continuation Sheet C (P.13 or extra nat dir pages): Are they present?\n'
        '   If present, are the name, address, HKID, email fields filled with data?\n\n'
        '4. P.1: Are the return period dates (From/To) fields filled?'
        '   Look for 6 date fields near the top-right of the form.\n\n'
        'Please describe what you see on EACH page. Be specific about which fields have data and which are blank.\n'
        'For blank fields, mention the field label and what should be there.'
    )
}]

for img_path in images:
    with open(img_path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    content.append({
        'type': 'image_url',
        'image_url': {'url': f'data:image/png;base64,{b64}'}
    })

print(f'Sending {len(content)} items to qwen-vl-max...')
start = time.time()
resp = requests.post(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    headers={'Authorization': f'Bearer {QWEN_API_KEY}', 'Content-Type': 'application/json'},
    json={
        'model': 'qwen-vl-max',
        'messages': [{'role': 'user', 'content': content}],
        'max_tokens': 8000
    },
    timeout=180
)
elapsed = time.time() - start
print(f'Done in {elapsed:.1f}s, status={resp.status_code}')

if resp.status_code == 200:
    result = resp.json()
    answer = result['choices'][0]['message']['content']
    out_path = '_qwen_nar1_debug.txt'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(answer)
    print(f'Saved {len(answer)} chars to {out_path}')
    print('=' * 60)
    print(answer[:3000])
else:
    print(f'Error: {resp.text[:800]}')
