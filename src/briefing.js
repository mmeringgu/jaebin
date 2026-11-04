// 아침 브리핑 메시지를 만들어 Slack/Teams로 보냅니다. (예전 app/briefing.py)
import { addDays } from "./settings.js";

const CATEGORY_NAMES = [
  ["company", "우리회사 뉴스"],
  ["policy", "정책"],
  ["hospital", "학회&병원"],
  ["competitor", "경쟁사"],
];
const PER_CATEGORY = 3; // 카테고리마다 보낼 기사 수

// 어제~오늘 기사 중 카테고리별 상위 몇 건을 메시지 글로 만듭니다.
export function buildBriefing(articles, day) {
  const since = addDays(day, -1);
  // 메인 키워드만 맞은 기사(덜 중요한 기사)는 화면 기본값처럼 빼고 보냅니다.
  const recent = articles.filter((a) => a.date >= since && a.match_level !== "main");
  const lines = ["[SMD 뉴스 브리핑] " + day];
  for (const [categoryId, name] of CATEGORY_NAMES) {
    const rows = recent.filter((a) => a.category === categoryId).slice(0, PER_CATEGORY);
    lines.push("");
    lines.push("■ " + name + " (" + rows.length + "건)");
    for (const a of rows) {
      lines.push("- " + a.title + " (" + a.source + ")");
      lines.push("  " + a.url);
    }
  }
  return lines.join("\n");
}

// 웹훅 주소(BRIEFING_WEBHOOK_URL)로 메시지를 보냅니다. 성공하면 true.
export async function sendBriefing(env, text) {
  const url = String(env.BRIEFING_WEBHOOK_URL || "").trim();
  // 주소가 없으면 브리핑 없이 기존처럼 동작합니다.
  if (!url) return false;
  try {
    // Slack과 Teams 모두 {"text": "..."} 형식을 받습니다.
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return true;
  } catch (error) {
    console.warn("브리핑 전송 실패:", error.message);
    return false;
  }
}
