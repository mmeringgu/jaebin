// D1을 변경하지 않고 후생신보 제목과 라포르시안의 순위 혼입 제목을 원문으로 복원합니다.
import { cleanArticleTitle, originalArticleTitle } from "./article-title.js";
import { articleUrl, fetchPage } from "./crawler.js";
import { SOURCE_BY_ID } from "./settings.js";

const source = SOURCE_BY_ID.S018;
const rankedSource = SOURCE_BY_ID.S005;
const memory = new Map();
const CACHE_KEY = "https://www.whosaeng.com/__smd_title_cache/v2";
const DAY = 86400000;
// 요청 사이에는 URL과 만료 시간만 공유합니다. 다른 요청의 I/O Promise는 공유하지 않습니다.
const inFlight = new Map();

function titleUrl(value, title = "") {
  // 이미 저장된 순위 혼입 제목도 원문 메타데이터로 확인합니다. 실제 숫자 제목은 임의로 자르지 않습니다.
  if (/^https?:\/\/(?:www\.)?rapportian\.com\//i.test(value || "") && /^\d{1,2}\s+\S/.test(String(title).trim())) {
    return articleUrl(value, rankedSource);
  }
  if (!/^https?:\/\/(?:www\.)?whosaeng\.com\//i.test(value || "")) return null;
  const url = articleUrl(value, source);
  if (!url) return null;
  const parsed = new URL(url);
  const id = parsed.pathname.match(/^\/(\d+)$/)?.[1] || parsed.searchParams.get("uid");
  return "https://www.whosaeng.com/" + id;
}

function remember(url, entry) {
  memory.delete(url);
  memory.set(url, entry);
  if (memory.size > 512) memory.delete(memory.keys().next().value);
}

export async function resolveArticleTitles(rows, options = {}) {
  const targets = new Map();
  for (const row of rows) {
    // 원문 제목 교정이 필요한 매체와 기사만 조회 대상으로 삼습니다.
    const url = titleUrl(row.url, row.title);
    if (url) targets.set(url, null);
  }
  if (!targets.size) { options.onState?.({ pending: 0, failed: 0 }); return rows; }

  const now = Date.now();
  const cache = globalThis.caches?.default;
  // 제목 캐시를 한 번에 읽어 기사 수만큼 캐시 요청이 늘지 않게 합니다.
  try {
    const response = await cache?.match(CACHE_KEY);
    if (response) {
      const saved = await response.json();
      for (const [url, entry] of Object.entries(saved)) {
        if (entry?.title && entry.expires > now && (!memory.has(url) || memory.get(url).expires < entry.expires)) remember(url, entry);
      }
    }
  } catch { /* 캐시를 읽지 못해도 원문 조회를 계속합니다. */ }

  const reportState = () => {
    let pending = 0;
    let failed = 0;
    for (const url of targets.keys()) {
      const hit = memory.get(url);
      if (!hit || hit.expires <= Date.now()) pending++;
      else if (!hit.title) failed++;
    }
    options.onState?.({ pending, failed });
  };

  const resolvedRows = () => rows.map((row) => {
    const url = titleUrl(row.url, row.title);
    const hit = url && memory.get(url);
    return { ...row, title: (hit?.expires > Date.now() && hit.title) || cleanArticleTitle(row.title, row) };
  });

  const warm = async () => {
    let budget = 32;
    // 짧은 묶음으로 처리·저장해 응답 이후 실행이 중단되어도 앞서 복원한 제목을 남깁니다.
    const queue = [...targets.keys()].filter((url) => !(memory.get(url)?.expires > now) && !(inFlight.get(url) > now)).slice(0, 8);
    for (const url of queue) inFlight.set(url, now + 30000);
    for (let start = 0; start < queue.length; start += 4) {
      let changed = false;
      await Promise.all(queue.slice(start, start + 4).map(async (url) => {
        try {
          const titleSource = new URL(url).hostname.replace(/^www\./, "") === "rapportian.com" ? rankedSource : source;
          const page = await fetchPage(url, titleSource, 750000, false, {
            timeoutMs: 4000,
            beforeFetch() { if (budget-- <= 0) throw new Error("제목 조회 요청 한도"); },
          });
          const title = originalArticleTitle(page, titleSource);
          if (!title) throw new Error("원문 제목 없음");
          remember(url, { title, expires: Date.now() + DAY });
          changed = true;
        } catch (error) {
          remember(url, { title: "", expires: Date.now() + 60000 });
          console.warn("기사 제목 복원 실패:", url, error.message);
        } finally {
          inFlight.delete(url);
        }
      }));
      if (changed && cache) {
        const saved = Object.fromEntries([...memory].filter(([, entry]) => entry.title && entry.expires > Date.now()));
        try {
          await cache.put(CACHE_KEY, new Response(JSON.stringify(saved), {
            headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
          }));
        } catch { /* 메모리 캐시는 그대로 사용합니다. */ }
      }
    }
  };
  if (options.background) {
    // 목록 응답은 캐시된 제목으로 즉시 반환하고 원문 조회는 응답 뒤에도 이어서 처리합니다.
    if (options.waitUntil) options.waitUntil(warm().catch((error) => console.warn("제목 캐시 갱신 실패:", error.message)));
    reportState();
    return resolvedRows();
  }
  await warm();
  reportState();
  return resolvedRows();
}
