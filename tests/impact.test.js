import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const sharedScript = readFileSync(new URL("../static/news-rules.js", import.meta.url), "utf8");
const impactScript = readFileSync(new URL("../static/impact.js", import.meta.url), "utf8");
const articleScript = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
const { impactOf, impactControls, card } = runInNewContext(
  sharedScript + "\n" + impactScript + "\n" + articleScript.slice(0, articleScript.indexOf("function render(){")) +
  "\n({ impactOf, impactControls, card });",
);
const article = (title, category = "policy", changes = {}) => ({
  id: 1, title, category, tags: [], date: "2026-11-11", source: "매체", entity: "", url: "https://example.com/1", ...changes,
});

test("별표하지 않은 기사는 기존 선택이 있어도 분류를 표시하지 않습니다", () => {
  for (const title of ["캐논메디칼 MRI 출시", "지멘스 MRI 출시", "MRI 급여 축소"]) {
    const a = article(title, "company", { impact_override: "위협" });
    assert.equal(impactOf(a), "");
    assert.equal(impactControls(a), "");
    assert.doesNotMatch(card(a, []), /data-impact|impact-good|impact-bad/);
  }
});

test("별표한 기사만 두 선택지를 제공하며 제목으로 자동 분류하지 않습니다", () => {
  const a = article("캐논메디칼 MRI 출시", "company", { starred: true });
  assert.equal(impactOf(a), "");
  assert.match(impactControls(a), /data-impact-value="기회"/);
  assert.match(impactControls(a), /data-impact-value="위협"/);
  assert.match(impactControls({ ...a, impact_override: "기회" }), /title="직접 분류"/);
  assert.match(impactControls({ ...a, impact_override: "기회" }), /data-impact-value=""/);
  assert.equal(impactOf({ ...a, impact_override: "위협" }), "위협");
});

test("기존 인사이트 데이터가 있어도 카드에 출력하지 않고 전체 영향 필터도 제거합니다", () => {
  const a = article("연구 동향", "policy", { ai_summary: "인사이트: 과거 내용" });
  assert.doesNotMatch(card(a, []), /AI 인사이트|과거 내용|ai-summary|ai-chip/);
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="impact"/);
});

test("직접 분류는 저장 성공 후 화면에 반영합니다", async () => {
  const rows = [article("연구 발표")];
  let rendered = 0;
  const controls = [{ disabled: false }, { disabled: false }];
  const button = {
    getAttribute(name) { return name === "data-impact" ? "1" : "위협"; },
    closest() { return { querySelectorAll() { return controls; } }; },
  };
  const save = runInNewContext(impactScript + "\n saveImpact;", {
    articles: rows,
    async postJson(path, data) {
      assert.equal(path, "/api/article-impact");
      assert.equal(data.id, 1);
      assert.equal(data.impact, "위협");
      assert.equal(rows[0].impact_override, undefined);
      assert.ok(controls.every((b) => b.disabled));
    },
    render() { rendered++; }, showNotice() { assert.fail("저장 실패"); },
  });
  await save(button);
  assert.equal(rows[0].impact_override, "위협");
  assert.equal(rendered, 1);
  assert.ok(controls.every((b) => !b.disabled));
});

test("저장 실패 시 기존 분류를 유지하고 다시 선택할 수 있습니다", async () => {
  const rows = [article("연구 발표", "policy", { impact_override: "기회" })];
  let message = "";
  const controls = [{ disabled: false }];
  const save = runInNewContext(impactScript + "\n saveImpact;", {
    articles: rows,
    async postJson() { throw new Error("저장 실패"); },
    render() { assert.fail("저장 실패 상태를 반영하면 안 됩니다."); },
    showNotice(value) { message = value; },
  });
  await save({ getAttribute(name) { return name === "data-impact" ? "1" : "위협"; }, closest() { return { querySelectorAll() { return controls; } }; } });
  assert.equal(rows[0].impact_override, "기회");
  assert.equal(message, "저장 실패");
  assert.equal(controls[0].disabled, false);
});

test("별표를 해제하면 화면의 분류도 지우고 저장 실패 시에는 유지합니다", async () => {
  const rows = [article("연구 발표", "policy", { starred: 1, impact_override: "기회" })];
  const starScript = articleScript.slice(articleScript.indexOf("async function saveStar("), articleScript.indexOf("// 숨기기 저장:"));
  let fail = true;
  const save = runInNewContext(starScript + "\nsaveStar;", {
    articles: rows,
    async postJson() { if (fail) throw new Error("실패"); },
    render() {}, showNotice() {},
  });
  await save(1, false);
  assert.equal(rows[0].starred, 1);
  assert.equal(rows[0].impact_override, "기회");
  fail = false;
  await save(1, false);
  assert.equal(rows[0].starred, 0);
  assert.equal(rows[0].impact_override, "");
});
