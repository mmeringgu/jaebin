import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import worker from "../src/index.js";
import { koreaNow, addDays } from "../src/settings.js";
import { normalizeInsights } from "../src/report.js";
import { monthlyInsights } from "../src/ai_summary.js";

test("월간 API는 최근 30일 기사로 생성하고 주간 API는 제공하지 않습니다", async (t) => {
  const day = koreaNow().day;
  const rows = [0, -29, -30, 1].map((offset, i) => ({
    id: i + 1, starred: 1, title: "캐논메디칼 MRI 영상진단 장비 도입 " + i, source: "청년의사",
    url: "https://www.docdocdoc.co.kr/news/articleView.html?idxno=" + (i + 1), published_date: addDays(day, offset),
    summary: JSON.stringify({ format: "excerpt", source_id: "S012", first_paragraph: "기사 첫 문단입니다." }),
  }));
  rows.push({ ...rows[0], id: 99, starred: 0, url: 'https://www.docdocdoc.co.kr/news/articleView.html?idxno=99' });
  const env = { OPENAI_API_KEY: "test", DB: { prepare() {
    return { bind() { return this; }, async run() { return {}; }, async all() { return { results: rows.map((row) => ({ ...row })) }; } };
  } } };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /최근 30일/);
    const selected = body.messages[1].content.split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(selected.map((row) => row.date).sort(), [addDays(day, -29), day].sort());
    assert.match(body.messages[0].content, /제목이나 본문 요약을 반복하지/);
    assert.match(body.messages[0].content, /2~3개/);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ insights: [
      { text: "장비 도입 수요에 대비해 구매 일정 확인이 필요함.", sources: [1] },
      { text: "공급 경쟁 확대 가능성이 있어 제안 차별화 검토가 필요함.", sources: [2] },
    ] }) } }] });
  });
  const request = (path, body = {}) => worker.fetch(new Request("http://localhost" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), env);
  const response = await request("/api/monthly-report");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.since, addDays(day, -29));
  assert.equal(result.until, day);
  assert.equal(result.article_count, 2);
  assert.equal(result.report.insights.length, 2);
  assert.equal((await request("/api/weekly-report", { period: "week" })).status, 404);
  assert.equal(calls, 1);
});

const article = (id, changes = {}) => ({ id, title: '중요 기사 제목 '+id, entity: '대상'+id, category: 'policy', date: '2026-11-18',
 source: '매체', url: 'https://example.com/'+id, starred: 1, hidden: false, ...changes });
function screen(rows,fetcher){
 const nodes=new Map();
 const node=(tag)=>({tag,children:[],textContent:'',attributes:{},append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(key,value){this.attributes[key]=value;}});
 const get=(id)=>{if(!nodes.has(id))nodes.set(id,node('div'));return nodes.get(id);};
 const script=readFileSync(new URL('../static/report.js',import.meta.url),'utf8');
 const shared=readFileSync(new URL('../static/news-rules.js',import.meta.url),'utf8');
 const api=runInNewContext(shared+'\n'+script+'\n({importantReport,renderMonthlySummary,createMonthlyInsights});',{
  articles:rows,document:{getElementById:get,createElement:node},
  kstDate:(days)=>new Date(Date.UTC(2026,10,18-days)).toISOString().slice(0,10),
  fetch:fetcher||function(){assert.fail('표 조회만으로 AI API를 호출하지 않아야 합니다.');},
 });
 return {...api,get};
}

test('월간 요약은 최근 30일 중요 기사만 세 영역 표에 즉시 표시합니다',()=>{
 const rows=[article(1,{impact_override:'기회'}),article(2,{impact_override:'위협',date:'2026-10-20'}),
  article(3,{starred:0,impact_override:'기회'}),article(4,{hidden:true}),article(5,{date:'2026-10-19'}),article(6,{date:'2026-11-19'})];
 const ui=screen(rows),report=ui.importantReport(rows);
 assert.equal(report.count,2);
 assert.deepEqual(JSON.parse(JSON.stringify(report.sections.map((s)=>s.items.length))),[0,1,1]);
 assert.deepEqual(JSON.parse(JSON.stringify(report.sections.map((s)=>s.title))),['정책','기회','위협']);
 assert.ok(report.sections.every((s)=>s.format==='table'));
 assert.equal(report.sections[1].items[0].impact,'기회');assert.equal(report.sections[2].items[0].impact,'위협');
 assert.equal(report.sections.some((s)=>s.title==='경쟁사 움직임'),false);
 assert.match(ui.get('report-status').textContent,/중요 기사 2건/);
 rows[0].starred=0;rows[1].hidden=true;ui.renderMonthlySummary();
 assert.match(ui.get('report-status').textContent,/중요 기사 0건/);
 assert.match(ui.get('report-output').children[1].textContent,/선택된 정책 기사가 없습니다/);
});

