import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { articles, setImpact, readBody } from "../src/service.js";

test("기존 DB 전환·수동 분류 저장·재조회·재수집·해제와 AI 생성 보류를 확인합니다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  // 기존 데이터베이스처럼 새 분류 칸이 없는 상태부터 확인합니다.
  sqlite.exec("ALTER TABLE articles DROP COLUMN impact_override");
  const db = {
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
    prepare(sql) {
      let args = [];
      const query = {
        bind(...values) { args = values; return query; },
        async run() { return { success: true, meta: sqlite.prepare(sql).run(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
      };
      return query;
    },
  };
  const env = { DB: db };
  const request = (path, payload) => worker.fetch(new Request("http://localhost" + path, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(payload),
  }), env);
  try {
    sqlite.prepare("INSERT INTO articles(id,category,entity,published_date,source,title,url,summary) VALUES(1,'company','캐논메디칼','2026-11-11',?,?,?,?)").run(
      "청년의사", "캐논메디칼 MRI 출시", "https://www.docdocdoc.co.kr/news/articleView.html?idxno=1",
      JSON.stringify({ format: "excerpt", first_paragraph: "기사 본문입니다.", source_id: "S012", ai_summary: "영향: 위협\n인사이트: 설명" }),
    );
    assert.equal((await request("/api/article-impact", { id: 1, impact: "위협" })).status, 200);
    assert.equal(sqlite.prepare("SELECT impact_override FROM articles WHERE id=1").get().impact_override, "위협");
    const visible = await articles(env);
    assert.equal(visible[0].impact_override, "위협");
    assert.equal(visible[0].ai_summary, "인사이트: 설명");
    // 실제 기사 재게시 경로가 수동 분류를 덮어쓰지 않는지 확인합니다.
    sqlite.prepare("INSERT INTO news_candidates(id,source_id,source_name,title,url,published_date,snippet,body_text) VALUES(1,'S012',?,?,?,?,?,?)").run(
      "청년의사", "캐논메디칼 MRI 출시", "https://www.docdocdoc.co.kr/news/articleView.html?idxno=1", "2026-11-11",
      JSON.stringify({ format: "excerpt", first_paragraph: "다시 읽은 기사 본문입니다." }), "다시 읽은 기사 본문입니다.",
    );
    const collected = await readBody(env, { id: "S012", name: "청년의사", status: "사용", categories: ["company"] }, 1);
    assert.equal(collected.error, "");
    assert.equal((await articles(env))[0].impact_override, "위협");
    for (const payload of [{ id: 1, impact: "참고" }, { id: 1 }, { id: -1, impact: "기회" }, { id: "1", impact: "기회" }]) {
      assert.equal((await request("/api/article-impact", payload)).status, 400);
    }
    assert.equal((await request("/api/article-impact", { id: 999, impact: "기회" })).status, 404);
    assert.equal((await request("/api/article-summary", { id: 1 })).status, 409);
    assert.equal((await request("/api/article-impact", { id: 1, impact: "" })).status, 200);
    assert.equal((await articles(env))[0].impact_override, "");
    await setImpact(env, 1, "기회");
    assert.equal((await articles(env))[0].impact_override, "기회");
  } finally {
    sqlite.close();
  }
});
