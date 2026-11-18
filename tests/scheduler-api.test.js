import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { scheduledStep, automationStatus } from "../src/service.js";
import { CONFIG, SOURCE_BY_ID } from "../src/settings.js";

const day = "2026-11-17", morning = Date.parse("2026-11-17T08:00:00+09:00");
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const db = {
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
    prepare(sql) {
      let args = [];
      const query = {
        bind(...values) { args = values; return query; },
        async run() { return { success: true, meta: sqlite.prepare(sql).run(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      };
      return query;
    },
  };
  const list = sqlite.prepare("INSERT INTO monitor_jobs(job_key,run_day,kind,source_id,status,started_at) VALUES(?,?,'list',?,'success','2026-11-16 22:00:00')");
  for (const source_id of CONFIG.auto_order) list.run(`${day}:list:${source_id}:am`, day, source_id);
  const addBodyJobs = (count) => {
    const stmt = sqlite.prepare("INSERT INTO monitor_jobs(job_key,run_day,kind,source_id,article_id,category,status,started_at) VALUES(?,?,'body','S012',?,'policy','success','2026-11-16 23:00:00')");
    for (let i = 0; i < count; i++) stmt.run(`${day}:body:${1000 + i}`, day, 1000 + i);
  };
  const canon = () => {
    const s = SOURCE_BY_ID.S029;
    sqlite.prepare("INSERT INTO news_candidates(id,source_id,source_name,title,url,published_date,suggested_category,snippet,body_text) VALUES(1,?,?,?,?,'2026-11-17','company',?,'cached body')")
      .run(s.id, s.name, "Canon Medical MRI system launch", "https://global.medical.canon/news/pressrelease/2026/2026-11-17/",
        JSON.stringify({ format: "excerpt", first_paragraph: "Canon Medical introduces a new MRI system for hospitals.", language: "en" }));
  };
  return { sqlite, env: { DB: db, AUTO_ENABLED: "true", AUTO_SOURCE_LIMIT: "40", AUTO_MAX_BODY_PER_DAY: "160" }, addBodyJobs, canon };
}

test("일반 기사를 120회 처리했어도 캐논 후보를 우선 게시합니다", async (t) => {
  const { sqlite, env, addBodyJobs, canon } = database();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("캐시된 본문을 사용해야 합니다."); });
  try {
    addBodyJobs(120);canon();
    const result = await scheduledStep(env, false, morning);
    assert.equal(result.kind, "body");assert.equal(result.status, "success");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM articles WHERE category='company'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT category FROM monitor_jobs WHERE article_id=1").get().category, "company");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM monitor_jobs WHERE kind='body'").get().n, 121);
  } finally { sqlite.close(); }
});

test("160회 상한은 캐논에도 적용하고 현황에 대기 후보와 배정량을 표시합니다", async (t) => {
  t.mock.method(Date, "now", () => morning);
  const { sqlite, env, addBodyJobs, canon } = database();
  try {
    addBodyJobs(160);canon();
    const result = await scheduledStep(env, false, morning);
    assert.equal(result.status, "limit");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 0);
    const status = await automationStatus(env);
    assert.equal(status.bodies_done, 160);
    assert.equal(status.settings.maxBodies, 160);
    assert.equal(status.categories.find((r) => r.category === "company").pending, 1);
    assert.equal(status.categories.find((r) => r.category === "policy").target, 45);
  } finally { sqlite.close(); }
});

test("같은 제목으로 게시된 후보는 자동 재처리하여 일일 한도를 소비하지 않습니다", async () => {
  const { sqlite, env, canon } = database();
  try {
    canon();
    sqlite.prepare("INSERT INTO articles(category,entity,published_date,source,title,url,summary) SELECT 'company','Canon Medical',published_date,source_name,title,url,snippet FROM news_candidates WHERE id=1").run();
    const result = await scheduledStep(env, false, morning);
    assert.equal(result.status, "idle");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM monitor_jobs WHERE kind='body'").get().n, 0);
  } finally { sqlite.close(); }
});

test("정보원별 세 번 실패와 하루 열 번 실패 중지 조건을 유지합니다", async () => {
  const { sqlite, env, canon } = database();
  try {
    canon();
    const insert = sqlite.prepare("INSERT INTO monitor_jobs(job_key,run_day,kind,source_id,article_id,status) VALUES(?,?,'body','S029',?,'error')");
    for (let i = 0; i < 3; i++) insert.run(`${day}:body:${2000 + i}`, day, 2000 + i);
    assert.equal((await scheduledStep(env, false, morning)).status, "idle");
    for (let i = 3; i < 10; i++) insert.run(`${day}:body:${2000 + i}`, day, 2000 + i);
    assert.equal((await scheduledStep(env, false, morning)).status, "paused");
    assert.equal(sqlite.prepare("SELECT pause_day FROM monitor_control WHERE id=1").get().pause_day, day);
  } finally { sqlite.close(); }
});
