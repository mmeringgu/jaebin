import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (name) => readFileSync(new URL(`../static/${name}.js`, import.meta.url), "utf8");
const api = runInNewContext(read("news-rules") + "\n" + read("stats") + "\n({policyStatus,policyBoard,policyChangeGroups,policyChanges});", {
  articles: [], document: { getElementById: () => ({ addEventListener() {} }) },
  kstDate: () => "2026-11-18",
  esc: (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
});
const article = (id, title, changes = {}) => ({ id, title, subtitle: "", category: "policy", date: "2026-11-18",
  source: `매체${id}`, url: `https://example.com/${id}`, ...changes });
const status = (name, latest, changes = {}) => ({ policy: { name }, changed: true, now: "확정", before: "논의", latest, ...changes });

test("한 기사가 두 정책에 해당해도 단계 변화의 기사 제목은 한 번만 표시합니다", () => {
  const latest = article(3, "검사 수가 개편 및 관리급여 확정");
  const rows = [article(1, "검사 수가 개편 논의", { date: "2026-11-10" }), latest,
    article(2, "관리급여 추진", { date: "2026-11-11" })]; // 입력 순서에 의존하지 않습니다.
  const statuses = api.policyStatus(rows), changed = statuses.filter((s) => s.changed);
  assert.equal(changed.length, 2);
  assert.equal(changed[0].before, "논의");assert.equal(changed[1].before, "발의");
  assert.ok(changed.every((s) => s.latest.id === 3 && s.now === "확정"));
  const groups = api.policyChangeGroups(statuses);
  assert.equal(groups.length, 1);assert.equal(groups[0].changes.length, 2);
  const html = api.policyChanges(statuses);
  assert.equal((html.match(/<li>/g) || []).length, 1);
  assert.equal((html.match(/검사 수가 개편 및 관리급여 확정/g) || []).length, 1);
  assert.match(html, /검사 수가 인하·수가 개편/);assert.match(html, /관리급여 \(비급여 관리\)/);
  assert.match(html, /논의 → <b>확정/);assert.match(html, /발의 → <b>확정/);
  assert.equal((api.policyBoard(statuses).match(/검사 수가 개편 및 관리급여 확정/g) || []).length, 2);
});

test("다른 매체의 동일 소식은 최신 기사와 추가 출처로 합칩니다", () => {
  const first = article(1, "검사 수가 개편 및 관리급여 확정", { date: "2026-11-17" });
  const latest = article(2, first.title);
  const rows = [status("수가", first), status("관리급여", latest)];
  const groups = api.policyChangeGroups(rows);
  assert.equal(groups.length, 1);assert.equal(groups[0].main.id, 2);assert.equal(groups[0].others[0].id, 1);
  const html = api.policyChanges(rows);
  assert.equal((html.match(/<li>/g) || []).length, 1);assert.match(html, /추가 출처 1건/);
  assert.match(html, /https:\/\/example.com\/1/);assert.match(html, /https:\/\/example.com\/2/);
  assert.equal((html.match(/검사 수가 개편 및 관리급여 확정/g) || []).length, 1);
});

test("단계가 다르거나 별개의 소식은 합치지 않으며 변화 없는 정책은 제외합니다", () => {
  const rows = [status("수가", article(1, "검사 수가 개편 확정")),
    status("관리급여", article(2, "검사 수가 개편 확정"), { now: "시행" }),
    status("장비", article(3, "특수의료장비 설치 기준 공포")),
    status("의료 AI", article(4, "의료 AI 보상 논의"), { changed: false })];
  const groups = api.policyChangeGroups(rows);
  assert.equal(groups.length, 3);
  assert.equal((api.policyChanges(rows).match(/<li>/g) || []).length, 3);
  assert.doesNotMatch(api.policyChanges(rows), /의료 AI 보상/);
  assert.match(api.policyChanges([]), /이번 주에 단계가 바뀐 정책이 없습니다/);
});

test("동일 URL·정책의 반복을 제거하며 정책명과 기사 제목을 안전하게 표시합니다", () => {
  const a = article(1, '<img src=x> 수가 확정');
  const rows = [status('<script>정책</script>', a), status('<script>정책</script>', { ...a, id: 2 })];
  const groups = api.policyChangeGroups(rows);
  assert.equal(groups.length, 1);assert.equal(groups[0].changes.length, 1);assert.equal(groups[0].others.length, 0);
  const html = api.policyChanges(rows);
  assert.doesNotMatch(html, /<img|<script>/);assert.match(html, /&lt;script&gt;/);
});
