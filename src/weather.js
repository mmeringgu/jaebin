// 강남구청 부근 대표 좌표의 시간별 예보입니다. 관측 실황이 아닌 예보임을 화면에도 표시합니다.
const FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=37.5172&lon=127.0473';
const CACHE_MS = 3 * 60 * 60 * 1000;
let memory, pending;

export function weatherScene(symbol, wind) {
  if (/thunder/.test(symbol)) return 'thunder';
  if (/snow|sleet/.test(symbol)) return 'snowy';
  if (/rain/.test(symbol)) return 'rainy';
  if (/fog/.test(symbol)) return 'foggy';
  if (wind >= 5) return 'windy'; // 화면 표현 기준이며 강풍 특보 기준은 아닙니다.
  if (/^cloudy/.test(symbol)) return 'overcast';
  if (/partlycloudy|fair/.test(symbol)) return 'cloudy';
  if (/clearsky/.test(symbol)) return 'sunny';
  return 'overcast';
}

export function normalizeWeather(forecast, now = Date.now()) {
  const rows = forecast?.properties?.timeseries;
  if (!Array.isArray(rows) || !rows.length) throw new Error('날씨 예보가 비어 있습니다.');
  const valid = rows.filter(row => Number.isFinite(Date.parse(row.time))).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const row = valid.filter(row => Date.parse(row.time) <= now).at(-1) || valid[0];
  if (!row || Math.abs(Date.parse(row.time) - now) > 3 * 3600000) throw new Error('현재 시간의 날씨 예보가 없습니다.');
  const instant = row.data?.instant?.details;
  const period = row.data?.next_1_hours || row.data?.next_6_hours;
  const symbol = period?.summary?.symbol_code || '';
  if (!Number.isFinite(instant?.air_temperature) || !Number.isFinite(instant?.wind_speed) || !symbol) throw new Error('날씨 응답 형식이 올바르지 않습니다.');
  const localHour = new Date(now + 9 * 3600000).getUTCHours();
  return { location:'서울 강남구', temperature:Math.round(instant.air_temperature),
    wind:instant.wind_speed, windy:instant.wind_speed >= 5,
    scene:weatherScene(symbol, instant.wind_speed),
    night:symbol.endsWith('_night') || (!symbol.endsWith('_day') && (localHour < 7 || localHour >= 18)),
    mixed:/sleet/.test(symbol), heavy:/heavy/.test(symbol),
    forecast_time:row.time, updated_at:forecast.properties.meta?.updated_at || row.time,
    source:'MET Norway', source_url:'https://www.met.no/en', forecast:true };
}

async function loadForecast() {
  const cache = globalThis.caches?.default;
  const key = new Request(FORECAST_URL);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const expires=Number(hit.headers.get('X-Weather-Expires'));
      if (expires>Date.now()) { const data=await hit.json(); normalizeWeather(data); memory={data,expires}; return data; }
    }
  }
  const response = await fetch(FORECAST_URL, { headers:{'User-Agent':'SMDNewsClipping/1.0 (https://github.com/mmeringgu/jaebin)', Accept:'application/json'}, signal:AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('날씨 정보를 가져오지 못했습니다.');
  const data = await response.json();
  normalizeWeather(data);
  memory = { data, expires:Date.now()+CACHE_MS };
  if (cache) {
    try { await cache.put(key, new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=10800','X-Weather-Expires':String(memory.expires)}})); }
    catch { /* 캐시 저장 실패가 날씨 표시를 중단하지 않습니다. */ }
  }
  return data;
}

export async function gangnamWeather() {
  try {
    if (memory?.expires > Date.now()) return {...normalizeWeather(memory.data), stale:false};
    if (!pending) pending=loadForecast().finally(()=>{pending=undefined;});
    return {...normalizeWeather(await pending), stale:false};
  } catch (error) {
    if (memory && Date.now()-memory.expires < 3*3600000) {
      try { return {...normalizeWeather(memory.data), stale:true}; } catch {}
    }
    throw Object.assign(new Error('날씨 정보를 잠시 불러올 수 없습니다.'),{status:503});
  }
}
