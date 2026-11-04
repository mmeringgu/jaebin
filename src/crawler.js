// 정보원(언론사·기관) 사이트에서 기사 목록과 본문을 가져옵니다. (예전 app/crawler.py)
//
// 파이썬에서는 BeautifulSoup으로 HTML을 읽었지만, Cloudflare에서는 기본으로 들어 있는
// HTMLRewriter(HTML을 앞에서부터 차례로 읽으면서 원하는 태그를 만나면 알려주는 도구)를 씁니다.
// 그래서 "이 태그가 시작됐다 → 글자가 나왔다 → 태그가 끝났다" 순서로 메모하는 방식으로 작성했습니다.
import { hostOf, keywordMatch, selectionLevel } from "./rules.js";

// ───────────────────────── 글자 정리 ─────────────────────────

// HTML 안의 &amp; 같은 표시를 실제 글자로 바꿉니다.
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", bull: "•",
};
function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// 글자를 정리합니다: &amp; 같은 표시를 바꾸고, 여러 칸 띄어쓰기·줄바꿈을 한 칸으로 줄입니다.
export function text(value) {
  return decodeEntities(String(value)).replace(/\s+/g, " ").trim();
}

// "2026.10.24", "2026-10-24 07:00" 같은 글에서 날짜를 찾아 "2026-10-24" 형식으로 바꿉니다.
export function normalizedDate(value) {
  const match = String(value || "").match(/\b(20\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})(?!\d)/);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // 2026-02-31처럼 없는 날짜는 버립니다.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

// ───────────────────────── 기사 주소 확인 ─────────────────────────

