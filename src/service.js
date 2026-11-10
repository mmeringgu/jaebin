// 기사 수집·저장·예약 수집의 전체 흐름입니다. (예전 app/service.py)
import { summarize, periodReport, trendInsight } from "./ai_summary.js";
import { buildBriefing, sendBriefing } from "./briefing.js";
import { loadCandidates, readArticle } from "./crawler.js";
import { all, first, run } from "./db.js";
import { articleTags, hostOf, keywordMatch, selection, selectionLevel } from "./rules.js";
import { addDays, automationSettings, CONFIG, integer, koreaNow, SOURCE_BY_ID, SOURCES } from "./settings.js";

// DB의 summary 칸(JSON 글)을 읽습니다. 형식이 이상하면 빈 요약을 돌려줍니다.
export function parseExcerpt(value) {
  try {
    const result = JSON.parse(value);
    if (result && result.format === "excerpt") return result;
  } catch {
    // 형식이 맞지 않으면 아래 빈 값을 씁니다.
  }
  return { format: "excerpt", subtitle: "", first_paragraph: "" };
}

// 아직 본문을 읽지 않은(또는 설정이 바뀌어 다시 읽어야 하는) 기사 후보를 고르는 조건입니다.
const PENDING_CONDITION = `expires_at>CURRENT_TIMESTAMP AND processing_status='pending'
  AND (fetch_status='pending' OR (fetch_status='success' AND snippet NOT LIKE ?))
  AND (body_fetched_at IS NULL OR body_fetched_at<=datetime('now','-1 minute'))`;
// 키워드가 모두 맞은(full) 기사 → 먼저 모은 기사 순서로 처리합니다.
const PENDING_ORDER = `ORDER BY CASE WHEN snippet LIKE '%"match_level":"full"%' THEN 0 ELSE 1 END,first_collected_at,id LIMIT 1`;
const CURRENT_VERSION = '%"config_version":"' + CONFIG.version + '"%';

// ───────────────────────── 동시 실행 막기 ─────────────────────────

// 수집 작업이 두 개 동시에 돌지 않도록 DB에 "사용 중" 표시를 하고 작업(task)을 실행합니다.
// 표시는 2분이 지나면 자동으로 풀립니다. (작업이 중간에 멈춰도 영원히 잠기지 않게)
export async function withCollectorLock(env, task) {
  const token = crypto.randomUUID();
  const now = Date.now();
  const claimed = await first(env.DB, "UPDATE monitor_control SET lock_token=?,lock_until=? WHERE id=1 AND lock_until<=? RETURNING id", [token, now + 120000, now]);
  if (!claimed) throw new Error("다른 수집 작업이 실행 중입니다. 잠시 후 다시 시도해 주세요.");
  try {
    return await task();
  } finally {
    await run(env.DB, "UPDATE monitor_control SET lock_token='',lock_until=0 WHERE id=1 AND lock_token=?", [token]);
  }
}

// ───────────────────────── 기사 목록 수집 ─────────────────────────

