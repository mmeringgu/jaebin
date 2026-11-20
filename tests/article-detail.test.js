import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { detailExcerpt } from "../src/article-excerpt.js";
import worker from "../src/index.js";

const script = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("../static/news-rules.js", import.meta.url), "utf8");
const { splitText, card } = runInNewContext(shared + "\n" + script.slice(0, script.indexOf("function render(){")) + "\n({splitText,card});", { impactControls: () => "" });
const first = "첫 문단이 짧은 기사입니다.";
const second = "두 번째 문단에는 병원 장비 도입 일정과 구체적인 사업 계획이 자세하게 설명되어 있습니다.";

test("기사 시작의 언론사·기자·지역 표기를 미리보기와 상세 내용에서 제거합니다", () => {
  for (const prefix of ["[메디컬투데이=홍길동 기자] ", "[싱글리스트] [김철수 기자] ", "(서울=연합뉴스) 홍길동 기자 = ", "(디지틀조선일보) ", "[서울] ", "【청년의사】 "]) {
    const row = { title: "기사 제목", source: "청년의사", summary: prefix + first, detail_text: prefix + first + "\n\n" + second };
    assert.equal(splitText(row).preview, first, prefix);
    assert.equal(splitText(row).rest, second, prefix);
    assert.equal(splitText({ ...row, subtitle: prefix + "장비 도입 확대" }).preview, "장비 도입 확대", prefix);
  }
  assert.equal(splitText({title:"기사 제목",source:"매체",summary:"[매체] "+first,detail_text:"(서울=연합뉴스) 홍길동 기자 = "+second}).rest, second);
});

test("본문의 의학 용어·설명 괄호와 문장 중간의 표기는 유지합니다", () => {
  for (const summary of ["[MRI] 장비를 새로 도입했습니다.", "(자기공명영상) 검사 장비를 도입했습니다.", "(AI 기반) 영상 판독을 시작했습니다.", "[임상 결과] 검사 정확도가 높아졌습니다.", "병원은 (서울 소재) 센터에 장비를 도입했습니다."]) {
    assert.equal(splitText({ title: "기사 제목", summary }).preview, summary);
  }
});

test("짧은 첫 문단 다음 내용을 보여주고 제목·미리보기는 반복하지 않습니다", () => {
  const article = { title: "기사 제목입니다", summary: first, detail_text: first + "\n\n" + second };
  assert.equal(splitText(article).preview, first);
  assert.equal(splitText(article).rest, second);
  assert.equal(splitText({ ...article, detail_text: article.title + " " + article.detail_text }).rest, second);
  assert.equal(splitText({ ...article, subtitle: "부제목" }).rest, article.detail_text);
  const long = { ...article, summary: second.repeat(4), detail_text: second.repeat(8) };
  const result = splitText(long);
  assert.ok(result.preview.length <= 92);
  assert.ok(result.rest.length > 100);
  assert.equal(splitText({ ...article, detail_text: first }).rest, "");
  const html = card({ ...article, detail_text: first, detail_loaded: true, tags: [], id: 1, date: "2026-11-18", entity: "", source: "매체", url: "https://example.com/1" }, []);
  assert.match(html, /확인된 본문은 위에 모두 표시/);
  const css = readFileSync(new URL("../static/style.css", import.meta.url), "utf8");
  assert.match(css, /-webkit-line-clamp:5/);
  assert.match(css, /\.detail-text\[hidden\].*display:none/);
});

test("상세 원문은 문단·문장 순서를 유지하고 1,000자로 제한합니다", () => {
  const text = detailExcerpt(["기사 제목입니다", "사진: 설명입니다", first, first, second.repeat(30)], "기사 제목입니다");
  assert.ok(text.startsWith(first + "\n\n"));assert.ok(text.length <= 1000);
  assert.doesNotMatch(text, /사진:|기사 제목/);
});

test("펼칠 때만 추가 본문을 요청하고 중복 요청 없이 안전하게 표시합니다", async () => {
  let toggle, requests = 0, release;
  const pending = new Promise((resolve) => { release = resolve; });
  const article = { id: 1, title: "기사 제목", summary: first };
  const status = {}, body = {};
  const details = { open: true, matches: () => true, getAttribute: () => "1", querySelector: (selector) => selector === ".detail-text" ? body : status };
  runInNewContext(readFileSync(new URL("../static/article-detail.js", import.meta.url), "utf8"), {
    articles: [article], splitText,
    document: { addEventListener(_name, handler) { toggle = handler; } },
    async fetch() { requests++;await pending;return Response.json({ text: first + "\n\n<script>원문 텍스트</script>" }); },
  });
  assert.equal(requests, 0);
  const one = toggle({ target: details }), two = toggle({ target: details });
  assert.equal(requests, 1);
  release();await one;await two;
  assert.equal(article.detail_loaded, true);
  assert.equal(body.textContent, "<script>원문 텍스트</script>");
  assert.equal(body.hidden, false);assert.equal(status.hidden, true);
  await toggle({ target: details });assert.equal(requests, 1);
});

