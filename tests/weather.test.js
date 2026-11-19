import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWeather,weatherScene} from '../src/weather.js';
import worker from '../src/index.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function forecast(now=Date.now(),symbol='clearsky_day',wind=2){
 return {properties:{meta:{updated_at:new Date(now).toISOString()},timeseries:[{time:new Date(now).toISOString(),data:{instant:{details:{air_temperature:12.4,wind_speed:wind}},next_1_hours:{summary:{symbol_code:symbol}}}}]}};
}
test('8가지 장면은 강수·안개를 우선하고 비바람·진눈깨비·낮밤을 함께 반영합니다',()=>{
 for(const [symbol,scene] of [['clearsky_day','sunny'],['fair_day','cloudy'],['partlycloudy_night','cloudy'],['cloudy','overcast'],['fog','foggy'],['rain','rainy'],['heavyrainandthunder','thunder'],['snow','snowy'],['sleet','snowy']]){
  assert.equal(weatherScene(symbol,2),scene);
 }
 assert.equal(weatherScene('clearsky_day',5),'windy');
 assert.equal(weatherScene('rain',8),'rainy');
 const now=Date.parse('2026-11-19T12:00:00Z');
 const result=normalizeWeather(forecast(now,'heavysleet',7),now);
 assert.equal(result.night,true);assert.equal(result.windy,true);assert.equal(result.mixed,true);assert.equal(result.heavy,true);assert.equal(result.temperature,12);
 assert.equal(normalizeWeather(forecast(now,'clearsky_day'),now).night,false);
});
test('현재 시간에 해당하는 예보를 고르고 오래되거나 잘못된 응답을 거부합니다',()=>{
 const now=Date.parse('2026-11-19T02:30:00Z'),data=forecast(now-30*60000);
 data.properties.timeseries.unshift(...forecast(now-90*60000,'rain').properties.timeseries);
 data.properties.timeseries.push(...forecast(now+30*60000,'snow').properties.timeseries);
 assert.equal(normalizeWeather(data,now).scene,'sunny');
 assert.throws(()=>normalizeWeather(forecast(now-4*3600000),now));
 assert.throws(()=>normalizeWeather({}));
 const invalid=forecast(now);invalid.properties.timeseries[0].data.instant.details.air_temperature=null;
 assert.throws(()=>normalizeWeather(invalid,now));
});
test('날씨 API는 DB 없이 동작하고 실패를 안내하며 같은 지점 예보를 재사용합니다',async(t)=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('offline');});
 const request=()=>worker.fetch(new Request('https://example.com/api/weather'),{});
 assert.equal((await request()).status,503);
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.match(url,/lat=37\.5172&lon=127\.0473/);assert.match(options.headers['User-Agent'],/SMDNewsClipping/);
  return Response.json(forecast());
 });
 const response=await request();assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.scene,'sunny');assert.equal(data.forecast,true);assert.equal(data.location,'서울 강남구');
 assert.equal((await request()).status,200);assert.equal(calls,2);
});
test('화면은 날씨 응답을 표시하고 실패 시 마지막 정보를 유지하며 동작을 정지할 수 있습니다',async()=>{
 const nodes=new Map(),listeners=new Map(),classes=new Set();let data=normalizeWeather(forecast(Date.now(),'snow',7)),fail=false,callCount=0;
 function node(){return {style:{},textContent:'',attributes:{},children:[],append(child){this.children.push(child);},setAttribute(key,value){this.attributes[key]=value;},addEventListener(key,value){this[key]=value;}};}
 const get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
 const root=get('header-weather');root.dataset={};root.querySelector=get;
 root.classList={contains:key=>classes.has(key),toggle(key,value){const on=value??!classes.has(key);if(on)classes.add(key);else classes.delete(key);}};
 runInNewContext(readFileSync(new URL('../static/weather.js',import.meta.url),'utf8'),{
  document:{getElementById:get,createElement:node,hidden:false,addEventListener(key,value){listeners.set(key,value);}},
  fetch:async()=>{callCount++;if(fail)throw new Error('offline');return {ok:true,json:async()=>data};},
  localStorage:{getItem:()=>null,setItem(){}},AbortSignal,Date,setInterval(fn){listeners.set('interval',fn);},setTimeout(fn){listeners.set('stop',fn);return 1;},clearTimeout(){}
 });
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(root.dataset.weather,'snowy');assert.match(get('weather-reading').textContent,/雪|눈/);assert.ok(classes.has('blustery'));
 assert.equal(get('.precipitation').children.length,24);
 get('.weather-pause').click();assert.ok(classes.has('paused'));
 fail=true;await listeners.get('interval')();await new Promise(resolve=>setImmediate(resolve));
 assert.match(get('weather-reading').textContent,/갱신 지연/);assert.equal(root.dataset.weather,'snowy');
 fail=false;data={scene:'not-a-scene',temperature:0};listeners.get('interval')();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(root.dataset.weather,'snowy');assert.equal(callCount,3);
});
