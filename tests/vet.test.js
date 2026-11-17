import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { keywordMatch, articleTags } from "../src/rules.js";
import { parseBingRss } from "../src/crawler.js";
import { CONFIG, SOURCE_BY_ID } from "../src/settings.js";

const source = SOURCE_BY_ID.S012;
const shared = readFileSync(new URL("../static/news-rules.js", import.meta.url), "utf8");
const screen = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
const { matchesTopic } = runInNewContext(shared + "\n" + screen.slice(0, screen.indexOf("function render(){")) + "\n({ matchesTopic });");

test("수의 맥락과 영상 장비·진단 맥락을 함께 가진 기사를 수집하고 Vet로 필터링합니다", () => {
  for (const context of ["수의", "동물의료센터", "동물 의료센터", "동물의료 센터", "동물 의료 센터", "동물병원", "동물 병원", "수의대", "수의과대학", "수의과 대학", "수의 대학", "반려동물", "반려견", "반려묘", "강아지", "고양이", "veterinary", "veterinarian", "vet", "animal", "canine", "feline"]) {
    for (const image of ["CT", "MRI", "MR", "초음파", "영상진단", "영상 판독", "영상의학", "엑스레이", "X-ray", "방사선 촬영", "자기공명", "ultrasound", "radiology"]) {
      const title = `${context} ${image} 진단 기술 도입`;
      const groups = keywordMatch(title, source);
      const vet = groups.find((rule) => rule.id === "K018");
      assert.ok(vet, title);
      assert.equal(vet.matchLevel, "full", title);
      assert.equal(vet.category, "hospital");
      assert.ok(articleTags(groups).includes("Vet"));
      assert.equal(matchesTopic({ title, tags: articleTags(groups) }, "Vet"), true, title);
    }
  }
});

test("동물 일반·수의계약·사람용 영상 기사와 영어 단어 일부를 Vet로 잘못 분류하지 않습니다", () => {
  for (const title of [
    "반려동물 사료 신제품 공개", "동물병원 진료비 안내", "반려견 홍보 영상 공개",
    "반려동물 AI 상담 서비스 도입", "수의계약으로 MRI 공급", "CT 장비 수의 계약 체결",
    "서울대병원 MRI 도입", "PET-CT 검사 도입", "private MRI investment 확대", "동물병원 ACT 프로그램 도입",
  ]) {
    assert.equal(keywordMatch(title, source).some((rule) => rule.id === "K018"), false, title);
    assert.equal(matchesTopic({ title, tags: [] }, "Vet"), false, title);
  }
  assert.deepEqual(keywordMatch("[칼럼] 수의 CT 진단의 미래", source), []);
  assert.equal(keywordMatch("동물병원 MRI 전문의 채용", source).some((rule) => rule.id === "K018"), false);
  assert.equal(keywordMatch("동물병원 MRI 도입", { ...source, categories: ["policy"] }).some((rule) => rule.id === "K018"), false);
});

test("필수의료 영상 기사는 정책으로 분류하고 Vet에서는 제외합니다", () => {
  const original = readFileSync(new URL("rapportian-241753-head.html", import.meta.url), "utf8")
    .match(/property="og:title" content="([^"]+)"/)[1];
  for (const title of [original, "2 " + original, "필수의료 CT 수가 개선", "지역필수의료 MRI 검사비 조정"]) {
    const groups = keywordMatch(title, SOURCE_BY_ID.S005);
    assert.equal(groups[0]?.category, "policy", title);
    assert.equal(groups.some((rule) => rule.id === "K018"), false, title);
    assert.equal(articleTags(groups).includes("Vet"), false, title);
    assert.equal(matchesTopic({ title, tags: articleTags(groups) }, "Vet"), false, title);
  }
  // 필수의료가 함께 있어도 실제 수의학 표현까지 제외하지 않습니다.
  for (const title of ["필수의료와 수의 영상진단 CT 연구", "필수의료 논의와 동물병원 MRI 도입"]) {
    assert.ok(keywordMatch(title, source).some((rule) => rule.id === "K018"), title);
    assert.equal(matchesTopic({ title }, "Vet"), true, title);
  }
});

test("수의 영상 경쟁사 기사는 기존 경쟁사 분류를 유지하면서 Vet와 MRI에도 표시합니다", () => {
  const title = "GE헬스케어, 동물병원 MRI 장비 공급";
  const groups = keywordMatch(title, source);
  assert.equal(groups[0].category, "competitor");
  assert.equal(matchesTopic({ title, tags: articleTags(groups) }, "Vet"), true);
  assert.equal(matchesTopic({ title, tags: articleTags(groups) }, "MRI"), true);
});

test("Vet 검색원이 예약 순서에 포함되고 RSS 결과가 수집 후보가 됩니다", () => {
  for (const id of ["B011", "B012"]) {
    const vetSource = SOURCE_BY_ID[id];
    assert.equal(vetSource.kind, "bing");
    assert.ok(CONFIG.auto_order.slice(0, 40).includes(id));
    const query = new URL(vetSource.listingUrl).searchParams.get("q");
    for (const word of ["동물의료센터", "동물병원", "수의대", "수의과대학"]) assert.ok(query.includes(word), id + " " + word);
    const rss = `<rss><channel><item><title>반려동물 초음파 영상진단 기술 공개</title>
      <link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Fvet-news</link>
      <pubDate>${new Date().toUTCString()}</pubDate><description>동물병원 영상진단에 관한 기사 첫 문단입니다.</description>
      <News:Source>수의 뉴스</News:Source></item></channel></rss>`;
    const rows = parseBingRss(rss, vetSource);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].groups.includes("K018"));
    assert.equal(rows[0].matchLevel, "full");
  }
  assert.equal(new Set(CONFIG.sources.map((s) => s.id)).size, CONFIG.sources.length);
});

test("기관 이름과 CT·MRI·초음파의 순서에 관계없이 수집하고 Vet로 분류합니다", () => {
  const vetSource = SOURCE_BY_ID.B012;
  for (const institution of ["동물의료센터", "동물병원", "수의대", "수의과대학"]) {
    for (const device of ["CT", "MRI", "초음파"]) {
      for (const title of [`${institution}, ${device} 진단 장비 도입`, `${device} 도입한 ${institution}, 진료 확대`]) {
        const rss = `<rss><channel><item><title>${title}</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Fvet</link>
          <pubDate>${new Date().toUTCString()}</pubDate><description>수의 영상진단 기사 첫 문단입니다.</description></item></channel></rss>`;
        const rows = parseBingRss(rss, vetSource);
        assert.equal(rows.length, 1, title);
        assert.ok(rows[0].groups.includes("K018"), title);
        assert.equal(rows[0].matchLevel, "full");
        assert.equal(matchesTopic({ title }, "Vet"), true, title);
      }
    }
  }
});

test("뉴스 분야에 Vet를 유지하고 업계 동향의 분야 필터는 제거합니다", () => {
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  for (const id of ["topic"]) {
    const select = html.match(new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>'))?.[1];
    assert.match(select, /<option>Vet<\/option>/);
  }
  assert.doesNotMatch(html, /id="stats-topic"/);
});
