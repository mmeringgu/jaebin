// 의료 경쟁사 3곳의 공개 글로벌 뉴스만 읽습니다. 브라우저 실행이나 인증 키는 사용하지 않습니다.
import { articleUrl, fetchPage, normalizedDate, text } from "./crawler.js";
import { keywordMatch, selectionLevel } from "./rules.js";
import { koreaNow, addDays } from "./settings.js";
import { manualMetadata } from "./manual-article.js";
import { detailExcerpt } from "./article-excerpt.js";

const SIEMENS_API = "https://api.scrivito.com/tenants/0e46935d037de4ec3888566275864b37/workspaces/published/objs/search";
const variants = new Set(["ge", "siemens", "philips"]);
const plain = (value) => text(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " "));

export function officialDate(value) {
  const clean = plain(value);
  const compact = clean.match(/^(20\d{2})(\d{2})(\d{2})\d{6}$/);
  if (compact) return normalizedDate(compact.slice(1).join("-"));
  if (/^20\d{2}[./-]\d/.test(clean)) return normalizedDate(clean);
  const english = clean.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}/i);
  const time = Date.parse(english ? english[0] + " UTC" : clean);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function candidates(records, source) {
  const today = koreaNow().day, oldest = addDays(today, -30), unique = new Map();
  for (const row of records) {
    const url = articleUrl(row.url, source), title = plain(row.title), date = officialDate(row.date);
    if (!url || !date || date < oldest || date > today || title.length < 8 || title.length > 300) continue;
    const groups = keywordMatch(title, source);
    if (!groups.length) continue;
    const matchLevel = selectionLevel(groups);
    unique.set(url, { ...row, title, date, url, groups: groups.map((g) => g.id), category: groups[0].category,
      matchLevel, priority: matchLevel === "full" ? 2 : 1 });
  }
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
}

export function parseGeOfficial(page, source) {
  if (!/<rss\b/i.test(page)) throw new Error("GE 공식 뉴스 RSS 형식을 확인하지 못했습니다.");
  const records = [];
  for (const item of page.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const value = (name) => plain(item[1].match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]);
    let url;
    try {
      url = new URL(value("link"));
      // GE가 제공하는 RSS의 예전 en-global/*.html 주소를 현재 뉴스룸 주소로 바꿉니다.
      url.pathname = url.pathname.replace(/^\/en-global\//, "/en/").replace(/\.html$/, "");
    } catch { continue; }
    records.push({ title: value("title"), url: url.href, date: value("pubDate") });
  }
  return candidates(records, source);
}

export async function parsePhilipsOfficial(page, source) {
  const records = [];
  let row = null, field = null, found = false;
  const rewriter = new HTMLRewriter().on(".p-rn45__card", { element(el) {
    found = true;
    const current = { title: "", date: "", url: "" };row = current;
    el.onEndTag(() => { records.push(current);if (row === current) row = null; });
  } }).on(".p-rn45__card a", { element(el) { if (row) row.url ||= el.getAttribute("href") || ""; } });
  for (const [selector, name] of [[".p-rn45__title", "title"], [".p-rn45__date", "date"]]) {
    rewriter.on(selector, { element(el) { if (!row) return;field = name;el.onEndTag(() => { field = null; }); } });
  }
  rewriter.onDocument({ text(chunk) { if (row && field) row[field] += chunk.text + (chunk.lastInTextNode ? " " : ""); } });
  await rewriter.transform(new Response(page)).arrayBuffer();
  if (!found) throw new Error("필립스 공식 뉴스 목록 영역을 찾지 못했습니다.");
  return candidates(records, source);
}

async function siemensSearch(query, size) {
  const response = await fetch(SIEMENS_API, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "SMDNewsMonitor/1.0" },
    body: JSON.stringify({ query: [
      { field: "_obj_class", operator: "equals", value: "CorporatePressReleasePage" },
      { field: "_site_id", operator: "equals", value: "31374d8da25ebfbe" },
      { field: "_path", operator: "starts_with", value: "/en/press/releases/" },
      { field: "hide_page", operator: "equals", value: ["no", null] }, ...query,
    ], options: { site_aware: true }, include_objs: true, size, order_by: [["publish_date", "desc"]] }) });
  if (!response.ok || !/json/i.test(response.headers.get("Content-Type") || "")) {
    await response.body?.cancel();throw new Error("지멘스 공식 뉴스 조회 실패 · HTTP " + response.status);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 750000) throw new Error("지멘스 공식 뉴스 크기 제한 초과");
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(data.results) || (data.results.length && !Array.isArray(data.objs))
    || data.results.length !== (data.objs || []).length) throw new Error("지멘스 공식 뉴스 목록이 불완전합니다.");
  return data.objs || [];
}

