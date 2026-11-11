import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// 실제 화면 코드의 순수 함수를 실행해 DOM 없이 중복 판정을 검증합니다.
const sharedScript = readFileSync(new URL("../static/news-rules.js", import.meta.url), "utf8");
const script = readFileSync(new URL("../static/articles.js", import.meta.url), "utf8");
const { groupSameNews, titlePieces, similarity, sortRows } = runInNewContext(
  sharedScript + "\n" + script.slice(0, script.indexOf("function render(){")) +
  "\n({ groupSameNews, titlePieces, similarity, sortRows });",
);
const article = (id, changes = {}) => ({
  id, date: "2026-11-11", title: "캐논메디칼 새 MRI 장비 공개",
  category: "company", source: "매체" + id, saved_at: "2026-11-11 00:00:00",
  tags: [], ...changes,
});

test("동일 날짜에는 적게 겹치는 제목도 한 기사로 묶습니다", () => {
  const older = article(1, { title: "인공지능 영상판독 정확도 개선 신기술 발표" });
  const newer = article(2, { title: "인공지능 영상판독 도입 확대 임상연구 성과 공개" });
  const score = similarity(titlePieces(older.title), titlePieces(newer.title));
  assert.ok(score >= 0.15 && score < 0.25, String(score));
  const groups = groupSameNews([older, newer]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].main.id, 2);
});

test("별표와 관련도보다 최근 수집 시각을 우선해 대표를 선택합니다", () => {
  const older = article(99, { starred: true, tags: ["MRI", "장비"], saved_at: "2026-11-11 01:00:00" });
  const newer = article(2, { saved_at: "2026-11-11 02:00:00" });
  for (const sort of ["relevance", "new"]) {
    const rows = sortRows([older, newer], sort);
    assert.equal(groupSameNews(rows)[0].main, newer);
  }
});

test("카테고리나 정보원이 달라도 중복은 한 건만 표시합니다", () => {
  const older = article(1, { category: "company" });
  const newer = article(2, { category: "hospital" });
  const groups = groupSameNews([older, newer]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].main, newer);
  assert.equal(groups[0].others[0], older);
});

test("날짜가 다른 기사는 기존의 엄격한 기준과 3일 범위를 유지합니다", () => {
  const older = article(1, { title: "인공지능 영상판독 정확도 개선 신기술 발표" });
  const newer = article(2, { date: "2026-11-12", title: "인공지능 영상판독 도입 확대 임상연구 성과 공개" });
  assert.equal(groupSameNews([older, newer]).length, 2);
  assert.equal(groupSameNews([article(1), article(2, { date: "2026-11-15" })]).length, 2);
  const groups = groupSameNews([article(99), article(1, { date: "2026-11-12" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].main.date, "2026-11-12");
});

test("관련 없는 기사와 빈 제목은 합치지 않으며 원래 배열을 변경하지 않습니다", () => {
  const rows = [article(1), article(2, { title: "의대 신설 추진" }), article(3, { title: "" })];
  assert.equal(groupSameNews(rows).length, 3);
  assert.deepEqual(rows.map((a) => a.id), [1, 2, 3]);
  assert.equal(groupSameNews([article(1, { title: "" }), article(2, { title: "" })]).length, 2);
});

test("두 묶음에 걸치는 기사를 만나면 묶음을 합치고 최신 대표를 유지합니다", () => {
  const rows = [
    article(3, { title: "가나다라마바사아자차" }),
    article(2, { title: "카타파하거너더러머버" }),
    article(1, { title: "가나다라마바사아자차 카타파하거너더러머버" }),
  ];
  const groups = groupSameNews(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].main.id, 3);
  assert.equal(groups[0].others.length, 2);
});
