import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("백그라운드 제목 복원이 끝나면 화면을 자동으로 재조회합니다", async () => {
  const source = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
  const start = source.indexOf("let titleRefreshTimer=");
  const code = source.slice(start, source.indexOf("\nrefreshArticles().catch", start));
  const timers = [];
  const displayed = [];
  const replies = [
    { articles: [{ title: "동국대일산병원은 평가 결과를 발표했다." }], title_refresh_pending: true },
    { articles: [{ title: "동국대일산병원, 결핵·COPD 1등급" }], title_refresh_pending: false },
  ];
  const context = vm.createContext({
    articles: [], console,
    async fetch() { return { ok: true, async json() { return replies.shift(); } }; },
    isAwardNews() { return false; }, splitConference(a) { return a; },
    changeFilters() { displayed.push(context.articles[0].title); },
    setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {},
  });
  vm.runInContext(code, context);
  await vm.runInContext("refreshArticles()", context);
  assert.equal(timers.length, 1);
  timers[0]();
  await new Promise(setImmediate);
  assert.deepEqual(displayed, ["동국대일산병원은 평가 결과를 발표했다.", "동국대일산병원, 결핵·COPD 1등급"]);
  assert.equal(timers.length, 1);
});

test("원문 조회 실패 시 실패 캐시 만료 후 다시 조회하고 성공하면 중단합니다", async () => {
  const source = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
  const start = source.indexOf("let titleRefreshTimer=");
  const code = source.slice(start, source.indexOf("\nrefreshArticles().catch", start));
  const timers = [], displayed = [];
  const replies = [
    { articles: [{ title: "2내년부터 필수의료 CT 수가 개편" }], title_refresh_pending: false, title_refresh_failed: 1 },
    { articles: [{ title: "내년부터 필수의료 CT 수가 개편" }], title_refresh_pending: false, title_refresh_failed: 0 },
  ];
  const context = vm.createContext({
    articles: [], console,
    async fetch() { return { ok: true, async json() { return replies.shift(); } }; },
    isAwardNews() { return false; }, splitConference(a) { return a; },
    changeFilters() { displayed.push(context.articles[0].title); },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {},
  });
  vm.runInContext(code, context);
  await vm.runInContext("refreshArticles()", context);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].delay > 60000);
  timers[0].callback();
  await new Promise(setImmediate);
  assert.deepEqual(displayed, ["2내년부터 필수의료 CT 수가 개편", "내년부터 필수의료 CT 수가 개편"]);
  assert.equal(timers.length, 1);
});
