"""Read-only MFDS public-search pilot: four companies x four equipment families.

This is a first-page sample, not a complete inventory or a feed of new products.
No API credentials, writes to MFDS, or changes to article collection are required.
"""
import argparse
import datetime as dt
import http.cookiejar
import json
from pathlib import Path
import re
import time
import unicodedata
import urllib.parse
import urllib.request

BASE = 'https://emedi.mfds.go.kr'
SOURCE = BASE + '/search/data/MNU20237'
COMPANIES = {
    'GE': {'query': '지이헬스케어', 'names': ['지이헬스케어코리아', '한국지이초음파']},
    'Siemens': {'query': '지멘스헬시니어스', 'names': ['지멘스헬시니어스']},
    'Philips': {'query': '필립스코리아', 'names': ['필립스코리아']},
    'Samsung Medison': {'query': '삼성메디슨', 'names': ['삼성메디슨']},
}
FAMILIES = {
    'CT': {'query': 'A11010.01', 'codes': ['A11010.01', 'A11010.02', 'A11010.04', 'A11010.05'],
           'name': '전산화 단층 엑스선 촬영장치'},
    'MRI': {'query': 'A12010.01', 'codes': [f'A12010.{i:02}' for i in range(1, 13)],
            'name': '자기공명 전산화 단층 촬영장치'},
    'Angiography': {'query': 'A11090.03', 'codes': [f'A11090.{i:02}' for i in range(1, 5)],
                    'name': '순환기용 엑스선 투시 진단장치'},
    'Ultrasound': {'query': 'A26380.01', 'codes': ['A26380'] + [f'A26380.{i:02}' for i in range(1, 9)],
                   'name': '초음파 영상 진단장치'},
}

def canonical_company(value):
    value = unicodedata.normalize('NFKC', str(value))
    value = re.sub(r'주식회사|유한회사|\(주\)|\(유\)|\s+', '', value)
    return value.casefold()

def extract_page(html):
    match = re.search(r'\bvar\s+excelItemList\s*=\s*', html)
    if not match:
        raise ValueError('MFDS response has no readable item list; not an empty result.')
    rows, _ = json.JSONDecoder().raw_decode(html[match.end():])
    count = re.search(r'id=["\']totSearchCnt["\'][^>]*value=["\']([0-9,]+)', html)
    if not isinstance(rows, list) or not count:
        raise ValueError('MFDS public-search response format changed.')
    return rows, int(count[1].replace(',', ''))

def normalize_row(raw, company, family):
    names = [canonical_company(n) for n in COMPANIES[company]['names']]
    if canonical_company(raw.get('ENTP_NAME', '')) not in names:
        return None, 'company_not_in_scope'
    code = raw.get('MD_CLSF_NO', '')
    if code not in FAMILIES[family]['codes']:
        return None, 'equipment_not_in_scope'
    if raw.get('ITEM_STATE') != '정상' or raw.get('CANCEL_YN') == 'Y' or raw.get('RTRCN_WDRW_DT'):
        return None, 'not_currently_normal'
    if raw.get('XPRTPP_YN') == 'Y':
        return None, 'export_only'
    number = str(raw.get('ITEM_NO_FULLNAME', '')).strip()
    if not number or not re.fullmatch(r'\d{8}', str(raw.get('PRDL_PRM_DT', ''))):
        return None, 'missing_permit_or_date'
    date = dt.datetime.strptime(raw['PRDL_PRM_DT'], '%Y%m%d').date().isoformat()
    return {'company': company, 'legal_name': raw['ENTP_NAME'], 'family': family,
            'classification_code': code, 'item_name': raw.get('ITEM_NAME', ''),
            'model_name': raw.get('TYPE_NAME', ''), 'permit_number': number,
            'permit_date': date, 'status': raw['ITEM_STATE'],
            'item_id': raw.get('MEDDEV_ITEM_SEQ', ''), 'source_url': SOURCE}, None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='work/device-approvals-pilot.json')
    args = parser.parse_args()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.open(SOURCE, timeout=25).read()
    result = {'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'source_url': SOURCE,
              'coverage': 'first page only, up to 10 records per company and representative exact classification code; normal and non-export-only records retained; not all subtypes',
              'queries': [], 'records': []}
    seen = set()
    for company, spec in COMPANIES.items():
        for family, scope in FAMILIES.items():
            params = {'chkList': '1', 'chkGroup': 'GROUP_BY_FIELD_01', 'pageNum': '1',
                      'nowPageNum': '1', 'tabGubun': '1', 'searchYn': 'true', 'searchOn': 'Y',
                      'grade': '0', 'indtyCd': '1|2|21|22', 'itemState': '정상',
                      'entpName': spec['query'], 'mdClsfNo': scope['query']}
            query = {'company': company, 'family': family, 'parameters': params}
            try:
                request = urllib.request.Request(BASE + '/search/data/list',
                    data=urllib.parse.urlencode(params).encode(),
                    headers={'Referer': SOURCE, 'X-Requested-With': 'XMLHttpRequest'})
                with opener.open(request, timeout=25) as response:
                    raw, total = extract_page(response.read().decode('utf-8'))
                query.update({'source_total': total, 'sampled_rows': len(raw), 'accepted_rows': 0, 'excluded': {}})
                for row in raw:
                    record, reason = normalize_row(row, company, family)
                    if reason:
                        query['excluded'][reason] = query['excluded'].get(reason, 0) + 1
                        continue
                    key = (company, record['permit_number'], record['classification_code'])
                    if key in seen:
                        continue
                    seen.add(key)
                    result['records'].append(record)
                    query['accepted_rows'] += 1
            except Exception as error:
                query['error'] = str(error)
            result['queries'].append(query)
            print(json.dumps({k: v for k, v in query.items() if k != 'parameters'}, ensure_ascii=False), flush=True)
            time.sleep(.25)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if any('error' in q for q in result['queries']):
        raise SystemExit(1)

if __name__ == '__main__':
    main()
