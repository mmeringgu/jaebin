import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import worker from "../src/index.js";
import { koreaNow, addDays } from "../src/settings.js";

test("월간 API는 최근 30일 기사로 생성하고 주간 API는 제공하지 않습니다", async (t) => {
  const day = koreaNow().day;
  const rows = [0, -29, -30, 1].map((offset, i) => ({
    id: i + 1, title: "캐논메디칼 MRI 영상진단 장비 도입 " + i, source: "청년의사",
    url: "https://www.docdocdoc.co.kr/news/articleView.html?idxno=" + (i + 1), published_date: addDays(day, offset),
    summary: JSON.stringify({ format: "excerpt", source_id: "S012", first_paragraph: "기사 첫 문단입니다." }),
  }));
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
    return Response.json({ choices: [{ message: { content: JSON.stringify({ trends: [{ text: "월간 동향", sources: [1] }] }) } }] });
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
  assert.equal(result.report.sections[0].title, "이번 달 핵심 동향");
  assert.equal((await request("/api/weekly-report", { period: "week" })).status, 404);
  assert.equal(calls, 1);
});

const article = (id, changes = {}) => ({ id, title: '중요 기사 제목 '+id, entity: '대상'+id, category: 'policy', date: '2026-11-18',
 source: '매체', url: 'https://example.com/'+id, starred: 1, hidden: false, ...changes });
function screen(rows){
 const nodes=new Map();
 const node=(tag)=>({tag,children:[],textContent:'',attributes:{},append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(key,value){this.attributes[key]=value;}});
 const get=(id)=>{if(!nodes.has(id))nodes.set(id,node('div'));return nodes.get(id);};
 const script=readFileSync(new URL('../static/report.js',import.meta.url),'utf8');
 const shared=readFileSync(new URL('../static/news-rules.js',import.meta.url),'utf8');
 const api=runInNewContext(shared+'\n'+script+'\n({importantReport,renderMonthlySummary});',{
  articles:rows,document:{getElementById:get,createElement:node},
  kstDate:(days)=>new Date(Date.UTC(2026,10,18-days)).toISOString().slice(0,10),
  fetch(){assert.fail('월간 요약은 생성 API를 호출하지 않아야 합니다.');},
 });
 return {...api,get};
}

test('월간 요약은 최근 30일 중요 기사만 세 영역 표에 즉시 표시합니다',()=>{
 const rows=[article(1,{impact_override:'기회'}),article(2,{impact_override:'위협',date:'2026-10-20'}),
  article(3,{starred:0,impact_override:'기회'}),article(4,{hidden:true}),article(5,{date:'2026-10-19'}),article(6,{date:'2026-11-19'})];
 const ui=screen(rows),report=ui.importantReport(rows);
 assert.equal(report.count,2);
 assert.deepEqual(JSON.parse(JSON.stringify(report.sections.map((s)=>s.items.length))),[2,1,1]);
 assert.ok(report.sections.every((s)=>s.format==='table'));
 assert.equal(report.sections[1].items[0].impact,'기회');assert.equal(report.sections[2].items[0].impact,'위협');
 assert.equal(report.sections.some((s)=>s.title==='경쟁사 움직임'),false);
 assert.match(ui.get('report-status').textContent,/중요 기사 2건/);
 rows[0].starred=0;rows[1].hidden=true;ui.renderMonthlySummary();
 assert.match(ui.get('report-status').textContent,/중요 기사 0건/);
 assert.match(ui.get('report-output').children[1].textContent,/중요 기사가 없습니다/);
});

test('기회·위협 선택 변경을 재생성 없이 반영하며 생성 버튼과 설명을 제거합니다',()=>{
 const rows=[article(1)],ui=screen(rows);
 assert.equal(ui.importantReport(rows).sections[1].items.length,0);
 rows[0].impact_override='기회';ui.renderMonthlySummary();
 const table=ui.get('report-output').children[3].children[0];
 const symbol=table.children[1].children[0].children[2].children[0];
 assert.equal(symbol.textContent,'▲');assert.equal(symbol.className,'report-positive');
 const html=readFileSync(new URL('../static/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="report-month-button"|id="report-description"/);
 const articles=readFileSync(new URL('../static/articles.js',import.meta.url),'utf8');
 assert.match(articles,/typeof renderMonthlySummary==='function'/);
});
