import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { selectReportArticles, normalizeReport } from "../src/report.js";
import { periodReport } from "../src/ai_summary.js";

const article = (id, title, changes = {}) => ({ id, title, category: "policy", date: "2026-11-11",
  source: "매체" + id, url: "https://example.com/" + id, summary: "본문", ...changes });

test("별표를 우선하면서 중복 보도가 많은 다른 소식도 선정합니다", () => {
  const rows = [
    article(1, "가나다라마바사아자차", { starred: true }),
    article(2, "카타파하거너더러머버"), article(3, "카타파하거너더러머버"), article(4, "카타파하거너더러머버"),
    article(5, "머너러더거버서어저처"),
  ];
  const selected = selectReportArticles(rows, 2);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].id, 1);
  assert.equal(selected[1].id, 4);
  assert.equal(selected[1].duplicate_count, 3);
  assert.equal(selectReportArticles(rows.filter((a) => !a.starred), 1)[0].id, 4);
});

test("별표가 상한보다 많아도 다른 소식을 포함하고 중복 소식은 한 번만 사용합니다", () => {
  const rows = [
    article(1, "가나다라마바사아자차", { starred: true }),
    article(2, "카타파하거너더러머버", { starred: true }),
    article(3, "버서어저처커터퍼허겨", { starred: true }),
    article(4, "쟈챠캬탸퍄햐겨녀뎌려"), article(5, "쟈챠캬탸퍄햐겨녀뎌려"),
  ];
  const selected = selectReportArticles(rows, 3);
  assert.equal(selected.filter((a) => a.starred).length, 2);
  assert.equal(selected.find((a) => !a.starred).duplicate_count, 2);
});

test("화면과 같은 기회·위협 규칙 및 수동 분류를 사용하고 이전 AI 판단은 무시합니다", () => {
  const selected = selectReportArticles([
    article(1, "캐논메디칼 MRI 출시", { category: "company", impact_override: "위협" }),
    article(2, "제도 연구", { ai_summary: "영향: 기회" }),
  ], 30);
  assert.equal(selected.find((a) => a.id === 1).impact, "위협");
  assert.equal(selected.find((a) => a.id === 2).impact, "");
});

test("기회·위협과 경쟁사 출처를 검증하고 실제 원문 링크만 연결합니다", () => {
  const rows = [
    { ...article(1, "기회 기사"), impact: "기회", competitors: [] },
    { ...article(2, "지멘스 기사"), impact: "위협", competitors: ["지멘스 헬시니어스"] },
    { ...article(3, "미분류 기사"), impact: "", competitors: [] },
  ];
  const report = normalizeReport(JSON.stringify({
    trends: [{ text: "동향1", sources: [1, 2] }, { text: "동향2", sources: [3] }, { text: "동향3", sources: [1] }, { text: "동향4", sources: [2] }],
    opportunities: [{ text: "기회", sources: [1] }, { text: "잘못된 분류", sources: [2] }, { text: "미분류 제외", sources: [3] }],
    risks: [{ text: "위협", sources: [2] }, { text: "없는 기사", sources: [99] }],
    competitors: [{ name: "지멘스 헬시니어스", text: "변화", sources: [2] }, { name: "필립스", text: "가공 기사", sources: [1] }],
  }), rows, "week");
  assert.equal(report.sections[0].items.length, 3);
  assert.equal(report.sections[1].items.length, 1);
  assert.equal(report.sections[2].items.length, 1);
  assert.equal(report.sections[3].items.length, 1);
  assert.equal(report.sections[1].items[0].sources[0].url, rows[0].url);
  assert.equal(report.sections[3].items[0].text, "지멘스 헬시니어스: 변화");
  assert.equal(normalizeReport("invalid", rows, "week"), null);
});

test("새 경쟁사 기사가 없으면 경쟁사 움직임 항목을 만들지 않습니다", () => {
  const rows = [{ ...article(1, "병원 기사"), impact: "", competitors: [] }];
  const report = normalizeReport(JSON.stringify({ trends: [{ text: "병원 동향", sources: [1] }],
    competitors: [{ name: "필립스", text: "특이사항 없음", sources: [1] }] }), rows, "month");
  assert.equal(report.sections.length, 3);
  assert.equal(report.sections[0].title, "이번 달 핵심 동향");
});

test("리포트 생성 요청에 별표·중복 수·분류를 전달하고 출처 번호를 검증합니다", async () => {
  const rows = selectReportArticles([article(1, "지멘스 MRI 출시", { category: "competitor" })], 30);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.impact, "위협");
    assert.equal(input.duplicate_count, 1);
    assert.equal(input.competitors[0], "지멘스 헬시니어스");
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      trends: [{ text: "경쟁 동향", sources: [1] }], risks: [{ text: "제품 경쟁", sources: [1] }],
      competitors: [{ name: "지멘스 헬시니어스", text: "신제품 출시", sources: [1] }],
    }) } }] });
  };
  try {
    const report = await periodReport({ OPENAI_API_KEY: "test" }, rows, "week");
    assert.equal(report.sections[2].items[0].sources[0].url, rows[0].url);
  } finally { globalThis.fetch = originalFetch; }
});

test("출처 링크를 클릭 가능한 요소로 표시하고 생성 텍스트는 HTML로 실행하지 않습니다", () => {
  const script = readFileSync(new URL("../static/report.js", import.meta.url), "utf8");
  const createElement = (tag) => ({ tag, children: [], append(child) { this.children.push(child); }, replaceChildren() { this.children = []; } });
  const render = runInNewContext(script.slice(0, script.indexOf("(function(){")) + "\nrenderReport;", { document: { createElement } });
  const output = createElement("div");
  render({ sections: [{ title: "핵심 동향", items: [{ text: "<script>test</script>", sources: [
    { url: "https://example.com/original", source: "매체", title: "기사" },
    { url: "javascript:alert(1)", source: "위험 링크", title: "기사" },
  ] }] }] }, output);
  const row = output.children[1].children[0];
  assert.equal(row.children[0].textContent, "<script>test</script>");
  assert.equal(row.children[1].children.length, 1);
  assert.equal(row.children[1].children[0].href, "https://example.com/original");
  assert.equal(row.children[1].children[0].rel, "noopener noreferrer");
});
