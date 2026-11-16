// 제목에 붙은 후생신보 매체 표기만 제거합니다. 본문에서 제목을 추측하지 않습니다.
export function cleanArticleTitle(value, source = {}) {
  let title = String(value || "").replace(/\s+/g, " ").trim();
  const isWhosaeng = source.kind === "whosaeng" || source.name === "후생신보"
    || source.source === "후생신보" || /^https?:\/\/(?:www\.)?whosaeng\.com(?:\/|$)/i.test(source.url || "");
  if (!isWhosaeng) return title;
  const label = "(?:\\[\\s*후생신보\\s*\\]|【\\s*후생신보\\s*】|［\\s*후생신보\\s*］|≪\\s*후생신보\\s*≫|《\\s*후생신보\\s*》)";
  title = title.replace(new RegExp("^(?:" + label + "\\s*)+"), "");
  return title.replace(new RegExp("\\s*(?:[-|·]\\s*)?" + label + "$"), "").trim();
}

// 기존에 본문이 저장된 제목은 원문의 제목 메타데이터로 복원합니다.
// 속성 순서·따옴표 종류가 달라도 읽되, 본문 텍스트는 사용하지 않습니다.
export function originalArticleTitle(page, source) {
  // 제목 메타데이터가 있는 head만 읽어 큰 기사 본문 전체를 반복 검색하지 않습니다.
  const headEnd = page.search(/<\/head\s*>/i);
  const metadata = page.slice(0, headEnd < 0 ? 65536 : Math.min(headEnd, 65536));
  const decode = (value) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, entity) => {
    if (entity[0] === "#") {
      const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[entity.toLowerCase()];
  });
  const metas = [];
  for (const tag of metadata.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const attr of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    }
    metas.push(attrs);
  }
  for (const name of ["og:title", "twitter:title"]) {
    const value = metas.find((attrs) => (attrs.property || attrs.name || "").toLowerCase() === name)?.content;
    if (!value) continue;
    const title = cleanArticleTitle(decode(value), source);
    if (title.length >= 8 && title.length <= 220) return title;
  }
  return "";
}
