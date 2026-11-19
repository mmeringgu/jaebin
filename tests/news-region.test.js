import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import '../static/news-rules.js';

const read=name=>readFileSync(new URL('../static/'+name+'.js',import.meta.url),'utf8');
const article=(id,changes={})=>({id,title:'기사 제목 '+id,entity:'지멘스',category:'competitor',tags:[],date:'2026-11-19',summary:'원문 첫 문단',source:'청년의사',url:'https://www.docdocdoc.co.kr/news/'+id,hidden:false,...changes});
function screen(rows){
 const nodes=new Map();let stats=0,monthly=0;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,innerHTML:'',outerHTML:'',addEventListener(name,fn){this[name]=fn;},scrollIntoView(){}});return nodes.get(id);};
 get('sort').value='new';
 const source=read('articles'),end=source.indexOf('// 맨 위 제목줄의 높이를 재서');
 const api=runInNewContext(read('news-rules')+'\n'+read('impact')+'\n'+source.slice(0,end)+'\n({render,setRows(rows){articles=rows;},pages:currentPages,setRegion(value){competitorRegion=value;}});',{
  URL,document:{getElementById:get,querySelector(){return {focus(){}};}},renderStats(){stats++;},renderMonthlySummary(){monthly++;},
 });
 api.setRows(rows);
 const toggle=(region,category='competitor')=>get('sections').click({target:{closest(selector){return selector==='button[data-'+category+'-region]'?{getAttribute:()=>region}:null;}}});
 return {...api,get,toggle,counts:()=>({stats,monthly})};
}

test('국내·글로벌은 번역 언어가 아닌 발행처를 기준으로 구분합니다',()=>{
 const region=globalThis.NewsRules.newsRegion;
 assert.equal(region(article(1,{title:'GE announces a new MRI system'})),'domestic');
 assert.equal(region(article(2,{title:'한글로 번역한 글로벌 발표',source:'Siemens 공식',url:'https://www.siemens-healthineers.com/press/1',domestic_media:false})),'global');
 assert.equal(region(article(3,{source:'Reuters',url:'https://www.reuters.com/business/1',title:'한글 번역 기사'})),'global');
 assert.equal(region(article(4,{source:'GE 한국 공식',url:'https://www.gehealthcare.co.kr/1',domestic_media:false})),'domestic');
 assert.equal(region(article(5,{source:'The Korea Herald',url:'https://www.koreaherald.com/article/1'})),'domestic');
});

test('해외 이슈를 보도한 국내 .com 매체와 한국 이슈를 보도한 해외 매체를 출처로 구분합니다',()=>{
 for(const category of ['company','competitor']){
  for(const host of ['heraldcorp.com','newstomato.com','ohmynews.com','hankookilbo.com','segye.com','munhwa.com']){
   assert.equal(NewsRules.newsRegion(article(1,{category,title:'미국·일본 의료영상 장비 해외 시장 투자',source:'국내 언론',url:'https://news.'+host+'/1',domestic_media:false})),'domestic');
  }
  assert.equal(NewsRules.newsRegion(article(2,{category,title:'한국 병원에 MRI 공급',summary:'국내 사업 소식',source:'Reuters',url:'https://www.reuters.com/world/asia-pacific/1',domestic_media:true})),'global');
  assert.equal(NewsRules.newsRegion(article(3,{category,source:'청년의사',url:'https://www.docdocdoc.co.kr/1',domestic_media:false})),'domestic');
 }
});

test('캐논 뉴스는 토글 없이 국내·글로벌을 모두 표시하고 경쟁사 선택과 독립적으로 유지합니다',()=>{
 const ui=screen([
  article(1,{category:'company',entity:'캐논',title:'캐논 CT 국내 공급',date:'2026-11-18'}),
  article(2,{category:'company',entity:'캐논',title:'캐논 MRI 신제품 출시',source:'캐논 글로벌 공식',url:'https://global.medical.canon/news/2',domestic_media:false}),
  article(3,{title:'지멘스 한국 병원 장비 공급',source:'Reuters',url:'https://www.reuters.com/3'})
 ]);
 ui.render();const original=ui.get('sections').innerHTML,counts=ui.counts();
 assert.doesNotMatch(original,/data-company-region/);
 assert.match(original,/docdocdoc\.co\.kr/);assert.match(original,/global\.medical\.canon/);
 ui.toggle('global');assert.match(ui.get('competitor').outerHTML,/reuters\.com/);
 assert.equal(ui.get('sections').innerHTML,original);assert.deepEqual(ui.counts(),counts);
});

