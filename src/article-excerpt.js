// 상세 표시용 원문은 최대 1,000자 보관하며 화면에서는 최대 5줄만 표시합니다.
export function detailExcerpt(paragraphs, title = "") {
  const seen = new Set(), rows = [];
  const fold = (value) => value.replace(/[^\p{L}\p{N}]/gu, "");
  for (const paragraph of paragraphs) {
    const value = String(paragraph || "").replace(/\s+/g, " ").trim();
    if (value.length < 8 || fold(value) === fold(title) || seen.has(value)
      || /^(?:사진|자료|출처)\s*[=:：]|^(?:저작권|무단\s*전재|관련\s*기사|Copyright)/i.test(value)) continue;
    seen.add(value);rows.push(value);
    if (rows.join("\n\n").length >= 1000) break;
  }
  const joined = rows.join("\n\n");
  return joined.length <= 1000 ? joined : joined.slice(0, 999).trimEnd() + "…";
}

export async function genericDetailExcerpt(page, title = "") {
  const sections = [];
  let section = null, paragraph = null, skip = 0;
  const rewriter = new HTMLRewriter()
    .on('article, [itemprop="articleBody"], #articleBody, #article-view-content-div, #news_body_area, #textinput, .article-body, .article_body, .article-content, .news_body', {
      element(el) {
        if (section) return;
        const current = { paragraphs: [], text: "", single: el.tagName === "p" };section = current;
        el.onEndTag(() => { sections.push(current);section = null;paragraph = null; });
      },
    })
    .on("script, style, noscript, nav, footer, aside, figure, figcaption", {
      element(el) { skip++;el.onEndTag(() => { skip--; }); },
    })
    .on("p", {
      element(el) {
        if (!section || skip || section.single) return;
        const current = { text: "", section };paragraph = current;
        el.onEndTag(() => { current.section.paragraphs.push(current.text);if (paragraph === current) paragraph = null; });
      },
    })
    .onDocument({ text(chunk) {
      if (!section || skip) return;
      const value = chunk.text + (chunk.lastInTextNode ? " " : "");
      section.text += value;if (paragraph) paragraph.text += value;
    } });
  await rewriter.transform(new Response(page)).text();
  const candidates = sections.map((s) => detailExcerpt(s.paragraphs.length ? s.paragraphs : [s.text], title));
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}
