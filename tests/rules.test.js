// 키워드 분류·기사 주소·날짜 읽기가 예전 파이썬 버전과 똑같이 동작하는지 확인합니다.
// 실행: npm test
// (기사 본문 읽기는 Cloudflare 전용 도구(HTMLRewriter)를 써서 여기서는 시험하지 않습니다. `npm run dev`로 확인하세요.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasWord, keywordMatch } from "../src/rules.js";
import { articleUrl, normalizedDate, text } from "../src/crawler.js";
import { addDays, koreaNow, SOURCE_BY_ID } from "../src/settings.js";

const source = SOURCE_BY_ID["S012"];

test("영어 키워드는 다른 단어 속에 섞이면 안 맞습니다", () => {
  assert.equal(hasWord("MRI 도입", "MRI"), true);
  assert.equal(hasWord("GEOMETRY", "GE"), false);
  assert.equal(hasWord("GE헬스케어 신제품", "GE"), true);
});

test("여러 카테고리가 맞으면 경쟁사가 먼저입니다", () => {
  assert.equal(keywordMatch("캐논메디칼 지멘스 MRI 협력", source)[0].category, "competitor");
});

test("제외 키워드가 있으면 고르지 않습니다", () => {
  assert.deepEqual(keywordMatch("캐논메디칼 프린터 공개", source), []);
});

test("메인 키워드만 맞으면 main 등급입니다", () => {
  assert.equal(keywordMatch("캐논메디칼 소식", source)[0].matchLevel, "main");
});

test("기사 주소는 필요한 값만 남기고, 다른 사이트 주소는 거릅니다", () => {
  assert.equal(
    articleUrl("/news/articleView.html?utm_source=x&idxno=123", source),
    "https://www.docdocdoc.co.kr/news/articleView.html?idxno=123",
  );
  assert.equal(articleUrl("https://evil.example/news/articleView.html?idxno=123", source), null);
  assert.equal(articleUrl("javascript:alert(1)", source), null);
  assert.equal(articleUrl("https://www.docdocdoc.co.kr:9000/news/articleView.html?idxno=123", source), null);
});

test("날짜를 읽고, 없는 날짜는 버립니다", () => {
  assert.equal(normalizedDate("2026-02-30"), null);
  assert.equal(normalizedDate("2026. 1. 2"), "2026-01-02");
  assert.equal(normalizedDate("2026-10-24T07:00:00+09:00"), "2026-10-24");
});

test("HTML 표시(&amp; 등)를 글자로 바꾸고 띄어쓰기를 정리합니다", () => {
  assert.equal(text("AI&middot;데이터 &amp;  &#39;의료&#39;\n 현장"), "AI·데이터 & '의료' 현장");
});

test("한국 시간 날짜 계산", () => {
  // 2026-11-02 23:30 UTC = 2026-11-03 08:30 한국 시간
  assert.deepEqual(koreaNow(Date.UTC(2026, 10, 2, 23, 30)), { day: "2026-11-03", hour: 8 });
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("[칼럼]·[기고] 같은 의견 글은 고르지 않습니다", () => {
  assert.deepEqual(keywordMatch("[칼럼] 지멘스 MRI 시장을 보며", source), []);
  assert.equal(keywordMatch("지멘스 MRI 신제품 공개", source).length > 0, true);
});

test("경쟁사 정식 이름(GE헬스케어·삼성메디슨 등)만 있어도 full 등급입니다", () => {
  assert.equal(keywordMatch("GE헬스케어, 신임 대표 선임", source)[0].matchLevel, "full");
  assert.equal(keywordMatch("삼성메디슨 3분기 실적 발표", source)[0].matchLevel, "full");
  // 짧은 이름("지멘스")만 있으면 보조 키워드가 있어야 full
  assert.equal(keywordMatch("지멘스 신임 대표 선임", source)[0].matchLevel, "main");
});

test("병원 보도자료 정보원은 목록에서 빠졌습니다", () => {
  for (const id of ["S023", "S024", "S025", "S026"]) assert.equal(SOURCE_BY_ID[id], undefined);
});
