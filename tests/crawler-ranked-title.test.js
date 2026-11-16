import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("라포르시안 많이 본 기사 순위는 제외하고 제목의 실제 숫자는 보존합니다", async () => {
  const bundle = await build({
    stdin: { contents: `import { parseCandidates } from './src/crawler.js';
      import { SOURCE_BY_ID } from './src/settings.js';
      export default { async fetch(request) {
        return Response.json(await parseCandidates(await request.text(), SOURCE_BY_ID.S005));
      }};`, resolveDir: process.cwd() },
    bundle: true, write: false, format: "esm", platform: "browser",
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-09-01" }));
  try {
    const html = readFileSync(new URL("rapportian-ranked-title.html", import.meta.url), "utf8");
    const response = await runtime.dispatchFetch("https://example.com", { method: "POST", body: html });
    const rows = await response.json();
    const find = (id) => rows.find((row) => row.url.endsWith("idxno=" + id))?.title;
    assert.equal(find(241753), "내년부터 지역·필수의료 수가 2.7조 투입…검체·CT·MRI 검사비 2.6조 줄인다");
    assert.equal(find(990101), "2개 병원 CT 장비 도입…MRI 검사 2배 확대");
    assert.equal(find(990102), "MRI 검사비 2.6조 줄인다");
  } finally { await runtime.dispose(); }
});
