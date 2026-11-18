import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { selectReportArticles, normalizeReport } from "../src/report.js";
import { monthlyReport } from "../src/ai_summary.js";

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

test("월간 요약용 기사에는 기회·위협 판정 값을 추가하지 않습니다", () => {
  const selected = selectReportArticles([
    article(1, "캐논메디칼 MRI 출시", { category: "company", impact_override: "위협" }),
    article(2, "제도 연구", { ai_summary: "영향: 기회" }),
  ], 30);
  assert.equal("impact" in selected.find((a) => a.id === 1), false);
  assert.equal("impact" in selected.find((a) => a.id === 2), false);
});

test("같은 소식의 다른 별표 기사에 직접 분류가 있으면 월간 선정에서 유지합니다", () => {
  const rows = [article(1, "같은 병원 신축 소식입니다", { starred: true, impact_override: "기회" }),
    article(2, "같은 병원 신축 소식입니다", { starred: true })];
  const selected = selectReportArticles(rows, 30);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].impact_override, "기회");
});

test("기회·리스크는 미분류·일반 기사·반대 분류를 근거로 허용하지 않습니다", () => {
  const rows = [
    article(1, "직접 선택한 기회 기사", { starred: true, impact_override: "기회", entity: "A병원" }),
    article(2, "직접 선택한 위협 기사", { starred: true, impact_override: "위협", entity: "수가 정책" }),
    article(3, "분류 없는 별표 기사", { starred: true }),
    article(4, "일반 기사 과거 분류", { starred: false, impact_override: "기회" }),
  ];
  const report = normalizeReport(JSON.stringify({ trends: [{ text: "동향", sources: [1] }],
    opportunities: [{ target: "잘못된 분류", text: "잘못된 내용", sources: [2] }, { text: "혼합", sources: [1, 3] }, { text: "일반 기사", sources: [4] }],
    risks: [{ text: "반대 분류", sources: [1] }],
  }), rows);
  const good = report.sections[1], bad = report.sections[2];
  assert.equal(good.title, "비즈니스 기회");assert.equal(bad.title, "위협·리스크");
  assert.equal(good.items[0].target, "A병원");assert.equal(good.items[0].impact, "기회");
  assert.equal(bad.items[0].impact, "위협");
  assert.equal(good.items[0].text, rows[0].title);assert.equal(bad.items[0].text, rows[1].title);
});

test("직접 분류된 별표 기사만 기회·리스크 표에 넣고 출처의 원문 링크를 검증합니다", () => {
  const rows = [
    { ...article(1, "기회 기사"), starred: true, impact_override: "기회", competitors: [] },
    { ...article(2, "지멘스 기사"), starred: true, impact_override: "위협", competitors: ["지멘스 헬시니어스"] },
    { ...article(3, "미분류 기사"), impact: "", competitors: [] },
  ];
  const report = normalizeReport(JSON.stringify({
    trends: [{ text: "동향1", sources: [1, 2] }, { text: "동향2", sources: [3] }, { text: "동향3", sources: [1] }, { text: "동향4", sources: [2] }],
    opportunities: [{ text: "기회", sources: [1] }, { text: "잘못된 분류", sources: [2] }, { text: "미분류 제외", sources: [3] }],
    risks: [{ text: "위협", sources: [2] }, { text: "없는 기사", sources: [99] }],
    competitors: [{ name: "지멘스 헬시니어스", text: "변화", sources: [2] }, { name: "필립스", text: "가공 기사", sources: [1] }],
  }), rows);
  assert.equal(report.sections[0].items.length, 3);
  assert.equal(report.sections[1].items.length, 1);
  assert.equal(report.sections.length, 4);
  assert.equal(report.sections[0].items[0].sources[0].url, rows[0].url);
  assert.equal(report.sections[1].format, "table");
  assert.equal(report.sections[3].items[0].target, "지멘스 헬시니어스");
  assert.equal(report.sections[3].items[0].text, "변화");
  assert.equal(normalizeReport("invalid", rows), null);
});

test("새 경쟁사 기사가 없으면 경쟁사 움직임 항목을 만들지 않습니다", () => {
  const rows = [{ ...article(1, "병원 기사"), impact: "", competitors: [] }];
  const report = normalizeReport(JSON.stringify({ trends: [{ text: "병원 동향", sources: [1] }],
    competitors: [{ name: "필립스", text: "특이사항 없음", sources: [1] }] }), rows);
  assert.equal(report.sections.length, 3);
  assert.equal(report.sections[1].empty_message, "선택된 기사가 없습니다.");
  assert.equal(report.sections[2].items.length, 0);
  assert.equal(report.sections[0].title, "이번 달 핵심 동향");
});

