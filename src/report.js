import "../static/news-rules.js";
import { CONFIG } from "./settings.js";
import { hasWord } from "./rules.js";

const { groupSameNews, compareNewest } = globalThis.NewsRules;

function competitorNames(title) {
  return CONFIG.rules.filter((rule) => rule.category === "competitor" && rule.status === "사용" &&
    rule.main.some((word) => hasWord(title, word))).map((rule) => rule.main[0]);
}

// 같은 소식은 한 번만 보내고 중요 기사를 우선하되 다른 소식도 반드시 포함합니다.
export function selectReportArticles(rows, maxCount) {
  const stories = groupSameNews(rows).map((group) => {
    const members = [group.main, ...group.others];
    const starred = members.filter((a) => a.starred).sort(compareNewest);
    const article = starred.find((a) => ["기회", "위협"].includes(a.impact_override)) || starred[0] || group.main;
    return { ...article, starred: starred.length > 0, duplicate_count: members.length,
      competitors: competitorNames(article.title) };
  });
  const byCoverage = (a, b) => b.duplicate_count - a.duplicate_count || compareNewest(a, b);
  const starred = stories.filter((a) => a.starred).sort(byCoverage);
  const others = stories.filter((a) => !a.starred).sort(byCoverage);
  // 양쪽에 기사가 있으면 중요 기사에 약 2/3, 다른 소식에 약 1/3을 우선 배정합니다.
  const starLimit = others.length ? Math.min(starred.length, Math.max(1, Math.floor(maxCount * 2 / 3))) : maxCount;
  const chosen = starred.slice(0, starLimit);
  chosen.push(...others.slice(0, maxCount - chosen.length));
  chosen.push(...starred.slice(starLimit, starLimit + maxCount - chosen.length));
  return chosen;
}

// 모델이 임의의 URL을 출력하지 않도록 기사 번호를 검증해 실제 원문 링크로 바꿉니다.
export function normalizeReport(raw, articles) {
  let value;
  try { value = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()); }
  catch { return null; }
  if (!value || typeof value !== "object") return null;
  const normalizeItem = (item, allowed = () => true) => {
    if (!item || typeof item.text !== "string" || !item.text.trim() || !Array.isArray(item.sources)) return null;
    const ids = [...new Set(item.sources)];
    if (!ids.length || !ids.every((id) => Number.isInteger(id) && id >= 1 && id <= articles.length && allowed(articles[id - 1]))) return null;
    const sources = ids.map((id) => articles[id - 1]).filter((a) => /^https?:\/\//i.test(a.url));
    if (sources.length !== ids.length) return null;
    const judgments = new Set(sources.filter((a) => a.starred && ["기회", "위협"].includes(a.impact_override)).map((a) => a.impact_override));
    return { text: item.text.replace(/\s+/g, " ").trim(),
      impact: judgments.size === 1 ? [...judgments][0] : "",
      sources: sources.map((a) => ({ title: a.title, url: a.url, source: a.source, date: a.date })) };
  };
  const items = (rows, max, allowed) => (Array.isArray(rows) ? rows : []).map((row) => normalizeItem(row, allowed)).filter(Boolean).slice(0, max);
  const trends = items(value.trends, 3);
  if (!trends.length) return null;
  const sections = [
    { title: "이번 달 핵심 동향", items: trends },
  ];
  for (const [key, title, impact] of [["opportunities", "비즈니스 기회", "기회"], ["risks", "위협·리스크", "위협"]]) {
    const eligible = (a) => a.starred && a.impact_override === impact;
    const rows = (Array.isArray(value[key]) ? value[key] : []).flatMap((row) => {
      const item = normalizeItem(row, eligible);
      if (!item) return [];
      const target = typeof row.target === "string" ? row.target.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      return [{ ...item, target: target || articles[row.sources[0] - 1].entity || "주요 변화" }];
    }).slice(0, 3);
    // 모델이 해당 영역을 누락해도 직접 선택한 기사는 원문 제목으로 표시합니다.
    if (!rows.length) articles.forEach((a, index) => {
      if (!eligible(a) || rows.length >= 3) return;
      const item = normalizeItem({ text: a.title, sources: [index + 1] }, eligible);
      if (item) rows.push({ ...item, target: a.entity || "주요 변화" });
    });
    sections.push({ title, format: "table", empty_message: "선택된 기사가 없습니다.", items: rows });
  }
  const seen = new Set();
  const competitors = (Array.isArray(value.competitors) ? value.competitors : []).flatMap((row) => {
    if (!row || typeof row.name !== "string" || seen.has(row.name)) return [];
    const item = normalizeItem(row, (a) => (a.competitors || []).includes(row.name));
    if (!item) return [];
    seen.add(row.name);
    return [{ ...item, target: row.name }];
  });
  if (competitors.length) sections.push({ title: "경쟁사 움직임", format: "table", items: competitors });
  return { sections };
}