// 정보원 목록 페이지에서 키워드에 맞는 기사 후보를 모아 저장합니다.
export async function collectSource(env, source, scheduled = false) {
  const db = env.DB;
  // 오래된 기록부터 정리합니다.
  await run(db, "DELETE FROM news_candidates WHERE expires_at<=CURRENT_TIMESTAMP");
  await run(db, "DELETE FROM collection_runs WHERE started_at<=datetime('now','-7 days')");
  await archiveOldArticles(env);

  if (!scheduled) {
    const recent = await first(db, "SELECT id FROM collection_runs WHERE source_id=? AND source_name=? AND started_at>datetime('now','-10 minutes')", [source.id, source.name]);
    if (recent) throw new Error("같은 정보원은 10분 후 다시 수집할 수 있습니다.");
  }
  const runRow = await first(db, "INSERT INTO collection_runs(source_id,source_name,run_status) VALUES(?,?,'running') RETURNING id", [source.id, source.name]);

  try {
    const items = await loadCandidates(source);
    const matched = items.filter((a) => a.groups.length > 0).slice(0, 30);

    // 후보는 최대 500건까지만 저장합니다.
    const knownRows = await all(db, "SELECT url FROM news_candidates");
    const known = new Set(knownRows.map((r) => r.url));
    let available = Math.max(0, 500 - known.size);
    let saved = 0;
    const statements = [];
    for (const a of matched) {
      // 이미 다른 정보원이 찾아 둔 기사는 빙 검색이 덮어쓰지 않습니다. (원래 정보원이 본문을 더 자세히 읽음)
      if (source.kind === "bing" && known.has(a.url)) continue;
      const isNew = !known.has(a.url);
      if (isNew && available <= 0) continue;
      if (isNew) {
        available--;
        saved++;
      }
      let snippet = JSON.stringify({ match_level: a.matchLevel, config_version: "" });
      // 빙 뉴스 검색 기사는 날짜·앞부분 문장을 이미 알고 있으므로 미리 넣어 둡니다.
      // 그러면 "본문 읽기" 때 원문 페이지를 가져오지 않고 이 내용을 그대로 씁니다.
      if (a.description) {
        snippet = JSON.stringify({ format: "excerpt", subtitle: "", first_paragraph: a.description, media: a.media, match_level: a.matchLevel, config_version: "" });
      }
      statements.push(db.prepare(`INSERT INTO news_candidates(source_id,source_name,title,url,suggested_category,matched_keyword_groups_json,snippet,published_date,body_text)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
        source_id=excluded.source_id,source_name=excluded.source_name,title=excluded.title,
        suggested_category=excluded.suggested_category,matched_keyword_groups_json=excluded.matched_keyword_groups_json,
        snippet=CASE WHEN news_candidates.fetch_status='success' THEN news_candidates.snippet ELSE excluded.snippet END,
        processing_status='pending',fetch_status=CASE WHEN news_candidates.fetch_status='error' THEN 'pending' ELSE news_candidates.fetch_status END,
        last_collected_at=CURRENT_TIMESTAMP,expires_at=datetime('now','+7 days')`)
        .bind(source.id, source.name, a.title, a.url, a.category, JSON.stringify(a.groups), snippet, a.date || null, a.description || ""));
    }
    const selected = statements.length;
    statements.push(db.prepare("UPDATE collection_runs SET finished_at=CURRENT_TIMESTAMP,run_status='success',found_count=?,saved_count=? WHERE id=?").bind(items.length, saved, runRow.id));
    // 여러 저장을 한 번에 묶어서 실행합니다. (중간에 실패하면 전부 취소)
    await db.batch(statements);

    return {
      source: source.label || source.name,
      found: items.length,
      selected,
      saved,
      lists: 1,
      warning: selected < matched.length ? "후보 저장 상한 500건으로 일부 새 기사를 저장하지 못했습니다." : "",
    };
  } catch (error) {
    await run(db, "UPDATE collection_runs SET finished_at=CURRENT_TIMESTAMP,run_status='error',error_message=? WHERE id=?", [String(error.message).slice(0, 300), runRow.id]);
    throw error;
  }
}

// ───────────────────────── 기사 본문 읽기 ─────────────────────────

// 본문을 읽을 다음 기사 후보 하나를 고릅니다.
function findPending(env, source, articleId = null) {
  return first(env.DB, `SELECT * FROM news_candidates WHERE source_id=? AND source_name=? AND (? IS NULL OR id=?) AND ${PENDING_CONDITION} ${PENDING_ORDER}`,
    [source.id, source.name, articleId, articleId, CURRENT_VERSION]);
}

