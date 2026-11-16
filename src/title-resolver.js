// 기존 D1 데이터는 변경하지 않고, 조회 결과의 후생신보 제목만 원문으로 복원합니다.
import { cleanArticleTitle, originalArticleTitle } from "./article-title.js";
import { articleUrl, fetchPage } from "./crawler.js";
import { SOURCE_BY_ID } from "./settings.js";

const source = SOURCE_BY_ID.S018;
const memory = new Map();
const CACHE_KEY = "https://www.whosaeng.com/__smd_title_cache/v2";
const DAY = 86400000;
// 요청 사이에는 URL과 만료 시간만 공유합니다. 다른 요청의 I/O Promise는 공유하지 않습니다.
const inFlight = new Map();

function titleUrl(value) {
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
    // 후생신보 기사 주소만 원문 제목 조회 대상으로 삼습니다.
    const url = titleUrl(row.url);
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
    const url = titleUrl(row.url);
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
          const page = await fetchPage(url, source, 750000, false, {
            timeoutMs: 4000,
            beforeFetch() { if (budget-- <= 0) throw new Error("제목 조회 요청 한도"); },
          });
          const title = originalArticleTitle(page, source);
          if (!title) throw new Error("원문 제목 없음");
          remember(url, { title, expires: Date.now() + DAY });
          changed = true;
        } catch (error) {
          remember(url, { title: "", expires: Date.now() + 60000 });
          console.warn("후생신보 제목 복원 실패:", url, error.message);
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
