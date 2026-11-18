import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { manualArticleUrl, manualMetadata, fetchManualArticle } from "../src/manual-article.js";
import { articles, excludedArticles, readBody, automationStatus } from "../src/service.js";
import { koreaNow } from "../src/settings.js";

const url = "https://www.example.com/news/1";
const page = `<html><head><meta property="og:title" content="캐논메디칼 MRI 신제품 공개">
<meta property="og:site_name" content="의료신문"><meta name="description" content="새로운 MRI 장비를 공개한 기사 첫 문단입니다.">
<meta property="article:published_time" content="2026-10-15T10:00:00+09:00"></head></html>`;
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const env = { DB: {
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
    prepare(sql) {
      let args = [];
      const query = { bind(...values) { args = values; return query; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
      }; return query;
    },
  } };
  const post = (path, data, origin = "http://localhost") => worker.fetch(new Request("http://localhost" + path, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data),
  }), env);
  return { sqlite, env, post };
}
const input = () => ({ url, title: "일반 기준에서는 제외되는 별도 기사", source: "의료신문", date: koreaNow().day,
  category: "policy", summary: "관리자가 직접 확인하고 추가하는 기사 첫 문단입니다." });

test("공개 기사 URL만 허용하고 추적 매개변수와 조각을 정리합니다", () => {
  assert.equal(manualArticleUrl(url + "?id=1&utm_source=feed#top"), url + "?id=1");
  for (const value of ["file:///a", "http://127.0.0.1/a", "http://[::1]/a", "http://localhost/a", "https://host.internal/a", "https://name:pass@example.com/", "https://example.com:9000/a"]) {
    assert.throws(() => manualArticleUrl(value));
  }
});

test("제목·매체·날짜·첫 문단·분류를 읽으며 없는 정보는 지어내지 않습니다", () => {
  const data = manualMetadata(page, url);
  assert.equal(data.title, "캐논메디칼 MRI 신제품 공개");
  assert.equal(data.source, "의료신문");
  assert.equal(data.date, "2026-10-15");
  assert.equal(data.category, "company");
  const incomplete = manualMetadata("<head><title>별도로 확인할 기사 제목</title></head>", url);
  assert.equal(incomplete.date, "");assert.equal(incomplete.summary, "");assert.equal(incomplete.category, "");
  const structured = manualMetadata('<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","headline":"구조화 데이터 기사 제목","datePublished":"2026-10-12","description":"구조화 데이터의 기사 첫 문단입니다.","publisher":{"name":"별도신문"}}]}</script>', url);
  assert.equal(structured.date, "2026-10-12");assert.equal(structured.source, "별도신문");
});

test("리다이렉트의 공개 주소 여부와 HTML 형식·크기를 검사합니다", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (target) => {
    paths.push(target);
    return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
  });
  await assert.rejects(fetchManualArticle(url), /공개된 기사/);
  assert.equal(paths.length, 1);
  globalThis.fetch = async () => new Response("binary", { headers: { "Content-Type": "application/pdf" } });
  await assert.rejects(fetchManualArticle(url), /공개된 기사 URL/);
  globalThis.fetch = async () => new Response("x".repeat(1500001), { headers: { "Content-Type": "text/html" } });
  await assert.rejects(fetchManualArticle(url), /너무 큽니다/);
});

test("URL 확인·직접 추가·중복 방지 및 공통 화면 반영이 동작합니다", async (t) => {
  const { sqlite, env, post } = database();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++;return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } }); });
  try {
    const preview = await post("/api/manual-article-preview", { url });
    assert.equal(preview.status, 200);assert.equal((await preview.json()).article.title, "캐논메디칼 MRI 신제품 공개");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 0);
    const response = await post("/api/manual-article", input());
    assert.equal(response.status, 201);
    const result = await articles(env);
    assert.equal(result.length, 1);assert.equal(result[0].manual, true);assert.equal(result[0].category, "policy");
    assert.equal((await excludedArticles(env)).length, 0);
    assert.equal((await automationStatus(env)).published_today, 1);
    const csv = await worker.fetch(new Request("http://localhost/api/export.csv"), env);
    assert.match(await csv.text(), /일반 기준에서는 제외되는 별도 기사/);
    assert.equal((await post("/api/manual-article", input())).status, 409);
    assert.equal((await post("/api/manual-article-preview", { url })).status, 409);
    assert.equal(requests, 1);
  } finally { sqlite.close(); }
});

test("잘못된 입력·분류·날짜와 다른 사이트의 추가 요청은 저장하지 않습니다", async () => {
  const { sqlite, post } = database();
  try {
    for (const change of [{ category: "unknown" }, { title: "짧음" }, { summary: "" }, { date: "2026-02-31" }, { date: "2099-01-01" }, { url: "javascript:alert(1)" }]) {
      assert.equal((await post("/api/manual-article", { ...input(), ...change })).status, 400);
    }
    assert.equal((await post("/api/manual-article", input(), "https://other.com")).status, 403);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 0);
  } finally { sqlite.close(); }
});

test("자동 재수집이 관리자가 직접 추가한 기사를 덮어쓰지 않습니다", async () => {
  const { sqlite, env, post } = database();
  try {
    assert.equal((await post("/api/manual-article", input())).status, 201);
    sqlite.prepare("INSERT INTO news_candidates(id,source_id,source_name,title,url,published_date,snippet,body_text) VALUES(1,'S012','청년의사',?,?,?,?,?)")
      .run("캐논메디칼 MRI 신제품 공개", url, koreaNow().day, JSON.stringify({ format: "excerpt", first_paragraph: "자동 수집의 다른 첫 문단입니다." }), "cached body");
    await readBody(env, { id: "S012", name: "청년의사", status: "사용", categories: ["company"] }, 1);
    const result = await articles(env);
    assert.equal(result[0].title, input().title);assert.equal(result[0].category, "policy");assert.equal(result[0].manual, true);
  } finally { sqlite.close(); }
});
