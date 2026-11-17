import { test } from "node:test";
import assert from "node:assert/strict";
import { planNextTask, dailyTargets, dueCollections, schedulerState, collectionCadence } from "../src/scheduler.js";
import { SOURCE_BY_ID } from "../src/settings.js";

const day = "2026-11-17";
const sources = ["S030", "S029", "S028", "S012", "S018", "B002", "B003", "S014"].map((id) => SOURCE_BY_ID[id]);
const lists = (ids = sources.map((s) => s.id), slot = "am") => ids.map((source_id) => ({
  source_id, kind: "list", status: "success", job_key: `${day}:list:${source_id}:${slot}`,
  started_at: slot === "pm" ? "2026-11-17 05:00:00" : "2026-11-16 22:00:00",
}));
const candidate = (id, category, source_id = "S012", changes = {}) => ({
  id, source_id, source_name: SOURCE_BY_ID[source_id].name, suggested_category: category,
  title: `${category} 관련 기사 ${id}`, published_date: day, ...changes,
});
const body = (row, changes = {}) => ({ ...row, category: row.category || row.suggested_category,
  kind: "body", status: "success", article_id: row.id, ...changes });
const input = (changes = {}) => ({ sources, day, hour: 10, daily: lists(), pending: [], runs: [], published: [], maxBodies: 160, ...changes });

test("하루 160회 목표와 설정을 줄였을 때의 비율을 정확히 배분합니다", () => {
  assert.deepEqual(dailyTargets(160), { company: 30, policy: 45, competitor: 45, hospital: 30, conference: 10 });
  assert.deepEqual(dailyTargets(32), { company: 6, policy: 9, competitor: 9, hospital: 6, conference: 2 });
  assert.equal(Object.values(dailyTargets(121)).reduce((a, b) => a + b, 0), 121);
});

test("본사 목록 다음에 본사 원문을 즉시 처리하고 글로벌·일본 순서로 이어갑니다", () => {
  const pending = [candidate(1, "company", "S030"), candidate(2, "company", "S029"), candidate(3, "company", "S028")];
  const state = input({ daily: [], pending });
  let next = planNextTask(state);
  assert.equal(next.kind, "list");assert.equal(next.source.id, "S030");
  state.daily.push(...lists(["S030"]));
  next = planNextTask(state);
  assert.equal(next.kind, "body");assert.equal(next.candidate.id, 1);
  state.daily.push(body(next.candidate));
  next = planNextTask(state);
  assert.equal(next.kind, "list");assert.equal(next.source.id, "S029");
  state.daily.push(...lists(["S029"]));
  next = planNextTask(state);
  assert.equal(next.candidate.id, 2);
  state.daily.push(body(next.candidate));
  assert.equal(planNextTask(state).source.id, "S028");
});

test("일반 목록 수집과 원문 처리를 교대로 진행합니다", () => {
  const state = input({ daily: lists(["S030", "S029", "S028"]), pending: [candidate(1, "policy")] });
  let next = planNextTask(state);
  assert.equal(next.kind, "body");assert.equal(next.candidate.category, "policy");
  state.daily.push(body(next.candidate));
  next = planNextTask(state);
  assert.equal(next.kind, "list");assert.equal(next.source.id, "S012");
});

test("카테고리가 모두 있으면 정책·경쟁사·병원·학회를 목표량까지 고르게 처리합니다", () => {
  const pending = [];
  for (const category of ["company", "policy", "competitor", "hospital", "conference"]) {
    for (let i = 0; i < 12; i++) pending.push(candidate(pending.length + 1, category, category === "company" ? "S028" : "S012"));
  }
  const state = input({ maxBodies: 32, hour: 18, pending, daily: [...lists(), ...lists(["S030", "S029", "S012", "S018", "B002", "B003"], "pm")] });
  const counts = {};
  for (let i = 0; i < 32; i++) {
    const next = planNextTask(state);
    assert.equal(next.kind, "body");
    counts[next.candidate.category] = (counts[next.candidate.category] || 0) + 1;
    state.daily.push(body(next.candidate));
  }
  assert.deepEqual(counts, dailyTargets(32));
  assert.equal(planNextTask(state).status, "limit");
});

test("정책·병원 후보가 있으면 경쟁사가 배정량을 먼저 빼앗지 못합니다", () => {
  const daily = [...lists(), ...lists(["S030", "S029", "S012", "S018", "B002", "B003"], "pm")];
  let id = 100;
  for (const [category, count] of Object.entries({ company: 30, policy: 44, competitor: 45, hospital: 29, conference: 9 })) {
    for (let i = 0; i < count; i++) daily.push(body(candidate(id++, category)));
  }
  const state = input({ hour: 18, daily, pending: [candidate(1, "policy"), candidate(2, "hospital"), candidate(3, "conference"), candidate(4, "competitor")] });
  const chosen = [];
  for (let i = 0; i < 3; i++) {
    const next = planNextTask(state);chosen.push(next.candidate.category);state.daily.push(body(next.candidate));
  }
  assert.deepEqual(new Set(chosen), new Set(["policy", "hospital", "conference"]));
});