// 후보 기사 하나의 본문을 읽고, AI 요약을 붙여 게시합니다.
export async function readBody(env, source, articleId = null) {
  const db = env.DB;
  const candidate = await findPending(env, source, articleId);
  if (!candidate) return { message: "처리할 기사 없음" };

  // 키워드 설정이 바뀌어 더 이상 맞지 않는 기사는 제외합니다.
  const groups = keywordMatch(candidate.title, source);
  if (groups.length === 0) {
    await run(db, "UPDATE news_candidates SET processing_status='excluded' WHERE id=?", [candidate.id]);
    return { skipped: true };
  }
  await run(db, "UPDATE news_candidates SET body_fetched_at=CURRENT_TIMESTAMP WHERE id=?", [candidate.id]);

  let detail = { date: null };
  let error = "";
  try {
    // 이미 읽어 둔 기사면 다시 가져오지 않고 저장된 내용을 씁니다.
    const cached = parseExcerpt(candidate.snippet);
    if (cached.first_paragraph && candidate.published_date) {
      detail = { date: candidate.published_date, body: candidate.body_text, excerpt: cached };
    } else {
      detail = await readArticle(candidate.url, source, candidate.title);
    }
    if (!detail.date || !detail.excerpt.first_paragraph) throw new Error("발행일 또는 첫 문단을 확인하지 못했습니다.");

    const excerpt = { ...detail.excerpt, source_id: source.id, config_version: CONFIG.version, match_level: selectionLevel(groups) };
    // 빙 뉴스 검색 기사는 "빙 검색" 대신 실제 매체 이름(예: 조선일보)을 출처로 보여줍니다.
    const sourceName = excerpt.media ? excerpt.media + " (빙 검색)" : source.name;
    // 아직 AI 인사이트가 없는 기사만 GPT에 인사이트를 요청합니다.
    if (!excerpt.ai_summary) excerpt.ai_summary = await summarize(env, candidate.title, detail.body);

    // 기사 게시와 후보 갱신을 한 번에 처리합니다.
    await db.batch([
      // review_status를 'published'(게시)로 꼭 적어 줍니다. 예전 D1은 비워 두면 'draft'(임시)가 되어 화면에 안 나옵니다.
      db.prepare(`INSERT INTO articles(category,entity,published_date,source,title,url,summary,tags_json,review_status)
        VALUES(?,?,?,?,?,?,?,?,'published') ON CONFLICT(url) DO UPDATE SET category=excluded.category,entity=excluded.entity,
        published_date=excluded.published_date,source=excluded.source,title=excluded.title,summary=excluded.summary,
        tags_json=excluded.tags_json,is_sample=0,updated_at=CURRENT_TIMESTAMP`)
        .bind(groups[0].category, groups[0].mainMatches[0], detail.date, sourceName, candidate.title, candidate.url, JSON.stringify(excerpt), JSON.stringify(articleTags(groups))),
      db.prepare(`UPDATE news_candidates SET published_date=?,body_text=?,snippet=?,fetch_status='success',
        fetch_error='',body_fetched_at=CURRENT_TIMESTAMP,suggested_category=?,matched_keyword_groups_json=? WHERE id=?`)
        .bind(detail.date, detail.body, JSON.stringify(excerpt), groups[0].category, JSON.stringify(groups.map((g) => g.id)), candidate.id),
    ]);
  } catch (e) {
    console.warn("기사 읽기 실패:", candidate.url, e.message);
    error = String(e.message).slice(0, 300);
    await run(db, "UPDATE news_candidates SET fetch_status='error',fetch_error=?,body_fetched_at=CURRENT_TIMESTAMP WHERE id=?", [error, candidate.id]);
    detail = { date: null };
  }
  return {
    source: source.label || source.name,
    title: candidate.title,
    published_date: detail.date,
    groups: groups.map((g) => g.id),
    error,
  };
}

// ───────────────────────── 화면에 보여줄 목록 ─────────────────────────

// 수집 화면용: 최근 기사 후보 50건
export async function candidates(env, sourceId = null) {
  const source = SOURCE_BY_ID[sourceId];
  let sql = "SELECT *,LENGTH(body_text) AS body_length FROM news_candidates WHERE expires_at>CURRENT_TIMESTAMP";
  let args = [];
  if (source) {
    sql += " AND source_id=? AND source_name=?";
    args = [sourceId, source.name];
  }
  const rows = await all(env.DB, sql + " ORDER BY first_collected_at DESC,id DESC LIMIT 50", args);
  const result = [];
  for (const row of rows) {
    const current = SOURCE_BY_ID[row.source_id];
    if (!current || current.name !== row.source_name || hostOf(row.url) !== hostOf(current.url)) continue;
    const chosen = selection(row.title, current);
    if (!chosen.selected) continue;
    delete row.body_text; // 본문은 길어서 화면에 보내지 않습니다.
    result.push({ ...row, selection: chosen, excerpt: parseExcerpt(row.snippet) });
  }
  return result;
}

