import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveArticleTitles } from "../src/title-resolver.js";
import { articles, candidates, visibleArticles } from "../src/service.js";
import worker from "../src/index.js";
import { readFileSync } from "node:fs";

test("라포르시안에 이미 저장된 순위 2는 원문 제목으로 복원하고 D1은 변경하지 않습니다", async (t) => {
  const correct = "내년부터 지역·필수의료 수가 2.7조 투입…검체·CT·MRI 검사비 2.6조 줄인다";
  const html = readFileSync(new URL("rapportian-241753-head.html", import.meta.url), "utf8");
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "https://www.rapportian.com/news/articleView.html?idxno=241753");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  });
  const row = { id: 77, title: "2 " + correct, source: "라포르시안", published_date: "2026-10-28",
    url: "https://www.rapportian.com/news/articleView.html?idxno=241753",
    summary: JSON.stringify({ format: "excerpt", source_id: "S005", first_paragraph: "기사의 첫 문단입니다." }) };
  const env = { DB: { prepare(sql) {
    assert.match(sql, /^SELECT /);
    return { bind() { return this; }, async all() { return { results: [{ ...row }] }; } };
  } } };
  assert.equal((await articles(env))[0].title, correct);
  assert.equal(row.title, "2 " + correct);
});

test("라포르시안의 숫자로 시작하는 실제 제목은 원문 확인 후에도 보존합니다", async (t) => {
  const title = "2 CT 장비 신규 도입하는 병원";
  t.mock.method(globalThis, "fetch", async () => new Response(`<meta property="og:title" content="${title}">`, { headers: { "Content-Type": "text/html" } }));
  const rows = [{ title, url: "https://www.rapportian.com/news/articleView.html?idxno=990103" }];
  assert.equal((await resolveArticleTitles(rows))[0].title, title);
});

test("기사 API는 원문 응답을 기다리지 않고 200을 반환하고 응답 뒤에 캐시를 갱신합니다", async (t) => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async () => {
    await blocked;
    return new Response('<meta property="og:title" content="≪후생신보≫ 캐논메디칼 MRI 실제 제목 복원">', { headers: { "Content-Type": "text/html" } });
  });
  const stored = { id: 10, title: "【후생신보】 캐논메디칼 MRI 장비를 병원에서 도입했다고 밝혔습니다.",
    source: "후생신보", url: "https://www.whosaeng.com/990005", published_date: "2026-11-16",
    summary: JSON.stringify({ format: "excerpt", source_id: "S018", first_paragraph: "본문입니다." }) };
  const env = { DB: { prepare(sql) {
    assert.doesNotMatch(sql, /^(UPDATE|INSERT|DELETE)/);
    return { bind() { return this; }, async run() { return { success: true }; }, async all() { return { results: [{ ...stored }] }; } };
  } } };
  const tasks = [];
  const ctx = { waitUntil(task) { tasks.push(task); } };
  let timeout;
  t.after(() => { release(); clearTimeout(timeout); });
  const response = await Promise.race([
    worker.fetch(new Request("https://example.com/api/articles"), env, ctx),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("원문 조회가 API 응답을 막았습니다.")), 1000); }),
  ]);
  clearTimeout(timeout);
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.title_refresh_pending, true);
  assert.match(first.articles[0].title, /장비를 병원에서/);
  release();
  await Promise.all(tasks);
  const next = await worker.fetch(new Request("https://example.com/api/articles"), env, ctx);
  const updated = await next.json();
  assert.equal(updated.articles[0].title, "캐논메디칼 MRI 실제 제목 복원");
  assert.equal(updated.title_refresh_pending, false);
  await Promise.all(tasks);
});

test("옛 기사 주소도 같은 원문 제목으로 복원하고 중복 조회하지 않습니다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return new Response('<meta property="og:title" content="≪후생신보≫ 동국대일산병원, 결핵·COPD 1등급">', { headers: { "Content-Type": "text/html" } });
  });
  const urls = ["https://www.whosaeng.com/sub_read.html?uid=175102", "http://whosaeng.com/read.php?uid=175102", "https://www.whosaeng.com/175102"];
  const rows = urls.map((url) => ({ url, title: "【후생신보】 동국대일산병원은 최근 결핵 관련 평가 결과를 발표했다." }));
  const resolved = await resolveArticleTitles(rows);
  assert.ok(resolved.every((row) => row.title === "동국대일산병원, 결핵·COPD 1등급"));
  assert.deepEqual(calls, ["https://www.whosaeng.com/175102"]);
});

