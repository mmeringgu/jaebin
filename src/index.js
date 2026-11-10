// Cloudflare Worker의 입구입니다. (예전 app/main.py)
// - fetch(): 화면에서 오는 요청(/api/...)을 받아 알맞은 기능으로 보냅니다.
// - scheduled(): 1분마다 자동으로 불려서 예약 수집을 한 단계씩 진행합니다.
// 화면 파일(index.html, css, js)은 static 폴더에서 Cloudflare가 알아서 보내 줍니다. (wrangler.toml의 [assets])
import { addMissingColumns, first } from "./db.js";
import * as service from "./service.js";
import { CONFIG, koreaNow, SOURCE_BY_ID, SOURCES } from "./settings.js";

// ───────────────────────── 응답 만들기 도우미 ─────────────────────────

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// 오류에 HTTP 상태 번호를 붙여서 던집니다. 예: throw httpError(400, "기사 번호가 필요합니다.")
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ───────────────────────── 요청 내용 확인 ─────────────────────────

// 버튼에서 보낸 JSON을 읽습니다. 다른 사이트에서 몰래 호출하지 못하게 출처(Origin)도 확인합니다.
async function readJson(request, env, maxBytes = 200) {
  const origin = request.headers.get("Origin");
  const here = new URL(request.url);
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean);
  allowed.push(here.origin);
  if (origin && !allowed.includes(origin.replace(/\/$/, ""))) throw httpError(403, "등록된 사이트에서 실행해 주세요.");
  // Origin이 없는 요청은 내 PC(localhost)에서 시험할 때만 허용합니다.
  if (!origin && !["localhost", "127.0.0.1"].includes(here.hostname)) throw httpError(403, "사이트의 수집 버튼으로 실행해 주세요.");

  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw httpError(415, "application/json 형식이 필요합니다.");

  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBytes) throw httpError(413, "요청이 너무 큽니다.");
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw httpError(400, "요청 형식 오류");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw httpError(400, "JSON 객체가 필요합니다.");
  return payload;
}

function needArticleId(payload) {
  if (!Number.isInteger(payload.id)) throw httpError(400, "기사 번호가 필요합니다.");
}

// ───────────────────────── CSV 내보내기 ─────────────────────────

// 엑셀이 =, +, -, @로 시작하는 칸을 수식으로 읽어 오류(#NAME?)가 나지 않게 앞에 '를 붙입니다.
function safeCell(value) {
  const cell = String(value ?? "");
  return ["=", "+", "-", "@"].includes(cell[0]) ? "'" + cell : cell;
}

// 쉼표·따옴표·줄바꿈이 있는 칸은 "..."로 감쌉니다. (CSV 규칙)
function csvCell(value) {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

async function exportCsv(env) {
  const names = {};
  for (const c of CONFIG.categories) names[c.id] = c.name;
  const lines = [["발행일", "카테고리", "회사·기관", "출처", "제목", "AI 인사이트", "첫 문단", "키워드", "중요", "메모", "원문 링크"]];
  for (const a of await service.visibleArticles(env)) {
    // AI 인사이트의 "- " 줄머리는 엑셀에서 수식으로 읽히므로 "• "로 바꿉니다.
    const aiSummary = a.ai_summary.split("\n").map((line) => (line.startsWith("- ") ? "• " + line.slice(2) : line)).join("\n");
    lines.push([a.date, names[a.category] || a.category, a.entity, a.source, a.title,
      aiSummary, a.summary, a.tags.join(", "), a.starred ? "★" : "", a.memo, a.url].map(safeCell));
  }
  const csv = lines.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  // 엑셀에서 한글이 깨지지 않도록 맨 앞에 BOM(﻿)을 붙입니다.
  return new Response("﻿" + csv, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="smd-news.csv"',
    },
  });
}

// ───────────────────────── 주소별 처리 ─────────────────────────

