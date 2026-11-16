// 기본 실행은 원문 대조 결과와 교정 SQL만 생성합니다. --apply를 붙이면 D1에 반영합니다.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { originalArticleTitle } from "../src/article-title.js";

const database = "smd-news-db";
const source = { kind: "whosaeng" };
const outputDir = new URL("../.wrangler/title-repair/", import.meta.url);
mkdirSync(outputDir, { recursive: true });
const wrangler = new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url);
function d1(args) {
  const result = spawnSync(process.execPath, [fileURLToPath(wrangler), "d1", "execute", database, "--remote", ...args], {
    encoding: "utf8", env: process.env, timeout: 120000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || "D1 실행 실패");
  return result.stdout;
}
const query = "SELECT 'articles' AS table_name,id,title,url FROM articles WHERE source='후생신보' OR url LIKE '%whosaeng.com/%' UNION ALL SELECT 'news_candidates' AS table_name,id,title,url FROM news_candidates WHERE source_id='S018' OR url LIKE '%whosaeng.com/%'";
const inputIndex = process.argv.indexOf("--input");
const rows = inputIndex >= 0 ? JSON.parse(readFileSync(process.argv[inputIndex + 1], "utf8"))
  : JSON.parse(d1(["--command", query, "--json"])).flatMap((result) => result.results || []);
// 수정 전 제목을 남겨 실제 반영 후에도 대조할 수 있게 합니다.
writeFileSync(new URL("before.json", outputDir), JSON.stringify(rows, null, 2));
const titles = new Map();
const failures = [];
for (const { url } of rows) {
  if (titles.has(url)) continue;
  titles.set(url, "");
  try {
    const parsed = new URL(url);
    if (!/^(www\.)?whosaeng\.com$/i.test(parsed.hostname)) throw new Error("후생신보 주소가 아닙니다.");
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const bytes = await response.arrayBuffer();
    const utf8 = new TextDecoder().decode(bytes);
    const charset = response.headers.get("content-type") || utf8.slice(0, 2000);
    const page = /(?:euc-kr|ks_c_5601|cp949)/i.test(charset) ? new TextDecoder("euc-kr").decode(bytes) : utf8;
    const title = originalArticleTitle(page, source);
    if (!title) throw new Error("원문 제목 메타데이터를 확인하지 못했습니다.");
    titles.set(url, title);
  } catch (error) {
    failures.push({ url, error: error.message });
  }
}
const changes = rows.filter((row) => titles.get(row.url) && row.title !== titles.get(row.url))
  .map((row) => ({ ...row, corrected_title: titles.get(row.url) }));
const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
const sql = changes.map((row) => {
  if (!["articles", "news_candidates"].includes(row.table_name) || !Number.isInteger(row.id)) throw new Error("교정 대상 형식 오류");
  // 원문 대조 이후 변경된 기사는 덮어쓰지 않습니다. 제목 외 데이터는 보존합니다.
  return `UPDATE ${row.table_name} SET title=${quote(row.corrected_title)} WHERE id=${row.id} AND url=${quote(row.url)} AND title=${quote(row.title)};`;
}).join("\n");
writeFileSync(new URL("review.json", outputDir), JSON.stringify({ changes, failures }, null, 2));
const sqlPath = new URL("repair.sql", outputDir);
writeFileSync(sqlPath, sql + "\n");
console.log(JSON.stringify({ checked: rows.length, changes: changes.length, failures, review: outputDir.href }, null, 2));
if (process.argv.includes("--apply") && changes.length) {
  // 실패가 있는 경우 부분 반영으로 끝내지 않고 먼저 실패 원인을 해결합니다.
  if (failures.length) throw new Error("원문 대조 실패가 있어 DB 반영을 중단했습니다.");
  console.log(d1(["--file", fileURLToPath(sqlPath), "--yes"]));
}
