import { text, normalizedDate } from "./crawler.js";
import { originalArticleTitle } from "./article-title.js";
import { keywordMatch } from "./rules.js";

export const MANUAL_CATEGORIES = ["company", "policy", "hospital", "conference", "competitor"];
const error = (message, status = 400) => Object.assign(new Error(message), { status });

export function manualArticleUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw error("기사의 전체 URL을 입력해 주세요."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port
    || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)) {
    throw error("공개된 기사 사이트의 http 또는 https URL을 입력해 주세요.");
  }
  url.hostname = host;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  if (url.href.length > 2048) throw error("기사 URL이 너무 깁니다.");
  return url.href;
}

export function manualMetadata(page, url) {
  const head = page.slice(0, Math.min(page.search(/<\/head\s*>/i) < 0 ? 65536 : page.search(/<\/head\s*>/i), 65536));
  const meta = new Map();
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const attr of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    const name = (attrs.property || attrs.name || "").toLowerCase();
    if (!meta.has(name)) meta.set(name, text(attrs.content || ""));
  }
  const json = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (/Article|NewsArticle|ReportageNewsArticle/i.test(String(node["@type"] || ""))) json.push(node);
    if (node["@graph"]) visit(node["@graph"]);
  };
  for (const script of page.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { visit(JSON.parse(script[1])); } catch { /* 불완전한 구조화 데이터는 건너뜁니다. */ }
  }
  const article = json[0] || {};
  const plain = (value) => text(String(value || "").replace(/<[^>]*>/g, " "));
  const title = originalArticleTitle(page, { url }) || plain(article.headline) || plain(head.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]);
  const summary = plain(meta.get("og:description") || meta.get("description") || article.description || String(article.articleBody || "").split(/\n/)[0]).slice(0, 1600);
  const date = normalizedDate(meta.get("article:published_time") || meta.get("datepublished") || meta.get("pubdate") || meta.get("date") || article.datePublished);
  const source = plain(meta.get("og:site_name") || article.publisher?.name) || new URL(url).hostname.replace(/^www\./, "");
  const groups = keywordMatch(title, { status: "사용", categories: MANUAL_CATEGORIES });
  return { url, title: title.slice(0, 300), source: source.slice(0, 120), date: date || "", summary,
    category: groups[0]?.category || "" };
}

export async function fetchManualArticle(value) {
  let url = manualArticleUrl(value);
  const signal = AbortSignal.timeout(15000);
  try {
    for (let hop = 0; hop < 4; hop++) {
      const response = await fetch(url, { redirect: "manual", signal, headers: { Accept: "text/html", "User-Agent": "SMDNewsMonitor/1.0" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        await response.body?.cancel();
        if (!location) throw error("기사의 이동 주소를 확인하지 못했습니다.", 422);
        url = manualArticleUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok || !/text\/html/i.test(response.headers.get("Content-Type") || "")) {
        await response.body?.cancel();
        throw error("기사 페이지를 읽지 못했습니다. 공개된 기사 URL인지 확인해 주세요.", 422);
      }
      const reader = response.body?.getReader();
      if (!reader) throw error("기사 내용이 없습니다.", 422);
      const chunks = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1500000) { await reader.cancel(); throw error("기사 페이지가 너무 큽니다.", 422); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const charset = response.headers.get("Content-Type")?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || "utf-8";
      let page;
      try { page = new TextDecoder(charset).decode(bytes); } catch { page = new TextDecoder().decode(bytes); }
      return manualMetadata(page, url);
    }
    throw error("기사 주소의 이동이 너무 많습니다.", 422);
  } catch (e) {
    if (e.status) throw e;
    throw error("기사 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 422);
  }
}
