import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('approval_pilot', Path(__file__).parents[1] / 'scripts/verify-device-approvals.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)

class ApprovalPilotTests(unittest.TestCase):
    def row(self, **changes):
        # Reduced fields from the MFDS GE CT sample; not a complete permit record.
        return dict(ENTP_NAME='지이헬스케어코리아(주)', MD_CLSF_NO='A11010.01',
                    ITEM_NAME='전신용 전산화 단층 엑스선 촬영장치', TYPE_NAME='HiSpeed Dual',
                    ITEM_NO_FULLNAME='수인25-4742호', PRDL_PRM_DT='20251223',
                    ITEM_STATE='정상', CANCEL_YN='N', RTRCN_WDRW_DT='', XPRTPP_YN='N') | changes

    def test_legal_name_variants(self):
        for name in ['지이헬스케어코리아㈜', '지이헬스케어코리아 주식회사', '(주)지이헬스케어코리아']:
            item, error = pilot.normalize_row(self.row(ENTP_NAME=name), 'GE', 'CT')
            self.assertIsNone(error)
            self.assertEqual(item['company'], 'GE')
        self.assertEqual(pilot.canonical_company('주식회사 필립스코리아'), pilot.canonical_company('(주)필립스코리아'))

    def test_only_four_companies_and_equipment(self):
        for fields in [dict(ENTP_NAME='캐논메디칼시스템즈코리아(주)'), dict(MD_CLSF_NO='A13010.02'),
                       dict(MD_CLSF_NO='A58020.03'), dict(MD_CLSF_NO='A11010.03')]:
            self.assertIsNone(pilot.normalize_row(self.row(**fields), 'GE', 'CT')[0])

    def test_converted_cancelled_and_export_only_are_not_current_domestic_items(self):
        for fields in [dict(ITEM_STATE='전환', CANCEL_YN='Y'), dict(ITEM_STATE='취하'),
                       dict(ITEM_STATE='취소'), dict(XPRTPP_YN='Y'), dict(RTRCN_WDRW_DT='2026-01-01')]:
            self.assertIsNone(pilot.normalize_row(self.row(**fields), 'GE', 'CT')[0])

    def test_four_representative_codes(self):
        for company, family, name in [('GE', 'CT', '지이헬스케어코리아(주)'),
                                     ('Siemens', 'MRI', '지멘스 헬시니어스(주)'),
                                     ('Philips', 'Angiography', '(주)필립스코리아'),
                                     ('Samsung Medison', 'Ultrasound', '삼성메디슨(주)'),
                                     ('GE', 'Ultrasound', '한국지이초음파(유)')]:
            item, error = pilot.normalize_row(self.row(ENTP_NAME=name, MD_CLSF_NO=pilot.FAMILIES[family]['query']), company, family)
            self.assertIsNone(error)
            self.assertEqual(item['family'], family)

    def test_parse_source_and_distinguish_failure_from_no_results(self):
        rows = [self.row()]
        html = 'var excelItemList = ' + json.dumps(rows) + ';<input id="totSearchCnt" value="1">'
        self.assertEqual(pilot.extract_page(html), (rows, 1))
        self.assertEqual(pilot.extract_page('var excelItemList = [];<input id="totSearchCnt" value="0">'), ([], 0))
        for invalid in ['접속 오류', 'var excelItemList = [];']:
            with self.assertRaises(ValueError):
                pilot.extract_page(invalid)

if __name__ == '__main__':
    unittest.main()