test('보건뉴스는 국내에 표시하며 미등록 .com 출처를 글로벌로 간주하지 않습니다',()=>{
 const url='http://bokuennews.com/news/article.html?no=286884';
 for(const host of ['bokuennews.com','www.bokuennews.com','m.bokuennews.com']){
  const row=article(1,{source:'보건뉴스',url:url.replace('bokuennews.com',host),domestic_media:false});
  assert.equal(NewsRules.newsRegion(row),'domestic');
  assert.equal(NewsRules.isDomesticMedia({...row,domestic_media:undefined}),true);
 }
 for(const unknown of ['https://unregistered-press.com/1','https://reuters.com.unregistered-press.com/1','bad-url']){
  assert.equal(NewsRules.newsRegion(article(2,{source:'미확인 매체',url:unknown})),'domestic');
 }
 const ui=screen([article(1,{source:'보건뉴스',url,title:'지멘스 해외 의료사업 확장'}),article(2,{source:'Reuters',url:'https://www.reuters.com/2',title:'지멘스 한국 병원 장비 공급'})]);
 ui.render();assert.match(ui.get('sections').innerHTML,/bokuennews\.com/);
 ui.toggle('global');assert.doesNotMatch(ui.get('competitor').outerHTML,/bokuennews\.com/);
 assert.match(ui.get('competitor').outerHTML,/reuters\.com/);
});

test('국내를 기본으로 표시하고 토글 전환은 경쟁사만 갱신하며 다른 영역·집계는 유지합니다',()=>{
 const ui=screen([article(1,{title:'국내 공급 계약 발표'}),article(2,{title:'해외 생산 공장 투자',url:'https://www.gehealthcare.com/press/2',domestic_media:false}),article(3,{category:'policy',title:'검사 수가 제도 개편'})]);
 ui.render();
 const original=ui.get('sections').innerHTML,counts=ui.counts();
 assert.match(original,/국내 공급 계약 발표/);assert.doesNotMatch(original,/해외 생산 공장 투자/);
 assert.match(original,/data-competitor-region="domestic" aria-pressed="true"/);
 assert.doesNotMatch(original,/head-count|class="count"|중복 기사 포함/);
 ui.pages.competitor=2;ui.toggle('global');
 const selected=ui.get('competitor').outerHTML;
 assert.match(selected,/해외 생산 공장 투자/);assert.doesNotMatch(selected,/국내 공급 계약 발표/);
 assert.match(selected,/data-competitor-region="global" aria-pressed="true"/);
 assert.equal(ui.pages.competitor,1);assert.equal(ui.get('sections').innerHTML,original);assert.deepEqual(ui.counts(),counts);
 ui.toggle('domestic');assert.match(ui.get('competitor').outerHTML,/국내 공급 계약 발표/);
});

test('동일 소식의 국내 보도가 해외 최신 기사에 가려지지 않으며 검색·분야 필터도 유지합니다',()=>{
 const title='지멘스 MRI 신제품 출시';
 const ui=screen([article(1,{title,date:'2026-11-18'}),article(2,{title,url:'https://www.siemens-healthineers.com/press/2',domestic_media:false})]);
 ui.render();assert.match(ui.get('sections').innerHTML,/docdocdoc\.co\.kr/);assert.doesNotMatch(ui.get('sections').innerHTML,/siemens-healthineers\.com/);
 ui.get('topic').value='MRI';ui.get('search').value='신제품';ui.toggle('global');
 assert.match(ui.get('competitor').outerHTML,/siemens-healthineers\.com/);assert.doesNotMatch(ui.get('competitor').outerHTML,/docdocdoc\.co\.kr/);
 ui.get('topic').value='CT';ui.render(true);assert.match(ui.get('competitor').outerHTML,/조건에 맞는 기사가 없습니다/);
});
