import requests, base64, json, os, time

QWEN_API_KEY = os.environ.get('QWEN_API_KEY', '')
if not QWEN_API_KEY:
    try:
        with open('.dev.vars', 'r') as f:
            for line in f:
                if 'QWEN_API_KEY' in line:
                    QWEN_API_KEY = line.split('=')[1].strip().strip('"').strip("'")
    except:
        pass

# Load all page images
all_images = []
for i in range(1, 16):
    with open(f'_nar1_p{i}.png', 'rb') as f:
        all_images.append(base64.b64encode(f.read()).decode())

content = [{
    'type': 'text',
    'text': (
        'Please analyze these 15 pages of the NAR1 Annual Return form template (Hong Kong Companies Registry). '
        'Output in structured format, one section per page.\n\n'
        'For each page (P.1 to P.15), list:\n'
        '1. Page title/purpose (Chinese and English)\n'
        '2. All fillable fields with their labels and what data goes there\n'
        '3. Continuation logic: capacity limits, which continuation sheet is used for extra people\n'
        '4. Special controls: checkboxes, dropdowns, radio buttons and their options\n'
        '5. Notes: special requirements, constraints, page relationships\n\n'
        'Key areas to focus on:\n'
        '- P.1: Presenter fields (name/address/phone/fax/email/reference) at bottom\n'
        '- P.2: Email and phone fields for the company\n'
        '- P.8: Continuation sheet counts (columns A/B/C/D) and signer handling\n'
        '- P.9-10: Schedule 1/2 member capacity per page\n'
        '- P.11-14: Each continuation sheet capacity (one person per page? multiple?)\n'
        '- Whether each page fills "1st person" or "continuation (2nd+ person)"\n'
        '- Field naming patterns you observe\n\n'
        'Output in Chinese. Be thorough - this is for programming form filling logic.'
    )
}]

for i in range(1, 16):
    content.append({
        'type': 'image_url',
        'image_url': {'url': f'data:image/png;base64,{all_images[i-1]}'}
    })

print(f'Sending {len(content)} items...')
start = time.time()
resp = requests.post(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    headers={'Authorization': f'Bearer {QWEN_API_KEY}', 'Content-Type': 'application/json'},
    json={
        'model': 'qwen-vl-max',
        'messages': [{'role': 'user', 'content': content}],
        'max_tokens': 8000
    },
    timeout=120
)
elapsed = time.time() - start
print(f'Done in {elapsed:.1f}s, status={resp.status_code}')

if resp.status_code == 200:
    result = resp.json()
    answer = result['choices'][0]['message']['content']
    with open('_qwen_nar1_analysis.txt', 'w', encoding='utf-8') as f:
        f.write(answer)
    print(f'Saved {len(answer)} chars')
    print(answer[:800])
else:
    print(f'Error: {resp.text[:500]}')
