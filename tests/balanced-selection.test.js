import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { assessArticle } from "../src/selection-policy.js";
import { hasWord } from "../src/rules.js";
import { SOURCE_BY_ID } from "../src/settings.js";
import { articles, candidates, readBody } from "../src/service.js";
import worker from "../src/index.js";

const source = SOURCE_BY_ID.S012;
test("중도안은 수가·제도·시설·영상의료·의료 사업 변화를 포함합니다", () => {
  for (const [title, category] of [
    ["검사수가 깎아 필수의료 지원", "policy"],
    ["검체검사 수가 인하 확정, 원가분석 논란", "policy"],
    ["환산지수-상대가치 연계 수가체계 개선 추진", "policy"],
    ["관리급여 넘어 비급여항목 관리에 의료계 반발", "policy"],
    ["혈관·림프관 동시에 보는 조영술, 건강보험 수가 신설", "policy"],
    ["6기 상급종합병원 지정, 신규 진입 촉각", "policy"],
    ["상급종합병원에 연간 1조원 성과보상…지원금 조정", "policy"],
    ["국립대병원 적극 육성…지역의료 체계 전환", "policy"],
    ["동탄시티병원, 영상센터 신축 착공", "hospital"],
    ["국립대병원 부채 급증…투자 위축", "hospital"],
    ["고려대 안산병원, 영상의학진단센터와 업무협약", "hospital"],
    ["대한영상의학회, 영상진단 임상 지침 발표", "hospital"],
    ["동물병원 MRI 장비 도입", "hospital"],
    ["지멘스, 헬시니어스 의료기기 자회사 분리 추진", "competitor"],
    ["GE헬스케어 의료 사업 책임자 선임", "competitor"],
    ["캐논메디칼 MRI 공급 계약", "company"],
    ["루닛, 사우디 정부에 AI 영상분석 솔루션 공급", "policy"],
  ]) {
    const result = assessArticle(title, source);
    assert.equal(result.selected, true, title + " " + result.reasons.join(" / "));
    assert.equal(result.groups[0].category, category, title);
  }
});

test("기존 full 기사도 비의료·행사·일반 AI·취업 콘텐츠이면 제외합니다", () => {
  for (const title of [
    "지멘스 산업용 컴퓨터 보안 취약점 공개", "필립스, ASML로 AI 호황 맞아",
    "GE헬스케어 경력직 채용 면접 기출문제", "후지필름 기미 개선 캡슐 개발",
    "국제성모병원 김장 행사 참여", "서울대병원 GLP-1 치료제 유전자 연구",
    "병원경영CEO Academy 수료식 개최", "삼성서울병원 AI 의료 협력 MOU",
    "서울성모병원 교수 성형외과학회 이사장 취임", "한미약품 전문의약품 급여 등재",
    "국민건강보험공단 급여상임이사 임명", "상급종합병원 멀리 살수록 환자 사망률 높아",
    "상급종합병원 가정간호 역할 분담 필요", "의정부을지대병원 유정부 교수 표창",
    "윌스기념병원 개원 24주년…필수의료 강화 다짐",
  ]) {
    const result = assessArticle(title, source);
    assert.equal(result.selected, false, title);
    assert.ok(result.reasons.length, title);
  }
});

test("제목의 의료 사업을 첫 문장으로 보완하되 참고 사례나 비의료 제목은 승격하지 않습니다", () => {
  assert.equal(assessArticle("지멘스, 진단 제품 공급 확대", source, { first_paragraph: "지멘스 헬시니어스가 병원에 CT 장비를 공급한다." }).selected, true);
  assert.equal(assessArticle("지멘스, 진단 제품 공급 확대", source, { first_paragraph: "일반 산업용 센서 제품이다. CT 의료 장비는 다른 사업이다." }).selected, false);
  assert.equal(assessArticle("지멘스 산업용 컴퓨터 공개", source, { first_paragraph: "CT 장비와 비교하면 산업용 장비다." }).selected, false);
  assert.equal(assessArticle("서울대병원 진단 기술 연구", source, { first_paragraph: "예를 들어 CT 검사를 참고했다." }).selected, false);
  assert.equal(assessArticle("서울대병원 진단 기술 연구", source, { first_paragraph: "연구팀이 MRI 영상진단 기술을 개발했다." }).selected, true);
  assert.equal(assessArticle("캐논메디칼 MRI 공급", { ...source, categories: ["policy"] }).selected, false);
});

