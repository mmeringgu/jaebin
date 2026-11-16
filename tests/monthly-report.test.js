import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import worker from "../src/index.js";
import { koreaNow, addDays } from "../src/settings.js";

test("월간 API는 최근 30일 기사로 생성하고 주간 API는 제공하지 않습니다", async (t) => {
  const day = koreaNow().day;
  const rows = [0, -29, -30, 1].map((offset, i) => ({
    id: i + 1, title: "캐논메디칼 MRI 영상진단 장비 도입 " + i, source: "청년의사",
    url: "https://www.docdocdoc.co.kr/news/articleView.html?idxno=" + (i + 1), published_date: addDays(day, offset),
    summary: JSON.stringify({ format: "excerpt", source_id: "S012", first_paragraph: "기사 첫 문단입니다." }),
  }));
  const env = { OPENAI_API_KEY: "test", DB: { prepare() {
    return { bind() { return this; }, async run() { return {}; }, async all() { return { results: rows.map((row) => ({ ...row })) }; } };
  } } };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /최근 30일/);
    const selected = body.messages[1].content.split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(selected.map((row) => row.date).sort(), [addDays(day, -29), day].sort());
    return Response.json({ choices: [{ message: { content: JSON.stringify({ trends: [{ text: "월간 동향", sources: [1] }] }) } }] });
  });
  const request = (path, body = {}) => worker.fetch(new Request("http://localhost" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), env);
  const response = await request("/api/monthly-report");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.since, addDays(day, -29));
  assert.equal(result.until, day);
  assert.equal(result.article_count, 2);
  assert.equal(result.report.sections[0].title, "이번 달 핵심 동향");
  assert.equal((await request("/api/weekly-report", { period: "week" })).status, 404);
  assert.equal(calls, 1);
});

test("월간 버튼만 있는 화면에서 생성·버튼 복구가 정상 동작합니다", async () => {
  const listeners = {};
  const monthButton = { disabled: false, addEventListener(type, handler) { listeners[type] = handler; } };
  const status = { textContent: "" };
  const output = { replaceChildren() {} };
  const elements = { "report-month-button": monthButton, "report-status": status, "report-output": output };
  const script = readFileSync(new URL("../static/report.js", import.meta.url), "utf8");
  runInNewContext(script, {
    document: { getElementById(id) { assert.ok(elements[id], id); return elements[id]; } },
    async fetch(path, options) {
      assert.equal(path, "/api/monthly-report");
      assert.deepEqual(JSON.parse(options.body), {});
      assert.equal(monthButton.disabled, true);
      return { ok: true, async json() { return { report: { sections: [] }, since: "2026-10-18", until: "2026-11-16", article_count: 2 }; } };
    },
  });
  await listeners.click();
  assert.equal(monthButton.disabled, false);
  assert.match(status.textContent, /기사 2건/);
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]), ["news", "report", "stats", "admin"]);
  assert.deepEqual([...html.matchAll(/data-panel="([^"]+)"/g)].map((match) => match[1]), ["news", "report", "stats", "admin"]);
  assert.doesNotMatch(html, /주간 리포트|id="report-button"/);
});