test("처음 묶음 뒤에 있는 기존 기사도 다음 조회에서 이어 복원합니다", async (t) => {
  let fetched = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetched++;
    return new Response('<meta property="og:title" content="≪후생신보≫ 캐논메디칼 MRI 실제 기사 제목">', { headers: { "Content-Type": "text/html" } });
  });
  const rows = Array.from({ length: 12 }, (_, i) => ({ title: "【후생신보】 본문으로 잘못 저장된 기사입니다.", url: "https://www.whosaeng.com/" + (991000 + i) }));
  let state;
  await resolveArticleTitles(rows, { onState(value) { state = value; } });
  assert.deepEqual(state, { pending: 4, failed: 0 });
  const resolved = await resolveArticleTitles(rows, { onState(value) { state = value; } });
  assert.deepEqual(state, { pending: 0, failed: 0 });
  assert.equal(fetched, 12);
  assert.ok(resolved.every((row) => row.title === "캐논메디칼 MRI 실제 기사 제목"));
});

test("기존 본문형 제목을 원문으로 복원하고 캐시하며 D1에는 SELECT만 실행합니다", async (t) => {
  let fetched = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetched++;
    return new Response('<meta content="[후생신보] 캐논메디칼 MRI 장비 도입 확대" property="og:title">', { headers: { "Content-Type": "text/html; charset=utf-8" } });
  });
  const storedTitle = "【후생신보】 이 병원은 지난달부터 새로운 영상 장비를 운영한다고 밝혔습니다.";
  const row = { id: 1, title: storedTitle, source: "후생신보", source_id: "S018", source_name: "후생신보",
    url: "https://www.whosaeng.com/990001", published_date: "2026-11-16", hidden: 0,
    summary: JSON.stringify({ format: "excerpt", source_id: "S018", first_paragraph: "첫 문단입니다." }), snippet: "{}" };
  const sqls = [];
  const env = { DB: { prepare(sql) {
    sqls.push(sql);
    assert.match(sql, /^SELECT /);
    return { bind() { return this; }, async all() { return { results: [{ ...row }] }; } };
  } } };
  // 저장된 본문형 제목에는 키워드가 없어도 복원 후 실제 제목으로 선별합니다.
  assert.equal((await articles(env))[0].title, "캐논메디칼 MRI 장비 도입 확대");
  assert.equal((await visibleArticles(env))[0].title, "캐논메디칼 MRI 장비 도입 확대");
  assert.equal((await candidates(env, "S018"))[0].title, "캐논메디칼 MRI 장비 도입 확대");
  assert.equal(fetched, 1);
  assert.equal(row.title, storedTitle);
  assert.equal(sqls.length, 3);
});

test("원문 조회 실패는 기사 목록을 중단하지 않으며 실패를 짧게 캐시합니다", async (t) => {
  let fetched = 0;
  t.mock.method(globalThis, "fetch", async () => { fetched++; throw new Error("접속 차단"); });
  const rows = [{ title: "[후생신보] MRI 장비 도입 확대", source: "후생신보", url: "https://www.whosaeng.com/990002" }];
  assert.equal((await resolveArticleTitles(rows))[0].title, "MRI 장비 도입 확대");
  assert.equal((await resolveArticleTitles(rows))[0].title, "MRI 장비 도입 확대");
  assert.equal(fetched, 1);
});

test("후생신보 이외의 사이트는 원문을 조회하지 않습니다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("호출하면 안 됩니다."); });
  const rows = [{ title: "다른 매체 제목", url: "https://other.example/123" }];
  assert.deepEqual(await resolveArticleTitles(rows), rows);
});

test("Cache API의 제목을 읽어 새 원문 요청 없이 복원합니다", async (t) => {
  let fetched = 0;
  t.mock.method(globalThis, "fetch", async () => { fetched++; throw new Error("원문 요청 불필요"); });
  const url = "https://www.whosaeng.com/990003";
  const prior = Object.getOwnPropertyDescriptor(globalThis, "caches");
  t.after(() => { if (prior) Object.defineProperty(globalThis, "caches", prior); else delete globalThis.caches; });
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: {
    async match() { return Response.json({ [url]: { title: "캐논메디칼 MRI 원문 제목", expires: Date.now() + 60000 } }); },
  } } });
  const result = await resolveArticleTitles([{ title: "【후생신보】 본문 일부입니다.", url }]);
  assert.equal(result[0].title, "캐논메디칼 MRI 원문 제목");
  assert.equal(fetched, 0);
});
