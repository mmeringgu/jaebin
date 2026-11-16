import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { CONFIG, SOURCE_BY_ID, koreaNow, addDays } from "../src/settings.js";
import { articleUrl, parseBingRss } from "../src/crawler.js";
import { canonDate } from "../src/canon.js";
import { collectSource, readBody, articles, candidates } from "../src/service.js";
import "../static/news-rules.js";

const ids = ["S028", "S029", "S030", "B013", "B014", "B015"];
const day = koreaNow().day;
const compact = day.replaceAll("-", "");
const year = day.slice(0, 4);
const englishDate = new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

test("공식 3곳과 일본어·영문 검색 3곳이 모두 예약 수집에 포함됩니다", () => {
  assert.ok(CONFIG.auto_order.length <= 40);
  assert.equal(new Set(CONFIG.sources.map((source) => source.id)).size, CONFIG.sources.length);
  for (const id of ids) {
    assert.ok(SOURCE_BY_ID[id]);
    assert.ok(CONFIG.auto_order.slice(0, 24).includes(id), id);
    assert.deepEqual(SOURCE_BY_ID[id].categories, ["company"]);
  }
  assert.equal(new URL(SOURCE_BY_ID.B013.listingUrl).searchParams.get("cc"), "JP");
  assert.equal(new URL(SOURCE_BY_ID.B013.listingUrl).searchParams.get("setlang"), "ja");
  for (const id of ["B014", "B015"]) assert.equal(new URL(SOURCE_BY_ID[id].listingUrl).searchParams.get("setlang"), "en");
});

test("공식 기사 주소만 허용하고 목록·제품·외부 주소를 제외합니다", () => {
  assert.ok(articleUrl(`/about/pressrelease/${year}/${day}/`, SOURCE_BY_ID.S028));
  assert.ok(articleUrl(`/about/apology-and-notice-${compact}/`, SOURCE_BY_ID.S028));
  assert.ok(articleUrl(`/news/pressrelease/${year}/${day}/`, SOURCE_BY_ID.S029));
  assert.ok(articleUrl(`/ja/news/${year}/${compact}.html`, SOURCE_BY_ID.S030));
  assert.equal(articleUrl("/about/corporate/", SOURCE_BY_ID.S028), null);
  assert.equal(articleUrl("/products/ct/", SOURCE_BY_ID.S028), null);
  assert.equal(articleUrl("https://other.example/about/20261116/", SOURCE_BY_ID.S028), null);
});