test('기회·위협 선택 변경을 즉시 반영하며 표와 독립된 AI 버튼을 하나만 제공합니다',()=>{
 const rows=[article(1)],ui=screen(rows);
 assert.equal(ui.importantReport(rows).sections[1].items.length,0);
 rows[0].impact_override='기회';ui.renderMonthlySummary();
 const table=ui.get('report-output').children[3].children[0];
 const symbol=table.children[1].children[0].children[2].children[0];
 assert.equal(symbol.textContent,'▲');assert.equal(symbol.className,'report-positive');
 const html=readFileSync(new URL('../static/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="report-month-button"|id="report-description"/);
 assert.equal((html.match(/id="monthly-insight-button"/g)||[]).length,1);
 const articles=readFileSync(new URL('../static/articles.js',import.meta.url),'utf8');
 assert.match(articles,/typeof renderMonthlySummary==='function'/);
});

test('정책·기회·위협 표와 동일 소식을 중복시키지 않고 미분류 건수를 안내합니다',()=>{
 const rows=[article(1,{title:'복지부 특수의료장비 제도 개편'}),
  article(2,{title:'캐논메디칼 신제품 출시',category:'company',impact_override:'기회'}),
  article(3,{title:'GE헬스케어 공급 확대',category:'competitor',impact_override:'위협'}),
  article(4,{title:'병원 투자 계획 검토',category:'hospital'}),
  article(5,{title:'복지부 특수의료장비 제도 개편',impact_override:'기회',date:'2026-11-17'})];
 const ui=screen(rows),report=ui.importantReport(rows);
 assert.equal(report.count,4);assert.equal(report.unclassified,1);
 const urls=report.sections.flatMap((s)=>s.items.flatMap((a)=>a.sources.map((s)=>s.url)));
 assert.equal(new Set(urls).size,urls.length);
 assert.equal(report.sections[0].items.length,0);
 assert.equal(report.sections[1].items.length,2);
 assert.match(ui.get('report-status').textContent,/미분류 1건/);
});

test('AI는 버튼으로만 생성하고 연속 클릭을 막으며 글머리 기호와 검증된 원문을 표시합니다',async()=>{
 let calls=0,finish;
 const ui=screen([article(1)],async(path,options)=>{
  calls++;assert.equal(path,'/api/monthly-report');assert.equal(options.method,'POST');
  await new Promise((resolve)=>{finish=resolve;});
  return {ok:true,json:async()=>({since:'2026-10-20',until:'2026-11-18',article_count:1,report:{insights:[
   {text:'구매 일정 확인이 필요함.',sources:[{url:'https://example.com/1',title:'기사',source:'매체'}]},
   {text:'<script>대응 검토가 필요함.</script>',sources:[{url:'javascript:alert(1)'}]},
  ]}})};
 });
 assert.equal(calls,0);
 const pending=ui.createMonthlyInsights();await ui.createMonthlyInsights();assert.equal(calls,1);
 assert.equal(ui.get('monthly-insight-button').disabled,true);
 finish();await pending;
 const list=ui.get('monthly-insight-output').children[0];assert.equal(list.tag,'ul');assert.equal(list.children.length,2);
 assert.equal(list.children[1].children[0].textContent,'<script>대응 검토가 필요함.</script>');
 assert.equal(list.children[1].children[1].children.length,0);
 assert.equal(ui.get('monthly-insight-button').disabled,false);
});

test('중요 기사 변경 시 이전 인사이트와 진행 중인 오래된 결과를 폐기합니다',async()=>{
 let finish;const rows=[article(1)];
 const ui=screen(rows,()=>new Promise((resolve)=>{finish=resolve;}));
 const pending=ui.createMonthlyInsights();rows[0].starred=0;ui.renderMonthlySummary();
 finish({ok:true,json:async()=>({report:{insights:[{text:'옛 결과',sources:[]},{text:'옛 결과2',sources:[]}]}})});await pending;
 assert.equal(ui.get('monthly-insight-output').children.length,0);
 assert.equal(ui.get('monthly-insight-button').disabled,true);
});

test('인사이트는 중요 기사 출처만 허용하고 제목 반복·긴 문장·중복을 제외합니다',()=>{
 const rows=[article(1),article(2,{starred:0})];
 const first={text:'구매 시점 확인이 필요함.',sources:[1]},second={text:'공급 경쟁 심화 가능성에 대비가 필요함.',sources:[1]};
 const report=normalizeInsights(JSON.stringify({insights:[first,first,
  {text:rows[0].title,sources:[1]},{text:'잘못된 근거',sources:[2]},
  {text:'없는 번호',sources:[99]},{text:'긴'.repeat(101),sources:[1]},second]}),rows);
 assert.equal(report.insights.length,2);assert.equal(report.insights[0].sources[0].url,rows[0].url);
 assert.equal(normalizeInsights(JSON.stringify({insights:[first]}),rows),null);
 assert.equal(normalizeInsights('not JSON',rows),null);
});

test('중요 기사가 없거나 API 키가 없으면 AI 요청을 보내지 않습니다',async(t)=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('AI 요청이 없어야 합니다.'));
 assert.equal(await monthlyInsights({OPENAI_API_KEY:'test'},[article(1,{starred:0})]),null);
 assert.equal(await monthlyInsights({},[article(1)]),null);
});

test('AI 실패 시 안내하고 재시도할 수 있으며 표는 그대로 유지합니다',async()=>{
 const ui=screen([article(1)],async()=>({ok:false,json:async()=>({error:'분석 실패. 다시 시도해 주세요.'})}));
 await ui.createMonthlyInsights();
 assert.match(ui.get('monthly-insight-status').textContent,/다시 시도/);
 assert.equal(ui.get('monthly-insight-button').disabled,false);
 assert.ok(ui.get('report-output').children.length>0);
});
