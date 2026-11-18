import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (name) => readFileSync(new URL(`../static/${name}.js`, import.meta.url), "utf8");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const { hospitalProjects, newHospitals } = runInNewContext(
  read("news-rules") + "\n" + read("stats") + "\n({hospitalProjects,newHospitals});",
  { articles: [], document: { getElementById: () => ({ addEventListener() {} }) }, esc, shortDate: (s) => s.slice(5) },
);
const article = (id, title, changes = {}) => ({ id, title, category: "hospital", date: "2026-11-18",
  source: `매체${id}`, url: `https://example.com/${id}`, ...changes });

test("병원 약칭과 정식 명칭을 합치고 최신 보도를 대표로 선택합니다", () => {
  const old = article(1, "한빛대학교병원 암센터 착공, 2027년 개소", { date: "2026-11-10" });
  const latest = article(2, "한빛대병원 암센터 신축, 2028년 개소");
  const rows = hospitalProjects([old, latest]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].main, latest);
  assert.equal(rows[0].articles.length, 2);
  const html = newHospitals([old, latest]);
  assert.equal((html.match(/<tr>/g) || []).length, 2);
  assert.match(html, /추가 출처 1건/);
  assert.match(html, /2028년/);
  assert.doesNotMatch(html, /2027년/);
  assert.match(html, /https:\/\/example.com\/1/);
  assert.match(html, /https:\/\/example.com\/2/);
});

test("같은 병원의 별개 시설 사업과 다른 지역·분원은 분리합니다", () => {
  const rows = hospitalProjects([
    article(1, "한빛병원 암센터 신설"), article(2, "한빛병원 별관 증축"),
    article(3, "분당한빛병원 암센터 개소"), article(4, "한빛병원 강남분원 암센터 신설"),
    article(5, "한빛병원 강북분원 암센터 신설"),
  ]);
  assert.equal(rows.length, 5);
});

test("같은 시설의 진행 단계 보도는 날짜 간격과 무관하게 한 사업으로 묶습니다", () => {
  assert.equal(hospitalProjects([
    article(1, "한빛병원 별관 착공", { date: "2026-09-20" }),
    article(2, "한빛병원 별관 준공"),
  ]).length, 1);
  assert.equal(hospitalProjects([
    article(1, "한빛병원 신축"), article(2, "한빛병원 준공"),
  ]).length, 1);
});

test("병원명에 시설명이 붙은 제목과 대학병원 약칭도 같은 사업으로 봅니다", () => {
  assert.equal(hospitalProjects([
    article(1, "한빛대학병원암센터 신설"),
    article(2, "한빛대학교 병원 암센터 개소"),
    article(3, "한빛대병원 암센터 준공"),
  ]).length, 1);
});

test("중복 URL은 한 번만 표시하고 서로 다른 URL의 보도는 보존합니다", () => {
  const row = article(1, "한빛병원 개원");
  const list = [row, { ...row }, article(2, "한빛병원 신축")];
  assert.equal(hospitalProjects(list)[0].articles.length, 2);
  assert.equal(list.length, 3);
});

test("개원 기념·일반 병원명·다른 카테고리는 표에서 제외합니다", () => {
  assert.equal(hospitalProjects([
    article(1, "한빛병원 개원 기념"), article(2, "종합병원 신설"),
    article(3, "한빛병원 개원", { category: "company" }),
  ]).length, 0);
});

test("출처와 병원명은 HTML로 실행되지 않도록 표시합니다", () => {
  const html = newHospitals([article(1, "한빛병원 개원", { source: '<img src=x onerror="alert(1)">' })]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