test("캐논 공식 일본어·영문 목록과 본문을 실제 HTMLRewriter로 읽습니다", async () => {
  const bundle = await build({
    stdin: { contents: `import { parseCanonCandidates, canonArticleDetails } from './src/canon.js';
      import { SOURCE_BY_ID } from './src/settings.js';
      export default { async fetch(request) {
        const input=await request.json(); const source=SOURCE_BY_ID[input.id];
        return Response.json(input.action==='detail'
          ? await canonArticleDetails(input.page,source,input.url,input.dateHint)
          : await parseCanonCandidates(input.page,source));
      }};`, resolveDir: process.cwd() },
    bundle: true, write: false, format: "esm", platform: "browser",
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-09-01" }));
  const parse = async (id, page, extra = {}) => {
    const response = await runtime.dispatchFetch("https://example.com", { method: "POST", body: JSON.stringify({ id, page, ...extra }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const jpRow = (date, path, title) => `<div class="cmp-top-news-list__row"><div class="cmp-top-news-list__cell--date">${date}</div>
      <a class="cmp-top-news-list__link" href="${path}">${title}</a></div>`;
    const jp = await parse("S028", jpRow(englishDate, `/about/${compact}/`, "製品供給に関する重要なお知らせ")
      + jpRow(englishDate, `/about/php-${compact}/`, "PHPの脆弱性問題に関するお知らせ")
      + jpRow(addDays(day, -91), "/about/20200101/", "以前の製品供給に関するお知らせ")
      + jpRow(englishDate, "/products/ct/", "超音波診断装置の製品ページ")
      + jpRow(englishDate, "https://other.example/about/20261116/", "外部サイトの製品紹介ページ"));
    assert.equal(jp.length, 1);
    assert.equal(jp[0].title, "製品供給に関する重要なお知らせ");
    assert.equal(jp[0].date, day);
    assert.equal(jp[0].category, "company");

    const global = await parse("S029", `<a class="cmp-news-release-list__item-link" href="/news/pressrelease/${year}/${day}/">
      <div class="cmp-news-release-list__item-date">${englishDate}</div>
      <div class="cmp-news-release-list__item-title">Launch of a new diagnostic ultrasound system</div>
      <div class="cmp-news-release-list__item-desc">Canon has announced a new ultrasound system for healthcare professionals.</div></a>`);
    assert.equal(global[0].title, "Launch of a new diagnostic ultrasound system");
    assert.match(global[0].description, /^Canon has/);
    assert.equal(global[0].category, "company");

    const hqRow = (path, title) => `<a class="mNewsList__each" href="${path}"><p class="mNewsList__date">${year}年${Number(day.slice(5, 7))}月${Number(day.slice(8))}日</p>
      <h3 class="mNewsList__index">${title}</h3></a>`;
    const hq = await parse("S030", hqRow(`/ja/news/${year}/${compact}.html`, "新型の医療用CT装置を発売")
      + hqRow(`/ja/news/${year}/${compact}-2.html`, "新型のオフィス用プリンターを発売"));
    assert.equal(hq.length, 1);
    assert.equal(hq[0].title, "新型の医療用CT装置を発売");

    const jpText = "医療機器の供給体制を改善し、医療現場への安定供給を実現するために、関係各所と協力して対応を進めています。";
    const detail = await parse("S028", `<meta name="date" content="Thu, 28 May 2026 00:00:00 +0900"><div class="cmp-text"><p>${jpText}</p></div>`,
      { action: "detail", url: `https://jp.medical.canon/about/${compact}/`, dateHint: day });
    assert.equal(detail.date, day);
    assert.equal(detail.excerpt.first_paragraph, jpText);
    assert.equal(detail.excerpt.language, "ja");

    const enText = "Canon has introduced a new diagnostic imaging system to help clinicians deliver patient care.";
    const en = await parse("S029", `<meta name="description" content="${enText}">`,
      { action: "detail", url: `https://global.medical.canon/news/pressrelease/${year}/${day}/` });
    assert.equal(en.date, day);
    assert.equal(en.excerpt.first_paragraph, enText);
    assert.equal(en.excerpt.language, "en");

    const hqDetail = await parse("S030", `<p class="mText__regular">This is outside the article and must not be used as its first paragraph.</p>
      <div class="mNewsDetailBlock"><p class="mText__regular">${jpText}</p></div>`,
      { action: "detail", url: `https://global.canon/ja/news/${year}/${compact}.html` });
    assert.equal(hqDetail.excerpt.first_paragraph, jpText);
  } finally { await runtime.dispose(); }
});

test("날짜 시차를 보존하고 서로 다른 일본어 제목을 CT만 보고 합치지 않습니다", () => {
  assert.equal(canonDate("Thu, 28 May 2026 00:00:00 +0900"), "2026-05-28");
  assert.equal(canonDate("2026年5月28日"), "2026-05-28");
  const rows = ["新型検出器で患者の被ばく低減を目指すCT", "物流網を見直し海外向け工場の供給を改善するCT"].map((title, i) => ({ id: i, title, date: day, tags: [] }));
  assert.equal(globalThis.NewsRules.groupSameNews(rows).length, 2);
});

test("해외 RSS의 일본어·영어 기사를 수집하고 원문 그대로 게시합니다", async (t) => {
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
  const env = { DB: db };
  let calls = 0;
  const makeRss = (title, description, url) => `<rss><channel><item><title>${title}</title><link>https://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(url)}</link>
    <pubDate>${new Date().toUTCString()}</pubDate><description>${description}</description><News:Source>Medical News</News:Source></item></channel></rss>`;
  const fixtures = [
    ["B013", "キヤノン、医療用CTの供給体制を強化", "医療機器の供給体制に関するニュースです。", "https://example.com/canon-ja"],
    ["B014", "Canon Medical launches ultrasound system", "A new ultrasound system for healthcare professionals.", "https://example.com/canon-en"],
  ];
  try {
    for (const [id, title, description, url] of fixtures) {
      const rss = makeRss(title, description, url);
      assert.equal(parseBingRss(rss, SOURCE_BY_ID[id])[0].category, "company");
      t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(rss, { headers: { "Content-Type": "application/xml" } }); });
      await collectSource(env, SOURCE_BY_ID[id], true);
      assert.equal((await readBody(env, SOURCE_BY_ID[id])).error, "");
      const visible = (await articles(env)).find((row) => row.url === url);
      assert.equal(visible.title, title);
      assert.equal(visible.summary, description);
      assert.equal(visible.category, "company");
      const candidate = (await candidates(env, id)).find((row) => row.url === url);
      assert.equal(candidate.title, title);
      assert.equal(candidate.selection.level, "full");
      t.mock.restoreAll();
    }
    assert.equal(calls, 2); // 원문 재요청이나 번역 API 호출은 없습니다.
  } finally { sqlite.close(); }
});

test("해외 뉴스 검색은 최근 30일을 보고 기존 국내 검색은 7일 기준을 유지합니다", () => {
  const rss = (age) => `<rss><channel><item><title>Canon Medical launches ultrasound system</title>
    <link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Fmedical</link>
    <pubDate>${new Date(Date.now() - age * 86400000).toUTCString()}</pubDate>
    <description>A new ultrasound system for healthcare professionals.</description></item></channel></rss>`;
  assert.equal(parseBingRss(rss(14), SOURCE_BY_ID.B014).length, 1);
  assert.equal(parseBingRss(rss(14), SOURCE_BY_ID.B001).length, 0);
  assert.equal(parseBingRss(rss(40), SOURCE_BY_ID.B014).length, 0);
});
