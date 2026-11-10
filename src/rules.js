// 기사 제목에 키워드가 있는지 보고 카테고리를 정합니다. (예전 app/rules.py)
import { CONFIG, PRIORITY } from "./settings.js";

// 제목(text)에 단어(word)가 들어 있는지 확인합니다.
// 영어·숫자 단어("CT", "GE")는 다른 단어 속에 섞여 있으면 안 되므로 앞뒤 글자를 따로 확인합니다.
export function hasWord(text, word) {
  if (!word.trim()) return false;
  const lowerText = text.toLowerCase();
  const lowerWord = word.toLowerCase();
  const isEnglish = /^[a-z0-9 ]+$/i.test(word);
  if (!isEnglish) return lowerText.includes(lowerWord);

  // 영어 단어는 찾은 위치마다 앞뒤가 영어·숫자가 아닌지 봅니다. ("CT"는 맞고 "CTO"는 안 맞음)
  let start = lowerText.indexOf(lowerWord);
  while (start !== -1) {
    const before = lowerText[start - 1] || "";
    const after = lowerText[start + lowerWord.length] || "";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    start = lowerText.indexOf(lowerWord, start + 1);
  }
  return false;
}

// 제목에 [칼럼], [기고] 같은 글자가 있는지 확인합니다.
export function isOpinionTitle(title) {
  const words = CONFIG.excluded_title_words || [];
  return words.some((word) => title.includes(word));
}

// 제목이 어떤 키워드 규칙에 맞는지 찾습니다. 맞는 규칙이 없으면 빈 목록을 돌려줍니다.
export function keywordMatch(title, source) {
  if (source.status !== "사용") return [];
  // [칼럼]·[기고]처럼 의견 글은 뉴스가 아니므로 고르지 않습니다. (목록은 config.json의 excluded_title_words)
  if (isOpinionTitle(title)) return [];
  const matches = [];
  for (const rule of CONFIG.rules) {
    if (rule.status !== "사용" || !source.categories.includes(rule.category)) continue;
    const main = rule.main.filter((word) => hasWord(title, word));
    if (main.length === 0) continue;
    if (rule.excluded.some((word) => hasWord(title, word))) continue;
    const auxiliary = rule.auxiliary.filter((word) => hasWord(title, word));
    // 보조 키워드까지 맞으면 "full", 메인 키워드만 맞으면 "main"
    const matchLevel = auxiliary.length > 0 || rule.auxiliary.length === 0 ? "full" : "main";
    matches.push({ ...rule, mainMatches: main, auxiliaryMatches: auxiliary, matchLevel });
  }
  if (matches.length === 0) return [];

  // 카테고리 우선순위 → full 먼저 순서로 정렬하고, 1등과 같은 카테고리만 남깁니다.
  matches.sort((a, b) => {
    const byCategory = PRIORITY[a.category] - PRIORITY[b.category];
    if (byCategory !== 0) return byCategory;
    return (a.matchLevel === "full" ? 0 : 1) - (b.matchLevel === "full" ? 0 : 1);
  });
  return matches.filter((r) => r.category === matches[0].category);
}

export function selectionLevel(groups) {
  if (groups.some((r) => r.matchLevel === "full")) return "full";
  return groups.length > 0 ? "main" : "none";
}

// 기사 카드에 붙일 태그(맞은 키워드)를 중복 없이 최대 12개 만듭니다.
export function articleTags(groups) {
  const tags = [];
  for (const r of groups) {
    for (const word of [...r.mainMatches, ...r.auxiliaryMatches]) {
      if (!tags.includes(word)) tags.push(word);
    }
  }
  return tags.slice(0, 12);
}

// 수집 화면에 "왜 골랐는지" 설명을 만듭니다.
export function selection(title, source) {
  const groups = keywordMatch(title, source);
  const names = {};
  for (const c of CONFIG.categories) names[c.id] = c.name;
  const reasons = groups.map((r) => {
    let reason = names[r.category] + " · " + r.mainMatches.slice(0, 3).join(", ");
    if (r.auxiliaryMatches.length > 0) reason += " + " + r.auxiliaryMatches.slice(0, 3).join(", ");
    return reason + " · " + r.id;
  });
  return { selected: groups.length > 0, level: selectionLevel(groups), reasons };
}

// 주소에서 사이트 이름만 꺼냅니다. 예: "https://www.khanews.com/news" → "khanews.com"
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
