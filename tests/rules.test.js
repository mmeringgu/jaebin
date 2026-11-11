// 키워드 분류·기사 주소·날짜 읽기가 예전 파이썬 버전과 똑같이 동작하는지 확인합니다.
// 실행: npm test
// (기사 본문 읽기는 Cloudflare 전용 도구(HTMLRewriter)를 써서 여기서는 시험하지 않습니다. `npm run dev`로 확인하세요.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasWord, keywordMatch } from "../src/rules.js";
import { articleUrl, normalizedDate, text } from "../src/crawler.js";
import { addDays, koreaNow, SOURCE_BY_ID } from "../src/settings.js";

const source = SOURCE_BY_ID["S012"];

test("수상·소아응급실·주가는 모든 카테고리에서 제외합니다", () => {
  for (const title of [
    "캐논메디칼 MRI 기술 수상",
    "삼성메디슨 주가 상승",
    "소아응급실 CT 급여 변경",
    "의대 신설 및 소아응급실 확충",
    "인공지능 영상분석 기술 수상",
  ]) assert.deepEqual(keywordMatch(title, source), [], title);
  assert.ok(keywordMatch("캐논메디칼 MRI 기술 공개", source).length > 0);
  assert.ok(keywordMatch("CT 급여 변경", source).length > 0);
});

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

test("의료 AI는 지정한 다섯 조합의 두 단어가 제목에 함께 있으면 선별합니다", () => {
  for (const [main, auxiliary] of [
    ["인공지능", "영상판독"], ["AI", "영상판독"], ["인공지능", "영상진단"],
    ["인공지능", "영상분석"], ["AI", "영상분석"],
  ]) {
    for (const title of [`${main} 기반 ${auxiliary} 기술 공개`, `${auxiliary} 정확도 높이는 ${main}`]) {
      const matched = keywordMatch(title, source).find((rule) => rule.id === "K013");
      assert.ok(matched, title);
      assert.equal(matched.matchLevel, "full", title);
    }
  }
});

test("의료 AI 일반 기사나 조합의 한 단어만 있는 기사는 선별하지 않습니다", () => {
  for (const title of [
    "의료 AI 상담 서비스 도입", "의료영상 AI 투자 확대", "인공지능 신제품 공개",
    "AI 신제품 공개", "영상판독 기술 공개", "영상진단 기술 공개", "영상분석 기술 공개",
    "AI 영상진단 기술 공개", "RAIL 영상분석 기술 공개",
  ]) assert.deepEqual(keywordMatch(title, source), [], title);
  assert.equal(keywordMatch("ai 영상분석 기술 공개", source)[0].id, "K013");
});

test("의료 AI 조합에도 정보원 카테고리와 의견 기사 제외 조건을 적용합니다", () => {
  assert.deepEqual(keywordMatch("[칼럼] AI 영상판독의 미래", source), []);
  assert.deepEqual(keywordMatch("AI 영상판독 기술 공개", { ...source, categories: ["hospital"] }), []);
  assert.equal(keywordMatch("의료기기법 개정 시행", source)[0].id, "K012");
  assert.equal(keywordMatch("캐논메디칼 MRI 신제품 공개", source)[0].category, "company");
});

test("의대와 신설이 제목에 함께 있으면 병원 카테고리로 선별합니다", () => {
  for (const title of ["지역 의대 신설 추진", "신설 의대 설립 논의"]) {
    const matched = keywordMatch(title, source).find((rule) => rule.id === "K014");
    assert.ok(matched, title);
    assert.equal(matched.category, "hospital");
    assert.equal(matched.matchLevel, "full");
  }
  for (const title of ["의대 교육 개선", "새 학과 신설 추진"]) {
    assert.equal(keywordMatch(title, source).some((rule) => rule.id === "K014"), false, title);
  }
});

test("영상검사 급여·수가·심평원 관련 열한 조합을 정책 카테고리로 선별합니다", () => {
  for (const [first, second] of [
    ["CT", "급여"], ["MRI", "급여"], ["MRI", "수가"], ["CT", "수가"],
    ["초음파", "급여"], ["초음파", "수가"], ["영상검사", "수가"],
    ["심평원", "CT"], ["심평원", "MRI"], ["심평원", "초음파"],
    ["영상검사", "급여기준"],
  ]) {
    for (const title of [`${first} ${second} 변경 안내`, `${second} 관련 ${first} 논의`]) {
      const matched = keywordMatch(title, source).find((rule) => rule.id === "K015");
      assert.ok(matched, title);
      assert.equal(matched.category, "policy");
      assert.equal(matched.matchLevel, "full");
    }
  }
});

test("새 조합은 두 단어가 모두 필요하며 기존 제외 조건을 지킵니다", () => {
  for (const title of ["CT 기술 소개", "MRI 기술 소개", "초음파 기술 소개", "영상검사 안내", "급여 변경 안내", "수가 논의", "심평원 안내", "ACT 급여 안내"]) {
    assert.equal(keywordMatch(title, source).some((rule) => rule.id === "K015"), false, title);
  }
  assert.deepEqual(keywordMatch("[칼럼] 의대 신설 논의", source), []);
  assert.deepEqual(keywordMatch("[기고] CT 급여 변경", source), []);
  assert.deepEqual(keywordMatch("CT 급여 개인 보험 광고", source), []);
  assert.deepEqual(keywordMatch("의대 신설 추진", { ...source, categories: ["policy"] }), []);
  assert.deepEqual(keywordMatch("CT 급여 변경", { ...source, categories: ["hospital"] }), []);
});