async function htmlParagraphs(page, selector) {
  const blocks = [];
  let current = null;
  const rewriter = new HTMLRewriter().on(selector, { element(el) {
    if (current) return;
    const block = { text: "" };current = block;
    el.onEndTag(() => { blocks.push(plain(block.text));if (current === block) current = null; });
  } }).onDocument({ text(chunk) { if (current) current.text += chunk.text + (chunk.lastInTextNode ? " " : ""); } });
  await rewriter.transform(new Response(page)).arrayBuffer();
  return blocks.filter((block) => block.length >= 8);
}

function details(paragraphs, source, date, title) {
  const detail = detailExcerpt(paragraphs, title), first = paragraphs.find((p) => p.length >= 30) || "";
  if (!date || detail.length < 30 || !first) throw new Error("공식 기사의 발행일 또는 본문을 확인하지 못했습니다.");
  return { date, body: paragraphs.join("\n\n").slice(0, 20000), excerpt: {
    format: "excerpt", subtitle: "", first_paragraph: first.slice(0, 1000), detail_text: detail, language: "en",
  } };
}

async function siemensDetails(obj, source) {
  const html = Object.values(obj._widget_pool || {}).filter((w) => w._obj_class === "TextAndMediaWidget")
    .map((w) => w.description?.[1] || "").join("\n");
  const paragraphs = await htmlParagraphs(`<article>${html}</article>`, "article p, article li");
  return details(paragraphs, source, officialDate(obj.publish_date?.[1]), obj.title?.[1] || "");
}

export async function loadCompetitorOfficial(source) {
  if (!variants.has(source.official_variant)) throw new Error("지원하지 않는 경쟁사 공식 출처입니다.");
  if (source.official_variant === "siemens") {
    const oldest = addDays(koreaNow().day, -30).replaceAll("-", "") + "000000";
    const objects = await siemensSearch([{ field: "publish_date", operator: "is_greater_than", value: oldest }], 30);
    const records = [];
    for (const obj of objects) {
      const url = articleUrl("/" + obj._permalink, source);
      if (!url) continue;
      const detail = await siemensDetails(obj, source);
      records.push({ title: obj.title?.[1], url, date: detail.date, excerpt: detail.excerpt, body: detail.body });
    }
    return candidates(records, source);
  }
  const page = await fetchPage(source.listingUrl, source);
  return source.official_variant === "ge" ? parseGeOfficial(page, source) : parsePhilipsOfficial(page, source);
}

export async function competitorArticleDetails(page, source, url, dateHint = null, title = "") {
  const metadata = manualMetadata(page, url);
  const selector = source.official_variant === "ge" ? ".ge-body-copy" : ".p-body-copy-01";
  const paragraphs = await htmlParagraphs(page, selector);
  let date = dateHint || metadata.date;
  if (!date && source.official_variant === "ge") {
    let published = "";
    const rewriter = new HTMLRewriter().on("time, .press-release-date, .latest-press-release-card-item-container-pub-date", {
      element(el) { published ||= el.getAttribute("datetime") || ""; }, text(chunk) { published += chunk.text; },
    });
    await rewriter.transform(new Response(page)).arrayBuffer();
    date = officialDate(published);
  }
  return { ...details(paragraphs, source, date, title || metadata.title), title: metadata.title || title };
}

export async function readCompetitorOfficial(url, source, dateHint, title = "") {
  if (source.official_variant === "siemens") {
    const permalink = new URL(url).pathname.replace(/^\//, "");
    const objects = await siemensSearch([{ field: "_permalink", operator: "equals", value: permalink }], 1);
    if (objects.length !== 1) throw new Error("지멘스 공식 기사를 찾지 못했습니다.");
    return siemensDetails(objects[0], source);
  }
  return competitorArticleDetails(await fetchPage(url, source), source, url, dateHint, title);
}