// 뉴스 화면용: 게시된 기사 최대 500건 (숨긴 기사도 함께 보내고, 화면에서 보일지 정합니다)
// 통계 탭이 최근 90일을 다 보려면 넉넉해야 해서 200건 → 500건으로 늘렸습니다.
export async function articles(env) {
  const rows = await all(env.DB, "SELECT * FROM articles WHERE review_status='published' AND archived=0 AND is_sample=0 ORDER BY published_date DESC,id DESC");
  const result = [];
  for (const row of rows) {
    const excerpt = parseExcerpt(row.summary);
    if (!excerpt.first_paragraph) continue;

    // 이 기사를 가져온 정보원을 찾고, 지금 키워드 설정으로 다시 분류합니다.
    // 저장할 때 적어 둔 정보원 ID(source_id)가 같으면 그 정보원입니다.
    // (빙 검색 기사는 주소가 bing.com이 아니라 원래 언론사 주소라서, 주소만 비교하면 못 찾고 화면에서 빠졌습니다)
    const sources = SOURCES.filter((s) => s.id === excerpt.source_id || (hostOf(row.url) === hostOf(s.url) && s.name === row.source));
    sources.sort((a, b) => (a.id === excerpt.source_id ? 0 : 1) - (b.id === excerpt.source_id ? 0 : 1));
    let groups = [];
    for (const s of sources) {
      groups = keywordMatch(row.title, s);
      if (groups.length > 0) break;
    }
    if (groups.length === 0) continue;

    result.push({
      id: row.id, category: groups[0].category, match_level: selectionLevel(groups),
      entity: groups[0].mainMatches[0], date: row.published_date, source: row.source,
      title: row.title, url: row.url, subtitle: excerpt.subtitle || "",
      summary: excerpt.first_paragraph, ai_summary: excerpt.ai_summary || "", tags: articleTags(groups), track: null,
      is_sample: 0, content_type: "excerpt",
      starred: row.starred, memo: row.memo,
      hidden: row.hidden === 1, saved_at: row.created_at,
    });
    if (result.length === 500) break;
  }
  return result;
}

// 숨기지 않은 기사만 돌려줍니다. (CSV·브리핑·주간/월간 리포트용)
export async function visibleArticles(env) {
  return (await articles(env)).filter((a) => !a.hidden);
}

export async function setStar(env, articleId, starred) {
  await run(env.DB, "UPDATE articles SET starred=? WHERE id=?", [starred ? 1 : 0, articleId]);
}

export async function setMemo(env, articleId, memo) {
  await run(env.DB, "UPDATE articles SET memo=? WHERE id=?", [memo, articleId]);
}

export async function setHidden(env, articleId, hidden) {
  await run(env.DB, "UPDATE articles SET hidden=? WHERE id=?", [hidden ? 1 : 0, articleId]);
}

// 기사의 AI 인사이트를 (다시) 만들어 저장합니다. 예전 요약이 있으면 덮어씁니다. 실패하면 빈 글자를 돌려줍니다.
export async function remakeSummary(env, articleId) {
  const row = await first(env.DB, "SELECT title,url,summary FROM articles WHERE id=?", [articleId]);
  if (!row) return "";
  const excerpt = parseExcerpt(row.summary);
  // 원문 본문이 아직 남아 있으면 본문을, 없으면(7일 지나 지워진 경우) 부제목과 첫 문단을 보냅니다.
  const candidate = await first(env.DB, "SELECT body_text FROM news_candidates WHERE url=?", [row.url]);
  const body = candidate && candidate.body_text ? candidate.body_text : (excerpt.subtitle || "") + "\n" + excerpt.first_paragraph;
  const aiSummary = await summarize(env, row.title, body);
  if (aiSummary) {
    excerpt.ai_summary = aiSummary;
    await run(env.DB, "UPDATE articles SET summary=? WHERE id=?", [JSON.stringify(excerpt), articleId]);
  }
  return aiSummary;
}

