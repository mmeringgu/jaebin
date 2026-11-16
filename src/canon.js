// 캐논 공식 뉴스는 실제 목록의 제목·날짜와 기사 첫 문단을 읽습니다.
import { articleUrl, fetchPage, normalizedDate, text } from "./crawler.js";
import { keywordMatch, selectionLevel } from "./rules.js";

export function canonDate(value) {
  const clean = text(value || "");
  const japanese = clean.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (japanese) return normalizedDate(`${japanese[1]}-${japanese[2]}-${japanese[3]}`);
  const date = normalizedDate(clean);
  if (date) return date;
  const time = Date.parse(clean);
  return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : null;
}

async function scan(page, rewriter) {
  await rewriter.transform(new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } })).arrayBuffer();
}

export async function parseCanonCandidates(page, source) {
  const variant = source.canon_variant;
  const rowSelector = variant === "jp" ? ".cmp-top-news-list__row"
    : variant === "hq" ? "a.mNewsList__each" : "a.cmp-news-release-list__item-link";
  const titleSelector = variant === "jp" ? "a.cmp-top-news-list__link"
    : variant === "hq" ? ".mNewsList__index" : ".cmp-news-release-list__item-title";
  const dateSelector = variant === "jp" ? ".cmp-top-news-list__cell--date"
    : variant === "hq" ? ".mNewsList__date" : ".cmp-news-release-list__item-date";
  const records = [];
  let row = null;
  let field = null;
  let found = false;
  const rewriter = new HTMLRewriter().on(rowSelector, {
    element(el) {
      found = true;
      const current = { href: el.getAttribute("href") || "", title: "", date: "", description: "" };
      row = current;
      el.onEndTag(() => { records.push(current); if (row === current) row = null; });
    },
  });
  for (const [selector, name] of [[titleSelector, "title"], [dateSelector, "date"], [".cmp-news-release-list__item-desc", "description"]]) {
    rewriter.on(selector, {
      element(el) {
        if (!row) return;
        if (name === "title" && variant === "jp") row.href = el.getAttribute("href") || "";
        field = name;
        el.onEndTag(() => { field = null; });
      },
    });
  }
  rewriter.onDocument({ text(chunk) { if (row && field) row[field] += chunk.text + (chunk.lastInTextNode ? " " : ""); } });
  await scan(page, rewriter);
  if (!found) throw new Error("캐논 공식 뉴스 목록 영역을 찾지 못했습니다.");
  const oldest = new Date(Date.now() + 9 * 3600000 - 90 * 86400000).toISOString().slice(0, 10);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const unique = new Map();
  for (const record of records) {
    const url = articleUrl(record.href, source);
    const title = text(record.title);
    const date = canonDate(record.date);
    if (!url || !date || date < oldest || date > today || title.length < 8 || title.length > 220) continue;
    const groups = keywordMatch(title, source);
    if (!groups.length) continue;
    const level = selectionLevel(groups);
    unique.set(url, { title, url, date, description: text(record.description).slice(0, 1000),
      groups: groups.map((group) => group.id), category: groups[0].category,
      matchLevel: level, priority: level === "full" ? 2 : 1 });
  }
  return [...unique.values()];
}

export async function canonArticleDetails(page, source, url, dateHint = null) {
  let metaDate = "";
  let description = "";
  let paragraph = null;
  const paragraphs = [];
  const selector = source.canon_variant === "hq" ? ".mNewsDetailBlock p.mText__regular" : ".cmp-text p";
  const rewriter = new HTMLRewriter().on("meta", {
    element(el) {
      const name = el.getAttribute("property") || el.getAttribute("name");
      if (["date", "article:published_time"].includes(name)) metaDate ||= el.getAttribute("content") || "";
      if (["description", "og:description"].includes(name)) description ||= el.getAttribute("content") || "";
    },
  }).on(selector, {
    element(el) {
      const current = { text: "" };
      paragraph = current;
      el.onEndTag(() => { paragraphs.push(text(current.text)); if (paragraph === current) paragraph = null; });
    },
  }).onDocument({ text(chunk) { if (paragraph) paragraph.text += chunk.text + (chunk.lastInTextNode ? " " : ""); } });
  await scan(page, rewriter);
  const first = paragraphs.find((value) => value.length >= 40 && (value.match(/[\p{L}\p{N}]/gu) || []).length >= 20) || text(description);
  const path = new URL(url).pathname;
  const pathDate = path.match(/(20\d{2})-?(\d{2})-?(\d{2})/)?.slice(1).join("-");
  const date = dateHint || canonDate(pathDate) || canonDate(metaDate);
  if (!date || first.length < 30) throw new Error("캐논 공식 기사의 발행일 또는 첫 문단을 확인하지 못했습니다.");
  return { date, body: first.slice(0, 20000), excerpt: { format: "excerpt", subtitle: "", first_paragraph: first.slice(0, 1000), language: source.language } };
}

export async function readCanonArticle(url, source, dateHint) {
  return canonArticleDetails(await fetchPage(url, source), source, url, dateHint);
}
