import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { SOURCE_BY_ID, CONFIG, automationSettings, koreaNow, addDays } from "../src/settings.js";
import { articleUrl } from "../src/crawler.js";
import { keywordMatch } from "../src/rules.js";
import { assessArticle } from "../src/selection-policy.js";
import { officialDate, parseGeOfficial } from "../src/competitor-official.js";

const ids = ["S031", "S032", "S033"], day = koreaNow().day;
const dateLabel = new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const body = "The new MRI imaging system helps clinicians deliver detailed diagnostic images and improve patient care. ";
const geUrl = "https://www.gehealthcare.com/en/about/newsroom/press-releases/new-mri";
const philipsPath = `/a-w/about/news/archive/standard/news/press/${day.slice(0, 4)}/new-mri.html`;
const rss = (date = day, url = geUrl.replace("/en/", "/en-global/") + ".html?utm_source=RSS") => `<rss><channel><item><title>New MRI system launches worldwide</title><link>${url}</link><pubDate>${date}</pubDate><description>Not an article body</description></item></channel></rss>`;

test("공식 글로벌 출처는 경쟁사 3곳에만 추가하고 기존 자동수집과 한도를 유지합니다", () => {
  assert.deepEqual(CONFIG.sources.filter((s) => s.kind === "competitor_official").map((s) => s.id), ids);
  assert.equal(CONFIG.auto_order.length, 43);
  assert.equal(automationSettings({ AUTO_SOURCE_LIMIT: "43" }).sourceLimit, 43);
  assert.equal(automationSettings({ AUTO_MAX_BODY_PER_DAY: "160" }).maxBodies, 160);
  for (const id of ids) {
    assert.ok(CONFIG.auto_order.includes(id));
    assert.deepEqual(SOURCE_BY_ID[id].categories, ["competitor"]);
    assert.deepEqual(keywordMatch("New MRI system launches worldwide", SOURCE_BY_ID[id]).map((g) => g.id), [SOURCE_BY_ID[id].rule_id]);
  }
  assert.equal(assessArticle("Philips launches a new electric toothbrush", SOURCE_BY_ID.S033).selected, false);
  assert.equal(assessArticle("Philips delivers strong order intake growth and margin expansion in Q3", SOURCE_BY_ID.S033).selected, true);
  assert.equal(assessArticle("New MRI system launches worldwide", SOURCE_BY_ID.S033, { first_paragraph: body }).selected, true);
  assert.equal(assessArticle("Samsung Medison launches new ultrasound", { status: "사용", categories: ["competitor"] }).selected, true);
});

test("공식 기사 주소·날짜·언어 중복과 GE RSS 주소를 검증합니다", () => {
  assert.equal(officialDate("20261117000000"), "2026-11-17");
  assert.equal(officialDate("News article | November 17, 2026"), "2026-11-17");
  assert.equal(officialDate("20260231000000"), null);
  assert.equal(articleUrl("https://other.example/press/releases/new-mri", SOURCE_BY_ID.S032), null);
  assert.equal(articleUrl("/deu/press/releases/new-mri", SOURCE_BY_ID.S032), null);
  assert.equal(articleUrl("/press/releases", SOURCE_BY_ID.S032), null);
  assert.equal(articleUrl("/products/new-mri", SOURCE_BY_ID.S031), null);
  assert.equal(articleUrl("/a-w/about/news/archive/blogs/2026/consumer.html", SOURCE_BY_ID.S033), null);
  const items = parseGeOfficial(rss(), SOURCE_BY_ID.S031);
  assert.equal(items[0].url, geUrl);
  assert.equal(items[0].category, "competitor");
  assert.equal(items[0].description, undefined); // RSS 설명은 원문 본문으로 취급하지 않습니다.
  assert.equal(parseGeOfficial(rss(addDays(day, -31)), SOURCE_BY_ID.S031).length, 0);
  assert.equal(parseGeOfficial(rss(addDays(day, 1)), SOURCE_BY_ID.S031).length, 0);
  assert.equal(parseGeOfficial(rss(day, "https://other.example/en-global/about/newsroom/press-releases/new-mri.html"), SOURCE_BY_ID.S031).length, 0);
});

