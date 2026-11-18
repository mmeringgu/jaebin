import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (name) => readFileSync(new URL(`../static/${name}.js`, import.meta.url), "utf8");
const articlesScript = read("articles");
const { matchesTopic, NewsRules } = runInNewContext(read("news-rules") + "\n" + articlesScript.slice(0, articlesScript.indexOf("function render(){")) + "\n({matchesTopic,NewsRules});", { URL });
const article = (title, changes = {}) => ({ title, date: "2026-11-17", category: "competitor", source: "라포르시안", url: "https://www.rapportian.com/news/articleView.html?idxno=1", tags: [], hidden: false, ...changes });
function setup(articles = []) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", checked: false, innerHTML: "", addEventListener() {} });
    return nodes.get(id);
  };
  const api = runInNewContext(read("stats") + "\n({topicExposureRows,mediaExposureRows,exposureComparisons,exposureTable,companyTrend,companyShare,statsArticles,renderStats,competitorMovementRows,competitorMovements,COMPANIES});", {
    document: { getElementById: get }, articles, matchesTopic, NewsRules,
    kstDate: (days) => new Date(Date.UTC(2026, 10, 17 - days)).toISOString().slice(0, 10),
    esc: (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  });
  return { ...api, get };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("분야별로 여러 회사·분야를 각각 세고 최근 30일 경계를 적용합니다", () => {
  const api = setup();
  const rows = plain(api.topicExposureRows([
    article("캐논메디칼 지멘스 CT MRI 공개"),
    article("Canon Medical AI 초음파 공개", { date: "2026-10-19" }),
    article("GE Healthcare MRI 공개", { date: "2026-10-18" }),
    article("GE Healthcare CT 공개", { date: "2026-11-18" }),
    article("동물병원 MRI 도입", { category: "company" }),
    article("필수의료 CT 수가 개편"),
  ]));
  assert.deepEqual(rows.find((r) => r.name === "CT").counts, [1, 1, 0, 0, 0]);
  assert.deepEqual(rows.find((r) => r.name === "MRI").counts, [2, 1, 0, 0, 0]);
  assert.deepEqual(rows.find((r) => r.name === "UL").counts, [1, 0, 0, 0, 0]);
  assert.deepEqual(rows.find((r) => r.name === "AI").counts, [1, 0, 0, 0, 0]);
  assert.deepEqual(rows.find((r) => r.name === "Vet").counts, [1, 0, 0, 0, 0]);
});

test("매체별로 빙 검색 표기를 합치고 회사별 건수와 정렬을 유지합니다", () => {
  const api = setup();
  const rows = plain(api.mediaExposureRows([
    article("캐논메디칼 MRI 출시"),
    article("지멘스 CT 출시", { source: "라포르시안 (빙 검색)" }),
    article("캐논메디칼 GE헬스케어 CT 협력", { source: "메디컬타임즈" }),
    article("필립스 초음파 공개", { source: "" }),
    article("MRI 정책 개편", { source: "관련 없는 매체" }),
  ]));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.find((r) => r.name === "라포르시안").counts, [1, 1, 0, 0, 0]);
  assert.deepEqual(rows.find((r) => r.name === "메디컬타임즈").counts, [1, 0, 1, 0, 0]);
  assert.equal(rows[2].name, "매체 미확인");
});

test("업계 동향은 숨김만 제외하고 뉴스 분야 필터와 독립적으로 전체를 집계합니다", () => {
  const api = setup([
    article("캐논메디칼 CT 출시", { hidden: true }),
    article("지멘스 CT 출시", { match_level: "main" }),
    article("필립스 MRI 출시"), article("GE헬스케어 CT 출시"),
  ]);
  api.get("topic").value = "CT";
  const list = api.statsArticles();
  assert.equal(list.length, 3);
  assert.deepEqual(plain(api.topicExposureRows(list)).find((r) => r.name === "CT").counts, [0, 1, 1, 0, 0]);
  assert.deepEqual(plain(api.topicExposureRows(list)).find((r) => r.name === "MRI").counts, [0, 0, 0, 1, 0]);
  assert.deepEqual(plain(api.mediaExposureRows(list))[0].counts, [0, 1, 1, 1, 0]);
});