// 오래된 기사를 보관함(archived)으로 옮겨 화면을 가볍게 합니다. ⭐나 메모가 있는 기사는 그대로 둡니다.
export async function archiveOldArticles(env) {
  const days = integer(env, "ARCHIVE_DAYS", 90, 7, 3650);
  const cutoff = addDays(koreaNow().day, -days);
  await run(env.DB, `UPDATE articles SET archived=1 WHERE archived=0
    AND published_date<? AND starred=0 AND memo=''`, [cutoff]);
}

// ───────────────────────── 주간·월간 리포트 · 브리핑 ─────────────────────────

// 최근 기사로 GPT 리포트를 만듭니다. ⭐ 기사가 있으면 그것만 씁니다.
// period가 "month"이면 최근 30일(월간), 그 밖에는 최근 7일(주간)입니다.
export async function makeReport(env, day, period) {
  const isMonth = period === "month";
  const days = isMonth ? 30 : 7;
  // 비용을 줄이기 위해 주간은 최대 30건, 월간은 최대 60건만 보냅니다.
  const maxCount = isMonth ? 60 : 30;

  const since = addDays(day, -(days - 1));
  const inRange = (await visibleArticles(env)).filter((a) => a.date >= since && a.match_level !== "main");
  const starred = inRange.filter((a) => a.starred);
  const chosen = (starred.length > 0 ? starred : inRange).slice(0, maxCount);
  if (chosen.length === 0) return { error: "최근 " + days + "일 동안 리포트에 쓸 기사가 없습니다." };

  const report = await periodReport(env, chosen, period);
  if (!report) return { error: "리포트를 만들지 못했습니다. OPENAI_API_KEY 설정과 인터넷 연결을 확인해 주세요." };
  return { report, article_count: chosen.length, only_starred: starred.length > 0, since, until: day };
}

// 통계 탭 "AI 인사이트": 최근 7일 기사로 이번 주 핵심 이슈 3가지와 한 문단 요약을 만듭니다.
export async function makeTrendInsight(env, day) {
  const since = addDays(day, -6);
  // 키워드가 다 맞은 기사만, 비용을 줄이기 위해 40건까지 보냅니다.
  const chosen = (await visibleArticles(env)).filter((a) => a.date >= since && a.match_level !== "main").slice(0, 40);
  if (chosen.length === 0) return { error: "최근 7일 동안 분석할 기사가 없습니다." };
  const insight = await trendInsight(env, chosen);
  if (!insight) return { error: "AI 인사이트를 만들지 못했습니다. OPENAI_API_KEY 설정과 인터넷 연결을 확인해 주세요." };
  return { ...insight, article_count: chosen.length, since, until: day };
}

// 오늘 아직 브리핑을 안 보냈다면 웹훅으로 보냅니다. 보냈으면 true.
async function sendDailyBriefing(env, day) {
  if (!String(env.BRIEFING_WEBHOOK_URL || "").trim()) return false;
  const control = await first(env.DB, "SELECT briefing_day FROM monitor_control WHERE id=1");
  if (control.briefing_day === day) return false;
  // 실패해도 1분마다 다시 보내지 않도록, 보내기 전에 오늘 날짜를 먼저 기록합니다. (하루 한 번만 시도)
  await run(env.DB, "UPDATE monitor_control SET briefing_day=? WHERE id=1", [day]);
  return sendBriefing(env, buildBriefing(await visibleArticles(env), day));
}

// ───────────────────────── 예약 수집 ─────────────────────────

