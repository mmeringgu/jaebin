import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { keywordMatch, articleTags } from "../src/rules.js";
import { parseBingRss } from "../src/crawler.js";
import { SOURCE_BY_ID } from "../src/settings.js";
import { articles } from "../src/service.js";

const source = SOURCE_BY_ID.B001;

test("일본어·영어 메디컬 회사명과 의료 제목을 캐논 뉴스로 분류합니다", () => {
  for (const title of [
    "キヤノンメディカル、超音波診断装置を発売",
    "キャノンメディカル MRI 新製品を発表",
    "キヤノン メディカル、病院向けソリューションを導入",
    "Canon Medical Systems launches ultrasound platform",
    "CANON MEDICAL advances diagnostic imaging research",
  ]) {
    const groups = keywordMatch(title, source);
    assert.equal(groups[0]?.category, "company", title);
    assert.equal(groups[0]?.matchLevel, "full", title);
    assert.ok(groups.some((group) => group.id === "K001"));
  }
});

test("캐논 본사 이름은 의료 키워드가 함께 있을 때만 분류하며 전각 영문도 인식합니다", () => {
  for (const brand of ["캐논", "Canon", "キヤノン", "キャノン", "ＣＡＮＯＮ"]) {
    for (const context of ["의료기기", "CT", "MRI", "초음파", "医療", "画像診断", "超音波", "medical", "healthcare", "ultrasound"]) {
      const title = `${brand}, ${context} business expansion`;
      const groups = keywordMatch(title, source);
      assert.equal(groups[0]?.category, "company", title);
      assert.equal(groups[0]?.matchLevel, "full", title);
    }
  }
  assert.equal(keywordMatch("ＣＡＮＯＮ、医療用ＣＴ装置を発売", source)[0]?.category, "company");
});

test("캐논의 비의료·카메라·프린터·산업 검사 기사와 비슷한 영단어는 제외합니다", () => {
  for (const title of [
    "캐논 신임 대표 선임", "Canon announces quarterly earnings", "キヤノン、新事業を発表",
    "Canon AI platform launch", "キヤノン、人工知能サービスを発表",
    "캐논 AI 카메라 출시", "Canon launches camera lens", "キヤノン、カメラ用レンズを発売",
    "캐논 병원용 프린터 공급", "Canon medical printer launch", "キヤノン、医療機関向けプリンターを発売",
    "Canon industrial CT inspection system", "キヤノン、産業用X線検査システムを発表",
    "Canonical medical imaging platform", "Canonization and healthcare conference",
    "Canon Medical camera launch", "キヤノンメディカル カメラ発表",
  ]) {
    assert.equal(keywordMatch(title, source).some((group) => group.category === "company"), false, title);
  }
  assert.equal(keywordMatch("Canon medical imaging", { ...source, categories: ["hospital"] }).some((group) => group.category === "company"), false);
  assert.deepEqual(keywordMatch("Canon medical imaging", { ...source, status: "중지" }), []);
});

test("일본어 RSS와 기존 저장 기사도 같은 의료 키워드로 분류합니다", async () => {
  const title = "キヤノン、医療用CTの供給体制を強化";
  const url = "https://global.canon/ja/news/medical-test.html";
  const rss = `<rss><channel><item><title>${title}</title><link>https://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(url)}</link>
    <pubDate>${new Date().toUTCString()}</pubDate><description>医療機器の供給体制に関するお知らせです。</description><News:Source>日本のニュース</News:Source></item></channel></rss>`;
  assert.equal(parseBingRss(rss, source)[0]?.category, "company");
  const row = { id: 88, title, url, source: "日本のニュース (빙 검색)", published_date: "2026-11-16",
    summary: JSON.stringify({ format: "excerpt", source_id: "B001", first_paragraph: "医療機器の供給体制に関するお知らせです。" }) };
  const env = { DB: { prepare(sql) {
    assert.match(sql, /^SELECT /);
    return { bind() { return this; }, async all() { return { results: [row] }; } };
  } } };
  assert.equal((await articles(env))[0]?.category, "company");
});

test("일본어 분야 필터와 회사 통계에도 본사 의료 기사가 반영됩니다", () => {
  const shared = readFileSync(new URL("../static/news-rules.js", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
  const { matchesTopic } = runInNewContext(shared + "\n" + screen.slice(0, screen.indexOf("function render(){")) + "\n({ matchesTopic });");
  for (const [title, topic] of [["キヤノン、超音波診断装置を発売", "UL"], ["キヤノン、磁気共鳴画像診断装置を開発", "MRI"], ["ＣＡＮＯＮ 医療用ＣＴ発売", "CT"]]) {
    assert.equal(matchesTopic({ title, tags: articleTags(keywordMatch(title, source)) }, topic), true, title);
  }
  const stats = readFileSync(new URL("../static/stats.js", import.meta.url), "utf8");
  const { mentions, COMPANIES } = runInNewContext(stats.slice(0, stats.indexOf("function companyTrend(")) + "\n({ mentions, COMPANIES });");
  const mine = COMPANIES.find((company) => company.mine);
  assert.equal(mentions({ category: "company", title: "キヤノン、医療用CTを発売", tags: [] }, mine), true);
  assert.equal(mentions({ category: "policy", title: "医療用CTの政策", tags: [] }, mine), false);
});