test("실제 HTML에서 일반·등록 매체·캐논 공식 기사의 다음 문단을 읽습니다", async () => {
  const bundle = await build({ stdin: { contents: `
    import { articleDetails } from './src/crawler.js';
    import { canonArticleDetails } from './src/canon.js';
    import { genericDetailExcerpt } from './src/article-excerpt.js';
    export default { async fetch(request) { const i=await request.json();
      const result=i.kind==='generic'?await genericDetailExcerpt(i.page,i.title):i.kind==='canon'?
        (await canonArticleDetails(i.page,{canon_variant:'global'},'https://global.medical.canon/news/pressrelease/2026/2026-11-18/','2026-11-18')).excerpt.detail_text:
        (await articleDetails(i.page,{kind:'whosaeng'},i.title)).excerpt.detail_text;
      return Response.json(result); } };`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-09-01" }));
  try {
    const content = `<p>기사 제목입니다</p><figure><p>사진 설명은 제외합니다.</p></figure><p>${first}</p><p>${second}</p>`;
    for (const [kind, body] of [["generic", `<article>${content}<script>광고 스크립트</script></article>`], ["known", `<div id="textinput">${content}</div>`], ["canon", `<div class="cmp-text">${content}</div>`]]) {
      const page = `<meta property="article:published_time" content="2026-11-18">` + body;
      const response = await runtime.dispatchFetch("https://example.com", { method: "POST", body: JSON.stringify({ kind, page, title: "기사 제목입니다" }) });
      assert.equal(response.status, 200);
      const detail = await response.json();
      assert.ok(detail.includes(second), kind);
      if (kind !== "canon") assert.doesNotMatch(detail, /사진 설명|광고 스크립트/);
    }
  } finally { await runtime.dispose(); }
});

test("기존 검색 기사의 원문을 처음 펼칠 때 보완하고 이후 저장된 본문을 재사용합니다", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const summary = JSON.stringify({ format: "excerpt", source_id: "B001", first_paragraph: first, manual: true, manual_category: "policy" });
  sqlite.prepare("INSERT INTO articles(id,category,entity,published_date,source,title,url,summary) VALUES(1,'policy','','2026-11-18','매체','기사 제목입니다','https://example.com/1',?)").run(summary);
  sqlite.prepare("INSERT INTO news_candidates(source_id,source_name,title,url,snippet,body_text) VALUES('B001','검색','기사 제목입니다','https://example.com/1','{}',?)").run(first);
  const env = { DB: { prepare(sql) { let args = []; const query = { bind(...values) { args = values;return query; },
    async first() { return sqlite.prepare(sql).get(...args) || null; }, async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
  };return query; } } };
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++;return new Response('<script type="application/ld+json">'+JSON.stringify({ "@type": "NewsArticle", articleBody: first + "\n\n" + second })+'</script>', { headers: { "Content-Type": "text/html" } }); });
  try {
    const get = (id) => worker.fetch(new Request("http://localhost/api/article-detail?id=" + id), env);
    const r = await get(1);assert.equal(r.status, 200);assert.ok((await r.json()).text.includes(second));
    assert.equal((await get(1)).status, 200);assert.equal(requests, 1);
    const saved = JSON.parse(sqlite.prepare("SELECT summary FROM articles WHERE id=1").get().summary);
    assert.equal(saved.manual, true);assert.equal(saved.manual_category, "policy");assert.equal(saved.first_paragraph, first);
    assert.equal((await get(99)).status, 404);assert.equal((await get("1x")).status, 400);
    sqlite.prepare("UPDATE articles SET summary=? WHERE id=1").run(summary);
    globalThis.fetch = async () => { throw new Error("접속 차단"); };
    assert.equal((await get(1)).status, 422);
    assert.equal(sqlite.prepare("SELECT summary FROM articles WHERE id=1").get().summary, summary);
  } finally { sqlite.close(); }
});