// 예약 수집에 쓸 정보원 목록 (config.json의 auto_order 순서)
function automationSources(env) {
  const sources = CONFIG.auto_order.filter((id) => SOURCE_BY_ID[id]).map((id) => SOURCE_BY_ID[id]);
  return sources.slice(0, automationSettings(env).sourceLimit);
}

// 예약 수집 화면에 보여줄 오늘의 진행 상황
export async function automationStatus(env) {
  const settings = automationSettings(env);
  const sources = automationSources(env);
  const day = koreaNow().day;
  const control = await first(env.DB, "SELECT * FROM monitor_control WHERE id=1");
  const jobs = await all(env.DB, "SELECT * FROM monitor_jobs WHERE run_day=? ORDER BY started_at DESC,job_key DESC", [day]);
  const active = sources.map((s) => s.id);
  const recent = jobs.slice(0, 8).map((j) => ({ ...j, source: SOURCE_BY_ID[j.source_id]?.label || j.source_id }));
  return {
    setupRequired: false, settings, day, paused: control.pause_day === day,
    last_tick: control.last_tick, last_message: control.last_message, source_count: sources.length,
    sources: sources.map((s) => s.label || s.name),
    lists_done: jobs.filter((j) => j.kind === "list" && active.includes(j.source_id)).length,
    bodies_done: jobs.filter((j) => j.kind === "body").length,
    failed: jobs.filter((j) => j.status === "error" || j.status === "aborted").length,
    recent,
  };
}

// 정보원별 수집 상태를 만듭니다. (수집 관리 탭의 "정보원 상태" 표)
// 수집 기록(collection_runs)은 7일만 보관하므로 최근 7일 기준입니다.
export async function sourceStatus(env) {
  const rows = await all(env.DB, `SELECT source_id,
      MAX(started_at) AS last_run,
      MAX(CASE WHEN saved_count>0 THEN started_at END) AS last_new,
      SUM(saved_count) AS new_count,
      SUM(run_status='error') AS error_count
    FROM collection_runs GROUP BY source_id`);
  const lastErrors = await all(env.DB, `SELECT source_id, error_message FROM collection_runs
    WHERE id IN (SELECT MAX(id) FROM collection_runs GROUP BY source_id) AND run_status='error'`);

  return SOURCES.map((s) => {
    const row = rows.find((r) => r.source_id === s.id) || {};
    const lastError = lastErrors.find((r) => r.source_id === s.id);
    return {
      name: s.label || s.name,
      lastRun: row.last_run || null, // 마지막으로 목록을 확인한 시각
      lastNew: row.last_new || null, // 마지막으로 새 기사를 찾은 시각
      newCount: row.new_count || 0, // 최근 7일 동안 찾은 새 기사 수
      errorCount: row.error_count || 0, // 최근 7일 실패 횟수
      lastError: lastError ? lastError.error_message : "", // 가장 최근 수집이 실패했다면 그 이유
    };
  });
}