test("캐논 오후 여유 10회를 보호하고 17시부터 남은 몫을 재배분합니다", () => {
  const daily = [...lists(), ...lists(["S030", "S029", "S012", "S018", "B002", "B003"], "pm")];
  for (let i = 0; i < 150; i++) daily.push(body(candidate(1000 + i, "policy")));
  const state = input({ hour: 16, daily, pending: [candidate(1, "hospital")] });
  assert.equal(planNextTask(state).status, "reserved");
  state.pending.push(candidate(2, "company", "S029"));
  assert.equal(planNextTask(state).candidate.id, 2);
  state.pending.pop();state.hour = 17;
  assert.equal(planNextTask(state).candidate.id, 1);
});

test("중복 소식은 후순위지만 숫자가 바뀐 추가 정보는 새 소식으로 처리합니다", () => {
  const state = input({ pending: [
    candidate(1, "competitor", "B002", { title: "지멘스, 의료기기 공장 500억원 투자" }),
    candidate(2, "competitor", "B003", { title: "지멘스 의료기기 공장 500억원 투자" }),
    candidate(3, "competitor", "S012", { title: "지멘스 의료기기 공장 600억원 투자" }),
  ] });
  let next = planNextTask(state);assert.equal(next.candidate.id, 1);
  state.daily.push(body(next.candidate));
  next = planNextTask(state);assert.equal(next.candidate.id, 3);
  assert.equal(next.state.queue.find((a) => a.id === 2).duplicate, true);
});

test("오전 캐논 처리는 20회까지이며 남은 10회는 오후에 사용합니다", () => {
  const daily = [...lists()];
  for (let i = 0; i < 20; i++) daily.push(body(candidate(1000 + i, "company", "S030")));
  const state = input({ daily, pending: [candidate(1, "company", "S029")] });
  assert.equal(planNextTask(state).status, "reserved");
  state.hour = 14;
  state.daily.push(...lists(["S030", "S029", "S012", "S018", "B002", "B003"], "pm"));
  assert.equal(planNextTask(state).candidate.id, 1);
});

test("경쟁사와 매체를 번갈아 선택하고 오늘 실패한 정보원은 세 번 이후 건너뜁니다", () => {
  const first = candidate(1, "competitor", "B002", { title: "지멘스 의료기기 신제품 1 출시" });
  const state = input({ daily: [...lists(), body(first)], pending: [
    candidate(2, "competitor", "B002", { title: "지멘스 의료기기 신제품 2 출시" }),
    candidate(3, "competitor", "B003", { title: "GE헬스케어 의료기기 출시" }),
  ] });
  assert.equal(planNextTask(state).candidate.id, 3);
  for (let i = 0; i < 3; i++) state.daily.push(body(candidate(10 + i, "competitor", "B003"), { status: "error" }));
  assert.equal(planNextTask(state).candidate.id, 2);
});

test("오후 재수집은 별도 슬롯이며 기존 형식 작업 기록과 수동 수집도 존중합니다", () => {
  const jobs = lists(["S030", "S028"]);
  assert.equal(dueCollections(sources.slice(0, 3), day, 13, jobs).some((a) => a.source.id === "S030"), false);
  assert.equal(dueCollections(sources.slice(0, 3), day, 14, jobs).find((a) => a.source.id === "S030").slot, "pm");
  const legacy = [{ source_id: "S030", kind: "list", job_key: day + ":list:S030", started_at: "2026-11-16 22:00:00" }];
  assert.equal(dueCollections([SOURCE_BY_ID.S030], day, 10, legacy).length, 0);
  assert.equal(dueCollections([SOURCE_BY_ID.S030], day, 14, legacy).length, 1);
  assert.equal(dueCollections([SOURCE_BY_ID.S030], day, 14, legacy, [{ source_id: "S030", last_run: "2026-11-17 05:05:00" }]).length, 0);
});

test("느린 기관은 한국 날짜 기준 2~3일 주기로 확인하며 실패 다음 날은 재시도합니다", () => {
  assert.deepEqual(collectionCadence({ kind: "snuh" }), { days: 3, twice: false });
  assert.equal(dueCollections([SOURCE_BY_ID.S014], day, 10, [], [{ source_id: "S014", last_success: "2026-11-16 01:00:00" }]).length, 0);
  assert.equal(dueCollections([SOURCE_BY_ID.S014], day, 10, [], [{ source_id: "S014", last_success: "2026-11-15 01:00:00" }]).length, 1);
  assert.equal(dueCollections([SOURCE_BY_ID.S014], day, 10, [], [{ source_id: "S014", last_run: "2026-11-16 01:00:00" }]).length, 1);
});

test("통계는 학회·오늘 처리·대기·중복 후순위·배정 목표를 구분합니다", () => {
  const state = schedulerState(input({ pending: [candidate(1, "hospital", "S014", { title: "영상의학 학회 심포지엄 2026" })] }));
  const row = state.categories.find((c) => c.category === "conference");
  assert.equal(row.pending, 1);assert.equal(row.target, 10);
  assert.equal(state.categories.find((c) => c.category === "hospital").pending, 0);
});
