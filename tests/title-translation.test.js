import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { translateTitle } from "../src/ai_summary.js";
import { needsTitleTranslation, translateExcerptTitle, translatedTitle } from "../src/title-translation.js";
import { readBody, articles, candidates } from "../src/service.js";
import { SOURCE_BY_ID, koreaNow } from "../src/settings.js";
import worker from "../src/index.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const db = { async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }, prepare(sql) {
    let args = [];
    const statement = { bind(...values) { args = values; return statement; },
      async run() { return { success: true, meta: sqlite.prepare(sql).run(...args) }; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
    return statement;
  } };
  return { sqlite, env: { DB: db, OPENAI_API_KEY: "test-key" } };
}

const reply = (title) => Response.json({ choices: [{ message: { content: title } }] });
const original = "キヤノン、医療用CT装置を発売";
const korean = "캐논, 의료용 CT 장비 출시";

test("일본어·영어·전각 제목만 번역 대상으로 삼고 한국어 제목은 유지합니다", () => {
  for (const title of [original, "Canon launches a new MRI system", "ＣＡＮＯＮ ＭＲＩ ＳＹＳＴＥＭ"]) assert.equal(needsTitleTranslation(title), true);
  for (const title of [korean, "캐논메디칼 MRI 장비 도입", "2026-11-16", ""]) assert.equal(needsTitleTranslation(title), false);
});

test("번역에는 제목만 보내고 원제·숫자·의료 약어 보존을 요청합니다", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /모든 숫자/);
    assert.match(body.messages[0].content, /CT, MRI, AI/);
    assert.deepEqual(JSON.parse(body.messages[1].content), { language: "ja", title: "キヤノン MRI 3T 装置発売" });
    return reply("캐논, MRI 3T 장비 출시");
  });
  assert.equal(await translateTitle({ OPENAI_API_KEY: "test" }, "キヤノン MRI 3T 装置発売", "ja"), "캐논, MRI 3T 장비 출시");
});

test("실패·숫자 변형·API 키 누락 시 원제를 유지하고 실패는 잠시 뒤 재시도합니다", async (t) => {
  const excerpt = { format: "excerpt", first_paragraph: "原文です。" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply("캐논, MRI 7T 장비 출시"); });
  const title = "Canon MRI 3T launch";
  const failed = await translateExcerptTitle({ OPENAI_API_KEY: "test" }, title, excerpt, "en");
  assert.equal(translatedTitle(failed, title), "");
  assert.ok(failed.title_translation.retry_after > Date.now());
  await translateExcerptTitle({ OPENAI_API_KEY: "test" }, title, failed, "en");
  assert.equal(calls, 1);
  assert.equal(await translateExcerptTitle({}, original, excerpt, "ja"), excerpt);
  await translateExcerptTitle({ OPENAI_API_KEY: "test" }, korean, excerpt, "ko");
  assert.equal(calls, 1);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("translation unavailable"); });
  assert.equal(translatedTitle(await translateExcerptTitle({ OPENAI_API_KEY: "test" }, original, excerpt, "ja"), original), "");
});

test("새 해외 기사는 번역을 저장하고 뉴스·수집 관리에는 한국어 제목과 원제를 제공합니다", async (t) => {
  const { sqlite, env } = database();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply(korean); });
  try {
    sqlite.prepare("INSERT INTO news_candidates(id,source_id,source_name,title,url,published_date,snippet,body_text) VALUES(1,'B013',?,?,?,?,?,?)").run(
      SOURCE_BY_ID.B013.name, original, "https://example.com/translated-ja", koreaNow().day,
      JSON.stringify({ format: "excerpt", first_paragraph: "医療機器のニュースです。", language: "ja" }), "医療機器のニュースです。",
    );
    assert.equal((await readBody(env, SOURCE_BY_ID.B013, 1)).error, "");
    const stored = sqlite.prepare("SELECT title,summary FROM articles").get();
    assert.equal(stored.title, original);
    assert.equal(JSON.parse(stored.summary).title_translation.ko, korean);
    const news = (await articles(env))[0];
    assert.equal(news.title, korean);
    assert.equal(news.original_title, original);
    assert.equal(news.category, "company");
    assert.equal(news.summary, "医療機器のニュースです。");
    assert.equal((await candidates(env, "B013"))[0].title, korean);
    sqlite.exec("UPDATE news_candidates SET body_fetched_at=NULL,snippet=json_set(snippet,'$.config_version','previous')");
    assert.equal((await readBody(env, SOURCE_BY_ID.B013, 1)).error, "");
    assert.equal(calls, 1);
  } finally { sqlite.close(); }
});

test("기존 해외 기사도 목록 응답을 막지 않고 번역 후 자동 재조회에 반영합니다", async (t) => {
  const { sqlite, env } = database();
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async () => { await blocked; return reply(korean); });
  const tasks = [];
  const ctx = { waitUntil(task) { tasks.push(task); } };
  t.after(() => release());
  try {
    sqlite.prepare("INSERT INTO articles(id,category,entity,published_date,source,title,url,summary) VALUES(50,'company','Canon',?,?,?,?,?)").run(
      koreaNow().day, "日本ニュース (빙 검색)", original, "https://example.com/existing-ja",
      JSON.stringify({ format: "excerpt", first_paragraph: "医療機器のニュースです。", source_id: "B013", language: "ja" }),
    );
    const first = await worker.fetch(new Request("http://localhost/api/articles"), env, ctx);
    const firstData = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstData.articles[0].title, original);
    assert.equal(firstData.title_refresh_pending, true);
    release();
    await Promise.all(tasks);
    const second = await worker.fetch(new Request("http://localhost/api/articles"), env, ctx);
    const secondData = await second.json();
    assert.equal(secondData.articles[0].title, korean);
    assert.equal(secondData.articles[0].original_title, original);
    assert.equal(secondData.title_refresh_pending, false);
    assert.equal(sqlite.prepare("SELECT title FROM articles WHERE id=50").get().title, original);
    await Promise.all(tasks);
  } finally { release(); sqlite.close(); }
});

test("원제가 바뀌면 이전 번역을 표시하지 않습니다", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply(calls === 1 ? korean : "캐논, 의료용 MRI 장비 출시"); });
  const excerpt = await translateExcerptTitle({ OPENAI_API_KEY: "test" }, original, { format: "excerpt" }, "ja");
  const changed = "キヤノン、医療用MRI装置を発売";
  assert.equal(translatedTitle(excerpt, changed), "");
  const updated = await translateExcerptTitle({ OPENAI_API_KEY: "test" }, changed, excerpt, "ja");
  assert.equal(translatedTitle(updated, changed), "캐논, 의료용 MRI 장비 출시");
  assert.equal(calls, 2);
});

test("기사 자세히에 원제를 표시하고 HTML로 실행하지 않습니다", () => {
  const shared = readFileSync(new URL("../static/news-rules.js", import.meta.url), "utf8");
  const script = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
  const card = runInNewContext(shared + "\n" + script.slice(0, script.indexOf("function render(){")) + "\ncard;", { impactControls() { return ""; } });
  const html = card({ id: 1, title: korean, original_title: '<img src=x onerror="alert(1)">', date: "2026-11-16",
    category: "company", entity: "Canon", source: "캐논 일본", url: "https://example.com/article", summary: "원문 첫 문단입니다.", tags: [] }, []);
  assert.match(html, /원제/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
});