// 링크(href)가 이 정보원의 "기사 주소" 모양이 맞는지 확인합니다.
// 맞으면 쓸데없는 꼬리(utm 등)를 뗀 깔끔한 주소를, 아니면 null을 돌려줍니다.
export function articleUrl(href, source, allowAlternate = false) {
  let address;
  try {
    address = new URL(decodeEntities(href), source.listingUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(address.protocol) || hostOf(address.href) !== hostOf(source.url)) return null;
  if (address.username || address.password || address.port) return null;

  const p = address.pathname;
  const k = source.kind;
  // 주소 뒤 ?a=1&b=2 부분에서 값을 꺼내는 도우미입니다.
  const value = (key) => address.searchParams.getAll(key).filter(Boolean)[0] || "";
  const has = (key) => value(key) !== "";
  const only = (key, expected) => {
    const values = address.searchParams.getAll(key).filter(Boolean);
    return values.length === 1 && values[0] === expected;
  };

  // 정보원 종류(kind)마다 기사 주소 모양과, 남겨 둘 주소 값(keys)이 다릅니다.
  let valid = false;
  let keys = [];
  if (k === "bosa") {
    valid = p === "/news/articleView.html" && /^\d+$/.test(value("idxno"));
    keys = ["idxno"];
  } else if (k === "gate") {
    valid = /^\/news\/\d+$/.test(p);
  } else if (k === "medicaltimes") {
    valid = p.toLowerCase() === "/main/news/newsview.html" && has("ID");
    keys = ["ID"];
  } else if (k === "dailypharm") {
    valid = /^\/user\/news\/\d+$/.test(p);
  } else if (k === "mohw") {
    valid = p === "/board.es" && only("act", "view") && has("list_no");
    keys = ["mid", "bid", "act", "list_no"];
  } else if (k === "mfds") {
    valid = /\/brd\/m_\d+\/view.do$/.test(p) && has("seq");
    keys = ["seq"];
  } else if (k === "hira") {
    valid = p.endsWith("/bbsDummy.do") && has("brdBltNo");
    keys = ["pgmid", "brdScnBltNo", "brdBltNo"];
  } else if (k === "nhis" || k === "kha" || k === "sev") {
    valid = only("mode", "view") && has("articleNo") && p === new URL(source.listingUrl).pathname;
    keys = ["mode", "articleNo"];
  } else if (k === "amc") {
    valid = p === "/news/con/detail.do" && has("cntId");
    keys = ["cntId", "pressChk"];
  } else if (k === "snuh") {
    const pressPage = p.includes("/press/");
    const boardPage = p === "/board/B003/view.do" && (allowAlternate || source.listingUrl.includes("/board/B003/list.do"));
    valid = p.endsWith("/view.do") && has("bbs_no") && (pressPage || boardPage);
    keys = ["bbs_no", "viewType"];
  } else if (k === "cmc") {
    valid = /^\/page\/board\/news\/\d+$/.test(p);
  } else if (k === "etnews") {
    valid = /^\/20\d{12}$/.test(p);
  } else if (k === "yna") {
    valid = /^\/view\/AKR\d+$/.test(p);
  } else if (k === "yakup") {
    valid = p === "/news/index.html" && only("mode", "view") && has("nid");
    keys = ["mode", "cat", "cat2", "nid"];
  } else if (k === "whosaeng") {
    valid = /^\/\d+$/.test(p) || (p.endsWith("/read.php") && has("uid"));
    keys = ["uid"];
  } else if (k === "medipana") {
    if (p === "/news/articleView.html" && has("idxno")) {
      valid = true;
      keys = ["idxno"];
    } else if (p.endsWith("articleView.php") && has("news_idx")) {
      valid = true;
      keys = ["news_idx"];
    } else if (p.endsWith("article/view.php") && (has("news_idx") || has("idxno"))) {
      valid = true;
      keys = ["news_idx", "idxno"];
    }
  }
  if (!valid) return null;

  // 필요한 값만 이름순으로 붙여서 항상 같은 모양의 주소를 만듭니다. (같은 기사를 두 번 저장하지 않도록)
  const query = new URLSearchParams();
  for (const key of keys.filter(has).sort()) query.append(key, value(key));
  const base = new URL(source.url);
  const queryText = query.toString();
  return base.protocol + "//" + base.host + p + (queryText ? "?" + queryText : "");
}

// ───────────────────────── 페이지 가져오기 ─────────────────────────

// 정보원 페이지를 가져옵니다. 안전을 위해 등록된 사이트만, 크기·시간·이동 횟수를 제한합니다.
export async function fetchPage(url, source, maxSize = 750000, jsonResponse = false) {
  const waitSeconds = source.kind === "mfds" ? 30 : 15;
  const signal = AbortSignal.timeout(waitSeconds * 1000);
  const accept = jsonResponse ? "application/json" : "text/html";
  let target = new URL(url);
  try {
    // 다른 주소로 이동하라는 응답(301, 302 등)은 4번까지만 따라갑니다.
    for (let hop = 0; hop < 4; hop++) {
      const outside = !["http:", "https:"].includes(target.protocol) || hostOf(target.href) !== hostOf(source.url);
      if (outside || target.username || target.password || target.port) throw new Error("등록된 정보원 주소가 아닙니다.");

      const response = await fetch(target.href, {
        redirect: "manual",
        signal,
        headers: { "User-Agent": "SMDNewsMonitor/1.0", Accept: accept },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("Location");
        await response.body?.cancel();
        if (!next) throw new Error("이동 주소 없음");
        target = new URL(next, target);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("정보원 HTTP " + response.status + " · 서버가 수집 요청을 받지 못했습니다.");
      }
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.toLowerCase().includes(jsonResponse ? "json" : "text/html")) {
        await response.body?.cancel();
        throw new Error("응답 형식이 맞지 않습니다.");
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > maxSize) throw new Error("페이지 크기 제한 초과");

      // 한글 사이트 중에는 EUC-KR로 된 곳이 있어서, 페이지가 알려주는 글자 방식(charset)으로 읽습니다.
      const charsetPattern = /charset\s*=\s*["']?([\w-]+)/i;
      let charset = contentType.match(charsetPattern)?.[1];
      if (!charset) charset = new TextDecoder().decode(bytes.slice(0, 4096)).match(charsetPattern)?.[1];
      let page;
      try {
        page = new TextDecoder(charset || "utf-8").decode(bytes);
      } catch {
        page = new TextDecoder().decode(bytes);
      }
      const blocked = /Web Application Firewall page block|웹방화벽|접근이 차단되었습니다|비정상적인 접근으로 인해 차단/i;
      if (page.length < 5000 && blocked.test(page)) throw new Error("정보원 방화벽에서 접속을 제한했습니다.");
      return page;
    }
    throw new Error("이동 횟수 제한 초과");
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error("정보원 응답 대기시간 초과");
    throw error;
  }
}

// HTMLRewriter로 페이지를 끝까지 읽게 합니다. (읽는 동안 위에서 등록한 함수들이 불립니다)
async function readWith(rewriter, page) {
  const response = new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  await rewriter.transform(response).arrayBuffer();
}

// "a, b" 처럼 쉼표로 여러 개 적힌 선택자를 하나씩 나눕니다.
function splitSelectors(selectors) {
  return selectors.split(",").map((s) => s.trim());
}

// ───────────────────────── 기사 목록 읽기 ─────────────────────────

// 목록 페이지에서 기사 링크와 제목을 모읍니다.
export async function parseCandidates(page, source) {
  const links = []; // 찾은 링크들: { href, titleAttr, text, heading }
  let current = null; // 지금 읽고 있는 <a> 링크
  let headingTag = null; // 링크 안의 제목 태그(h1~h6, strong)를 읽는 중이면 그 태그 이름
  let skipDepth = 0; // <script>, <style> 안이면 글자를 무시합니다.
  let foundEtnewsArea = false;

  // 전자신문은 왼쪽 기사 목록(.col_left) 안의 링크만 씁니다.
  const linkSelector = source.kind === "etnews" ? ".col_left a[href]" : "a[href]";
  const rewriter = new HTMLRewriter();

  if (source.kind === "etnews") {
    rewriter.on(".col_left", { element() { foundEtnewsArea = true; } });
  }
  for (const tag of ["script", "style"]) {
    rewriter.on(tag, {
      element(el) {
        skipDepth++;
        el.onEndTag(() => { skipDepth--; });
      },
    });
  }
  // 링크 시작 → 새 메모를 만들고, 링크가 끝나면 목록에 넣습니다.
  rewriter.on(linkSelector, {
    element(el) {
      const link = { href: el.getAttribute("href"), titleAttr: el.getAttribute("title") || "", text: "", heading: null };
      current = link;
      headingTag = null;
      el.onEndTag(() => {
        links.push(link);
        if (current === link) current = null;
        headingTag = null; // 태그가 엉성하게 닫힌 사이트도 있어서, 링크가 끝나면 제목 읽기도 끝냅니다.
      });
    },
  });
  // 링크 안의 첫 번째 제목 태그 글자를 따로 모읍니다. (사진 설명 대신 진짜 제목을 쓰기 위해)
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "strong"]) {
    rewriter.on(linkSelector + " " + tag, {
      element(el) {
        if (!current || current.heading !== null) return;
        const link = current;
        link.heading = "";
        headingTag = tag;
        el.onEndTag(() => { if (current === link) headingTag = null; });
      },
    });
  }
  // 모든 글자가 여기로 옵니다. 지금 링크 안이면 링크 글자에 붙입니다.
  rewriter.onDocument({
    text(chunk) {
      if (!current || skipDepth > 0) return;
      const piece = chunk.text + (chunk.lastInTextNode ? " " : "");
      current.text += piece;
      if (headingTag !== null && current.heading !== null) current.heading += piece;
    },
  });
  await readWith(rewriter, page);

  if (source.kind === "etnews" && !foundEtnewsArea) throw new Error("전자신문 AI·SW 목록 영역을 찾지 못했습니다.");

  // 같은 주소가 여러 번 나오면, 키워드가 더 잘 맞는 제목 하나만 남깁니다.
  const unique = new Map();
  for (const link of links) {
    let href = link.href;
    // 서울대병원은 링크가 javascript:viewPage('123') 모양이라 실제 주소로 바꿔 줍니다.
    if (source.kind === "snuh" && /^javascript:viewPage/i.test(href)) {
      const id = href.match(/viewPage\(['"](\d+)/i)?.[1];
      if (id) href = "/board/B003/view.do?bbs_no=" + id + "&viewType=true";
    }
    const url = articleUrl(href, source);
    if (!url) continue;

    let title = text(link.heading || link.text);
    const attr = link.titleAttr;
    if ((title.length < 8 || source.kind === "sev") && attr && !/자세히보기|바로가기|다운로드/.test(attr)) {
      title = text(decodeEntities(attr).replace(/\s*자세히 보기$/, ""));
    }
    title = title.replace(/^새글\s*/, "").replace(/\s+New\s+\d{4}-\d{2}-\d{2}.*$/i, "").trim();
    if (title.length < 8 || title.length > 220) continue;

    const groups = keywordMatch(title, source);
    const level = selectionLevel(groups);
    const row = {
      title,
      url,
      groups: groups.map((g) => g.id),
      category: groups.length > 0 ? groups[0].category : null,
      matchLevel: level,
      priority: { full: 2, main: 1, none: 0 }[level],
    };
    if (!unique.has(url) || row.priority > unique.get(url).priority) unique.set(url, row);
  }
  return [...unique.values()].sort((a, b) => b.priority - a.priority);
}

// 정보원 목록 페이지를 가져와 기사 후보를 만듭니다.
export async function loadCandidates(source) {
  let page;
  try {
    page = await fetchPage(source.listingUrl, source);
  } catch (error) {
    // 의학신문(S001)만 https가 안 되면 http로 한 번 더 시도합니다.
    if (source.id !== "S001" || !source.listingUrl.startsWith("https:")) throw error;
    page = await fetchPage(source.listingUrl.replace("https:", "http:"), source);
  }
  let items = await parseCandidates(page, source);

  // 메디게이트뉴스는 목록이 비어 있으면 날짜별 목록(JSON)에서 다시 찾습니다.
  if (items.length === 0 && source.kind === "gate") {
    const endpoint = new URL("/section/date?date=&allOfDateFlag=Y", source.url).href;
    const data = JSON.parse(await fetchPage(endpoint, source, 400000, true));
    let anchors = "";
    for (const day of data.list || []) {
      for (const item of day.newsList || []) {
        const id = String(item.news_id || "");
        if (!/^\d+$/.test(id)) continue;
        const title = String(item.display_title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        anchors += '<a href="/news/' + id + '">' + title + "</a>";
      }
    }
    items = await parseCandidates(anchors, source);
  }
  // 서울대병원은 보도자료 목록이 비어 있으면 다른 게시판 주소로 다시 찾습니다.
  if (items.length === 0 && source.kind === "snuh") {
    const alternate = { ...source, listingUrl: new URL("/board/B003/list.do?viewType=true", source.url).href };
    items = await parseCandidates(await fetchPage(alternate.listingUrl, alternate), alternate);
  }
  if (items.length === 0) throw new Error("기사 링크를 찾지 못했습니다. 동적 목록·접속 제한·주소 변경 여부를 확인해 주세요.");
  return items;
}

// ───────────────────────── 기사 본문 읽기 ─────────────────────────

// 정보원 종류별로 "본문이 들어 있는 곳"의 위치(선택자)입니다.
const SELECTORS = {
  bosa: "#article-view-content-div", gate: ".contarea", medicaltimes: ".view_cont",
  dailypharm: "#newsContent", mohw: ".board_view .contents", mfds: ".bv_cont",
  hira: ".viewCont .view", nhis: ".post-content", kha: ".board-view__txt",
  sev: ".fr-view", amc: ".editArea", yakup: ".article_text_con", yna: ".story-news",
  medipana: "#articleBody, #article-view-content-div, .article-content",
  whosaeng: "#textinput, #news_body_area, .news_body", etnews: "#articleBody",
  snuh: ".boardViewContents, .viewContent", cmc: ".board-view__txt, .board-view-content",
};
// 날짜가 적힌 곳
const DATE_SELECTORS = {
  gate: ".newsinfo", medicaltimes: ".date_info", mohw: ".board_view .info",
  mfds: ".bv_txt01, .bv_info", hira: ".viewCont .writer", amc: ".contViewTit",
  yakup: ".info_con", whosaeng: ".view_info",
};
// 부제목이 적힌 곳
const SUBTITLE_SELECTORS = { bosa: ".article-head-sub", gate: ".subtxt", medicaltimes: ".subTit", yakup: ".sstitle_con" };

const DATE_META_NAMES = ["article:published_time", "date", "datePublished", "pubdate"];

// 기사 페이지에서 발행일, 본문, 부제목, 첫 문단을 꺼냅니다.
export async function articleDetails(page, source, title = "") {
  const kind = source.kind;
  let metaDate = null; // <meta>에 적힌 발행일
  const jsonScripts = []; // <script type="application/ld+json"> 안의 글
  let jsonText = null; // 지금 읽고 있는 ld+json 글
  let skipDepth = 0; // script, style, iframe, noscript 안이면 글자를 무시
  let figureDepth = 0; // 사진(figure) 안이면 첫 문단 후보에서 뺍니다.
  let allText = ""; // 페이지 전체 글자 (식약처 날짜 찾기용)
  let dateArea = null; // 날짜 영역 글자
  let subtitleArea = null; // 부제목 영역 글자
  let readingDate = false;
  let readingSubtitle = false;
  const sections = []; // 본문 후보 영역들
  let section = null; // 지금 읽고 있는 본문 영역
  let paragraph = null; // 지금 읽고 있는 <p>

  const rewriter = new HTMLRewriter();

  // 태그가 끝날 때 할 일을 모아 두는 곳입니다.
  // HTMLRewriter는 한 태그에 "끝나면 할 일(onEndTag)"을 하나만 기억합니다.
  // 예를 들어 부제목 영역이 <p> 태그면 부제목용·문단용 두 개가 부딪혀 하나가 사라집니다.
  // 그래서 각자 atEnd()로 여기에 넣어 두고, 맨 마지막(7번)에 한 번에 등록합니다.
  let endTasks = [];
  const atEnd = (task) => endTasks.push(task);

  // 1) <meta property="article:published_time" content="2026-10-24..."> 에서 날짜 찾기
  rewriter.on("meta", {
    element(el) {
      const name = el.getAttribute("property") || el.getAttribute("name");
      if (!metaDate && DATE_META_NAMES.includes(name)) metaDate = normalizedDate(el.getAttribute("content"));
    },
  });
  // 2) <script>는 화면에 안 보이므로 글자를 무시합니다.
  //    단, 검색엔진용 정보(type="application/ld+json")는 발행일이 들어 있어서 따로 모읍니다.
  rewriter.on("script", {
    element(el) {
      const isJson = (el.getAttribute("type") || "").toLowerCase() === "application/ld+json";
      if (isJson) jsonText = "";
      skipDepth++;
      atEnd(() => {
        skipDepth--;
        if (isJson) {
          jsonScripts.push(jsonText);
          jsonText = null;
        }
      });
    },
  });
  // 3) 그 밖에 화면에 안 보이는 부분도 글자를 무시합니다.
  for (const tag of ["style", "iframe", "noscript"]) {
    rewriter.on(tag, {
      element(el) {
        skipDepth++;
        atEnd(() => { skipDepth--; });
      },
    });
  }
  // 4) 날짜 영역과 부제목 영역: 처음 나온 것 하나만 읽습니다.
  for (const selector of splitSelectors(DATE_SELECTORS[kind] || "time")) {
    rewriter.on(selector, {
      element(el) {
        if (dateArea !== null) return;
        dateArea = "";
        readingDate = true;
        atEnd(() => { readingDate = false; });
      },
    });
  }
  if (SUBTITLE_SELECTORS[kind]) {
    rewriter.on(SUBTITLE_SELECTORS[kind], {
      element(el) {
        if (subtitleArea !== null) return;
        subtitleArea = "";
        readingSubtitle = true;
        atEnd(() => { readingSubtitle = false; });
      },
    });
  }
  // 5) 본문 영역: 영역마다 글자 조각(parts)과 문단(paragraphs)을 따로 모읍니다.
  for (const selector of splitSelectors(SELECTORS[kind] || "article")) {
    rewriter.on(selector, {
      element(el) {
        if (section) return; // 본문 영역 안에 또 본문 영역이 있으면 바깥 것만 씁니다.
        const current = { parts: [], paragraphs: [] };
        section = current;
        atEnd(() => {
          sections.push(current);
          section = null;
          paragraph = null;
        });
      },
    });
  }
  rewriter.on("figure", {
    element(el) {
      if (!section) return;
      figureDepth++;
      atEnd(() => { figureDepth--; });
    },
  });
  rewriter.on("figcaption", {
    element(el) {
      if (!section) return;
      figureDepth++;
      atEnd(() => { figureDepth--; });
    },
  });
  rewriter.on("p", {
    element(el) {
      if (!section) return;
      // <p>의 속성(class, style 등)을 글로 모아 둡니다. 사진 설명 문단을 거르기 위해서입니다.
      let attrs = "";
      for (const [name, value] of el.attributes) attrs += name + "=" + value + " ";
      paragraph = { text: "", attrs, style: el.getAttribute("style") || "", inFigure: figureDepth > 0 };
      section.paragraphs.push(paragraph);
      const mine = paragraph;
      atEnd(() => { if (paragraph === mine) paragraph = null; });
    },
  });
  // 6) 모든 태그(*)에 대해 맨 마지막에 실행됩니다. 위에서 모아 둔 "끝나면 할 일"을 이 태그에 한 번에 등록합니다.
  rewriter.on("*", {
    element(el) {
      if (endTasks.length === 0) return;
      const tasks = endTasks;
      endTasks = [];
      try {
        el.onEndTag(() => {
          for (const task of tasks) task();
        });
      } catch {
        // <br>처럼 닫는 태그가 없는 태그면 바로 실행합니다.
        for (const task of tasks) task();
      }
    },
  });
  // 7) 모든 글자가 여기로 옵니다. 지금 어디를 읽는 중인지에 따라 알맞은 곳에 붙입니다.
  rewriter.onDocument({
    text(chunk) {
      if (jsonText !== null) {
        jsonText += chunk.text;
        return;
      }
      if (skipDepth > 0) return;
      const piece = chunk.text + (chunk.lastInTextNode ? " " : "");
      allText += piece;
      if (readingDate) dateArea += piece;
      if (readingSubtitle) subtitleArea += piece;
      if (section) {
        section.parts.push({ text: chunk.text, end: chunk.lastInTextNode, paragraph, inFigure: figureDepth > 0 });
        if (paragraph) paragraph.text += piece;
      }
    },
  });
  await readWith(rewriter, page);

  // ── 발행일 정하기: meta → ld+json → 날짜 영역 순서로 찾습니다.
  let published = metaDate || dateFromJson(jsonScripts);
  if (!published) {
    let headerText = text(dateArea || "");
    if (kind === "gate") {
      // 메디게이트는 "기사입력시간 26.10.24" 처럼 연도가 두 자리라 앞에 20을 붙입니다.
      const short = headerText.match(/기사입력시간\s*(\d{2}[./-]\d{2}[./-]\d{2})/);
      if (short) headerText = "20" + short[1];
    }
    published = normalizedDate(headerText);
    if (!published && kind === "mfds") {
      const registered = text(allText).match(/등록일\s*[:：]?\s*(20\d{2}[-.]\d{1,2}[-.]\d{1,2})/);
      published = registered ? normalizedDate(registered[1]) : null;
    }
  }

  // ── 본문 영역 고르기: 50자 이상인 첫 영역 (없으면 마지막 영역)
  if (sections.length === 0) throw new Error("공개 본문을 찾지 못했습니다. 페이지 구조를 확인해 주세요.");
  let chosen = sections[sections.length - 1];
  for (const s of sections) {
    if (text(joinParts(s.parts)).length >= 50) {
      chosen = s;
      break;
    }
  }

  // ── 본문에서 뺄 문단: 제목을 그대로 반복한 문단, 기관 사이트의 가운데 정렬 문단(보통 사진 설명)
  // 비교할 때는 글자·숫자만 남깁니다. (띄어쓰기, 따옴표 차이 무시)
  const fold = (value) => value.replace(/[^\p{L}\p{N}]/gu, "");
  const removed = chosen.paragraphs.filter((p) => {
    const sameAsTitle = title && fold(text(p.text)) === fold(title);
    const centered = ["hira", "mohw", "mfds"].includes(kind) && /text-align\s*:\s*center/i.test(p.style);
    return sameAsTitle || centered;
  });
  const keptParts = chosen.parts.filter((part) => !removed.includes(part.paragraph));

  const body = text(joinParts(keptParts));
  const koreanLetters = body.match(/[가-힣]/g) || [];
  if (body.length < 50 || koreanLetters.length < 15) {
    throw new Error("공개 본문을 찾지 못했습니다. 첨부파일·로그인·동적 본문 여부를 확인해 주세요.");
  }
  if (body.length > 20000) throw new Error("본문 20,000자 제한을 초과했습니다.");

  const subtitle = subtitleArea ? text(subtitleArea).slice(0, 400) : "";

  // ── 첫 문단 찾기: 사진 설명·짧은 글을 건너뛰고 처음 나오는 제대로 된 문단
  const isGood = (value) => value.length >= 8 && !/^(사진|자료|출처)\s*[=:：]|^\[[^\]]+\]$/.test(value);
  let first = "";
  for (const p of chosen.paragraphs) {
    if (removed.includes(p) || p.inFigure || /caption|photo|credit/i.test(p.attrs)) continue;
    const value = text(p.text);
    if (isGood(value)) {
      first = value;
      break;
    }
  }
  // <p>가 없는 사이트는 본문 글자를 줄 단위로 보고 첫 번째 제대로 된 줄을 씁니다.
  if (!first) {
    const lines = joinParts(keptParts.filter((part) => !part.inFigure), "\n").split("\n");
    first = lines.map(text).find(isGood) || "";
  }
  if (!first) throw new Error("첫 문단을 확인하지 못했습니다.");
  if (!published) throw new Error("발행일을 확인하지 못했습니다. 기사 날짜 영역을 확인해 주세요.");

  return {
    date: published,
    body,
    excerpt: {
      format: "excerpt",
      excerpt_version: 2,
      subtitle,
      first_paragraph: first.length <= 300 ? first : first.slice(0, 299).trimEnd() + "…",
    },
  };
}

// 글자 조각들을 이어 붙입니다. 글자 덩어리(텍스트 노드)가 끝날 때마다 사이에 separator를 넣습니다.
function joinParts(parts, separator = " ") {
  let result = "";
  for (const part of parts) result += part.text + (part.end ? separator : "");
  return result;
}

// 검색엔진용 정보(ld+json)에서 기사 발행일(datePublished)을 찾습니다.
function dateFromJson(jsonScripts) {
  for (const raw of jsonScripts) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const queue = Array.isArray(value) ? [...value] : [value];
    for (const item of queue) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
      if (/NewsArticle|Article|ReportageNewsArticle/.test(String(item["@type"] || ""))) {
        const date = normalizedDate(item.datePublished);
        if (date) return date;
      }
    }
  }
  return null;
}

// 기사 하나를 가져와 내용을 꺼냅니다.
export async function readArticle(url, source, title) {
  if (!articleUrl(url, source, true)) throw new Error("등록된 기사 주소가 아닙니다.");
  return articleDetails(await fetchPage(url, source), source, title);
}
