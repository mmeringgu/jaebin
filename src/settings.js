// 설정값을 읽는 곳입니다. (예전 app/settings.py)
// 키워드·정보원 목록은 src/config.json에, 켜고 끄는 설정은 wrangler.toml의 [vars]에 있습니다.
import CONFIG from "./config.json" with { type: "json" };

export { CONFIG };

// "사용" 상태이고 목록 주소가 있는 정보원만 씁니다.
export const SOURCES = CONFIG.sources.filter((s) => s.status === "사용" && s.listingUrl);

// 정보원 ID로 정보원을 바로 찾을 수 있게 표를 만듭니다. 예: SOURCE_BY_ID["S012"]
export const SOURCE_BY_ID = {};
for (const s of SOURCES) SOURCE_BY_ID[s.id] = s;

// 여러 카테고리에 동시에 맞으면 이 순서(숫자가 작을수록 먼저)로 하나를 고릅니다.
export const PRIORITY = { competitor: 0, company: 1, hospital: 2, policy: 3 };

// 설정값을 숫자로 읽습니다. 숫자가 아니거나 범위를 벗어나면 기본값을 씁니다.
export function integer(env, name, defaultValue, low, high) {
  const value = Number(env[name] ?? defaultValue);
  if (Number.isInteger(value) && value >= low && value <= high) return value;
  return defaultValue;
}

export function automationSettings(env) {
  return {
    enabled: String(env.AUTO_ENABLED || "false").toLowerCase() === "true",
    sourceLimit: integer(env, "AUTO_SOURCE_LIMIT", 12, 1, 12),
    maxBodies: integer(env, "AUTO_MAX_BODY_PER_DAY", 120, 1, 240),
  };
}

// 한국 시간(KST) 기준 오늘 날짜("2026-11-02")와 시각(0~23)을 돌려줍니다.
export function koreaNow(time = Date.now()) {
  const korea = new Date(time + 9 * 60 * 60 * 1000);
  return { day: korea.toISOString().slice(0, 10), hour: korea.getUTCHours() };
}

// "2026-11-02"에서 며칠을 빼거나 더한 날짜를 돌려줍니다.
export function addDays(day, days) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
