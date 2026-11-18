// 목록 수집 주기·카테고리 배분·중복 후순위 결정을 DB 없이 계산합니다.
import { CONFIG, SOURCE_BY_ID, koreaNow } from "./settings.js";
import { hasWord } from "./rules.js";

const config = CONFIG.automation;
const categories = ["company", "policy", "competitor", "hospital", "conference"];
const labels = { company: "캐논", policy: "정책", competitor: "경쟁사", hospital: "병원", conference: "학회" };
const rotation = ["policy", "competitor", "hospital", "policy", "competitor", "conference"];
const conference = /학회|학술대회|학술회의|심포지엄|symposium|congress|conference/i;
const failure = (job) => ["error", "aborted"].includes(job.status);
const utcTime = (value) => {
  if (!value) return 0;
  const text = String(value).replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : text + "Z");
};
const total = (values) => values.reduce((sum, n) => sum + n, 0);

export function dailyTargets(maxBodies) {
  const base = config.daily_targets;
  const scale = maxBodies / total(Object.values(base));
  const targets = Object.fromEntries(categories.map((c) => [c, Math.floor(base[c] * scale)]));
  let remaining = maxBodies - total(Object.values(targets));
  for (const c of [...categories].sort((a, b) => (base[b] * scale % 1) - (base[a] * scale % 1))) {
    if (remaining <= 0) break;
    targets[c]++;remaining--;
  }
  return targets;
}

export function collectionCadence(source) {
  if (["snuh", "sev", "amc", "cmc"].includes(source.kind)) return { days: 3, twice: false };
  return { days: config.slow_sources[source.id] || 1, twice: config.twice_daily_sources.includes(source.id) };
}

export function canonRank(sourceId) {
  const index = config.canon_source_order.indexOf(sourceId);
  return index < 0 ? 1000 : index;
}

export function dueCollections(sources, day, hour, jobs, runs = []) {
  if (hour < 7) return [];
  const today = Date.parse(day + "T00:00:00+09:00");
  return sources.flatMap((source) => {
    const cadence = collectionCadence(source);
    const slot = cadence.twice && hour >= config.afternoon_hour ? "pm" : "am";
    const slotStart = today + (slot === "pm" ? config.afternoon_hour : 7) * 3600000;
    const completedSlot = jobs.some((j) => j.kind === "list" && j.source_id === source.id && (
      j.job_key === day + ":list:" + source.id + ":" + slot ||
      (j.job_key === day + ":list:" + source.id && (slot === "am" || utcTime(j.started_at) >= slotStart))
    ));
    if (completedSlot) return [];
    const record = runs.find((r) => r.source_id === source.id);
    // 수동 수집도 같은 시간대 목록 확인으로 인정합니다.
    if (utcTime(record?.last_run) >= slotStart) return [];
    const lastDay = record?.last_success ? koreaNow(utcTime(record.last_success)).day : "1970-01-01";
    if (cadence.days > 1 && Date.parse(day) - Date.parse(lastDay) < cadence.days * 86400000) return [];
    return [{ source, slot }];
  }).sort((a, b) => canonRank(a.source.id) - canonRank(b.source.id));
}

function annotate(row) {
  const source = SOURCE_BY_ID[row.source_id];
  let category = row.category || row.suggested_category || source?.categories[0] || "hospital";
  if (source?.kind === "canon_official") category = "company";
  if (category === "hospital" && conference.test(row.title || "")) category = "conference";
  let entity = row.entity || "";
  if (category === "competitor") {
    entity = source?.rule_id || CONFIG.rules.find((r) => r.category === "competitor" && r.main.some((word) => hasWord(row.title || "", word)))?.id || entity || row.source_id;
  }
  const title = row.title || "";
  const signature = [...new Set(title.normalize("NFKC").match(/\d+(?:[.,]\d+)*/g) || [])].sort().join("|");
  return { ...row, category, entity, story: { signature, pieces: globalThis.NewsRules.titlePieces(title) } };
}

function sameStory(a, b) {
  if (!a.title || !b.title || a.category !== b.category) return false;
  if (a.category === "competitor" && a.entity !== b.entity) return false;
  const dateA = a.published_date || a.first_collected_at?.slice(0, 10);
  const dateB = b.published_date || b.first_collected_at?.slice(0, 10);
  if (!dateA || !dateB || Math.abs(Date.parse(dateA) - Date.parse(dateB)) > 3 * 86400000) return false;
  // 투자액·제품 번호·성능 수치가 다르면 추가 정보로 취급합니다.
  if (a.story.signature !== b.story.signature) return false;
  return globalThis.NewsRules.similarity(a.story.pieces, b.story.pieces) >= 0.6;
}

function pendingQueue(pending, sources, daily, published) {
  const active = new Map(sources.map((s) => [s.id, s]));
  const attempted = new Set(daily.filter((j) => j.kind === "body").map((j) => j.article_id));
  const queued = pending.filter((row) => {
    const source = active.get(row.source_id);
    return source && source.name === row.source_name && !attempted.has(row.id)
      && daily.filter((j) => j.source_id === source.id && failure(j)).length < 3;
  }).map(annotate).sort((a, b) => canonRank(a.source_id) - canonRank(b.source_id)
    || String(b.published_date || "").localeCompare(a.published_date || "") || a.id - b.id);
  const representatives = new Map();
  const key = (row) => row.category + ":" + (row.category === "competitor" ? row.entity : "") + ":" + row.story.signature;
  const remember = (row) => {
    const id = key(row);
    if (!representatives.has(id)) representatives.set(id, []);
    representatives.get(id).push(row);
  };
  for (const row of [...daily.filter((j) => j.kind === "body" && j.status === "success").map(annotate), ...published.map(annotate)]) remember(row);
  return queued.map((row) => {
    const duplicate = (representatives.get(key(row)) || []).some((other) => sameStory(row, other));
    if (!duplicate) remember(row);
    return { ...row, duplicate };
  });
}