async function handleApi(request, env, path) {
  const method = request.method;

  if (method === "GET" && path === "/api/health") {
    await first(env.DB, "SELECT 1");
    return json({ status: "ok", storage: "D1" });
  }
  if (method === "GET" && path === "/api/articles") {
    const rows = await service.articles(env);
    return json({ storage: "D1", count: rows.length, limit: 500, articles: rows });
  }
  if (method === "GET" && path === "/api/export.csv") {
    return exportCsv(env);
  }
  if (method === "GET" && path === "/api/sources") {
    return json({ sources: SOURCES.map((s) => ({ id: s.id, name: s.label || s.name })) });
  }
  if (method === "GET" && path === "/api/candidates") {
    const sourceId = new URL(request.url).searchParams.get("source_id");
    if (sourceId && !SOURCE_BY_ID[sourceId]) throw httpError(400, "등록되지 않은 정보원");
    return json({ candidates: await service.candidates(env, sourceId) });
  }
  if (method === "GET" && path === "/api/automation-status") {
    return json(await service.automationStatus(env));
  }
  if (method === "GET" && path === "/api/source-status") {
    return json({ sources: await service.sourceStatus(env) });
  }

  if (method === "POST" && path === "/api/article-star") {
    const payload = await readJson(request, env);
    if (!Number.isInteger(payload.id) || typeof payload.starred !== "boolean") throw httpError(400, "기사 번호와 중요 여부가 필요합니다.");
    await service.setStar(env, payload.id, payload.starred);
    return json({ ok: true });
  }
  if (method === "POST" && path === "/api/article-memo") {
    const payload = await readJson(request, env, 3000);
    if (!Number.isInteger(payload.id) || typeof payload.memo !== "string") throw httpError(400, "기사 번호와 메모가 필요합니다.");
    await service.setMemo(env, payload.id, payload.memo.trim().slice(0, 300));
    return json({ ok: true });
  }
  if (method === "POST" && path === "/api/article-hide") {
    const payload = await readJson(request, env);
    if (!Number.isInteger(payload.id) || typeof payload.hidden !== "boolean") throw httpError(400, "기사 번호와 숨김 여부가 필요합니다.");
    await service.setHidden(env, payload.id, payload.hidden);
    return json({ ok: true });
  }
  if (method === "POST" && path === "/api/article-summary") {
    // AI 인사이트가 없는 기사에 인사이트를 다시 만듭니다.
    const payload = await readJson(request, env);
    needArticleId(payload);
    const aiSummary = await service.remakeSummary(env, payload.id);
    if (!aiSummary) throw httpError(503, "AI 인사이트를 만들지 못했습니다. OPENAI_API_KEY 설정과 인터넷 연결을 확인해 주세요.");
    return json({ ai_summary: aiSummary });
  }
  if (method === "POST" && path === "/api/weekly-report") {
    // 화면에서 보낸 period가 "month"이면 월간, 아니면 주간 리포트를 만듭니다.
    const payload = await readJson(request, env);
    const period = payload.period === "month" ? "month" : "week";
    const result = await service.makeReport(env, koreaNow().day, period);
    if (result.error) throw httpError(503, result.error);
    return json(result);
  }

  if (method === "POST" && path === "/api/trend-insight") {
    // 통계 탭의 "AI 인사이트": 이번 주 핵심 이슈 3가지
    await readJson(request, env);
    const result = await service.makeTrendInsight(env, koreaNow().day);
    if (result.error) throw httpError(503, result.error);
    return json(result);
  }

  // 수집 버튼들: 기사 수집, 본문 읽기, 예약 작업 1회 시험
  if (method === "POST" && ["/api/collect", "/api/read-body", "/api/automation-step"].includes(path)) {
    const payload = await readJson(request, env);
    try {
      if (path === "/api/automation-step") return json(await service.scheduledStep(env, true));
      const source = SOURCE_BY_ID[payload.source_id];
      if (typeof payload.source_id !== "string" || !source) throw httpError(400, "등록되지 않은 정보원");
      const task = path === "/api/collect" ? () => service.collectSource(env, source) : () => service.readBody(env, source);
      return json(await service.withCollectorLock(env, task));
    } catch (error) {
      if (error.status) throw error;
      // "10분 후 다시", "실행 중" 같은 안내는 409(지금은 할 수 없음), 그 밖의 수집 실패는 503으로 알려 줍니다.
      const busy = error.message.includes("10분 후") || error.message.includes("실행 중");
      throw httpError(busy ? 409 : 503, String(error.message).slice(0, 300));
    }
  }

  throw httpError(404, "없는 주소입니다.");
}

export default {
  // 화면에서 요청이 올 때마다 불립니다.
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      await addMissingColumns(env.DB);
      return await handleApi(request, env, path);
    } catch (error) {
      if (error.status) return json({ error: error.message }, error.status);
      console.error("처리 중 오류:", error);
      return json({ error: "서버 오류: " + String(error.message).slice(0, 200) }, 500);
    }
  },

  // wrangler.toml의 crons 설정대로 1분마다 불립니다.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await addMissingColumns(env.DB);
        const result = await service.scheduledStep(env, false, controller.scheduledTime);
        if (!["disabled", "waiting", "idle"].includes(result.status)) console.log("예약 수집:", JSON.stringify(result));
      } catch (error) {
        console.error("예약 수집 실패:", error.message);
      }
    })());
  },
};
