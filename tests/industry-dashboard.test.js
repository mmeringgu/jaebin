import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../static/industry-dashboard.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function screen(fetcher){
 const nodes=new Map(),calls=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',hidden:true,addEventListener(name,fn){this[name]=fn;}});return nodes.get(id);};
 get('industry-approval-period').value='90';
 class Clock extends Date{static now(){return Date.parse('2026-11-19T03:00:00Z');}}
 runInNewContext(script,{URL,URLSearchParams,AbortSignal,Intl,Date:Clock,document:{getElementById:get,querySelector:selector=>get(selector)},
  fetch:async url=>{const params=new URL(url,'https://example.com').searchParams;if(!params.has('kind'))return {ok:false,json:async()=>({})};calls.push(url);const company=params.get('company'),kind=params.get('kind');
   return fetcher(kind,company);
  }});
 return {get,calls,async open(){get('[data-tab="stats"]').click();await flush();await flush();},
  change(id,value){get('industry-'+id).value=value;get('industry-'+id).change();},
  page(kind,step){get('industry-dashboard').click({target:{closest:()=>({dataset:{industryPage:kind,step:String(step)}})}});}};
}
function record(id,company,date='2026-11-01'){
 return {id:String(id),company,family:'CT',item_name:'전신용 전산화 단층 엑스선 촬영장치',model:'장비 '+id,permit:'수인26-'+id+'호',date,action:'영업자 회수보고',status:'진행중',url:'https://emedi.mfds.go.kr/recall/view/MNU20265?deptReceiptNo='+id};
}
const response=(kind,company,records,extra={})=>({ok:true,json:async()=>({kind,company,records,fetched_at:'2026-11-19T02:00:00Z',partial:false,stale:false,...extra})});

test('탭을 열 때 공식자료만 조회하고 양쪽 공통 회사 필터·회수 4행 페이지·인허가 기간을 적용합니다',async()=>{
 const ui=screen((kind,company)=>{
  const rows=company==='GE'?Array.from({length:7},(_,i)=>record(i+1,company)):company==='Philips'?[record(20,company),record(21,company,'2026-05-01')]:[];
  return response(kind,company,rows);
 });
 assert.equal(ui.calls.length,0);await ui.open();assert.equal(ui.calls.length,8);
 assert.equal((ui.get('industry-recalls-output').innerHTML.match(/<li>/g)||[]).length,4);
 assert.match(ui.get('industry-recalls-pages').innerHTML,/1 \/ 3/);
 assert.match(ui.get('industry-approvals-pages').innerHTML,/1 \/ 2/);
 ui.page('recalls',1);assert.equal((ui.get('industry-recalls-output').innerHTML.match(/<li>/g)||[]).length,4);
 ui.page('recalls',1);assert.equal((ui.get('industry-recalls-output').innerHTML.match(/<li>/g)||[]).length,1);
 assert.match(ui.get('industry-recalls-output').innerHTML,/industry-record-title[\s\S]*industry-record-family[\s\S]*industry-record-company/);
 ui.change('company','Philips');assert.match(ui.get('industry-recalls-output').innerHTML,/Philips/);assert.doesNotMatch(ui.get('industry-recalls-output').innerHTML,/>GE</);
 assert.equal((ui.get('industry-approvals-output').innerHTML.match(/<tr>/g)||[]).length,2);
 ui.change('approval-period','365');assert.equal((ui.get('industry-approvals-output').innerHTML.match(/<tr>/g)||[]).length,3);
 assert.equal(ui.calls.length,8);await ui.open();assert.equal(ui.calls.length,8);
});

test('조회 실패·일부 조회·이전 자료를 명시하고 공식 원문 외 링크와 HTML을 실행하지 않습니다',async()=>{
 const ui=screen((kind,company)=>{
  if(company==='GE')throw new Error('접속 실패');
  const rows=company==='Philips'?[{...record(1,company),item_name:'<img src=x>',model:'<script>alert(1)</script>',url:'javascript:alert(1)'}]:[];
  return response(kind,company,rows,{partial:company==='Philips',stale:company==='Philips'});
 });
 await ui.open();assert.match(ui.get('industry-recalls-status').textContent,/GE 조회 실패/);
 assert.match(ui.get('industry-recalls-status').textContent,/일부 자료만 조회됨/);
 assert.match(ui.get('industry-recalls-status').textContent,/이전 조회자료 표시/);
 assert.doesNotMatch(ui.get('industry-recalls-output').innerHTML,/<img|javascript:/);
 assert.doesNotMatch(ui.get('industry-approvals-output').innerHTML,/<script|javascript:/);
 ui.change('company','GE');assert.match(ui.get('industry-recalls-output').innerHTML,/불러오지 못했습니다/);
 assert.doesNotMatch(ui.get('industry-recalls-output').innerHTML,/공지가 없습니다/);
});

test('회수 장비 필터는 회사 선택과 함께 적용하고 페이지를 초기화하며 인허가에는 영향을 주지 않습니다',async()=>{
 const ui=screen((kind,company)=>response(kind,company,company==='GE'?[
  ...Array.from({length:5},(_,i)=>record(i+1,company)),
  {...record(10,company),family:'MRI',item_name:'MRI 전용 모델'}
 ]:company==='Philips'?[{...record(20,company),family:'MRI',item_name:'필립스 MRI 모델'}]:[]));
 await ui.open();
 ui.page('recalls',1);
 const approvals=ui.get('industry-approvals-output').innerHTML;
 ui.change('recall-family','MRI');
 assert.equal((ui.get('industry-recalls-output').innerHTML.match(/<li>/g)||[]).length,2);
 assert.match(ui.get('industry-recalls-output').innerHTML,/MRI 전용 모델/);
 assert.equal(ui.get('industry-recalls-pages').innerHTML,'');
 assert.equal(ui.get('industry-approvals-output').innerHTML,approvals);
 ui.change('company','Philips');
 assert.match(ui.get('industry-recalls-output').innerHTML,/필립스 MRI 모델/);
 assert.doesNotMatch(ui.get('industry-recalls-output').innerHTML,/MRI 전용 모델/);
 ui.change('recall-family','CT');assert.match(ui.get('industry-recalls-output').innerHTML,/공지가 없습니다/);
 ui.change('company','');ui.change('recall-family','');
 assert.equal((ui.get('industry-recalls-output').innerHTML.match(/<li>/g)||[]).length,4);
 assert.equal(ui.calls.length,8);
});