test("실제 Worker 파서와 DB로 3사 수집·본문·게시 및 지멘스 재요청 생략을 검증합니다", async () => {
  const bundle = await build({ stdin: { contents: `
    import { collectSource, readBody } from './src/service.js';
    import { loadCandidates } from './src/crawler.js';
    import { SOURCE_BY_ID } from './src/settings.js';
    export default { async fetch(request, env) {
      const i=await request.json(), source=SOURCE_BY_ID[i.id], calls=[];
      globalThis.fetch=async (url, options) => {
        calls.push({url:String(url),method:options?.method||'GET',payload:options?.body?JSON.parse(options.body):null});
        if(String(url).includes('api.scrivito.com')) return Response.json(i.api);
        return new Response(String(url)===source.listingUrl?i.list:i.page,{headers:{'Content-Type':String(url).endsWith('.xml')?'application/xml':'text/html'}});
      };
      try {
        if(i.action==='list') return Response.json({items:await loadCandidates(source),calls});
        const collected=await collectSource(env,source,true), result=await readBody(env,source);
        const article=await env.DB.prepare('SELECT * FROM articles WHERE source=?').bind(source.name).first();
        return Response.json({collected,result,article,calls});
      } catch(error) { return Response.json({error:error.message,calls}); }
    }};`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2025-09-01", d1Databases: ["DB"] }));
  const call = async (input) => (await runtime.dispatchFetch("https://example.com", { method: "POST", body: JSON.stringify(input) })).json();
  try {
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
    for (const sql of schema.split(";").filter((s) => s.trim())) await db.prepare(sql).run();
    const object = { _id: "article1", _permalink: "press/releases/new-mri", title: ["string", "New MRI system launches worldwide"],
      publish_date: ["date", day.replaceAll("-", "") + "000000"], _widget_pool: {
        a: { _obj_class: "TextAndMediaWidget", description: ["html", `<p>Short introduction.</p><p>${body.repeat(14)}</p>`] },
        b: { _obj_class: "ContactWidget", description: ["html", "This is a press contact and must not become body text."] },
      } };
    const api = { results: [{ id: object._id }], total: 1, objs: [object] };
    const philipsCard = `<div class="p-rn45__card"><a href="${philipsPath}"><p class="p-rn45__date">News article | ${dateLabel}</p><p class="p-rn45__title">Philips launches new MRI system</p></a></div>`;
    const fixtures = [
      { id: "S031", list: rss(), page: `<meta property="og:title" content="GE HealthCare’s new MRI system launches worldwide"><div class="ge-body-copy"><p>${body}</p><p>${body.repeat(14)}</p></div>` },
      { id: "S032", api },
      { id: "S033", list: philipsCard + philipsCard, page: `<p>Unrelated navigation text</p><div class="p-body-copy-01"><p>${body}</p><p>${body.repeat(14)}</p></div>` },
    ];
    for (const fixture of fixtures) {
      const r = await call(fixture);
      assert.equal(r.error, undefined, JSON.stringify(r));
      assert.equal(r.collected.saved, 1);
      assert.equal(r.result.error, "");
      assert.equal(r.article.category, "competitor");
      if (fixture.id === "S031") assert.equal(r.article.title, "GE HealthCare’s new MRI system launches worldwide");
      assert.equal(r.article.published_date, day);
      const excerpt = JSON.parse(r.article.summary);
      assert.equal(excerpt.language, "en");
      assert.ok(excerpt.detail_text.length > 900 && excerpt.detail_text.length <= 1000);
      assert.ok(!excerpt.detail_text.includes("press contact"));
      assert.equal(r.calls.length, fixture.id === "S032" ? 1 : 2);
      if (fixture.id === "S032") {
        const q = r.calls[0].payload;
        assert.equal(q.size, 30);
        assert.ok(q.query.some((x) => x.field === "_path" && x.value === "/en/press/releases/"));
        assert.ok(q.query.some((x) => x.field === "publish_date"));
      }
    }
    const missing = await call({ id: "S032", action: "list", api: { results: [{ id: "missing" }], objs: [] } });
    assert.match(missing.error, /불완전/);
    const empty = await call({ id: "S032", action: "list", api: { results: [], total: 0 } });
    assert.deepEqual(empty.items, []);
  } finally { await runtime.dispose(); }
});
