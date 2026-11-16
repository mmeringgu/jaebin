// 원제는 articles.title에 유지하고 한국어 제목은 기존 summary JSON에 보관합니다.
import { translateTitle } from "./ai_summary.js";
import { SOURCE_BY_ID } from "./settings.js";

const VERSION = 1;
const inFlight = new Map();
const retryDelay = 15 * 60 * 1000;

export function needsTitleTranslation(title) {
  const normalized = String(title || "").normalize("NFKC");
  return !/[가-힣]/.test(normalized) && /[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(normalized);
}

export function translatedTitle(excerpt, original) {
  const saved = excerpt.title_translation;
  return saved?.version === VERSION && saved.original === original && typeof saved.ko === "string" && /[가-힣]/.test(saved.ko) ? saved.ko : "";
}

function canRetry(excerpt, original) {
  const saved = excerpt.title_translation;
  return saved?.version !== VERSION || saved.original !== original || !saved.retry_after || saved.retry_after <= Date.now();
}

export async function translateExcerptTitle(env, original, excerpt, language = "") {
  if (!needsTitleTranslation(original) || translatedTitle(excerpt, original) || !canRetry(excerpt, original) || !String(env.OPENAI_API_KEY || "").trim()) return excerpt;
  const ko = await translateTitle(env, original, language);
  return { ...excerpt, title_translation: { version: VERSION, original, ko,
    ...(ko ? {} : { retry_after: Date.now() + retryDelay }) } };
}

export async function warmArticleTranslations(env, rows, options = {}) {
  if (!String(env.OPENAI_API_KEY || "").trim() || !options.waitUntil) return;
  const pending = [];
  let failed = 0;
  for (const row of rows) {
    let excerpt;
    try { excerpt = JSON.parse(row.summary); } catch { continue; }
    if (excerpt?.format !== "excerpt" || !excerpt.first_paragraph || !needsTitleTranslation(row.title) || translatedTitle(excerpt, row.title)) continue;
    if (!canRetry(excerpt, row.title)) { failed++; continue; }
    pending.push({ row, excerpt });
  }
  options.onState?.({ pending: pending.length, failed });
  const batch = pending.filter(({ row }) => !(inFlight.get(row.id) > Date.now())).slice(0, 2);
  for (const { row } of batch) inFlight.set(row.id, Date.now() + 30000);
  if (!batch.length) return;
  options.waitUntil(Promise.all(batch.map(async ({ row, excerpt }) => {
    try {
      const language = excerpt.language || SOURCE_BY_ID[excerpt.source_id]?.language || "";
      const next = await translateExcerptTitle(env, row.title, excerpt, language);
      // 재수집이나 다른 요약 수정이 진행됐다면 덮어쓰지 않습니다.
      await env.DB.prepare("UPDATE articles SET summary=? WHERE id=? AND title=? AND summary=?")
        .bind(JSON.stringify(next), row.id, row.title, row.summary).run();
    } catch (error) {
      console.warn("제목 번역 저장 실패:", row.id, error.message);
    } finally { inFlight.delete(row.id); }
  })));
}