export function schedulerState({ sources, day, hour, daily, runs = [], pending = [], published = [], maxBodies }) {
  const bodies = daily.filter((j) => j.kind === "body").map(annotate);
  const targets = dailyTargets(maxBodies);
  const counts = Object.fromEntries(categories.map((c) => [c, bodies.filter((j) => j.category === c).length]));
  const queue = pendingQueue(pending, sources, daily, published);
  const due = dueCollections(sources, day, hour, daily, runs).filter(({ source }) => daily.filter((j) => j.source_id === source.id && failure(j)).length < 3);
  const companyReserve = Math.min(targets.company, config.reserved_company_slots, Math.ceil(config.reserved_company_slots * maxBodies / 160));
  const reserved = hour < config.reserve_release_hour ? Math.min(companyReserve, Math.max(0, targets.company - counts.company)) : 0;
  return { bodies, targets, counts, queue, due, reserved, remaining: Math.max(0, maxBodies - bodies.length),
    companyMorningLimit: targets.company - companyReserve, companyAfternoonReady: hour >= config.afternoon_hour,
    categories: categories.map((category) => ({ category, name: labels[category], target: targets[category],
      done: counts[category], pending: queue.filter((a) => a.category === category).length,
      duplicates: queue.filter((a) => a.category === category && a.duplicate).length })) };
}

function chooseBody(state, maxBodies, canonOnly = false) {
  if (!state.remaining) return null;
  let pool = state.queue.filter((row) => (!canonOnly || row.category === "company")
    && (row.category !== "company" || state.companyAfternoonReady || state.counts.company < state.companyMorningLimit)
    && (row.category === "company" || state.bodies.length < maxBodies - state.reserved));
  const novel = pool.filter((row) => !row.duplicate);
  if (novel.length) pool = novel;
  const underTarget = pool.filter((row) => state.counts[row.category] < state.targets[row.category]);
  // 아직 목록을 확인하지 않은 정보원이 있으면 미발견 카테고리의 배정량을 빌리지 않습니다.
  if (underTarget.length) pool = underTarget;
  else if (state.due.length) return null;
  if (!pool.length) return null;
  const rounds = state.bodies.filter((j) => j.category !== "company").length;
  let bucket = canonOnly ? "company" : null;
  for (let i = 0; !bucket && i < rotation.length; i++) {
    const c = rotation[(rounds + i) % rotation.length];
    if (pool.some((row) => row.category === c)) bucket = c;
  }
  bucket ||= "company";
  const sourceUse = (row) => state.bodies.filter((j) => j.source_id === row.source_id).length;
  const entityUse = (row) => state.bodies.filter((j) => j.category === row.category && j.entity === row.entity).length;
  const last = state.bodies.at(-1);
  return pool.filter((row) => row.category === bucket).sort((a, b) => (bucket === "company" ? canonRank(a.source_id) - canonRank(b.source_id) : 0)
    || (bucket === "competitor" ? entityUse(a) - entityUse(b) : 0)
    || Number(a.source_id === last?.source_id) - Number(b.source_id === last?.source_id)
    || sourceUse(a) - sourceUse(b)
    || String(b.published_date || "").localeCompare(a.published_date || "") || a.id - b.id)[0] || null;
}

export function planNextTask(input) {
  const state = schedulerState(input);
  const canonList = state.due.find(({ source }) => canonRank(source.id) < 1000);
  const canonBody = state.counts.company < state.targets.company ? chooseBody(state, input.maxBodies, true) : null;
  // 본사→글로벌→일본→검색 순서이며, 목록을 확보하면 해당 우선순위의 원문을 즉시 처리합니다.
  if (canonBody && (!canonList || canonRank(canonBody.source_id) < canonRank(canonList.source.id))) return { kind: "body", candidate: canonBody, source: SOURCE_BY_ID[canonBody.source_id], state };
  if (canonList) return { kind: "list", ...canonList, state };
  const body = chooseBody(state, input.maxBodies);
  const last = input.daily.at(-1);
  if (body && (last?.kind === "list" || !state.due.length)) return { kind: "body", candidate: body, source: SOURCE_BY_ID[body.source_id], state };
  if (state.due.length) return { kind: "list", ...state.due[0], state };
  if (body) return { kind: "body", candidate: body, source: SOURCE_BY_ID[body.source_id], state };
  const status = !state.remaining ? "limit" : state.queue.length && state.reserved ? "reserved" : "idle";
  return { status, state, message: status === "limit" ? "오늘 기사 처리 상한에 도달했습니다."
    : status === "reserved" ? "캐논 오후 갱신용 " + state.reserved + "회를 남겨두고 대기합니다. " + config.reserve_release_hour + "시부터 다른 기사에도 배분합니다."
    : "현재 처리할 작업이 없습니다. 다음 수집 시간에 다시 확인합니다." };
}
