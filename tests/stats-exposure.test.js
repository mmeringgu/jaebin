import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (name) => readFileSync(new URL(`../static/${name}.js`, import.meta.url), "utf8");
const articlesScript = read("articles");
const { matchesTopic } = runInNewContext(read("news-rules") + "\n" + articlesScript.slice(0, articlesScript.indexOf("function render(){")) + "\n({matchesTopic});");
const article = (title, changes = {}) => ({ title, date: "2026-11-17", category: "competitor", source: "라포르시안", tags: [], hidden: false, ...changes });
function setup(articles = []) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", checked: false, innerHTML: "", addEventListener() {} });
    return nodes.get(id);
  };
  const api = runInNewContext(read("stats") + "\n({topicExposureRows,mediaExposureRows,exposureComparisons,statsArticles,renderStats});", {
    document: { getElementById: get }, articles, matchesTopic,
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

test("노출 관리에 두 비교와 행 기준 점유율을 표시하며 매체 이름은 HTML로 실행하지 않습니다", () => {
  const api = setup([article("캐논메디칼 GE헬스케어 CT 협력", { source: '<img src=x onerror="alert(1)">' })]);
  const html = api.get("stats-company").innerHTML;
  assert.match(html, /분야별 회사 비교/);
  assert.match(html, /매체별 노출 비교/);
  assert.match(html, /50%/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.equal((html.match(/company-comparison/g) || []).length, 1);
});

test("비교할 기사가 없으면 빈 상태를 안내합니다", () => {
  const api = setup();
  const html = api.exposureComparisons([]);
  assert.match(html, /조건에 맞는 분야별 회사 언급 기사가 없습니다/);
  assert.match(html, /조건에 맞는 매체별 회사 언급 기사가 없습니다/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
