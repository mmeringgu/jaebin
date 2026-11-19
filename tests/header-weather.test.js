import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function screen(now='2026-11-19T03:00:00Z',options={}){
 const nodes=new Map(),timers=new Map(),listeners=new Map(),frames=[];let timerId=0;
 const animations=[{currentTime:2000},{currentTime:3500}];
 function node(){const classes=new Set();return {style:{},children:[],dataset:{},textContent:'',attributes:{},append(child){this.children.push(child);},setAttribute(key,value){this.attributes[key]=value;},addEventListener(key,value){this[key]=value;},classList:{contains:key=>classes.has(key),toggle(key,value){const on=value??!classes.has(key);if(on)classes.add(key);else classes.delete(key);}}};}
 const get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
 const root=get('header-weather');root.querySelector=get;
 get('.smd-landscape').getAnimations=()=>animations;
 class Clock extends Date{static now(){return Date.parse(now);}}
 const window={scrollY:options.scrollY||0,addEventListener(name,fn){listeners.set(name,fn);},dispatchEvent(event){listeners.get(event.type)?.(event);}};
 const context={Date:Clock,window,document:{hidden:false,getElementById:get,createElement:node,querySelector:get,addEventListener(name,fn){listeners.set(name,fn);}},
  CustomEvent:class{constructor(type){this.type=type;}},requestAnimationFrame(fn){frames.push(fn);return frames.length;},
  matchMedia:()=>({matches:!!options.reduced,addEventListener(){}}),localStorage:{getItem:()=>options.manuallyPaused?'true':null,setItem(){}},AbortSignal,
  fetch:async()=>({ok:true,json:async()=>({scene:options.scene||'sunny',temperature:4,wind:2,forecast_time:now,night:false})}),
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn){listeners.set('refresh',fn);}
 };
 for(const file of ['header','weather'])runInNewContext(readFileSync(new URL('../static/'+file+'.js',import.meta.url),'utf8'),context);
 const scroll=y=>{window.scrollY=y;listeners.get('scroll')();frames.shift()();};
 const stop=()=>{const [id,timer]=Array.from(timers.entries())[0];timers.delete(id);timer.fn();};
 return {root,get,timers,animations,listeners,scroll,stop};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('작은 스크롤과 배너 축소에 따른 108px 위치 보정으로 확대·축소가 반복되지 않습니다',()=>{
 const ui=screen(),header=ui.get('.topbar');
 for(const y of [100,0,120,12,0]){
  ui.scroll(y);assert.equal(header.classList.contains('is-compact'),false);
 }
 ui.scroll(161);assert.equal(header.classList.contains('is-compact'),true);
 for(const y of [53,54,52,10]){
  ui.scroll(y);assert.equal(header.classList.contains('is-compact'),true);
 }
 ui.scroll(0);assert.equal(header.classList.contains('is-compact'),false);
 const restored=screen(undefined,{scrollY:161});
 assert.equal(restored.get('.topbar').classList.contains('is-compact'),true);
});

test('최초에는 6초 재생하고 스크롤 축소와 독립적으로 정지하며 최상단 복귀 때 다시 시작합니다',async()=>{
 const ui=screen();await flush();
 assert.equal(ui.root.classList.contains('paused'),false);assert.equal(ui.timers.size,1);
 assert.equal(Array.from(ui.timers.values())[0].ms,6000);assert.ok(ui.animations.every(animation=>animation.currentTime===0));
 ui.scroll(180);assert.equal(ui.get('.topbar').classList.contains('is-compact'),true);
 assert.equal(ui.root.classList.contains('paused'),false);
 ui.stop();assert.equal(ui.root.classList.contains('paused'),true);
 ui.animations.forEach(animation=>{animation.currentTime=6000;});
 ui.scroll(0);assert.equal(ui.get('.topbar').classList.contains('is-compact'),false);
 assert.equal(ui.root.classList.contains('paused'),false);assert.ok(ui.animations.every(animation=>animation.currentTime===0));
 ui.stop();ui.scroll(0);assert.equal(ui.root.classList.contains('paused'),true);assert.equal(ui.timers.size,0);
 await ui.listeners.get('refresh')();await flush();assert.equal(ui.timers.size,0);
});
test('한국 날짜의 계절 경계와 11월 중순의 겨울 전환을 반영합니다',async()=>{
 for(const [now,season] of [['2026-03-01T00:00:00Z','spring'],['2026-06-01T00:00:00Z','summer'],['2026-09-01T00:00:00Z','autumn'],['2026-11-14T14:59:00Z','autumn'],['2026-11-14T15:00:00Z','winter'],['2026-02-28T14:59:00Z','winter']]){
  const ui=screen(now);await flush();assert.equal(ui.root.dataset.season,season,now);
 }
 const snow=screen(undefined,{scene:'snowy'});await flush();assert.equal(snow.root.dataset.weather,'snowy');assert.equal(snow.root.dataset.season,'winter');
});
test('사용자 일시 정지와 모션 감소 설정을 최상단 재진입 때도 존중합니다',async()=>{
 for(const options of [{manuallyPaused:true},{reduced:true}]){
  const ui=screen(undefined,options);await flush();assert.equal(ui.root.classList.contains('paused'),true);assert.equal(ui.timers.size,0);
  ui.scroll(180);ui.scroll(0);assert.equal(ui.root.classList.contains('paused'),true);assert.equal(ui.timers.size,0);
 }
 const ui=screen();await flush();ui.get('.weather-pause').click();assert.equal(ui.root.classList.contains('paused'),true);assert.equal(ui.timers.size,0);
 ui.get('.weather-pause').click();assert.equal(ui.root.classList.contains('paused'),false);assert.equal(ui.timers.size,1);
});
