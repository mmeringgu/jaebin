import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {equipmentFamily,legalName,normalizeApproval,parseApprovalsPage,parseRecallPage,officialRecallDetail} from '../src/industry-official.js';

const row=(changes={})=>({ENTP_NAME:'(주)필립스코리아',MD_CLSF_NO:'A11010.01',MEDDEV_ITEM_SEQ:'2021005248',DOCID:'2021005248_1',ITEM_NAME:'전신용 전산화 단층 엑스선 촬영장치',TYPE_NAME:'Spectral CT 7500 외 1 건',ITEM_NO_FULLNAME:'수인21-4467호',PRDL_PRM_DT:'20210923',ITEM_STATE:'정상',CANCEL_YN:'N',XPRTPP_YN:'N',...changes});
const page=(rows,total=rows.length)=>'var excelItemList = '+JSON.stringify(rows)+';<input id="totSearchCnt" value="'+total+'">';
const now=Date.parse('2026-11-19T03:00:00Z');

test('공식 업체명과 세부 품목코드로만 네 회사·장비 본체를 선별합니다',()=>{
 assert.equal(legalName('주식회사 필립스코리아'),legalName('(주)필립스코리아'));
 for(const [code,family] of [['A11010.02','CT'],['A12010.12','MRI'],['A11090.01','Angiography'],['A26380.03','초음파']])assert.equal(equipmentFamily(code),family);
 for(const code of ['A11010.03','A13010.02','A58020.03','D00000.01'])assert.equal(equipmentFamily(code,'CT 초음파 영상분석 소프트웨어'),'');
 assert.equal(normalizeApproval(row(),'Philips').permit,'수인21-4467호');
 for(const changes of [{ENTP_NAME:'캐논메디칼시스템즈코리아(주)'},{ITEM_STATE:'전환'},{CANCEL_YN:'Y'},{XPRTPP_YN:'Y'},{RTRCN_WDRW_DT:'2026-01-01'},{PRDL_PRM_DT:'20260230'}])assert.equal(normalizeApproval(row(changes),'Philips'),null);
});

test('공식 HTML 안의 JSON 배열·유니코드·인용부호를 읽으며 오류 페이지를 빈 목록으로 처리하지 않습니다',()=>{
 const data=row({TYPE_NAME:'모델 [A] "B"'});assert.deepEqual(parseApprovalsPage(page([data])).rows,[data]);
 assert.deepEqual(parseApprovalsPage(page([])),{rows:[],total:0});
 for(const invalid of ['접속이 차단되었습니다.','var excelItemList = [','var excelItemList = [];'])assert.throws(()=>parseApprovalsPage(invalid));
});

test('실제 식약처 회수 표본은 공지별로 보존하고 진행중인 네 장비군만 표시합니다',()=>{
 const html=readFileSync(new URL('./fixtures/mfds-recalls.html',import.meta.url),'utf8');
 const data=parseRecallPage(html,'Philips');assert.equal(data.total,8);assert.equal(data.rows.length,8);
 assert.equal(new Set(data.rows.map(r=>r.id)).size,8);
 assert.ok(data.rows.every(r=>r.status==='진행중'&&new URL(r.url).origin==='https://emedi.mfds.go.kr'));
 assert.ok(data.rows.some(r=>r.date==='2026-09-10'));
 assert.equal(parseRecallPage(html,'GE').rows.length,0);
 assert.equal(parseRecallPage(html.replaceAll('진행중','종료'),'Philips').rows.length,0);
 assert.throws(()=>parseRecallPage('서버 점검 중','Philips'));
});

test('인허가를 페이지 순회하고 서버측 날짜·현재 상태를 재검증하며 조회 결과를 캐시합니다',async t=>{
 const {officialIndustry}=await import('../src/industry-official.js?pagination');let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;const params=new URLSearchParams(options.body);
  assert.equal(params.get('prdlPrmDtFrom'),'2025-11-20');assert.equal(params.get('prdlPrmDtTo'),'2026-11-19');
  const records=params.get('pageNum')==='1'?[row({DOCID:'1',MEDDEV_ITEM_SEQ:'1',ITEM_NO_FULLNAME:'수인26-1호',PRDL_PRM_DT:'20261101'}),row({DOCID:'2',MEDDEV_ITEM_SEQ:'2',PRDL_PRM_DT:'20200101'})]:[row({DOCID:'3',MEDDEV_ITEM_SEQ:'3',ITEM_NO_FULLNAME:'수인26-3호',PRDL_PRM_DT:'20261001'})];
  return new Response(page(records,3));
 });
 const data=await officialIndustry('approvals','Philips',now);assert.equal(calls,2);assert.equal(data.records.length,2);assert.equal(data.partial,false);
 assert.equal(data.records[0].permit,'수인26-1호');await officialIndustry('approvals','Philips',now+1);assert.equal(calls,2);
});

test('반복 페이지는 일부 조회로 표시하고 갱신 실패 시 이전 공식자료를 명시적으로 유지합니다',async t=>{
 const {officialIndustry}=await import('../src/industry-official.js?stale');let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(page([row({PRDL_PRM_DT:'20261101'})],50));});
 const data=await officialIndustry('approvals','Philips',now);assert.equal(data.partial,true);assert.equal(calls,2);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('접속 실패');});
 const stale=await officialIndustry('approvals','Philips',now+7*3600000);assert.equal(stale.stale,true);assert.equal(stale.records.length,1);
 await assert.rejects(officialIndustry('recalls','GE',now),error=>error.status===503);
 await assert.rejects(officialIndustry('approvals','Canon',now),error=>error.status===400);
});

test('회수 모델은 공지의 정확한 허가번호·품목 순번과 연결하고 제조번호별 중복을 제거합니다',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{
  calls++;const source=new URL(url);
  if(source.pathname==='/recall/view/MNU20265')return new Response('<tr recallSeq="1"><td>수인99-9호</td></tr><tr recallSeq="2"><td>수인 26-1 호</td></tr><th scope="row">회수사유</th><td>부품 점검 안내</td>');
  assert.equal(source.searchParams.get('recallItemSeq'),'2');
  return Response.json({recallModel:[{deptReceiptNo:'202600000001',recallItemSeq:'2',typeName:'모델 A'},{deptReceiptNo:'202600000001',recallItemSeq:'2',typeName:'모델 A'},{deptReceiptNo:'202600000001',recallItemSeq:'2',typeName:'모델 B'},{deptReceiptNo:'202600000001',recallItemSeq:'1',typeName:'다른 품목'}]});
 });
 const detail=await officialRecallDetail('202600000001','수인26-1호',now);
 assert.equal(detail.model,'모델 A 외 1종');assert.equal(detail.reason,'부품 점검 안내');assert.equal(calls,2);
 await officialRecallDetail('202600000001','수인26-1호',now+1);assert.equal(calls,2);
 await assert.rejects(officialRecallDetail('../test','수인26-1호'),e=>e.status===400);
});

test('공식자료 API는 기사 DB 없이 동작하고 허용되지 않은 회사·공지 입력을 거부합니다',async t=>{
 const {default:worker}=await import('../src/index.js');
 t.mock.method(globalThis,'fetch',async()=>new Response(page([])));
 const request=path=>worker.fetch(new Request('https://example.com'+path),{});
 const response=await request('/api/industry-official?kind=approvals&company=Samsung%20Medison');
 assert.equal(response.status,200);assert.deepEqual((await response.json()).records,[]);
 assert.equal((await request('/api/industry-official?kind=approvals&company=Canon')).status,400);
 assert.equal((await request('/api/industry-recall-detail?id=invalid&permit=test')).status,400);
});