test("노출 관리에 비교를 표시하고 합계·캐논 점유율 열을 제거하며 매체 이름을 안전하게 표시합니다", () => {
  const api = setup([article("캐논메디칼 GE헬스케어 CT 협력", { source: '<img src=x onerror="alert(1)">' })]);
  const html = api.get("stats-company").innerHTML;
  assert.match(html, /분야별 회사 비교/);
  assert.match(html, /매체별 노출 비교/);
  assert.match(html, /50%/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.equal((html.match(/company-comparison/g) || []).length, 1);
  const comparisons = api.exposureComparisons([article("캐논메디칼 GE헬스케어 CT 협력")]);
  assert.doesNotMatch(comparisons, /캐논 점유율|언급 합계/);
  assert.doesNotMatch(comparisons, /exposure-note/);
  assert.match(comparisons, />캐논<\/th>/);
});

test("공식·해외·기관 기사는 제외하고 국내 언론사 기사만 모든 노출 분석에 반영합니다", () => {
  const api = setup();
  const list = [
    article("캐논메디칼 CT 국내 공급", { category: "company" }),
    article("캐논메디칼 MRI 글로벌 공급", { category: "company", source: "캐논 글로벌 공식", url: "https://global.medical.canon/news/1", original_title: "Canon Medical MRI launch" }),
    article("캐논 CT 본사 발표", { category: "company", source: "캐논 본사", url: "https://global.canon/ja/news/1.html" }),
    article("GE헬스케어 MRI 해외 출시", { source: "Yahoo Finance (빙 검색)", url: "https://finance.yahoo.com/news/1" }),
    article("필립스 MRI 국내 보도", { source: "국제뉴스 (빙 검색)", url: "https://www.gukjenews.com/news/1" }),
    article("지멘스 MRI 기관 안내", { source: "건강보험심사평가원", url: "https://www.hira.or.kr/bbs/1" }),
  ];
  const rows = plain(api.topicExposureRows(list));
  assert.deepEqual(rows.find((r) => r.name === "CT").counts, [1, 0, 0, 0, 0]);
  assert.deepEqual(rows.find((r) => r.name === "MRI").counts, [0, 0, 0, 1, 0]);
  const domestic = article("필립스 MRI 국내 보도", { source: "스페셜타임스 (빙 검색)", url: "https://www.specialtimes.co.kr/news/1" });
  assert.equal(NewsRules.isDomesticMedia(domestic), true);
  assert.equal(NewsRules.isDomesticMedia(article("해외 번역", { source: "한국어 뉴스", url: "https://example.com/ko/1" })), false);
  const media = plain(api.mediaExposureRows(list));
  assert.deepEqual(media.map((r) => r.name), ["국제뉴스", "라포르시안"]);
  assert.match(api.companyShare(list), /50%/);
  const trend = api.companyTrend(list);
  assert.doesNotMatch(trend, /NaN/);
});

test("회사 행·열은 언급 수 내림차순이고 정렬 후에도 각 회사의 수치를 유지합니다", () => {
  const api = setup();
  const list = [article("GE헬스케어 CT 첫 공급"), article("GE헬스케어 MRI 공급"), article("지멘스 CT 공급"), article("캐논메디칼 MRI 공급")];
  const rows = api.topicExposureRows(list);
  const table = api.exposureTable(rows, "분야");
  const headers = [...table.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headers.slice(0, 4), ["분야", "GE", "캐논", "지멘스"]);
  const cells = table.match(/<th scope="row">CT<\/th>([\s\S]*?)<\/tr>/)[1];
  const numbers = [...cells.matchAll(/class="exposure-count">(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(numbers.slice(0, 3), [1, 0, 1]);
  const trend = api.companyTrend(list);
  assert.ok(trend.indexOf('class="trend-name">GE') < trend.indexOf('class="trend-name">캐논'));
  assert.equal(api.COMPANIES.find((c) => c.mine).name, "캐논");
});

test("매체 정렬은 캐논 노출량보다 경쟁사 기사 수를 우선하고 다중 언급 기사도 한 건으로 셉니다", () => {
  const api = setup();
  const list = [
    ...Array.from({ length: 8 }, () => article("캐논메디칼 MRI 공급", { source: "캐논 다수 매체" })),
    article("GE헬스케어 지멘스 필립스 MRI 공동 연구", { source: "공동 보도 매체" }),
    article("GE헬스케어 CT 공급", { source: "경쟁사 다수 매체" }),
    article("지멘스 MRI 공급", { source: "경쟁사 다수 매체 (빙 검색)" }),
  ];
  const rows = plain(api.mediaExposureRows(list));
  assert.deepEqual(rows.map((r) => r.name), ["경쟁사 다수 매체", "공동 보도 매체", "캐논 다수 매체"]);
  assert.deepEqual(rows.map((r) => r.competitorArticles), [2, 1, 0]);
});

test("비교할 기사가 없으면 빈 상태를 안내합니다", () => {
  const api = setup();
  const html = api.exposureComparisons([]);
  assert.match(html, /조건에 맞는 분야별 회사 언급 기사가 없습니다/);
  assert.match(html, /조건에 맞는 국내 매체별 회사 언급 기사가 없습니다/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("경쟁사 움직임은 최신 30일의 회수 이외 소식을 회사별로 묶고 출처를 보존합니다", () => {
  const api = setup();
  const rows = [
    article("지멘스 MRI 신제품 출시", { id: 1, entity: "지멘스", url: "https://example.com/1" }),
    article("지멘스 MRI 신제품 출시", { id: 2, entity: "지멘스", source: "다른 매체", url: "https://example.com/2" }),
    article("GE헬스케어 CT 공급 계약", { id: 3, entity: "GE헬스케어", url: "https://example.com/3" }),
    article("지멘스 MRI 제품 회수", { entity: "지멘스" }),
    article("필립스 MRI 출시", { entity: "필립스", hidden: true }),
    article("캐논메디칼 CT 공급", { category: "company" }),
    article("삼성메디슨 초음파 출시", { entity: "삼성메디슨", date: "2026-10-18" }),
  ];
  const result = api.competitorMovementRows(rows);
  assert.equal(result.length, 2);
  const siemens = result.find((row) => row.company === "지멘스");
  assert.equal(siemens.a.id, 2);assert.equal(siemens.others.length, 1);
  const html = api.competitorMovements(rows);
  assert.match(html, /경쟁사 움직임/);assert.match(html, /추가 출처 1건/);
  assert.match(html, /https:\/\/example.com\/1/);assert.match(html, /https:\/\/example.com\/2/);
  assert.doesNotMatch(html, /제품 회수|필립스|캐논메디칼|삼성메디슨/);
});

test("업계 동향 이동 바는 뉴스와 같은 디자인이며 경쟁사 움직임이 회수 현황보다 앞에 있습니다", () => {
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  const nav = html.match(/<nav class="summary-bar" id="industry-summary-bar"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]), ["industry-competitor", "industry-policy", "industry-hospital"]);
  assert.deepEqual([...nav.matchAll(/<\/span>([^<]+)<\/a>/g)].map((m) => m[1]), ["경쟁사", "정책", "병원"]);
  assert.ok(html.indexOf('id="stats-movements"') < html.indexOf('id="stats-competitor"'));
  assert.ok(html.indexOf('id="industry-competitor"') < html.indexOf('id="industry-policy"'));
  assert.ok(html.indexOf('id="industry-policy"') < html.indexOf('id="industry-hospital"'));
  for (const id of ["industry-competitor", "industry-policy", "industry-hospital"]) assert.ok(html.includes(`id="${id}"`));
  const api = setup([article("지멘스 MRI 신제품 출시", { entity: "지멘스" })]);
  assert.match(api.get("stats-movements").innerHTML, /지멘스 MRI 신제품 출시/);
});

test("경쟁사 카드는 최신 회사부터 표시하고 회사별 모든 소식을 간결한 행으로 모읍니다", () => {
  const api = setup();
  const rows = [
    article("지멘스 CT 100대 공급 계약", { entity: "지멘스", date: "2026-11-16", url: "https://example.com/1" }),
    article("지멘스 MRI 3.0T 신제품 출시", { entity: "지멘스", date: "2026-11-15", url: "https://example.com/2" }),
    article("지멘스 초음파 공장 투자", { entity: "지멘스", date: "2026-11-14", url: "https://example.com/3" }),
    article("지멘스 이사회 대표 선임", { entity: "지멘스", date: "2026-11-13", url: "https://example.com/4" }),
    article("GE헬스케어 CT FDA 승인", { entity: "GE헬스케어", url: "https://example.com/5" }),
  ];
  const html = api.competitorMovements(rows);
  assert.equal((html.match(/<article class="movement-card">/g) || []).length, 2);
  assert.equal((html.match(/class="movement-story"/g) || []).length, 5);
  assert.ok(html.indexOf('<h4>GE</h4>') < html.indexOf('<h4>지멘스</h4>'));
  assert.match(html, /최근 소식 4건/);
  assert.match(html, />CT 100대 공급 계약<|>CT 100대 공급 계약<\/a>/);
  assert.match(html, /이사회 대표 선임/);
  assert.match(html, /<time datetime="2026-11-16">11\/16<\/time>/);
  assert.match(html, /class="movement-row-sources"><a href="https:\/\/example.com\/1"/);
  assert.doesNotMatch(html, /movement-kind|movement-lead|movement-meta|movement-more|<table|<details/);
  const css = readFileSync(new URL('../static/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.movement-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css.slice(css.indexOf('@media(max-width:700px)')), /\.movement-grid\{grid-template-columns:1fr\}/);
});

test("카드 제목은 원문 사실과 전체 제목을 보존하며 HTML과 잘못된 원문 링크를 실행하지 않습니다", () => {
  const api = setup();
  const html = api.competitorMovements([
    article("GE HealthCare’s new MRI system launches worldwide", { entity: "GE Healthcare", url: "https://example.com/ge" }),
    article('필립스 <img src=x onerror=alert(1)> MRI 3.0T 출시', { entity: '필립스', url: 'javascript:alert(1)' }),
  ]);
  assert.match(html, /title="GE HealthCare’s new MRI system launches worldwide"/);
  assert.match(html, />new MRI system launches worldwide<\/a>/);
  assert.doesNotMatch(html, /<img|href="javascript:/);
  assert.match(html, /MRI 3.0T 출시/);
});
