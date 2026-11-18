import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { hasWord, keywordMatch } from "../src/rules.js";
import { assessArticle } from "../src/selection-policy.js";
import { parseBingRss } from "../src/crawler.js";
import { CONFIG, SOURCE_BY_ID } from "../src/settings.js";

const source = { status: "사용", categories: ["company", "competitor", "hospital", "policy"] };
const script = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
const { matchesTopic } = runInNewContext(script.slice(0, script.indexOf("function render(){")) + "\n({matchesTopic});", { NewsRules: globalThis.NewsRules });
const aliases = ["MRI", "ＭＲＩ", "자기공명영상", "자기공명영상장치", "자기공명장치", "자기공명촬영", "자기공명검사",
  "자기공명 영상", "자기공명 영상 장치", "자기 공명 영상 장치", "자기 공명 검사", "magnetic resonance", "Magnetic Resonance Imaging", "magnetic-resonance imaging"];

test("MRI 표현과 띄어쓰기 변형을 메인·필수 키워드, 선별, 화면 필터에 공통 적용합니다", () => {
  for (const alias of aliases) {
    const title = `${alias} 장비 도입 확대`;
    assert.equal(hasWord(title, "MRI"), true, alias);
    assert.ok(keywordMatch(title, source).some((r) => r.id === "K023"), alias);
    assert.equal(assessArticle(title, source).selected, true, alias);
    assert.equal(matchesTopic({ title }, "MRI"), true, alias);
  }
});

test("기존 누락 예시와 정책·회사·동물병원 기사를 올바르게 분류합니다", () => {
  for (const title of ["자기공명영상 장치 도입 확대", "자기 공명 영상 장치 도입 확대", "서울대병원, 자기공명영상장치 도입"]) {
    const result = assessArticle(title, source);
    assert.equal(result.selected, true, title);assert.equal(result.groups[0].category, "hospital");
  }
  const policy = assessArticle("자기공명영상 장비 허가 기준 개정", source);
  assert.equal(policy.selected, true);assert.equal(policy.groups[0].category, "policy");
  assert.ok(policy.groups.some((r) => r.id === "K015"));
  for (const [company, category] of [["지멘스", "competitor"], ["캐논", "company"]]) {
    const result = assessArticle(`${company}, 자기 공명 영상 장치 출시`, source);
    assert.equal(result.selected, true);assert.equal(result.level, "full");assert.equal(result.groups[0].category, category);
  }
  const title = "새봄동물병원, 자기 공명 영상 장치 도입";
  assert.equal(assessArticle(title, source).selected, true);
  assert.equal(matchesTopic({ title }, "Vet"), true);assert.equal(matchesTopic({ title }, "MRI"), true);
});

test("MRI가 단어 일부에 섞이거나 일반 설명·채용뿐이면 수집하지 않습니다", () => {
  for (const title of ["AMRI", "MRIPRO", "MRSA", "magnetic resonancefoo"]) {
    assert.equal(hasWord(title, "MRI"), false, title);
    assert.equal(matchesTopic({ title }, "MRI"), false, title);
  }
  assert.equal(hasWord("MR 음악 제작 연구", "MRI"), false);
  assert.equal(matchesTopic({ title: "MR 장비 도입" }, "MRI"), true); // 기존 화면의 MR 표기는 유지
  for (const title of ["자기공명영상 검사 방법 알아보기", "자기공명영상 전문의 채용", "MR 음악 제작 연구"]) {
    assert.equal(assessArticle(title, source).selected, false, title);
  }
});

test("일반·Vet·해외 검색에 MRI 동의어를 보강하고 검색원 수와 본문 한도를 유지합니다", () => {
  const q = (id) => new URL(SOURCE_BY_ID[id].listingUrl).searchParams.get("q");
  for (const id of ["B006", "B012", "B016"]) {
    assert.match(q(id), /MRI/);assert.match(q(id), /자기공명영상/);assert.match(q(id), /자기공명장치/);
    assert.match(q(id), /자기공명촬영/);assert.match(q(id), /자기공명검사/);assert.match(q(id), /자기 공명/);
  }
  assert.match(q("B006"), /특수의료장비/);assert.match(q("B006"), /magnetic resonance/);
  assert.match(q("B012"), /동물병원/);assert.match(q("B016"), /site:dailyvet.co.kr/);
  assert.match(q("B015"), /magnetic resonance/);assert.match(q("B013"), /磁気共鳴/);
  assert.equal(CONFIG.auto_order.length, 43);
  const rss = `<rss><channel><item><title>자기 공명 영상 장치 도입 확대</title>
    <link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Fmri</link>
    <pubDate>${new Date().toUTCString()}</pubDate><description>병원이 자기공명영상 장비를 도입하여 검사 역량을 확대했습니다.</description></item></channel></rss>`;
  const items = parseBingRss(rss, SOURCE_BY_ID.B006);
  assert.equal(items.length, 1);assert.equal(items[0].category, "hospital");
});
