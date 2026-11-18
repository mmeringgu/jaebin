import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function screen(fetch) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", textContent: "", disabled: false, hidden: true,
      addEventListener(name, fn) { this[name] = fn; }, reportValidity() { return true; }, reset() {},
    });
    return nodes.get(id);
  };
  let refreshes = 0, finished = 0;
  runInNewContext(readFileSync(new URL("../static/manual-article.js", import.meta.url), "utf8"), {
    document: { getElementById: get, dispatchEvent() { finished++; } }, fetch,
    refreshArticles: async () => { refreshes++; }, CustomEvent: class {},
  });
  return { get, refreshes: () => refreshes, finished: () => finished };
}

test("URL 확인은 저장하지 않고 확인 후 추가하며 중복 요청을 방지합니다", async () => {
  const calls = [];let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const ui = screen(async (path, options) => {
    calls.push({ path, data: JSON.parse(options.body) });
    if (path.endsWith("preview")) return Response.json({ article: { url: "https://example.com/1", title: "확인할 기사 제목입니다", source: "신문", date: "2026-10-15", category: "policy", summary: "기사 첫 문단을 확인합니다." } });
    await blocked;return Response.json({ article: { title: "확인할 기사 제목입니다" } }, { status: 201 });
  });
  ui.get("manual-url").value = "https://example.com/1";
  await ui.get("manual-preview").onclick();
  assert.equal(calls.length, 1);assert.equal(ui.get("manual-fields").hidden, false);
  assert.equal(ui.get("manual-fields").disabled, false);
  const save = ui.get("manual-article-form").submit({ preventDefault() {} });
  assert.equal(ui.get("manual-save").disabled, true);
  await ui.get("manual-article-form").submit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  release();await save;
  assert.equal(calls[1].path, "/api/manual-article");
  assert.equal(calls[1].data.category, "policy");
  assert.equal(ui.get("manual-fields").hidden, true);
  assert.match(ui.get("manual-status").textContent, /추가 완료/);
  assert.equal(ui.refreshes(), 1);assert.equal(ui.finished(), 1);
});

test("URL을 바꾸면 이전 확인 결과를 무효화하며 저장 실패 시 입력을 유지합니다", async () => {
  let fail = false;
  const ui = screen(async () => fail ? Response.json({ error: "이미 저장된 기사입니다." }, { status: 409 })
    : Response.json({ article: { url: "https://example.com/1", title: "검토할 기사 제목입니다", category: "policy", source: "매체", date: "2026-10-15", summary: "첫 문단을 확인합니다." } }));
  ui.get("manual-url").value = "https://example.com/1";
  await ui.get("manual-preview").onclick();
  fail = true;
  await ui.get("manual-article-form").submit({ preventDefault() {} });
  assert.equal(ui.get("manual-fields").hidden, false);
  assert.match(ui.get("manual-status").textContent, /이미 저장/);
  assert.equal(ui.refreshes(), 0);
  ui.get("manual-url").input();
  assert.equal(ui.get("manual-fields").hidden, true);
  assert.equal(ui.get("manual-fields").disabled, true);
});
