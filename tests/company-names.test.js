import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import '../static/news-rules.js';
import {keywordMatch} from '../src/rules.js';
import {normalizeInsights} from '../src/report.js';
import worker from './helpers/admin-worker.js';
const rules=globalThis.NewsRules;

test('지정 경쟁사 이름의 한글·영문 변형을 네 표준 이름으로 통일합니다',()=>{
 for(const [input,expected] of [['GE헬스케어','GE'],['GE 헬스케어','GE'],['GE Healthcare','GE'],['지이헬스케어','GE'],
  ['지멘스헬시니어스','Siemens'],['지멘스 헬시니어스','Siemens'],['Siemens Healthineers','Siemens'],
  ['필립스','Philips'],['Philips Healthcare','Philips'],['삼성메디슨','Samsung Medison'],['삼성 메디슨','Samsung Medison'],['Samsung Medison','Samsung Medison']]){
  assert.equal(rules.companyLabel(input),expected,input);
  assert.equal(rules.designatedCompany({entity:input}),expected,input);
  assert.equal(rules.companyLabel(expected),expected);
 }
 assert.equal(rules.companyLabel('빙 뉴스 검색: 지멘스 의료'),'빙 뉴스 검색: Siemens 의료');
 for(const entity of ['후지필름','United Imaging','Samsung Electronics','삼성전자','General Hospital','GEAR'])assert.equal(rules.designatedCompany({entity}),'',entity);
});
test('업계 업체는 뉴스 수집 대상으로 유지하고 월간 표·AI 입력에서만 지정 경쟁사로 제한합니다',()=>{
 for(const title of ['후지필름 CT 신제품 출시','유나이티드 이미징 MRI 신제품 출시']){
  const groups=keywordMatch(title,{status:'사용',categories:['company','competitor','policy','hospital']});
  assert.equal(groups[0].category,'competitor');
 }
 const base={date:'2026-11-19',starred:1,impact_override:'기회',category:'competitor'};
 const entities=['GE헬스케어','지멘스','필립스','삼성메디슨','후지필름','United Imaging'];
 const headlines=['GE헬스케어 초음파 FDA 승인','지멘스 의료사업 공장 투자','필립스 CT 공급 계약','삼성메디슨 실적 증가','후지필름 인수 합병 발표','United Imaging 신제품 출시'];
 const articles=entities.map((entity,id)=>({...base,id,entity,title:headlines[id],url:'https://example.com/'+id}));
 const selected=rules.monthlyArticles(articles,'2026-11-01','2026-11-30');
 assert.equal(selected.length,4);
 assert.deepEqual(new Set(selected.map(rules.designatedCompany)),new Set(['GE','Siemens','Philips','Samsung Medison']));
 assert.equal(articles.length,6);
 assert.equal(rules.designatedCompany({entity:'후지필름',title:'후지필름 GE와 협력'}),'');
});
test('뉴스 카드의 회사명·태그·출처만 바꾸고 제목·부제목·본문은 그대로 표시합니다',()=>{
 const read=name=>readFileSync(new URL('../static/'+name+'.js',import.meta.url),'utf8');
 const source=read('articles');
 const {card}=runInNewContext(read('news-rules')+'\n'+read('impact')+'\n'+source.slice(0,source.indexOf('function render(){'))+'\n({card});');
 const a={id:1,title:'지멘스 MRI 신제품 출시',entity:'지멘스헬시니어스',source:'지멘스 글로벌 공식',tags:['지멘스','MRI'],date:'2026-11-19',category:'competitor',url:'https://example.com/1',summary:'지멘스가 신규 의료영상 장비를 출시했습니다.'};
 const html=card(a,[]);
 assert.match(html,/>지멘스 MRI 신제품 출시<\/a>/);
 assert.match(html,/지멘스가 신규 의료영상 장비를 출시했습니다\./);
 assert.match(html,/<span class="entity">Siemens<\/span>/);
 assert.match(html,/Siemens 글로벌 공식/);
 assert.match(html,/<span class="tag">Siemens<\/span>/);
 assert.equal(a.entity,'지멘스헬시니어스');
});
test('관리 정보원 이름도 표준화하고 수집 규칙 자체는 변경하지 않습니다',async()=>{
 const response=await worker.fetch(new Request('https://example.com/api/sources'),{DB:{prepare(){return {async run(){}};}}});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.ok(data.sources.some(source=>source.name.includes('Siemens')));
 assert.ok(data.sources.some(source=>source.name.includes('Philips')));
 assert.ok(data.sources.some(source=>source.name.includes('후지필름')));
 assert.ok(data.sources.every(source=>!/지멘스|필립스|삼성메디슨|GE헬스케어/.test(source.name)));
});
test('AI가 생성한 설명의 회사명은 표준화하고 원문 출처 제목은 유지합니다',()=>{
 const articles=[{starred:1,title:'지멘스 신제품 발표',source:'매체',url:'https://example.com/1'}];
 const report=normalizeInsights(JSON.stringify({insights:[{text:'지멘스헬시니어스의 신제품 대응 검토가 필요함.',sources:[1]},{text:'필립스 공급 확대에 대비가 필요함.',sources:[1]}]}),articles);
 assert.match(report.insights[0].text,/^Siemens/);
 assert.match(report.insights[1].text,/^Philips/);
 assert.equal(report.insights[0].sources[0].title,'지멘스 신제품 발표');
});
