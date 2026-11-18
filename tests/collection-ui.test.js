import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function screen(fetch) {
  const elements = new Map(), listeners = new Map();
  function element() {
    return { textContent: "", innerHTML: "", value: "", options: [], disabled: false, checked: false,
      get selectedIndex() { return this.options.findIndex((o) => o.value === this.value); },
      replaceChildren() { this.options = []; },
      append(child) { this.options.push(child); if (!this.value && child.value) this.value = child.value; },
      addEventListener(type, callback) { this[type] = callback; },
      querySelectorAll() { return []; },
    };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
  };
  let articleRefreshes = 0;
  const context = { document, fetch, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    refreshArticles: async () => { articleRefreshes++; } };
  for (const name of ["automation", "collect", "source-status"]) {
    runInNewContext(readFileSync(new URL(`../static/${name}.js`, import.meta.url), "utf8"), context);
  }
  return { document, get: document.getElementById, articleRefreshes: () => articleRefreshes };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ fail = false, cooldown = false } = {}) {
  const calls = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let bodies = 0;
  const ui = screen(async (path, options) => {
    calls.push({ path, body: options?.body && JSON.parse(options.body) });
    let data;
    if (path === "/api/sources") data = { sources: [{ id: "S005", name: "라포르시안" }] };
    else if (path.startsWith("/api/candidates")) data = { candidates: [] };
    else if (path === "/api/automation-status") data = { settings: { enabled: true, maxBodies: 120 }, source_count: 1, lists_done: 0, bodies_done: 0, failed: 0, recent: [] };
    else if (path === "/api/source-status") data = { sources: [{ id: "S005", name: "라포르시안", newCount: 0 }] };
    else if (path === "/api/collect") {
      await blocked;
      if (fail || cooldown) return Response.json({ error: cooldown ? "10분 후 다시 수집할 수 있습니다." : "목록 연결 실패" }, { status: 409 });
      data = { saved: 1 };
    } else if (path === "/api/read-body") data = ++bodies === 1 ? {} : { message: "처리할 기사 없음" };
    else if (path === "/api/automation-step") data = { status: "idle", message: "처리할 작업 없음" };
    else throw new Error("Unexpected request " + path);
    return Response.json(data);
  });
  return { ui, calls, release };
}

test("정보원 행에서 수집하면 선택한 정보원으로 처리하고 진행 상태와 두 현황을 갱신합니다", async () => {
  const { ui, calls, release } = fixture();
  await flush();
  assert.match(ui.get("source-status").innerHTML, /data-collect-source="S005"/);
  const button = { disabled: false, dataset: { collectSource: "S005" } };
  ui.get("source-status").click({ target: { closest: () => button } });
  await flush();
  assert.equal(ui.get("auto-test").disabled, true);
  // 수집 중 같은 행을 다시 눌러도 중복 요청하지 않습니다.
  ui.get("source-status").click({ target: { closest: () => button } });
  release();
  await flush(); await flush();
  const mutations = calls.filter((c) => c.body);
  assert.deepEqual(mutations.map((c) => c.path), ["/api/collect", "/api/read-body", "/api/read-body"]);
  assert.ok(mutations.every((c) => c.body.source_id === "S005"));
  assert.match(ui.get("collect-result").textContent, /라포르시안 · 새 기사 1건 · 확인 1건/);
  assert.match(ui.get("collect-result").textContent, /완료/);
  assert.equal(ui.get("auto-test").disabled, false);
  assert.equal(ui.articleRefreshes(), 1);
  assert.equal(calls.some((c) => c.path.startsWith("/api/candidates")), false);
  for (const path of ["/api/source-status", "/api/automation-status"]) assert.equal(calls.filter((c) => c.path === path).length, 2);
});

test("목록 수집 실패 시 원문 처리를 중단하고 버튼을 복구합니다", async () => {
  const { ui, calls, release } = fixture({ fail: true });
  await flush();
  ui.document.dispatchEvent({ type: "collection-request", detail: { sourceId: "S005" } });
  release(); await flush(); await flush();
  assert.match(ui.get("collect-result").textContent, /목록 연결 실패/);
  assert.equal(calls.some((c) => c.path === "/api/read-body"), false);
  assert.equal(ui.get("auto-test").disabled, false);
});

test("10분 재수집 제한이면 저장된 후보를 처리하며 다음 작업 실행도 실제 API에 연결됩니다", async () => {
  const { ui, calls, release } = fixture({ cooldown: true });
  await flush();
  ui.document.dispatchEvent({ type: "collection-request", detail: { sourceId: "S005" } });
  release(); await flush(); await flush();
  assert.match(ui.get("collect-result").textContent, /저장된 기사를 처리합니다/);
  assert.equal(calls.filter((c) => c.path === "/api/read-body").length, 2);
  await ui.get("auto-test").onclick();
  assert.equal(calls.filter((c) => c.path === "/api/automation-step").length, 1);
  assert.match(ui.get("auto-result").textContent, /처리할 작업 없음/);
});
