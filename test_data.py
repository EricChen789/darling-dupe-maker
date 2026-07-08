#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Add test data: directors, secretaries, shareholders, SCR, share transfers"""
import requests, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

API = 'http://localhost:5000/api'
CID = 'b407d180-3746-4aef-8c48-6c2e72e3f68f'  # ABC Trading Limited

results = []

def add_person(data):
    r = requests.post(f'{API}/persons', json=data)
    return r.json().get('id', '')

def add_role(pid, role, **extra):
    payload = {'person_id': pid, 'company_id': CID, 'role': role}
    payload.update(extra)
    requests.post(f'{API}/person_company_roles', json=payload)

# ====== 董事1: 自然人 ======
pid = add_person({
    'identity': 'natural',
    'name_english': 'Chan Tai Man',
    'name_chinese': '陳大文',
    'id_number': 'A1234567',
    'passport_number': 'P9876543',
    'address': "Flat A, 12/F, Sunshine Tower, 88 Queen's Road Central, Central",
    'service_address': "Flat A, 12/F, Sunshine Tower, 88 Queen's Road Central, Central",
    'email': 'chantaiman@example.com',
    'phone': '61234567',
    'whatsapp': '61234567',
    'date_of_birth': '1980-05-15',
})
add_role(pid, 'director', date_appointed='2022-03-15')
results.append(f'董事1 (自然人): 陳大文 A1234567')

# ====== 董事2: 法人 ======
p2 = add_person({
    'identity': 'corporate',
    'name_english': 'Goldman Sachs (Asia) LLC',
    'name_chinese': '高盛（亞洲）有限責任公司',
    'id_number': 'BR9988776',
    'address': "68/F, Cheung Kong Centre, 2 Queen's Road Central, Central",
    'service_address': "68/F, Cheung Kong Centre, 2 Queen's Road Central, Central",
    'place_incorporated': 'Hong Kong',
    'company_number_ref': 'BR9988776',
    'tcsp_number': 'TCSP12345',
    'email': 'compliance@gsasia.com',
})
add_role(p2, 'director', date_appointed='2023-01-10')
results.append(f'董事2 (法人): 高盛（亞洲） BR9988776')

# ====== 董事3: 后备董事 ======
p3 = add_person({
    'identity': 'natural',
    'name_english': 'Lee Siu Ming',
    'name_chinese': '李小明',
    'id_number': 'B7654321',
    'passport_number': 'P1122334',
    'address': 'Room 301, Block B, Kowloon Bay Garden, Kwun Tong',
    'service_address': 'Room 301, Block B, Kowloon Bay Garden, Kwun Tong',
    'email': 'leesm@example.com',
    'phone': '98765432',
    'date_of_birth': '1975-11-20',
})
add_role(p3, 'director', date_appointed='2024-06-01', is_reserve=1)
results.append(f'董事3 (後備): 李小明 B7654321')

# ====== 秘书1: 法人 TCSP ======
p4 = add_person({
    'identity': 'corporate',
    'name_english': 'Twinsail Consultants Limited',
    'name_chinese': '雙帆顧問有限公司',
    'id_number': 'BR5566778',
    'address': "Unit 1502, 15/F, The Centre, 99 Queen's Road Central, Central",
    'service_address': "Unit 1502, 15/F, The Centre, 99 Queen's Road Central, Central",
    'place_incorporated': 'Hong Kong',
    'company_number_ref': 'BR5566778',
    'tcsp_number': 'TCSP00678',
    'email': 'info@twinsail.com',
    'phone': '25251234',
})
add_role(p4, 'secretary', date_appointed='2022-03-15')
results.append(f'秘書1 (法人): 雙帆顧問 TCSP00678')

# ====== 股东1: 自然人 5000股 ======
p5 = add_person({
    'identity': 'natural',
    'name_english': 'Chan Tai Man',
    'name_chinese': '陳大文',
    'id_number': 'A1234567',
    'address': "Flat A, 12/F, Sunshine Tower, 88 Queen's Road Central, Central",
    'email': 'chantaiman@example.com',
})
add_role(p5, 'shareholder', shares=5000, share_type='Ordinary', currency='HKD',
         issue_price='1.00', paid_up='5000', unpaid='0')
results.append(f'股東1 (自然人): 陳大文 5000股 Ordinary')