test("정부·전문의·수의의 단어 일부 오인식을 방지합니다", () => {
  for (const title of ["의정부을지대병원 개소", "유정부 방사선사 표창"]) assert.equal(hasWord(title, "정부"), false);
  assert.equal(hasWord("정부가 의료제도 개편", "정부"), true);
  assert.equal(hasWord("전문의약품 급여", "전문의"), false);
  assert.equal(hasWord("영상의학과 전문의 판독", "전문의"), true);
  assert.equal(hasWord("필수의료 수가", "수의"), false);
  assert.equal(hasWord("수의 영상진단 MRI", "수의"), true);
});

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const db = {
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
    prepare(sql) {
      let args = [];
      const query = {
        bind(...values) { args = values; return query; },
        async run() { return { success: true, meta: sqlite.prepare(sql).run(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      };
      return query;
    },
  };
  return { sqlite, env: { DB: db } };
}

test("뉴스·CSV는 공통 선별하고 제외 검토 API는 기존 데이터를 보존하며 이유를 반환합니다", async () => {
  const { sqlite, env } = database();
  try {
    const insert = sqlite.prepare("INSERT INTO articles(id,category,entity,published_date,source,title,url,summary,review_status,starred,memo) VALUES(?,'policy','','2026-11-17',?,?,?,?, 'published',1,'keep')");
    const excerpt = JSON.stringify({ format: "excerpt", source_id: source.id, first_paragraph: "기사 첫 문단입니다." });
    insert.run(1, source.name, "검사수가 깎아 필수의료 지원", "https://www.docdocdoc.co.kr/news/articleView.html?idxno=1", excerpt);
    insert.run(2, source.name, "지멘스 산업용 컴퓨터 AI 공개", "https://www.docdocdoc.co.kr/news/articleView.html?idxno=2", excerpt);
    assert.deepEqual((await articles(env)).map((a) => a.id), [1]);
    assert.equal((await articles(env))[0].domestic_media, true);
    const review = await worker.fetch(new Request("https://example.com/api/excluded-articles"), env);
    assert.equal(review.status, 200);
    const data = await review.json();
    assert.deepEqual(data.articles.map((a) => a.id), [2]);
    assert.equal(data.articles[0].selection.selected, false);
    assert.match(data.articles[0].selection.reasons[0], /산업/);
    const csv = await (await worker.fetch(new Request("https://example.com/api/export.csv"), env)).text();
    assert.match(csv, /검사수가/);
    assert.doesNotMatch(csv, /산업용/);
    assert.deepEqual(sqlite.prepare("SELECT id,starred,memo FROM articles ORDER BY id").all().map((r) => ({ ...r })), [{ id: 1, starred: 1, memo: "keep" }, { id: 2, starred: 1, memo: "keep" }]);
  } finally { sqlite.close(); }
});

test("수집 단계에서도 제외 후보는 게시하지 않고 관리 목록에서 이유를 확인할 수 있습니다", async () => {
  const { sqlite, env } = database();
  try {
    const add = sqlite.prepare("INSERT INTO news_candidates(id,source_id,source_name,title,url,published_date,snippet,body_text) VALUES(?,?,?,?,?,'2026-11-17',?,'본문')");
    const excerpt = JSON.stringify({ format: "excerpt", first_paragraph: "기사 첫 문단입니다." });
    add.run(1, source.id, source.name, "지멘스 산업용 컴퓨터 AI 공개", "https://www.docdocdoc.co.kr/news/articleView.html?idxno=3", excerpt);
    add.run(2, source.id, source.name, "검사수가 깎아 필수의료 지원", "https://www.docdocdoc.co.kr/news/articleView.html?idxno=4", excerpt);
    assert.equal((await readBody(env, source, 1)).skipped, true);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 0);
    assert.equal((await readBody(env, source, 2)).error, "");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 1);
    const rows = await candidates(env, source.id);
    assert.equal(rows.find((a) => a.id === 1).selection.selected, false);
    assert.equal(rows.find((a) => a.id === 2).selection.selected, true);
  } finally { sqlite.close(); }
});
