// 수집 경로 대신 실제 매체 이름을 표시합니다. 매체명이 없으면 원문 사이트를 씁니다.
export function articleSourceName(name, url) {
  const cleaned = String(name || "").normalize("NFKC").replace(/\s*\(빙\s*검색\)\s*$/u, "").trim();
  if (cleaned && !/^빙\s*(?:뉴스\s*)?검색/u.test(cleaned)) return cleaned;
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "출처 미확인"; }
}
