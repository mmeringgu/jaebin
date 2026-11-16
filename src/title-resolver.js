// 기존 D1 데이터는 변경하지 않고, 조회 결과의 후생신보 제목만 원문으로 복원합니다.
import { cleanArticleTitle, originalArticleTitle } from "./article-title.js";
import { articleUrl, fetchPage } from "./crawler.js";
import { SOURCE_BY_ID } from "./settings.js";

const source = SOURCE_BY_ID.S018;
const memory = new Map();
const CACHE_KEY = "https://www.whosaeng.com/__smd_title_cache/v1";
const DAY = 86400000;

function remember(url, entry) {
  memory.delete(url);
  memory.set(url, entry);
  if (memory.size > 512) memory.delete(memory.keys().next().value);
}

export async function resolveArticleTitles(rows, options = {}) {
  const targets = new Map();
  for (const row of rows) {
    // 후생신보 기사 주소만 원문 제목 조회 대상으로 삼습니다.
    if (!/^https?:\/\/(?:www\.)?whosaeng\.com\//i.test(row.url || "")) continue;
    const url = articleUrl(row.url, source);
    if (url) targets.set(url, null);
  }
  if (!targets.size) return rows;

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

  const resolvedRows = () => rows.map((row) => {
    const url = /^https?:\/\/(?:www\.)?whosaeng\.com\//i.test(row.url || "") ? articleUrl(row.url, source) : null;
    const hit = url && memory.get(url);
    return { ...row, title: (hit?.expires > Date.now() && hit.title) || cleanArticleTitle(row.title, row) };
  });

  const warm = async () => {

  // 리다이렉트도 포함해 최대 40회로 제한합니다. 남은 기사는 다음 조회에서 이어서 복원합니다.
  let budget = 40;
  let changed = false;
  // 다른 요청에서 시작한 I/O Promise를 공유하지 않습니다.
  const pending = new Map();
  // 최대 24건/4병렬/각 4초로 백그라운드 처리 시간이 과도하게 늘지 않게 합니다.
  const queue = [...targets.keys()].filter((url) => !(memory.get(url)?.expires > now)).slice(0, 24);
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let url; (url = queue.shift());) {
      const hit = memory.get(url);
      if (hit && hit.expires > now) {
        targets.set(url, hit.title);
        continue;
      }
      if (!pending.has(url)) {
        if (budget <= 0) continue;
        const task = (async () => {
          try {
            const page = await fetchPage(url, source, 750000, false, {
              timeoutMs: 4000,
              beforeFetch() { if (budget-- <= 0) throw new Error("제목 조회 요청 한도"); },
            });
            const title = originalArticleTitle(page, source);
            if (!title) throw new Error("원문 제목 없음");
            remember(url, { title, expires: Date.now() + DAY });
            changed = true;
            return title;
          } catch {
            // 원문 조회 실패 시 기존 제목을 유지하고 1분 후 다시 확인합니다.
            remember(url, { title: "", expires: Date.now() + 60000 });
            return "";
          } finally {
            pending.delete(url);
          }
        })();
        pending.set(url, task);
      }
      targets.set(url, await pending.get(url));
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
  };
  if (options.background) {
    // 목록 응답은 캐시된 제목으로 즉시 반환하고 원문 조회는 응답 뒤에도 이어서 처리합니다.
    if (options.waitUntil) options.waitUntil(warm().catch((error) => console.warn("제목 캐시 갱신 실패:", error.message)));
    return resolvedRows();
  }
  await warm();
  return resolvedRows();
}
