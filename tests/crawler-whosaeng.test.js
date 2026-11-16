import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { articles } from "../src/service.js";

test("실제 HTMLRewriter로 후생신보 제목 링크만 수집합니다", async () => {
  const bundle = await build({
    stdin: { contents: `import { parseCandidates } from './src/crawler.js';
      export default { async fetch(request) {
        return Response.json(await parseCandidates(await request.text(), {
          kind: 'whosaeng', url: 'https://www.whosaeng.com/', listingUrl: 'https://www.whosaeng.com/sub_view.html?type=abs', categories: ['company','policy','hospital','competitor']
        }));
      }};`, resolveDir: process.cwd() },
    bundle: true, write: false, format: "esm", platform: "browser",
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-09-01" }));
  try {
    const html = `<dl><dd class="title"><a href="/175999">[후생신보] 캐논메디칼 MRI 신제품 공개</a></dd>
      <dd class="body"><a href="/175999">【후생신보】 캐논메디칼 MRI 인공지능 영상진단 장비 도입 확대 본문입니다.</a></dd></dl>
      <dl><dd class="body"><a href="/175998">MRI 본문만 있는 링크는 수집하지 않습니다.</a></dd></dl>`;
    const response = await runtime.dispatchFetch("https://example.com", { method: "POST", body: html });
    const rows = await response.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "캐논메디칼 MRI 신제품 공개");
    const fixture = readFileSync(new URL("whosaeng-live.html", import.meta.url), "utf8");
    const liveRows = await (await runtime.dispatchFetch("https://example.com", { method: "POST", body: fixture })).json();
    assert.ok(liveRows.length > 0);
    assert.ok(liveRows.every((row) => !row.title.includes("【후생신보】")));
  } finally {
    await runtime.dispose();
  }
});

test("기존 DB 제목의 후생신보 표기도 API와 CSV 공통 조회에서 제거합니다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response('<meta property="og:title" content="[후생신보] 캐논메디칼 MRI 신제품 공개">', { headers: { "Content-Type": "text/html" } }));
  const row = { id: 1, title: "[후생신보] 캐논메디칼 MRI 신제품 공개", source: "후생신보",
    url: "https://www.whosaeng.com/175999", published_date: "2026-11-16",
    summary: JSON.stringify({ format: "excerpt", source_id: "S018", first_paragraph: "본문입니다." }) };
  const env = { DB: { prepare() { return { bind() { return this; }, async all() { return { results: [row] }; } }; } } };
  assert.equal((await articles(env))[0].title, "캐논메디칼 MRI 신제품 공개");
});
