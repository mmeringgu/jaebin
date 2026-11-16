import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanArticleTitle, originalArticleTitle } from "../src/article-title.js";

test("후생신보 매체 표기만 제거하고 다른 대괄호 제목은 보존합니다", () => {
  const source = { kind: "whosaeng" };
  for (const label of ["[후생신보]", "【후생신보】", "［후생신보］", "[ 후생신보 ]"]) {
    assert.equal(cleanArticleTitle(label + " 캐논메디칼 MRI 신제품 공개", source), "캐논메디칼 MRI 신제품 공개");
  }
  assert.equal(cleanArticleTitle("[기획] MRI 도입 확대", source), "[기획] MRI 도입 확대");
  assert.equal(cleanArticleTitle("[후생신보] MRI 도입 확대", { kind: "bosa" }), "[후생신보] MRI 도입 확대");
  assert.equal(cleanArticleTitle("MRI 도입 확대 - [후생신보]", { url: "https://www.whosaeng.com/175230" }), "MRI 도입 확대");
  assert.equal(cleanArticleTitle("[후생신보] MRI 도입 확대", { source: "후생신보" }), "MRI 도입 확대");
});

test("원문 제목 메타데이터로 복원하며 본문이나 요약문을 제목으로 쓰지 않습니다", () => {
  const source = { kind: "whosaeng" };
  const page = `<meta content='[후생신보] 캐논메디칼 &quot;MRI 신제품&quot; 공개' property='og:title'>
    <dd class="body">【후생신보】 기사 본문에는 여러 키워드가 등장합니다.</dd>`;
  assert.equal(originalArticleTitle(page, source), '캐논메디칼 "MRI 신제품" 공개');
  assert.equal(originalArticleTitle('<meta name="twitter:title" content="[후생신보] MRI 도입 확대 소식">', source), "MRI 도입 확대 소식");
  assert.equal(originalArticleTitle('<dd class="body">[후생신보] MRI 도입 확대 기사 본문</dd>', source), "");
});