test("표의 영향은 근거 별표 기사의 직접 선택값만 사용하며 상반된 판단은 표시하지 않습니다", () => {
  const rows = [
    article(1, "지멘스 MRI 출시", { starred: true, impact_override: "기회", competitors: ["지멘스"] }),
    article(2, "지멘스 공급 확대", { starred: true, impact_override: "위협", competitors: ["지멘스"] }),
    article(3, "지멘스 신제품", { starred: false, impact_override: "기회", competitors: ["지멘스"] }),
  ];
  const make = (sources) => normalizeReport(JSON.stringify({
    trends: [{ text: "동향", sources: [1] }],
    competitors: [{ name: "지멘스", text: "MRI 출시", impact: "기회", sources }],
  }), rows).sections[3].items[0];
  assert.equal(make([1]).impact, "기회");
  assert.equal(make([2]).impact, "위협");
  assert.equal(make([1, 2]).impact, "");
  assert.equal(make([3]).impact, "");
});

test("핵심 동향은 목록으로, 나머지는 네 열 표와 빨간 ▲·파란 ▼로 표시합니다", () => {
  const script = readFileSync(new URL("../static/report.js", import.meta.url), "utf8");
  const createElement = (tag) => ({ tag, children: [], attributes: {},
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const render = runInNewContext(script.slice(0, script.indexOf("(function(){")) + "\nrenderReport;", { document: { createElement } });
  const output = createElement("div");
  const source = { url: "https://example.com/original", source: "매체", title: "기사" };
  render({ sections: [
    { title: "이번 달 핵심 동향", items: [{ text: "동향", sources: [source] }] },
    { title: "경쟁사 움직임", format: "table", items: [
      { target: "A사", text: "신제품 출시", impact: "기회", sources: [source] },
      { target: "B사", text: "공급 확대", impact: "위협", sources: [source] },
      { target: "<img>", text: "<script>내용</script>", impact: "", sources: [{ ...source, url: "javascript:alert(1)" }] },
    ] },
  ] }, output);
  assert.equal(output.children[1].tag, "ul");
  const table = output.children[3].children[0];
  assert.equal(table.tag, "table");
  assert.deepEqual(table.children[0].children[0].children.map((cell) => cell.textContent), ["대상", "핵심 변화", "영향", "출처"]);
  const rows = table.children[1].children;
  assert.equal(rows[0].children[2].children[0].textContent, "▲");
  assert.equal(rows[0].children[2].children[0].className, "report-positive");
  assert.match(rows[0].children[2].children[0].attributes["aria-label"], /긍정 영향/);
  assert.equal(rows[1].children[2].children[0].textContent, "▼");
  assert.equal(rows[1].children[2].children[0].className, "report-negative");
  assert.equal(rows[2].children[2].children.length, 0);
  assert.equal(rows[2].children[0].textContent, "<img>");
  assert.equal(rows[2].children[1].textContent, "<script>내용</script>");
  assert.equal(rows[2].children[3].children[0].children.length, 0);
  const css = readFileSync(new URL("../static/style.css", import.meta.url), "utf8");
  assert.match(css, /\.report-positive\{color:var\(--red\)/);
  assert.match(css, /\.report-negative\{color:#2563eb/);
});

test("리포트 생성 요청에는 직접 선택한 분류를 전달하며 미분류 기사를 자동 판정하지 않습니다", async () => {
  const rows = selectReportArticles([article(1, "지멘스 MRI 출시", { category: "competitor" })], 30);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.impact, "");
    assert.match(body.messages[0].content, /opportunities/);
    assert.match(body.messages[0].content, /직접 선택한 분류를 바꾸거나/);
    assert.equal(input.duplicate_count, 1);
    assert.equal(input.competitors[0], "지멘스 헬시니어스");
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      trends: [{ text: "경쟁 동향", sources: [1] }], risks: [{ text: "제품 경쟁", sources: [1] }],
      competitors: [{ name: "지멘스 헬시니어스", text: "신제품 출시", sources: [1] }],
    }) } }] });
  };
  try {
    const report = await monthlyReport({ OPENAI_API_KEY: "test" }, rows);
    assert.equal(report.sections[3].items[0].sources[0].url, rows[0].url);
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
