import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { withoutImpact } from "../src/ai_summary.js";

const sharedScript = readFileSync(new URL("../static/news-rules.js", import.meta.url), "utf8");
const impactScript = readFileSync(new URL("../static/impact.js", import.meta.url), "utf8");
const articleScript = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
const { impactOf, impactControls, matchesImpact, card } = runInNewContext(
  sharedScript + "\n" + impactScript + "\n" + articleScript.slice(0, articleScript.indexOf("function render(){")) +
  "\n({ impactOf, impactControls, matchesImpact, card });",
);
const article = (title, category = "policy", changes = {}) => ({
  id: 1, title, category, tags: [], date: "2026-11-11", source: "매체", entity: "", url: "https://example.com/1", ...changes,
});

test("대상과 변화가 명확한 제목만 자동 분류합니다", () => {
  for (const [title, category, expected] of [
    ["캐논메디칼 MRI 출시", "company", "기회"],
    ["지멘스 MRI 출시", "competitor", "위협"],
    ["캐논메디칼 초음파 제품 리콜", "company", "위협"],
    ["필립스 CT 판매 중지", "competitor", "기회"],
    ["지역 병원 증축 착공", "hospital", "기회"],
    ["의대 신설 확정", "hospital", "기회"],
    ["CT 검사 수가 10% 인상", "policy", "기회"],
    ["MRI 급여 대상 축소", "policy", "위협"],
  ]) assert.equal(impactOf(article(title, category)), expected, title);
});

test("예정·부정·상반된 신호와 일반 연구는 판단을 보류합니다", () => {
  for (const [title, category] of [
    ["CT 규제 완화", "policy"], ["MRI 급여 확대", "policy"],
    ["병원 개원 예정", "hospital"], ["의대 신설 추진", "hospital"],
    ["MRI 출시 중단", "competitor"], ["CT 출시 계획 없다", "company"],
    ["CT 판매 금지 해제", "competitor"], ["MRI 리콜 아닌 것으로 확인", "company"],
    ["CT 출시 및 제품 회수", "competitor"], ["MRI 공동 도입 협약", "company"],
    ["MRI 수가 인상 및 수가 인하", "policy"], ["영상판독 연구 발표", "conference"],
    ["필립스 생활가전 출시", "competitor"],
  ]) assert.equal(impactOf(article(title, category)), "", title);
});

test("기존 AI 영향은 무시하고 직접 선택한 분류를 최우선으로 사용합니다", () => {
  const a = article("의료 AI 연구 발표", "policy", { ai_summary: "영향: 위협\n인사이트: 연구 동향" });
  assert.equal(impactOf(a), "");
  assert.equal(impactOf({ ...a, impact_override: "기회" }), "기회");
  assert.equal(impactOf(article("캐논메디칼 MRI 출시", "company", { impact_override: "위협" })), "위협");
  assert.equal(impactOf(article("캐논메디칼 MRI 출시", "company", { impact_override: "" })), "기회");
  assert.equal(matchesImpact({ ...a, impact_override: "기회" }, "기회"), true);
  assert.equal(matchesImpact(a, "both"), false);
});

test("미분류에는 두 선택지를, 분류한 기사에는 배지와 변경·해제를 제공합니다", () => {
  const a = article("영상판독 연구 동향");
  assert.match(impactControls(a), /data-impact-value="기회"/);
  assert.match(impactControls(a), /data-impact-value="위협"/);
  assert.doesNotMatch(impactControls(a), /class="chip /);
  assert.match(impactControls({ ...a, impact_override: "기회" }), /title="직접 분류"/);
  assert.match(impactControls({ ...a, impact_override: "기회" }), /data-impact-value=""/);
  assert.match(impactControls(article("CT 수가 인상")), /title="제목 기준 추정"/);
  assert.doesNotMatch(card(a, []), /data-summary/);
});

test("기존 AI 인사이트의 영향 줄만 제거하고 설명은 보존합니다", () => {
  assert.equal(withoutImpact("영향: 위협\n인사이트: 설명"), "인사이트: 설명");
  assert.equal(withoutImpact("- 영향： 기회\n인사이트: 설명"), "인사이트: 설명");
  assert.equal(withoutImpact("인사이트: 설명"), "인사이트: 설명");
});

test("직접 분류는 저장 성공 후 화면과 필터에 반영합니다", async () => {
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
    render() { rendered++; }, alert() { assert.fail("저장 실패"); },
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
    alert(value) { message = value; },
  });
  await save({ getAttribute(name) { return name === "data-impact" ? "1" : "위협"; }, closest() { return { querySelectorAll() { return controls; } }; } });
  assert.equal(rows[0].impact_override, "기회");
  assert.equal(message, "저장 실패");
  assert.equal(controls[0].disabled, false);
});
