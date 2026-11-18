import { test } from "node:test";
import assert from "node:assert/strict";
import { articleSourceName } from "../src/article-source.js";
import { articles, candidates } from "../src/service.js";
import { normalizeReport } from "../src/report.js";
import { buildBriefing } from "../src/briefing.js";
import { SOURCE_BY_ID } from "../src/settings.js";

const url = "https://www.example.com/news/1";
const excerpt = (changes = {}) => JSON.stringify({ format: "excerpt", source_id: "B001", first_paragraph: "MRI 장비 출시 소식입니다.", ...changes });
function database(rows) {
  return { DB: { prepare() { return { bind() { return this; }, async all() { return { results: rows.map((row) => ({ ...row })) }; } }; } } };
}

test("출처의 빙 검색 표시를 제거하고 매체명이 없으면 원문 사이트를 표시합니다", () => {
  assert.equal(articleSourceName("청년의사 (빙 검색)", url), "청년의사");
  assert.equal(articleSourceName("후생신보", url), "후생신보");
  assert.equal(articleSourceName("Yahoo Finance (빙 검색)", url), "Yahoo Finance");
  assert.equal(articleSourceName("빙 뉴스 검색: 캐논메디칼", url), "example.com");
  assert.equal(articleSourceName("", url), "example.com");
});

test("기존 기사와 제외 검토 API의 출처를 정리하고 월간 요약·브리핑에도 전달합니다", async () => {
  const row = { id: 1, title: "캐논메디칼 MRI 장비 출시", url, published_date: "2026-11-18",
    source: "청년의사 (빙 검색)", summary: excerpt() };
  const env = database([row]);
  const visible = await articles(env);
  assert.equal(visible[0].source, "청년의사");
  assert.equal((await articles(env, { includeExcluded: true }))[0].source, "청년의사");
  assert.equal(row.source, "청년의사 (빙 검색)");
  const report = normalizeReport(JSON.stringify({ trends: [{ text: "신제품 출시", sources: [1] }] }), visible);
  assert.equal(report.sections[0].items[0].sources[0].source, "청년의사");
  assert.doesNotMatch(buildBriefing(visible, "2026-11-18"), /빙 검색/);
});

test("수집 후보는 검색 정보원 이름 대신 실제 매체명 또는 사이트를 표시합니다", async () => {
  const source = SOURCE_BY_ID.B001;
  const rows = [
    { id: 1, source_id: source.id, source_name: source.name, title: "캐논메디칼 MRI 장비 출시", url, snippet: excerpt({ media: "후생신보" }) },
    { id: 2, source_id: source.id, source_name: source.name, title: "캐논메디칼 MRI 장비 공급", url: "https://www.other.com/2", snippet: excerpt() },
  ];
  const result = await candidates(database(rows), source.id);
  assert.equal(result[0].source_name, "후생신보");
  assert.equal(result[1].source_name, "other.com");
});