// 1분마다 불려서 작업을 "딱 하나"만 합니다.
// 순서: 정보원 목록 수집(정보원마다 하루 1번) → 기사 본문 읽기(하루 상한까지) → 모두 끝나면 아침 브리핑
export async function scheduledStep(env, manual = false, time = Date.now()) {
  const { day, hour } = koreaNow(time);
  const settings = automationSettings(env);
  if (!manual && !settings.enabled) return { status: "disabled", message: "자동 수집 꺼짐" };
  if (!manual && hour < 7) return { status: "waiting", message: "한국시간 오전 7시부터 처리합니다." };

  return withCollectorLock(env, async () => {
    const db = env.DB;
    await run(db, "UPDATE monitor_jobs SET status='aborted',finished_at=CURRENT_TIMESTAMP,message='이전 작업 중단' WHERE status='running' AND started_at<=datetime('now','-3 minutes')");
    await run(db, "DELETE FROM monitor_jobs WHERE run_day<date(?,'-7 days')", [day]);
    const control = await first(db, "SELECT * FROM monitor_control WHERE id=1");
    const daily = await all(db, "SELECT * FROM monitor_jobs WHERE run_day=?", [day]);
    const isFailed = (j) => j.status === "error" || j.status === "aborted";

    if (control.pause_day === day) return { status: "paused", message: "오늘 자동 수집이 중지되어 있습니다." };
    if (daily.filter(isFailed).length >= 10) {
      await run(db, "UPDATE monitor_control SET pause_day=?,last_tick=CURRENT_TIMESTAMP,last_message='하루 실패 10회로 중지' WHERE id=1", [day]);
      return { status: "paused", message: "하루 실패 10회로 중지" };
    }

    // 1) 오늘 아직 목록을 수집하지 않은 정보원을 찾습니다.
    const sources = automationSources(env);
    let source = sources.find((s) => !daily.some((j) => j.kind === "list" && j.source_id === s.id)) || null;
    let kind = "list";
    let candidate = null;

    // 2) 목록 수집이 다 끝났으면, 본문을 읽을 기사 하나를 찾습니다.
    if (!source) {
      if (daily.filter((j) => j.kind === "body").length >= settings.maxBodies) {
        // 하루 처리 상한에 걸려도 오늘 수집은 끝난 것이므로 브리핑을 보냅니다.
        await sendDailyBriefing(env, day);
        return { status: "limit", message: "오늘 기사 처리 상한에 도달했습니다." };
      }
      kind = "body";
      for (const s of sources) {
        // 오늘 3번 이상 실패한 정보원은 건너뜁니다.
        if (daily.filter((j) => j.source_id === s.id && isFailed(j)).length >= 3) continue;
        // 같은 날 이미 시도한 후보는 제외하고 다음 후보를 찾습니다.
        const row = await first(db, `SELECT id FROM news_candidates WHERE source_id=? AND source_name=? AND ${PENDING_CONDITION}
          AND NOT EXISTS(SELECT 1 FROM monitor_jobs j WHERE j.run_day=? AND j.kind='body' AND j.article_id=news_candidates.id)
          ${PENDING_ORDER}`, [s.id, s.name, CURRENT_VERSION, day]);
        if (row) {
          source = s;
          candidate = row;
          break;
        }
      }
      if (!source) {
        // 오늘 할 수집이 모두 끝났으니 아침 브리핑을 보냅니다.
        await sendDailyBriefing(env, day);
        await run(db, "UPDATE monitor_control SET last_tick=CURRENT_TIMESTAMP,last_message='처리할 작업 없음' WHERE id=1");
        return { status: "idle", message: "처리할 작업 없음" };
      }
    }

    // 3) 같은 작업을 두 번 하지 않도록 작업 기록을 먼저 남깁니다.
    const key = day + ":" + kind + ":" + (candidate ? candidate.id : source.id);
    const claimed = await first(db, "INSERT OR IGNORE INTO monitor_jobs(job_key,run_day,kind,source_id,article_id,status) VALUES(?,?,?,?,?,'running') RETURNING job_key",
      [key, day, kind, source.id, candidate ? candidate.id : null]);
    if (!claimed) return { status: "skipped", message: "이미 처리한 작업" };
    await run(db, "UPDATE monitor_control SET last_tick=CURRENT_TIMESTAMP,last_message=? WHERE id=1", [source.name + " · 처리 중"]);

    // 4) 작업 실행
    let status;
    let message;
    try {
      const result = kind === "list" ? await collectSource(env, source, true) : await readBody(env, source, candidate.id);
      const doneMessage = kind === "list" ? "목록 확인 완료 · 새 기사 " + result.saved + "건" : "기사 확인 완료";
      message = result.error || result.warning || result.message || doneMessage;
      if (result.error) status = "error";
      else if (result.skipped || result.message) status = "skipped";
      else status = "success";
    } catch (error) {
      status = "error";
      message = String(error.message).slice(0, 300);
    }
    await run(db, "UPDATE monitor_jobs SET status=?,message=?,finished_at=CURRENT_TIMESTAMP WHERE job_key=?", [status, message, key]);
    await run(db, "UPDATE monitor_control SET last_message=? WHERE id=1", [source.name + " · " + message]);
    return { status, kind, source: source.label || source.name, message };
  });
}
