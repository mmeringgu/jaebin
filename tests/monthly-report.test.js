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
  const output = { replaceChildren() {}, hasChildNodes() { return false; } };
  const intro = { hidden: false };
  const elements = { "report-month-button": monthButton, "report-status": status, "report-output": output, "report-description": intro };
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
  assert.equal(intro.hidden, true);
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]), ["news", "report", "stats", "admin"]);
  assert.deepEqual([...html.matchAll(/data-panel="([^"]+)"/g)].map((match) => match[1]), ["news", "report", "stats", "admin"]);
  assert.doesNotMatch(html, /주간 리포트|id="report-button"/);
  assert.match(html, /data-tab="report">📝 월간 요약/);
  assert.match(html, /data-tab="stats">📊 업계 동향/);
});

test("생성 후 설명을 숨기며 재생성 실패·브라우저 재조회에도 기존 결과를 유지합니다", async () => {
  const cache = new Map();let fail = false;
  const script = readFileSync(new URL("../static/report.js", import.meta.url), "utf8");
  function screen() {
    const node = () => ({ children: [], hidden: false, textContent: "",
      append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      hasChildNodes() { return this.children.length > 0; },
      addEventListener(name, handler) { this[name] = handler; },
    });
    const elements = Object.fromEntries(["report-month-button", "report-status", "report-output", "report-description"].map((id) => [id, node()]));
    runInNewContext(script, {
      document: { getElementById: (id) => elements[id], createElement: node },
      localStorage: { getItem: (key) => cache.get(key), setItem: (key, value) => cache.set(key, value) },
      async fetch() { return Response.json(fail ? { error: "생성 실패" } : {
        since: "2026-10-20", until: "2026-11-18", article_count: 1,
        report: { sections: [{ title: "이번 달 핵심 동향", items: [{ text: "생성된 동향", sources: [] }] },
          { title: "비즈니스 기회", format: "table", empty_message: "선택된 기사가 없습니다.", items: [] }] },
      }, { status: fail ? 503 : 200 }); },
    });
    return elements;
  }
  const first = screen();assert.equal(first["report-description"].hidden, false);
  await first["report-month-button"].click();
  assert.equal(first["report-description"].hidden, true);
  const rendered = first["report-output"].children;
  assert.equal(rendered[3].textContent, "선택된 기사가 없습니다.");
  fail = true;await first["report-month-button"].click();
  assert.equal(first["report-output"].children, rendered);
  assert.equal(first["report-description"].hidden, true);
  assert.match(first["report-status"].textContent, /생성 실패/);
  const restored = screen();assert.equal(restored["report-description"].hidden, true);
  assert.equal(restored["report-output"].children[1].children[0].children[0].textContent, "생성된 동향");
  assert.match(restored["report-status"].textContent, /저장된 요약/);
});
