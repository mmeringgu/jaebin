import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("수집 관리에는 기사 직접 추가와 상세 점검만 두고 후보·제외 검토는 표시하지 않습니다", () => {
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="(?:excluded-articles-details|collection-details|collect-source|candidate-list)"|src="\/excluded.js"/);
  assert.match(html, /id="manual-article-details"/);
  assert.match(html, /<summary>상세 점검<\/summary>/);
  assert.ok(html.indexOf('id="manual-article-details"') > html.indexOf('id="source-collection-details"'));
  assert.ok(html.indexOf('id="manual-article-details"') < html.indexOf('id="exposure-management"'));
  assert.ok(html.indexOf('id="auto-distribution"') > html.indexOf('<summary>상세 점검</summary>'));
});