# ====== 股东2: 法人 3000股 Preference ======
p6 = add_person({
    'identity': 'corporate',
    'name_english': 'Oceanwide Holdings Ltd',
    'name_chinese': '泛海控股有限公司',
    'id_number': 'BR3344556',
    'address': 'Suite 2801, One Island East, Taikoo Place, Quarry Bay',
    'place_incorporated': 'British Virgin Islands',
    'company_number_ref': 'BVI-12345',
    'email': 'ir@oceanwide.com',
})
add_role(p6, 'shareholder', shares=3000, share_type='Preference', currency='USD',
         issue_price='2.50', paid_up='7500', unpaid='0')
results.append(f'股東2 (法人): 泛海控股 3000股 Preference USD')

# ====== 股东3: 自然人 2000股 ======
p7 = add_person({
    'identity': 'natural',
    'name_english': 'Wong Ka Yan',
    'name_chinese': '黃家欣',
    'id_number': 'C3456789',
    'passport_number': 'P5566778',
    'address': 'Room 1205, Tower 3, Wonderland Villas, Shatin, New Territories',
    'email': 'wongky@example.com',
    'phone': '93456789',
    'date_of_birth': '1990-08-08',
})
add_role(p7, 'shareholder', shares=2000, share_type='Ordinary', currency='HKD',
         issue_price='1.00', paid_up='2000', unpaid='0')
results.append(f'股東3 (自然人): 黃家欣 2000股 Ordinary')

# ====== 股份转让记录 ======
requests.post(f'{API}/share_transactions', json={
    'company_id': CID,
    'transaction_date': '2024-12-01',
    'transaction_type': 'transfer',
    'from_name': 'Chan Tai Man',
    'to_name': 'Wong Ka Yan',
    'shares': 500, 'share_type': 'Ordinary', 'currency': 'HKD',
    'price_per_share': '1.20', 'total_consideration': '600',
    'instrument_number': 'INST-2024-001',
    'notes': 'Gift transfer to family member',
})
results.append('轉讓: 陳大文 → 黃家欣 500股')

requests.post(f'{API}/share_transactions', json={
    'company_id': CID,
    'transaction_date': '2025-03-20',
    'transaction_type': 'allotment',
    'to_name': 'Oceanwide Holdings Ltd',
    'shares': 1000, 'share_type': 'Ordinary', 'currency': 'HKD',
    'price_per_share': '1.00', 'total_consideration': '1000',
    'instrument_number': 'INST-2025-002',
    'notes': 'New share allotment per board resolution',
})
results.append('配發: → 泛海控股 1000股')

# ====== SCR 重要控制人 ======
requests.post(f'{API}/significant_controllers', json={
    'companyId': CID,
    'identity': 'natural',
    'nameEnglish': 'Chan Tai Man',
    'nameChinese': '陳大文',
    'idNumber': 'A1234567',
    'address': "Flat A, 12/F, Sunshine Tower, 88 Queen's Road Central, Central",
    'serviceAddress': "Flat A, 12/F, Sunshine Tower, 88 Queen's Road Central, Central",
    'dateBecame': '2022-03-15',
    'natureShares': True, 'natureVoting': True,
    'natureAppoint': False, 'natureInfluence': False, 'natureTrust': False,
    'natureOther': '',
})
results.append('SCR1: 陳大文 (持股>25% + 投票權>25%)')

requests.post(f'{API}/significant_controllers', json={
    'companyId': CID,
    'identity': 'corporate',
    'nameEnglish': 'Oceanwide Holdings Ltd',
    'nameChinese': '泛海控股有限公司',
    'idNumber': 'BR3344556',
    'address': 'Suite 2801, One Island East, Taikoo Place, Quarry Bay',
    'serviceAddress': 'Suite 2801, One Island East, Taikoo Place, Quarry Bay',
    'dateBecame': '2023-06-01',
    'natureShares': True, 'natureVoting': False,
    'natureAppoint': True, 'natureInfluence': True, 'natureTrust': False,
    'natureOther': '',
})
results.append('SCR2: 泛海控股 (持股>25% + 任免權 + 重大影響)')

print('\n========== 全部添加完成 ==========')
for r in results:
    print('  ' + r)
print(f'\n公司: ABC Trading Limited')
print(f'  - 3 董事 (2 自然人 + 1 法人, 含 1 後備)')
print(f'  - 1 秘書 (法人 TCSP)')
print(f'  - 3 股東 (2 自然人 + 1 法人, 共 10000 股)')
print(f'  - 2 股份轉讓記錄')
print(f'  - 2 重要控制人 (SCR)')
