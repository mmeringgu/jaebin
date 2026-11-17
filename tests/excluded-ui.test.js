import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("제외 검토는 펼칠 때 조회하고 이유를 안전하게 표시하며 수집 후 갱신합니다", async () => {
  const nodes = new Map(), listeners = new Map();
  const element = () => ({ open: false, children: [], textContent: "", addEventListener(name, fn) { this[name] = fn; },
    replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let calls = 0;
  const document = { getElementById: get, createElement: element, addEventListener(name, fn) { listeners.set(name, fn); } };
  runInNewContext(readFileSync(new URL("../static/excluded.js", import.meta.url), "utf8"), {
    document, async fetch(path) {
      assert.equal(path, "/api/excluded-articles");calls++;
      return Response.json({ articles: [{ title: '<img src=x onerror="alert(1)">', url: "https://example.com/1", date: "2026-11-17", source: "매체", selection: { reasons: ["비의료 사업"] } }] });
    },
  });
  assert.equal(calls, 0);
  get("excluded-articles-details").open = true;
  get("excluded-articles-details").toggle();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  const item = get("excluded-list").children[0];
  assert.equal(item.children[0].textContent, '<img src=x onerror="alert(1)">');
  assert.equal(item.children[2].textContent, "비의료 사업");
  get("excluded-articles-details").toggle();
  assert.equal(calls, 1);
  listeners.get("collection-finished")();
  await new Promise(setImmediate);
  assert.equal(calls, 2);
});

test("공개 화면에는 이중 선별 스위치가 없고 제외 검토는 관리 영역에 있습니다", () => {
  for (const file of ["index.html", "articles.js", "stats.js"]) {
    assert.doesNotMatch(readFileSync(new URL(`../static/${file}`, import.meta.url), "utf8"), /only-full/);
  }
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  const review = html.indexOf('id="excluded-articles-details"');
  assert.ok(review > html.indexOf('id="collection-management"'));
  assert.ok(review < html.indexOf('id="exposure-management"'));
});
